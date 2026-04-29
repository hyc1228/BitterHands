import { useCallback, useEffect, useRef, useState } from "react";
import { dict } from "../i18n";
import { haptic } from "../lib/haptic";
import { ClientMessageTypes } from "../party/protocol";
import { usePartyStore } from "../party/store";
import { useCameraFrameUpload } from "../hooks/useCameraFrameUpload";
import { useCameraStream } from "../hooks/useCameraStream";
import { useFaceMesh } from "../hooks/useFaceMesh";
import {
  createBlinkHoldState,
  createMouthState,
  createShakeState,
  DETECTION_DEFAULTS,
  noBlinkProgress,
  shakeShakesCount,
  updateMouth,
  updateNoBlink,
  updateShake
} from "../determination";

interface Props {
  /** Fired once all three checks pass; parent uses this to enable "Enter the zoo". */
  onPassed: (passed: boolean) => void;
}

type TaskKey = "shake" | "mouth" | "eyes";

const TASK_ORDER: TaskKey[] = ["shake", "mouth", "eyes"];
const SHAKE_TARGET = Math.max(1, Math.floor(DETECTION_DEFAULTS.shakeChangesNeeded / 2));

/**
 * Inline 3-step face-test gate shown on the Reveal screen. Reuses MediaPipe FaceMesh +
 * the existing `determination` detectors. The component owns its own camera stream so
 * the previous one (Onboard photo step) was already stopped.
 */
