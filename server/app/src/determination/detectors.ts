/**
 * Ported from `determination/index.html` — three independent detectors
 * (head shake, mouth open, 5s blink hold). Pure frame updates, no I/O.
 */

import type { Landmarks } from "./types";

// Landmark index groups (MediaPipe Face Mesh).
//
// NOTE on naming: the MediaPipe convention is that "LEFT_EYE" indices belong to the SUBJECT's
// left eye (which appears on the camera's RIGHT side, and on the user-facing mirrored selfie's
// LEFT side). This codebase historically labeled the constants based on the camera's perspective,
// so `LEFT_EYE_EAR = [33,…]` is actually the SUBJECT'S RIGHT eye. We keep the legacy names for
// existing callers (which only use the symmetric average via `averageEar`) and expose the
// subject-perspective indices below for asymmetric tests like `updateUserLeftEyeClosed`.
const LEFT_EYE_EAR = [33, 160, 158, 133, 153, 144] as const;
const RIGHT_EYE_EAR = [362, 385, 387, 263, 373, 380] as const;
/** SUBJECT-perspective ("the user's") eye indices — preferred for new wink/asymmetric tests. */
const USER_LEFT_EYE = RIGHT_EYE_EAR;
const USER_RIGHT_EYE = LEFT_EYE_EAR;

export const DETECTION_DEFAULTS = {
  earClosed: 0.2,
  marOpen: 0.4,
  blinkHoldMs: 5000,
  shakeThresh: 0.08,
  /** direction changes needed (same as index.html SHAKE_NEEDED) */
  shakeChangesNeeded: 4,
  mouthOpenFrames: 8,
  /** Onboard expression gate: hold eyes closed for this long (positive test). */
  eyesClosedHoldMs: 1500,
  /** Onboard expression gate: hold eyes OPEN (no blink) for this long (positive test). */
  gateNoBlinkHoldMs: 2000,
  /** Onboard expression gate "eyes open" threshold (more lenient than `earClosed = 0.2` so
   *  mobile selfie cams — which run lower EAR due to wide-angle distortion + downward angle
   *  + low-res landmarks — pass naturally without forcing the user to bug their eyes out). */
  gateEyesOpenThresh: 0.13,
  /** Onboard gate de-bounce: a single noisy sub-threshold frame won't reset the 2 s timer;
   *  needs `gateBlinkResetFrames` consecutive sub-threshold frames to count as a real blink. */
  gateBlinkResetFrames: 2
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
  /** Consecutive sub-threshold frames; used by `updateNoBlink`'s de-bounce (optional). */
  closedStreak?: number;
};

export function createBlinkHoldState(): BlinkHoldState {
  return { done: false, since: null, closedStreak: 0 };
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

/**
 * Positive eye-closed test: keep both eyes closed continuously for `eyesClosedHoldMs`.
 * Opening eyes resets progress. Mirror image of `BlinkHoldState` (which requires *not* blinking).
 */
export type EyesClosedState = {
  done: boolean;
  since: number | null;
};

export function createEyesClosedState(): EyesClosedState {
  return { done: false, since: null };
}

export function updateEyesClosed(
  lm: Landmarks,
  s: EyesClosedState,
  now: number
): EyesClosedState {
  if (s.done) return s;
  const avg = (earValue(lm, LEFT_EYE_EAR) + earValue(lm, RIGHT_EYE_EAR)) / 2;
  if (avg >= DETECTION_DEFAULTS.earClosed) {
    return { done: false, since: null };
  }
  const since = s.since ?? now;
  if (now - since >= DETECTION_DEFAULTS.eyesClosedHoldMs) {
    return { done: true, since };
  }
  return { done: false, since };
}

export function eyesClosedProgress(s: EyesClosedState, now: number): number {
  if (s.done) return 1;
  if (s.since == null) return 0;
  return Math.min(1, (now - s.since) / DETECTION_DEFAULTS.eyesClosedHoldMs);
}

/**
 * Wink test: close ONLY the user's left eye for `eyesClosedHoldMs`. Requires asymmetry
 * (user's right eye must stay open) so a normal blink doesn't accidentally pass. Opening
 * the left eye, or also closing the right, resets progress.
 *
 * Reuses `EyesClosedState` shape so the gate UI can render uniform progress.
 *
 * @deprecated Replaced in the onboard gate by `updateNoBlink` (2 s eyes-open hold) — physical
 * one-eye winks are unreliable for many users, and EAR jitter/head tilt easily resets the
 * asymmetry timer. Kept exported in case a future game rule wants strict wink detection.
 */
export function updateUserLeftEyeClosed(
  lm: Landmarks,
  s: EyesClosedState,
  now: number
): EyesClosedState {
  if (s.done) return s;
  const left = earValue(lm, USER_LEFT_EYE);
  const right = earValue(lm, USER_RIGHT_EYE);
  const leftClosed = left < DETECTION_DEFAULTS.earClosed;
  const rightOpen = right >= DETECTION_DEFAULTS.earClosed;
  if (!leftClosed || !rightOpen) {
    return { done: false, since: null };
  }
  const since = s.since ?? now;
  if (now - since >= DETECTION_DEFAULTS.eyesClosedHoldMs) {
    return { done: true, since };
  }
  return { done: false, since };
}

/**
 * Generic no-blink hold: keep eyes OPEN (avg EAR ≥ `openThresh`) continuously for `holdMs`.
 * Any blink (avg EAR < `openThresh` for `resetFrames` consecutive frames) resets the timer.
 *
 * Same logic family as `updateBlinkHold` but with caller-provided duration + threshold so
 * the onboard gate (2 s, lenient mobile-friendly threshold) and the OWL game rule (5 s,
 * stricter threshold) can share one implementation.
 *
 * @param openThresh   avg EAR cutoff. Defaults to `DETECTION_DEFAULTS.earClosed` (0.2 — desktop).
 *                     Pass `gateEyesOpenThresh` (0.13) for mobile-friendly UX.
 * @param resetFrames  how many consecutive sub-threshold frames count as a real blink.
 *                     Defaults to 1 (instant reset, like `updateBlinkHold`). Pass
 *                     `gateBlinkResetFrames` for the de-bounced gate behavior.
 */
export function updateNoBlink(
  lm: Landmarks,
  s: BlinkHoldState,
  now: number,
  holdMs: number,
  openThresh: number = DETECTION_DEFAULTS.earClosed,
  resetFrames: number = 1
): BlinkHoldState {
  if (s.done) return s;
  const avg = (earValue(lm, LEFT_EYE_EAR) + earValue(lm, RIGHT_EYE_EAR)) / 2;
  // Track consecutive sub-threshold frames on the state object (re-used `closedStreak` field).
  const streak = (avg < openThresh ? (s.closedStreak ?? 0) + 1 : 0);
  if (streak >= resetFrames) {
    return { done: false, since: null, closedStreak: streak };
  }
  const since = s.since ?? now;
  if (now - since >= holdMs) {
    return { done: true, since, closedStreak: streak };
  }
  return { done: false, since, closedStreak: streak };
}

export function noBlinkProgress(s: BlinkHoldState, now: number, holdMs: number): number {
  if (s.done) return 1;
  if (s.since == null) return 0;
  return Math.min(1, (now - s.since) / holdMs);
}
