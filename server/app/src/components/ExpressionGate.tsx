import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dict } from "../i18n";
import { usePartyStore } from "../party/store";
import { useCameraStream } from "../hooks/useCameraStream";
import { useFaceMesh } from "../hooks/useFaceMesh";
import {
  createEyesClosedState,
  createMouthState,
  createShakeState,
  DETECTION_DEFAULTS,
  eyesClosedProgress,
  shakeShakesCount,
  updateEyesClosed,
  updateMouth,
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

  const { stream, error: camError, start, stop } = useCameraStream({
    video: { width: { ideal: 480 }, height: { ideal: 360 }, facingMode: "user" },
    audio: false
  });
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [enabled, setEnabled] = useState(false);
  /** Bumps to force a UI re-render at most ~12 fps while detectors progress. */
  const [, setUiTick] = useState(0);

  const shakeRef = useRef(createShakeState());
  const mouthRef = useRef(createMouthState());
  const eyesRef = useRef(createEyesClosedState());

  // Keep video element wired up to the stream (mirrors selfie).
  useEffect(() => {
    if (!videoEl) return;
    videoEl.srcObject = stream;
    if (stream) void videoEl.play().catch(() => undefined);
  }, [stream, videoEl]);

  const onLandmarks = useCallback((lm: { x: number; y: number; z?: number }[]) => {
    const now = performance.now();
    if (!shakeRef.current.done) shakeRef.current = updateShake(lm, shakeRef.current);
    if (!mouthRef.current.done) mouthRef.current = updateMouth(lm, mouthRef.current);
    if (!eyesRef.current.done) eyesRef.current = updateEyesClosed(lm, eyesRef.current, now);
    setUiTick((n) => (n + 1) % 1024);
  }, []);

  const { status: meshStatus, lastError: meshError } = useFaceMesh({
    enabled: enabled && !!stream,
    videoEl,
    onLandmarks
  });

  const allDone =
    shakeRef.current.done && mouthRef.current.done && eyesRef.current.done;

  // Notify parent whenever pass-state flips.
  const lastPass = useRef(false);
  useEffect(() => {
    if (allDone === lastPass.current) return;
    lastPass.current = allDone;
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
    eyesRef.current = createEyesClosedState();
    lastPass.current = false;
    onPassed(false);
    const s = await start();
    if (s) setEnabled(true);
  }, [start, onPassed]);

  const handleRetry = useCallback(() => {
    shakeRef.current = createShakeState();
    mouthRef.current = createMouthState();
    eyesRef.current = createEyesClosedState();
    lastPass.current = false;
    onPassed(false);
    setUiTick((n) => (n + 1) % 1024);
  }, [onPassed]);

  const tasks = useMemo(() => {
    const now = performance.now();
    const shakeDone = shakeRef.current.done;
    const mouthDone = mouthRef.current.done;
    const eyesDone = eyesRef.current.done;
    return {
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
        done: eyesDone,
        active: !eyesDone && eyesRef.current.since != null,
        progress: eyesClosedProgress(eyesRef.current, now),
        icon: "😴",
        label: t.gateTaskCloseEyes,
        status: eyesDone
          ? t.gateOk
          : eyesRef.current.since == null
            ? t.gateProgressEyesOpen
            : t.gateProgressEyesHold(
                Math.max(
                  0,
                  (DETECTION_DEFAULTS.eyesClosedHoldMs - (now - eyesRef.current.since)) / 1000
                ).toFixed(1)
              )
      }
    } as const;
  }, [t]);

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
        {!enabled ? (
          <button type="button" className="primary gate-start" onClick={handleStart}>
            📷 {t.gateEnable}
          </button>
        ) : null}
        {meshLoading ? <div className="gate-overlay">{t.gateLoading}</div> : null}
        {camErr ? <div className="gate-overlay gate-overlay--err">⚠ {camErr}</div> : null}
        {meshErr ? <div className="gate-overlay gate-overlay--err">⚠ {meshErr}</div> : null}
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