export default function ExpressionGate({ onPassed }: Props) {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);

  // No explicit width/height: many Android front cameras don't natively
  // support 480x360 and silently negotiate to a `track.muted = true` state
  // (stream looks live, but no frames ever flow → black <video>).  Letting
  // the browser pick its own resolution + treating facingMode as a soft
  // preference (rather than an exact requirement) is the most permissive
  // setup and the closest match to PermissionGate's `video: true` call,
  // which works reliably on the same devices in the photo step.  FaceMesh
  // downsamples internally so input resolution doesn't matter for accuracy.
  const { stream, error: camError, start, stop } = useCameraStream({
    video: { facingMode: { ideal: "user" } },
    audio: false
  });
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [enabled, setEnabled] = useState(false);
  /** Bumps to force a UI re-render at most ~12 fps while detectors progress. */
  const [, setUiTick] = useState(0);
  /** True once the <video> has actually started painting frames.  Used
   *  alongside the watchdog below to detect the Android-specific "stream
   *  looks live but track.muted=true → no frames" failure mode and surface
   *  a manual recovery button. */
  const [framesLive, setFramesLive] = useState(false);
  /** Set when the watchdog timer expires without `framesLive` flipping
   *  true — surfaces a "tap to start camera" overlay that re-runs play()
   *  inside a user gesture, getting around mobile autoplay policies and
   *  triggering the unmute path for muted tracks on some Android builds. */
  const [framesStuck, setFramesStuck] = useState(false);

  const shakeRef = useRef(createShakeState());
  const mouthRef = useRef(createMouthState());
  const noBlinkRef = useRef(createBlinkHoldState());

  // Keep video element wired up to the stream and resiliently retry play().
  // Mobile (esp. Android) gotchas this handles:
  //   • `play()` rejected silently before metadata is loaded → re-call on
  //     `loadedmetadata` and `canplay`.
  //   • Track starts with `muted = true` (Android negotiates this when the
  //     constraint mismatches the camera's native modes) → re-call on the
  //     `unmute` event so frames flow as soon as the camera actually
  //     produces them.
  //   • Backgrounded / re-foregrounded tab pauses the element → `playing`
  //     edge flips framesLive=true to dismiss the watchdog overlay.
  useEffect(() => {
    if (!videoEl) return;
    videoEl.srcObject = stream;
    setFramesLive(false);
    setFramesStuck(false);
    if (!stream) return;

    const tryPlay = () => {
      if (!videoEl) return;
      const p = videoEl.play();
      if (p && typeof p.catch === "function") p.catch(() => undefined);
    };

    const onLoaded = () => tryPlay();
    const onCanPlay = () => tryPlay();
    const onPlaying = () => {
      setFramesLive(true);
      setFramesStuck(false);
    };
    videoEl.addEventListener("loadedmetadata", onLoaded);
    videoEl.addEventListener("canplay", onCanPlay);
    videoEl.addEventListener("playing", onPlaying);

    // Per-track unmute: Android Chrome / WebView frequently hand back a
    // track with `muted = true` initially.  When the camera actually
    // starts producing frames the track fires `unmute` — kick play()
    // again so the <video> consumes those frames instead of staying
    // paused on the muted source.
    const tracks = stream.getVideoTracks();
    const onUnmute = () => tryPlay();
    for (const tr of tracks) tr.addEventListener("unmute", onUnmute);

    tryPlay();
    return () => {
      videoEl.removeEventListener("loadedmetadata", onLoaded);
      videoEl.removeEventListener("canplay", onCanPlay);
      videoEl.removeEventListener("playing", onPlaying);
      for (const tr of tracks) tr.removeEventListener("unmute", onUnmute);
    };
  }, [stream, videoEl]);

  // Watchdog: if no frames are flowing 3s after the stream opens, surface
  // a "tap to start camera" button.  Tapping that button re-runs play()
  // inside a real user gesture, which gets around any remaining autoplay
  // restrictions and forces the muted track to unmute on some Android
  // builds.  Cleared the moment `framesLive` flips true.
  useEffect(() => {
    if (!stream || framesLive) {
      setFramesStuck(false);
      return;
    }
    const id = window.setTimeout(() => setFramesStuck(true), 3000);
    return () => window.clearTimeout(id);
  }, [stream, framesLive]);

  const handleManualKick = useCallback(() => {
    setFramesStuck(false);
    if (!videoEl) return;
    const p = videoEl.play();
    if (p && typeof p.catch === "function") p.catch(() => undefined);
  }, [videoEl]);

  const onLandmarks = useCallback((lm: { x: number; y: number; z?: number }[]) => {
    const now = performance.now();
    if (!shakeRef.current.done) shakeRef.current = updateShake(lm, shakeRef.current);
    if (!mouthRef.current.done) mouthRef.current = updateMouth(lm, mouthRef.current);
    if (!noBlinkRef.current.done) {
      noBlinkRef.current = updateNoBlink(
        lm,
        noBlinkRef.current,
        now,
        DETECTION_DEFAULTS.gateNoBlinkHoldMs,
        DETECTION_DEFAULTS.gateEyesOpenThresh,
        DETECTION_DEFAULTS.gateBlinkResetFrames
      );
    }
    setUiTick((n) => (n + 1) % 1024);
  }, []);

  const { status: meshStatus, lastError: meshError } = useFaceMesh({
    enabled: enabled && !!stream,
    videoEl,
    onLandmarks
  });

  // Same video element drives the OB face wall during Final Check so OB sees
  // the player while they're being graded on the 3 tasks.
  const conn = usePartyStore((s) => s.conn);
  const send = usePartyStore((s) => s.send);
  useCameraFrameUpload({
    enabled: conn === "open" && enabled && !!stream && !!videoEl,
    videoEl
  });

  const allDone =
    shakeRef.current.done && mouthRef.current.done && noBlinkRef.current.done;

  // Stream live gate progress to OB (server validates + relays as
  // GATE_PROGRESS). Sent at ~5 Hz; cheap (<150 B / msg) so we don't bother
  // diff-suppressing per-field. Stops once the gate is passed.
  useEffect(() => {
    if (conn !== "open") return;
    if (!enabled) return;
    if (allDone) return;
    const id = window.setInterval(() => {
      const now = performance.now();
      const sh = shakeRef.current;
      const mo = mouthRef.current;
      const ey = noBlinkRef.current;
      const shakeProgress = sh.done
        ? 1
        : Math.min(1, sh.changes / DETECTION_DEFAULTS.shakeChangesNeeded);
      const mouthProgress = mo.done
        ? 1
        : Math.min(1, mo.openFrames / DETECTION_DEFAULTS.mouthOpenFrames);
      const eyeProgress = noBlinkProgress(ey, now, DETECTION_DEFAULTS.gateNoBlinkHoldMs);
      const eyeHoldMs = ey.since == null ? 0 : Math.max(0, Math.floor(now - ey.since));
      send(ClientMessageTypes.GATE_PROGRESS, {
        active: true,
        shake: {
          done: sh.done,
          count: shakeShakesCount(sh),
          progress: shakeProgress
        },
        mouth: {
          done: mo.done,
          openFrames: mo.openFrames | 0,
          progress: mouthProgress
        },
        eyes: {
          done: ey.done,
          holdMs: eyeHoldMs,
          progress: eyeProgress
        }
      });
    }, 220);
    return () => window.clearInterval(id);
  }, [conn, enabled, allDone, send]);

  // Final "passed" beacon — once `allDone` flips true, push one last update
  // so OB sees all three bars filled before the entry is GC'd by the snapshot
  // diff (when the server marks the player ready).
  useEffect(() => {
    if (!allDone) return;
    if (conn !== "open") return;
    send(ClientMessageTypes.GATE_PROGRESS, {
      active: false,
      shake: {
        done: true,
        count: shakeShakesCount(shakeRef.current),
        progress: 1
      },
      mouth: {
        done: true,
        openFrames: mouthRef.current.openFrames | 0,
        progress: 1
      },
      eyes: { done: true, holdMs: DETECTION_DEFAULTS.gateNoBlinkHoldMs, progress: 1 }
    });
  }, [allDone, conn, send]);

  // Notify parent whenever pass-state flips.
  const lastPass = useRef(false);
  useEffect(() => {
    if (allDone === lastPass.current) return;
    lastPass.current = allDone;
    // Buzz on the false→true transition only — passing the gate is the
    // terminal moment of onboarding and deserves haptic acknowledgement.
    if (allDone) haptic("success");
    onPassed(allDone);
  }, [allDone, onPassed]);

  // Stop camera when gate is satisfied to free the device for the main scene.
  useEffect(() => {
    if (!allDone) return;
    const id = window.setTimeout(() => {
      setEnabled(false);
      stop();
    }, 500);
    return () => window.clearTimeout(id);
  }, [allDone, stop]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = useCallback(async () => {
    shakeRef.current = createShakeState();
    mouthRef.current = createMouthState();
    noBlinkRef.current = createBlinkHoldState();
    lastPass.current = false;
    onPassed(false);
    const s = await start();
    if (s) setEnabled(true);
  }, [start, onPassed]);

  // Auto-start the camera as soon as the gate mounts — there's no longer a
  // manual "Enable camera" button (it was getting clipped on narrow phones),
  // so we kick off detection immediately.  If the user previously denied
  // permission the browser will reject `start()` and the camErr overlay
  // shows a retry button below.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (enabled) return;
    autoStartedRef.current = true;
    void handleStart();
    // We deliberately fire-and-forget — `handleStart` already handles errors
    // (they surface via `camError` from `useCameraStream`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRetry = useCallback(() => {
    shakeRef.current = createShakeState();
    mouthRef.current = createMouthState();
    noBlinkRef.current = createBlinkHoldState();
    lastPass.current = false;
    onPassed(false);
    setUiTick((n) => (n + 1) % 1024);
  }, [onPassed]);

  // Plain (non-memoized) compute — refs mutate in onLandmarks; we re-render via setUiTick,
  // so we rebuild the view-model every render to read the latest ref state.
  const now = performance.now();
  const shakeDone = shakeRef.current.done;
  const mouthDone = mouthRef.current.done;
  const noBlinkDone = noBlinkRef.current.done;
  // Per-task done-edge haptic (light tap each time a task flips to done).
  // Using prevDoneRef instead of useEffect/state — refs are mutated in
  // onLandmarks, and a state-based pipeline would flicker between renders.
  const prevDoneRef = useRef({ shake: false, mouth: false, eyes: false });
  if (shakeDone && !prevDoneRef.current.shake) haptic("tap");
  if (mouthDone && !prevDoneRef.current.mouth) haptic("tap");
  if (noBlinkDone && !prevDoneRef.current.eyes) haptic("tap");
  prevDoneRef.current = { shake: shakeDone, mouth: mouthDone, eyes: noBlinkDone };
  const tasks = {
    shake: {
      key: "shake" as TaskKey,
      done: shakeDone,
      active: !shakeDone && shakeRef.current.changes > 0,
      progress: shakeDone
        ? 1
        : Math.min(1, shakeRef.current.changes / DETECTION_DEFAULTS.shakeChangesNeeded),
      icon: "🙂",
      label: t.gateTaskShake,
      status: shakeDone
        ? t.gateOk
        : shakeRef.current.changes > 0
          ? t.gateProgressShake(shakeShakesCount(shakeRef.current), SHAKE_TARGET)
          : t.gateWaiting
    },
    mouth: {
      key: "mouth" as TaskKey,
      done: mouthDone,
      active: !mouthDone && mouthRef.current.openFrames > 0,
      progress: mouthDone
        ? 1
        : Math.min(1, mouthRef.current.openFrames / DETECTION_DEFAULTS.mouthOpenFrames),
      icon: "😮",
      label: t.gateTaskMouth,
      status: mouthDone
        ? t.gateOk
        : mouthRef.current.openFrames > 0
          ? t.gateProgressMouth
          : t.gateWaiting
    },
    eyes: {
      key: "eyes" as TaskKey,
      done: noBlinkDone,
      active: !noBlinkDone && noBlinkRef.current.since != null,
      progress: noBlinkProgress(noBlinkRef.current, now, DETECTION_DEFAULTS.gateNoBlinkHoldMs),
      icon: "👀",
      label: t.gateTaskNoBlink,
      status: noBlinkDone
        ? t.gateOk
        : noBlinkRef.current.since == null
          ? t.gateProgressNoBlinkStart
          : t.gateProgressNoBlinkHold(
              Math.max(
                0,
                (DETECTION_DEFAULTS.gateNoBlinkHoldMs - (now - noBlinkRef.current.since)) / 1000
              ).toFixed(1)
            )
    }
  } as const;

  const overallProgress =
    (Number(tasks.shake.done) + Number(tasks.mouth.done) + Number(tasks.eyes.done)) / 3;

  const meshLoading = enabled && !!stream && meshStatus === "loading";
  const meshErr = enabled && !!stream && meshStatus === "error" ? meshError : null;
  const camErr = camError;

  return (
    <div className={"gate-wrap" + (allDone ? " is-passed" : "")}>
      <div className="gate-top">
        <div className="gate-title-row">
          <span className="gate-title">{t.gateTitle}</span>
          <span className="gate-pct" aria-hidden="true">
            {Math.round(overallProgress * 100)}%
          </span>
        </div>
        <p className="gate-hint">{allDone ? t.gatePassed : t.gateHint}</p>
      </div>

      <div className="gate-stage">
        <video
          ref={(el) => setVideoEl(el)}
          className="gate-video"
          autoPlay
          playsInline
          muted
          aria-hidden={enabled ? undefined : true}
        />
        {/* No manual "enable camera" button — the gate auto-starts on mount.
            When the camera is still warming up (no error, no stream yet),
            we surface a soft "starting…" hint so the stage isn't just a
            black rectangle. */}
        {!enabled && !camErr ? (
          <div className="gate-overlay">📷 {t.gateLoading}</div>
        ) : null}
        {meshLoading ? <div className="gate-overlay">{t.gateLoading}</div> : null}
        {camErr ? (
          <div className="gate-overlay gate-overlay--err">
            <span>⚠ {camErr}</span>
            <button
              type="button"
              className="primary gate-overlay__retry"
              onClick={handleStart}
            >
              📷 {t.gateEnable}
            </button>
          </div>
        ) : null}
        {meshErr ? <div className="gate-overlay gate-overlay--err">⚠ {meshErr}</div> : null}
        {/* Watchdog: stream opened but no frames flowed within 3 s.  This
            is the Android-specific "track muted, autoplay blocked, or
            both" recovery path — the button calls play() inside a real
            user gesture which both satisfies mobile autoplay policies
            and nudges some Android builds into actually unmuting the
            video track.  Suppressed when there's already a camErr /
            meshErr (those cases get their own overlay) and once frames
            actually start flowing. */}
        {framesStuck && !camErr && !meshErr && !framesLive ? (
          <div className="gate-overlay gate-overlay--err">
            <span>📷 {t.gateFramesStuck}</span>
            <button
              type="button"
              className="primary gate-overlay__retry"
              onClick={handleManualKick}
            >
              {t.gateFramesStuckBtn}
            </button>
          </div>
        ) : null}
      </div>

      <div className="gate-tasks">
        {TASK_ORDER.map((k) => {
          const task = tasks[k];
          return (
            <div
              key={k}
              className={
                "gate-task" +
                (task.done ? " is-done" : task.active ? " is-active" : "")
              }
              role="status"
              aria-live="polite"
            >
              <span className="gate-task__icon" aria-hidden="true">
                {task.done ? "✓" : task.icon}
              </span>
              <div className="gate-task__col">
                <span className="gate-task__label">{task.label}</span>
                <div className="gate-task__bar" aria-hidden="true">
                  <div
                    className="gate-task__fill"
                    style={{ width: `${Math.round(task.progress * 100)}%` }}
                  />
                </div>
                <span className="gate-task__status">{task.status}</span>
              </div>
            </div>
          );
        })}
      </div>

      {enabled && !allDone ? (
        <div className="gate-foot">
          <button type="button" className="ghost" onClick={handleRetry}>
            ↺ {t.gateRetry}
          </button>
        </div>
      ) : null}
    </div>
  );
}
