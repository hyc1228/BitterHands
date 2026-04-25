// ElevenLabs TTS for the Nocturne Zoo Monitor.
//
// Real-time synthesis with an in-memory cache keyed by hash(text + voiceId).
// Cache entries are reused across players in the same room; a content hash
// also means re-running the same template line is free after the first call.
//
// `synthesize()` returns null bytes when the API key/voice id is missing, so
// the rest of the pipeline can degrade to captions-only mode silently.

const CACHE = new Map();
const CACHE_MAX = 128;
const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * @param {string} text
 * @param {{ apiKey?: string, voiceId?: string, modelId?: string }} [opts]
 * @returns {Promise<{ ok: boolean, id: string|null, mime: string|null, bytes: Uint8Array|null, cached: boolean, error?: string }>}
 */
export async function synthesize(text, opts = {}) {
  const apiKey = opts.apiKey ?? readEnv("ELEVENLABS_API_KEY");
  const voiceId = opts.voiceId ?? readEnv("ELEVENLABS_VOICE_ID");
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!apiKey || !voiceId || !trimmed) {
    return { ok: false, id: null, mime: null, bytes: null, cached: false, error: "missing_config_or_text" };
  }

  const id = await hashHex(`${voiceId}::${trimmed}`);
  const hit = CACHE.get(id);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    hit.ts = Date.now();
    return { ok: true, id, mime: hit.mime, bytes: hit.bytes, cached: true };
  }

  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}` +
    `?output_format=mp3_44100_128`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg"
      },
      body: JSON.stringify({
        text: trimmed,
        model_id: opts.modelId ?? "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.75,
          style: 0.55,
          use_speaker_boost: true
        }
      })
    });
  } catch (err) {
    return { ok: false, id: null, mime: null, bytes: null, cached: false, error: `fetch:${String(err)}` };
  }

  if (!res.ok) {
    return { ok: false, id: null, mime: null, bytes: null, cached: false, error: `tts_${res.status}` };
  }

  const ab = await res.arrayBuffer();
  const bytes = new Uint8Array(ab);
  evictIfFull();
  CACHE.set(id, { mime: "audio/mpeg", bytes, ts: Date.now() });
  return { ok: true, id, mime: "audio/mpeg", bytes, cached: false };
}

/**
 * @param {string} id
 * @returns {{ mime: string, bytes: Uint8Array } | null}
 */
export function getCachedAudio(id) {
  const hit = CACHE.get(id);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    CACHE.delete(id);
    return null;
  }
  return { mime: hit.mime, bytes: hit.bytes };
}

function evictIfFull() {
  if (CACHE.size < CACHE_MAX) return;
  // simplest LRU-ish: drop oldest insertion
  const first = CACHE.keys().next().value;
  if (first !== undefined) CACHE.delete(first);
}

function readEnv(name) {
  try {
    if (typeof process !== "undefined" && process?.env && process.env[name]) return process.env[name];
  } catch {
    /* ignore */
  }
  try {
    if (typeof globalThis !== "undefined" && globalThis[name]) return globalThis[name];
  } catch {
    /* ignore */
  }
  return null;
}

async function hashHex(s) {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i];
    out += (v < 16 ? "0" : "") + v.toString(16);
  }
  return out.slice(0, 16);
}
