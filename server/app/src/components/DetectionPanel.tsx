import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dict } from "../i18n";
import { Animals, ClientMessageTypes } from "../party/protocol";
import { usePartyStore } from "../party/store";
import { useCameraFrameUpload } from "../hooks/useCameraFrameUpload";
import { useCameraStream } from "../hooks/useCameraStream";
import { useFaceMesh } from "../hooks/useFaceMesh";
import {
  averageEar,
  createBlinkHoldState,
  createMouthState,
  createShakeState,
  updateBlinkHold,
  updateMouth,
  updateShake,
  shakeShakesCount,
  DETECTION_DEFAULTS,
  makeSnapshot,
  setDeterminationResetHandler,
  setDeterminationSnapshot
} from "../determination";

const DET = {
  owl: { cycleMs: 40000, prepMs: 2000, windowMs: 5000 },
  giraffe: { cycleMs: 45000, windowMs: 5000 }
} as const;

export default function DetectionPanel() {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);
  const myAnimal = usePartyStore((s) => s.myAnimal);
  const send = usePartyStore((s) => s.send);
  const [status, setStatus] = useState<string>(t.detOff);
  const [enabled, setEnabled] = useState(false);
  const [uiTick, setUiTick] = useState(0);
  const lastUiMs = useRef(0);

  const { stream, error, start, stop } = useCameraStream({
    video: { width: { ideal: 640 }, height: { ideal: 360 } },
    audio: false
  });
  /** Must be state (not `ref.current`) so FaceMesh re-runs after `<video>` mounts. */
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);

  /** Determination demo (same as `determination/index.html`) — 全局快照来源 */
  const demoShake = useRef(createShakeState());
  const demoMouth = useRef(createMouthState());
  const demoBlink = useRef(createBlinkHoldState());

  const resetDemoStates = useCallback(() => {
    demoShake.current = createShakeState();
    demoMouth.current = createMouthState();
    demoBlink.current = createBlinkHoldState();
    setUiTick((x) => x + 1);
  }, []);

  useEffect(() => {
    setDeterminationResetHandler(() => {
      resetDemoStates();
    });
    return () => {
      setDeterminationResetHandler(null);
      setDeterminationSnapshot(null);
    };
  }, [resetDemoStates]);

  useEffect(() => {
    if (!videoEl) return;
    videoEl.srcObject = stream;
    if (stream) void videoEl.play().catch(() => undefined);
  }, [stream, videoEl]);

  const owlWindowActive = useRef(false);
  const blinkSeen = useRef(false);
  const giraffeWindowActive = useRef(false);
  const giraffeShake = useRef(createShakeState());

  const onLandmarks = useCallback(
    (landmarks: { x: number; y: number; z?: number }[]) => {
      const now = performance.now();
      demoShake.current = updateShake(landmarks, demoShake.current);
      demoMouth.current = updateMouth(landmarks, demoMouth.current);
      demoBlink.current = updateBlinkHold(landmarks, demoBlink.current, now);
      setDeterminationSnapshot(
        makeSnapshot(
          demoShake.current,
          demoMouth.current,
          demoBlink.current,
          now
        )
      );

      if (myAnimal === Animals.OWL && owlWindowActive.current) {
        if (averageEar(landmarks) < DETECTION_DEFAULTS.earClosed) {
          blinkSeen.current = true;
        }
      }
      if (myAnimal === Animals.GIRAFFE && giraffeWindowActive.current) {
        giraffeShake.current = updateShake(landmarks, giraffeShake.current);
      }

      if (now - lastUiMs.current > 80) {
        lastUiMs.current = now;
        setUiTick((x) => x + 1);
      }
    },
    [myAnimal]
  );

  const { status: meshStatus, lastError: meshError } = useFaceMesh({
    enabled: enabled && !!stream,
    videoEl,
    onLandmarks
  });

  useCameraFrameUpload({ enabled: enabled && !!stream, videoEl });

  useEffect(() => {
    if (!enabled) return;
    if (myAnimal !== Animals.OWL) return;
    let alive = true;
    let timeoutId: number | undefined;

    const tick = () => {
      if (!alive) return;
      setStatus("OWL: waiting…");
      timeoutId = window.setTimeout(() => {
        if (!alive) return;
        setStatus("OWL: get ready (2s)");
        timeoutId = window.setTimeout(() => {
          if (!alive) return;
          owlWindowActive.current = true;
          blinkSeen.current = false;
          setStatus("OWL: don't blink (5s)");
          timeoutId = window.setTimeout(() => {
            owlWindowActive.current = false;
            if (!alive) return;
            if (blinkSeen.current) {
              setStatus("OWL: blink → violation");
              send(ClientMessageTypes.VIOLATION, { detail: "blinked (owl rule)" });
            } else {
              setStatus("OWL: ok");
            }
            tick();
          }, DET.owl.windowMs);
        }, DET.owl.prepMs);
      }, DET.owl.cycleMs);
    };
    tick();
    return () => {
      alive = false;
      if (timeoutId) window.clearTimeout(timeoutId);
      owlWindowActive.current = false;
    };
  }, [enabled, myAnimal, send]);

  useEffect(() => {
    if (!enabled) return;
    if (myAnimal !== Animals.GIRAFFE) return;
    let alive = true;
    let timeoutId: number | undefined;

    const tick = () => {
      if (!alive) return;
      setStatus("GIRAFFE: waiting…");
      timeoutId = window.setTimeout(() => {
        if (!alive) return;
        giraffeWindowActive.current = true;
        giraffeShake.current = createShakeState();
        setStatus("GIRAFFE: swing your neck (5s)");
        timeoutId = window.setTimeout(() => {
          giraffeWindowActive.current = false;
          if (!alive) return;
          const ok = giraffeShake.current.done;
          if (!ok) {
            setStatus("GIRAFFE: not enough swing → violation");
            send(ClientMessageTypes.VIOLATION, { detail: "neck swing too small (giraffe rule)" });
          } else {
            setStatus("GIRAFFE: ok");
          }
          tick();
        }, DET.giraffe.windowMs);
      }, DET.giraffe.cycleMs);
    };
    tick();
    return () => {
      alive = false;
      if (timeoutId) window.clearTimeout(timeoutId);
      giraffeWindowActive.current = false;
    };
  }, [enabled, myAnimal, send]);

  const note = useMemo(() => {
    if (myAnimal === Animals.LION) return "Lion: roar detection (mic) coming soon.";
    if (myAnimal === Animals.OWL) return "Owl: don't blink during detection windows.";
    if (myAnimal === Animals.GIRAFFE) return "Giraffe: swing your neck within the window.";
    return "Awaiting animal assignment…";
  }, [myAnimal]);

  const dShake = demoShake.current;
  const dMouth = demoMouth.current;
  const dBlink = demoBlink.current;
  const now = performance.now();
  const blinkP =
    dBlink.since == null
      ? 0
      : dBlink.done
        ? 1
        : Math.min(1, (now - dBlink.since) / DETECTION_DEFAULTS.blinkHoldMs);
  void uiTick; // re-render

  async function handleStart() {
    resetDemoStates();
    const s = await start();
    if (s) setEnabled(true);
  }
  function handleStop() {
    setEnabled(false);
    stop();
    setStatus(t.detOff);
    setDeterminationSnapshot(null);
  }

  return (
    <div className="card stack" aria-label="detection-panel">
      <div className="section-title">{t.detectionTitle}</div>
      <div style={{ display: "grid", gap: 8 }}>
        <video
          ref={(el) => {
            setVideoEl(el);
          }}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%",
            aspectRatio: "16 / 9",
            objectFit: "cover",
            background: "var(--nz-black)",
            border: "1px solid var(--nz-cream-line)",
            borderRadius: "var(--nz-radius)",
            transform: "scaleX(-1)"
          }}
        />
        <div className="det-strip" role="group" aria-label="determination">
          <div
            className={
              "det-pill" +
              (dShake.done ? " det-pill--done" : dShake.changes > 0 ? " det-pill--active" : "")
            }
          >
            <span className="det-pill__icon" aria-hidden>🙂</span>
            <div className="det-pill__col">
              <span className="det-pill__label">{t.detShake}</span>
              <span className="det-pill__s">
                {dShake.done
                  ? t.detDone
                  : dShake.changes > 0
                    ? t.detShakeProgress(shakeShakesCount(dShake), 2)
                    : t.detShakeWait}
              </span>
            </div>
          </div>
          <div
            className={
              "det-pill" + (dMouth.done ? " det-pill--done" : dMouth.openFrames > 0 ? " det-pill--active" : "")
            }
          >
            <span className="det-pill__icon" aria-hidden>😮</span>
            <div className="det-pill__col">
              <span className="det-pill__label">{t.detMouth}</span>
              <span className="det-pill__s">
                {dMouth.done ? t.detDone : dMouth.openFrames > 0 ? t.detMouthOpen : t.detMouthWait}
              </span>
            </div>
          </div>
          <div
            className={"det-pill" + (dBlink.done ? " det-pill--done" : dBlink.since != null ? " det-pill--active" : "")}
          >
            <span className="det-pill__icon" aria-hidden>👁️</span>
            <div className="det-pill__col">
              <span className="det-pill__label">{t.detBlink}</span>
              <div className="det-blink-bar" aria-hidden>
                <div className="det-blink-fill" style={{ width: `${Math.round(blinkP * 100)}%` }} />
              </div>
              <span className="det-pill__s">
                {dBlink.done
                  ? t.detDone
                  : dBlink.since == null
                    ? t.detBlinkReset
                    : t.detBlinkHold(
                        ((DETECTION_DEFAULTS.blinkHoldMs - (now - dBlink.since)) / 1000).toFixed(1)
                      )}
              </span>
            </div>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {note}
        </div>
        <div className="row">
          {enabled ? (
            <button onClick={handleStop}>{t.cameraStop}</button>
          ) : (
            <button className="primary" onClick={handleStart}>
              {t.cameraStart}
            </button>
          )}
          <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
            {error
              ? `err: ${error}`
              : enabled && stream && meshStatus === "loading"
                ? t.detVisionLoading
                : enabled && stream && meshStatus === "error"
                  ? t.detVisionError(meshError || "unknown")
                  : status}
          </span>
        </div>
      </div>
    </div>
  );
}
