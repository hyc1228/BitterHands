/**
 * Tiny vibration helper for player-facing UI in the React app.
 *
 * The in-iframe game scene has its own `nzHaptic()` (see `main scene/index.html`);
 * this module is for the lobby / onboard / OB shells where we don't want to
 * load the iframe just to buzz a button. Patterns are deliberately quiet —
 * only confirmation-class events (ready, profile saved, fatal error) so we
 * don't desensitize players to the in-game haptics.
 *
 * All calls are no-ops when:
 *   • `navigator.vibrate` is missing (desktop, iOS Safari < 17)
 *   • the OS reports `prefers-reduced-motion: reduce`
 *   • the browser blocks vibration without a user gesture (try/catch)
 */

type HapticName = "tap" | "select" | "ready" | "success" | "error" | "warn";

const PATTERNS: Record<HapticName, number | number[]> = {
  /** Light flick — primary-button taps, slider snaps. */
  tap: 8,
  /** Discrete confirmation — toggle / option chosen. */
  select: [10, 18, 10],
  /** Player marked Ready — slight up-tick. */
  ready: [12, 20, 14],
  /** Onboarding finished, profile saved — three short pops. */
  success: [12, 20, 12, 20, 16],
  /** Submit failed / room full — medium thud. */
  error: [40, 60, 40],
  /** Soft attention-getter for non-blocking warnings (e.g. host-only action). */
  warn: 18
};

let _reducedMotion: boolean | null = null;

function reducedMotion(): boolean {
  if (_reducedMotion !== null) return _reducedMotion;
  if (typeof window === "undefined" || !window.matchMedia) {
    _reducedMotion = false;
    return _reducedMotion;
  }
  try {
    _reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    _reducedMotion = false;
  }
  return _reducedMotion;
}

export function haptic(name: HapticName): void {
  if (reducedMotion()) return;
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  if (typeof nav.vibrate !== "function") return;
  try {
    nav.vibrate(PATTERNS[name]);
  } catch {
    /* feature blocked — ignore */
  }
}
