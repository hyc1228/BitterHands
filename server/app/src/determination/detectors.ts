/**
 * Ported from `determination/index.html` — three independent detectors
 * (head shake, mouth open, 5s blink hold). Pure frame updates, no I/O.
 */

import type { Landmarks } from "./types";

// Landmark index groups (MediaPipe Face Mesh)
const LEFT_EYE_EAR = [33, 160, 158, 133, 153, 144] as const;
const RIGHT_EYE_EAR = [362, 385, 387, 263, 373, 380] as const;

export const DETECTION_DEFAULTS = {
  earClosed: 0.2,
  marOpen: 0.4,
  blinkHoldMs: 5000,
  shakeThresh: 0.08,
  /** direction changes needed (same as index.html SHAKE_NEEDED) */
  shakeChangesNeeded: 4,
  mouthOpenFrames: 8
} as const;

function dist(
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function earValue(lm: Landmarks, indices: readonly number[]): number {
  const pts = indices.map((i) => lm[i]).filter(Boolean) as {
    x: number;
    y: number;
  }[];
  if (pts.length < 6) return 1;
  const [p1, p2, p3, p4, p5, p6] = pts;
  return (dist(p2, p6) + dist(p3, p5)) / (2 * dist(p1, p4) + 1e-9);
}

export type ShakeState = {
  done: boolean;
  dir: 0 | 1 | -1;
  changes: number;
};

export function createShakeState(): ShakeState {
  return { done: false, dir: 0, changes: 0 };
}

/** Head shake: nose x vs face width, count direction flips. */
export function updateShake(lm: Landmarks, s: ShakeState): ShakeState {
  if (s.done) return s;
  const nose = lm[4];
  const leftBound = lm[234];
  const rightBound = lm[454];
  if (!nose || !leftBound || !rightBound) return s;
  const cx = (leftBound.x + rightBound.x) / 2;
  const fw = Math.abs(rightBound.x - leftBound.x) + 1e-6;
  const nx = (nose.x - cx) / fw;
  const cur: 0 | 1 | -1 =
    nx > DETECTION_DEFAULTS.shakeThresh
      ? 1
      : nx < -DETECTION_DEFAULTS.shakeThresh
        ? -1
        : 0;
  let changes = s.changes;
  let dir = s.dir;
  if (cur !== 0 && cur !== s.dir) {
    dir = cur;
    changes += 1;
  } else if (cur !== 0) {
    dir = cur;
  }
  const done = changes >= DETECTION_DEFAULTS.shakeChangesNeeded;
  return { done, dir, changes };
}

export function shakeShakesCount(s: ShakeState): number {
  return Math.floor(s.changes / 2);
}

export type MouthState = { done: boolean; openFrames: number };

export function createMouthState(): MouthState {
  return { done: false, openFrames: 0 };
}

/** Mouth open: MAR from lip landmarks. */
export function updateMouth(lm: Landmarks, s: MouthState): MouthState {
  if (s.done) return s;
  const p13 = lm[13];
  const p14 = lm[14];
  const p61 = lm[61];
  const p291 = lm[291];
  if (!p13 || !p14 || !p61 || !p291) return { ...s, openFrames: 0 };
  const mar =
    dist(p13, p14) / (dist(p61, p291) + 1e-6);
  if (mar > DETECTION_DEFAULTS.marOpen) {
    const openFrames = s.openFrames + 1;
    if (openFrames >= DETECTION_DEFAULTS.mouthOpenFrames) {
      return { done: true, openFrames: DETECTION_DEFAULTS.mouthOpenFrames };
    }
    return { done: false, openFrames };
  }
  return { done: false, openFrames: 0 };
}

export type BlinkHoldState = {
  done: boolean;
  since: number | null;
};

export function createBlinkHoldState(): BlinkHoldState {
  return { done: false, since: null };
}

/**
 * Hold eyes open (no blink) for `blinkHoldMs`. Blinking resets progress.
 * `now` = performance.now() or Date.now() consistently.
 */
export function updateBlinkHold(
  lm: Landmarks,
  s: BlinkHoldState,
  now: number
): BlinkHoldState {
  if (s.done) return s;
  const avg =
    (earValue(lm, LEFT_EYE_EAR) + earValue(lm, RIGHT_EYE_EAR)) / 2;
  if (avg < DETECTION_DEFAULTS.earClosed) {
    return { done: false, since: null };
  }
  const since = s.since ?? now;
  if (now - since >= DETECTION_DEFAULTS.blinkHoldMs) {
    return { done: true, since };
  }
  return { done: false, since };
}

export function blinkProgress(s: BlinkHoldState, now: number): number {
  if (s.done) return 1;
  if (s.since == null) return 0;
  return Math.min(1, (now - s.since) / DETECTION_DEFAULTS.blinkHoldMs);
}

/** Average EAR (both eyes) for display / owl-style rules. */
export function averageEar(lm: Landmarks): number {
  return (earValue(lm, LEFT_EYE_EAR) + earValue(lm, RIGHT_EYE_EAR)) / 2;
}
