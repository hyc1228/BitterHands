import type { BlinkHoldState, MouthState, ShakeState } from "./detectors";
import { blinkProgress } from "./detectors";

/** Latest frame snapshot for tools / 全局调用 (see `getDetermination`). */
export type DeterminationSnapshot = {
  shake: Readonly<ShakeState>;
  mouth: Readonly<MouthState>;
  blink: Readonly<BlinkHoldState>;
  /** 0..1 for 5s no-blink hold */
  blinkProgress: number;
  at: number;
};

let snapshot: DeterminationSnapshot | null = null;

export function setDeterminationSnapshot(s: DeterminationSnapshot | null): void {
  snapshot = s;
}

/**
 * 全局只读访问（例如主场景、自动化测试、或后续全局规则引擎）。
 * 在 Detection 面板开启摄像头并成功跑 FaceMesh 时才有数据。
 */
export function getDetermination(): DeterminationSnapshot | null {
  return snapshot;
}

/**
 * 由面板在内存里重置 demo 三个状态后调用，外部也可用于重新开始挑战。
 * （实际重置逻辑在 `DetectionPanel` 的 ref 中。）
 */
let resetImpl: (() => void) | null = null;
export function setDeterminationResetHandler(fn: (() => void) | null): void {
  resetImpl = fn;
}
export function resetDeterminationFromGlobal(): void {
  resetImpl?.();
}

export function makeSnapshot(
  shake: ShakeState,
  mouth: MouthState,
  blink: BlinkHoldState,
  now: number
): DeterminationSnapshot {
  return {
    shake: { ...shake },
    mouth: { ...mouth },
    blink: { ...blink },
    blinkProgress: blinkProgress(blink, now),
    at: now
  };
}

if (typeof window !== "undefined") {
  type G = { __nzDetermination: typeof getDetermination; __nzResetDetermination: typeof resetDeterminationFromGlobal };
  const w = window as unknown as G;
  w.__nzDetermination = getDetermination;
  w.__nzResetDetermination = resetDeterminationFromGlobal;
}
