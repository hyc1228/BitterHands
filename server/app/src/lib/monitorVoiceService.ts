import type { MonitorVoiceMessage } from "../party/protocol";
import { usePartyStore } from "../party/store";

/**
 * Single-channel audio queue for the Monitor PA broadcasts.
 * Plain module — boots once on import, subscribes to the party store, plays
 * clips on a single shared <Audio> element. No UI.
 *
 * Verbose logging is on by default during the hackathon. Filter the DevTools
 * console with `[nz-voice]` to inspect.
 */

const TAG = "[nz-voice]";
const LOG = true;

// Real wav we ship anyway — used to prime the audio element on the first user
// gesture. iOS Safari refuses to grant autoplay permission to data: URIs in
// many cases, but accepts a real audio file. Played muted, then paused.
const UNLOCK_PRIMER_URL = "/voice/ambient_0.wav";

let started = false;

export function startMonitorVoiceService(): void {
  if (started) {
    if (LOG) console.log(TAG, "already started, skipping");
    return;
  }
  started = true;
  if (typeof window === "undefined") return;

  if (LOG) console.log(TAG, "boot");

  const audioEl = new Audio();
  audioEl.preload = "auto";
  // iOS Safari needs `playsinline` semantics on the element so it doesn't try
  // to enter fullscreen on first play. Audio elements honor it via attribute.
  audioEl.setAttribute("playsinline", "");
  audioEl.setAttribute("webkit-playsinline", "");
  audioEl.setAttribute("x5-playsinline", "");

  const queue: MonitorVoiceMessage[] = [];
  let playing: MonitorVoiceMessage | null = null;
  let lastEndedAt = 0;
  let unlocked = false;
  const lastByKind = new Map<string, number>();

  audioEl.addEventListener("ended", () => {
    if (LOG) console.log(TAG, "ended", playing?.kind);
    lastEndedAt = Date.now();
    playing = null;
  });
  audioEl.addEventListener("error", () => {
    if (LOG) console.warn(TAG, "audio error", audioEl.error?.message, "src=", audioEl.currentSrc);
    lastEndedAt = Date.now();
    playing = null;
  });
  audioEl.addEventListener("playing", () => {
    if (LOG) console.log(TAG, "playing", audioEl.currentSrc);
  });

  // Mobile-safe unlock: on the first user gesture, play a real wav file
  // muted, then pause it. iOS Safari grants subsequent autoplay permission
  // to this <Audio> element after a user-initiated play+pause cycle.
  // We listen on a wide set of event types because different mobile browsers
  // surface gestures differently.
  const GESTURE_EVENTS = ["pointerdown", "touchstart", "touchend", "click", "keydown"];
  const unlock = () => {
    if (unlocked) return;
    if (LOG) console.log(TAG, "unlock attempt (gesture)");
    audioEl.muted = true;
    audioEl.src = UNLOCK_PRIMER_URL;
    audioEl.currentTime = 0;
    const p = audioEl.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        try { audioEl.pause(); } catch { /* ignore */ }
        audioEl.currentTime = 0;
        audioEl.muted = false;
        unlocked = true;
        for (const evt of GESTURE_EVENTS) {
          window.removeEventListener(evt, unlock as EventListener);
        }
        if (LOG) console.log(TAG, "audio unlocked ✓");
      }).catch((err) => {
        // iOS will sometimes reject the first attempt but accept the second —
        // keep the listeners attached so the next gesture retries.
        audioEl.muted = false;
        if (LOG) console.warn(TAG, "unlock attempt rejected, will retry on next gesture", err?.name, err?.message);
      });
    } else {
      // Older browsers without play-promise — assume success.
      try { audioEl.pause(); } catch { /* ignore */ }
      audioEl.muted = false;
      unlocked = true;
      for (const evt of GESTURE_EVENTS) {
        window.removeEventListener(evt, unlock as EventListener);
      }
    }
  };
  for (const evt of GESTURE_EVENTS) {
    window.addEventListener(evt, unlock, { passive: true });
  }

  // Globally exposed for ad-hoc DevTools poking — useful on phones where the
  // address bar is the only "console" you can reach via remote inspect.
  // - `__nzVoice.test()` plays a wav; verifies playback works at all.
  // - `__nzVoice.unlock()` retries the unlock dance manually.
  // - `__nzVoice.status()` reports current state.
  (window as unknown as { __nzVoice?: unknown }).__nzVoice = {
    audioEl,
    queue: () => queue.slice(),
    status: () => ({ unlocked, playing: playing?.kind, queued: queue.length }),
    unlock: () => unlock(),
    test: (url = "/voice/game_started_0.wav") => {
      if (LOG) console.log(TAG, "test play", url);
      audioEl.src = url;
      audioEl.currentTime = 0;
      return audioEl.play();
    }
  };

  function tryAdvance() {
    const now = Date.now();
    const next = queue[0];

    if (playing && next && next.priority > playing.priority + 1) {
      if (LOG) console.log(TAG, "preempt", playing.kind, "->", next.kind);
      try { audioEl.pause(); } catch { /* ignore */ }
      playing = null;
      lastEndedAt = now;
    }
    if (playing) return;
    if (now - lastEndedAt < 3000 && lastEndedAt !== 0) return;
    if (!next) return;

    queue.shift();
    playing = next;

    const url = resolveAudioUrl(next.audioUrl);
    if (!url) {
      if (LOG) console.warn(TAG, "no audio url for", next.kind);
      playing = null;
      lastEndedAt = Date.now();
      return;
    }

    if (LOG) console.log(TAG, "play", next.kind, "pri=" + next.priority, url, unlocked ? "" : "(NOT UNLOCKED)");

    try {
      audioEl.src = url;
      audioEl.currentTime = 0;
      const p = audioEl.play();
      if (p && typeof p.catch === "function") {
        p.catch((err) => {
          if (LOG) console.warn(TAG, "play() rejected", err?.name, err?.message);
          playing = null;
          lastEndedAt = Date.now();
        });
      }
    } catch (err) {
      if (LOG) console.warn(TAG, "play() threw", err);
      playing = null;
      lastEndedAt = Date.now();
    }
  }

  window.setInterval(() => {
    const fresh = usePartyStore.getState().drainMonitorVoiceInbox();
    if (fresh.length) {
      if (LOG) console.log(TAG, "drained", fresh.length, "msg(s):", fresh.map(m => m.kind).join(", "));
      const now = Date.now();
      for (const msg of fresh) {
        const lastSeen = lastByKind.get(msg.kind) ?? 0;
        if (now - lastSeen < 10_000) {
          if (LOG) console.log(TAG, "dedup-drop", msg.kind);
          continue;
        }
        lastByKind.set(msg.kind, now);
        queue.push(msg);
      }
      queue.sort((a, b) => b.priority - a.priority);
    }
    tryAdvance();
  }, 200);
}

/**
 * Server hands us a path-only URL — either:
 *   - `/party/<roomId>/__nz_voice?id=…`  (live ElevenLabs TTS, served by the room)
 *   - `/voice/<kind>_<idx>.wav`          (static WAV shipped under `server/public/voice/`)
 *
 * When SPA + PartyKit live on the same origin (e.g. `*.partykit.dev`), both paths just work
 * as-is. When the SPA is hosted on a separate origin (Vercel + PartyKit cloud, controlled by
 * `VITE_PARTYKIT_HOST`), the SPA origin doesn't have these files — we rewrite to PartyKit.
 */
function resolveAudioUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const needsPartyHost = raw.startsWith("/party/") || raw.startsWith("/voice/");
  if (!needsPartyHost) return raw;
  const host = (import.meta.env.VITE_PARTYKIT_HOST as string | undefined)?.trim();
  if (!host) return raw;
  const cleanHost = host.replace(/^(wss?|https?):\/\//i, "").split("/")[0];
  // Same-origin SPA already gets these; the rewrite is only meaningful when SPA host differs.
  if (typeof window !== "undefined" && window.location.host === cleanHost) return raw;
  return `https://${cleanHost}${raw}`;
}
