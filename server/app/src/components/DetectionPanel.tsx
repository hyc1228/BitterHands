import { useEffect, useMemo, useRef, useState } from "react";
import { dict } from "../i18n";
import { Animals, ClientMessageTypes } from "../party/protocol";
import { usePartyStore } from "../party/store";
import { useCameraFrameUpload } from "../hooks/useCameraFrameUpload";
import { useCameraStream } from "../hooks/useCameraStream";
import { useFaceMesh } from "../hooks/useFaceMesh";

const LEFT_EYE = { p1: 33, p2: 160, p3: 158, p4: 133, p5: 153, p6: 144 } as const;
const RIGHT_EYE = { p1: 362, p2: 385, p3: 387, p4: 263, p5: 373, p6: 380 } as const;
const NOSE_TIP = 1;

interface Pt {
  x: number;
  y: number;
  z?: number;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eyeEAR(landmarks: Pt[], idx: typeof LEFT_EYE | typeof RIGHT_EYE): number {
  const p1 = landmarks[idx.p1];
  const p2 = landmarks[idx.p2];
  const p3 = landmarks[idx.p3];
  const p4 = landmarks[idx.p4];
  const p5 = landmarks[idx.p5];
  const p6 = landmarks[idx.p6];
  if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return 1;
  const A = dist(p2, p6);
  const B = dist(p3, p5);
  const C = dist(p1, p4);
  return (A + B) / (2 * C);
}

const DET = {
  owl: { cycleMs: 40000, prepMs: 2000, windowMs: 5000, earThresh: 0.19 },
  giraffe: { cycleMs: 45000, windowMs: 5000, ampThresh: 0.08, peaksNeeded: 2 }
} as const;

export default function DetectionPanel() {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);
  const myAnimal = usePartyStore((s) => s.myAnimal);
  const send = usePartyStore((s) => s.send);
  const [status, setStatus] = useState<string>(t.detOff);
  const [enabled, setEnabled] = useState(false);

  const { stream, error, start, stop } = useCameraStream({
    video: { width: { ideal: 640 }, height: { ideal: 360 } },
    audio: false
  });
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  // Attach stream to <video>.
  useEffect(() => {
    if (videoElRef.current) {
      videoElRef.current.srcObject = stream;
      if (stream) videoElRef.current.play().catch(() => undefined);
    }
  }, [stream]);

  // Detection state holders (use refs to keep across renders)
  const owlWindowActive = useRef(false);
  const blinkSeen = useRef(false);
  const giraffeWindowActive = useRef(false);
  const noseBaseX = useRef<number | null>(null);
  const noseMin = useRef<number | null>(null);
  const noseMax = useRef<number | null>(null);
  const peaks = useRef(0);
  const lastDir = useRef(0);

  useFaceMesh({
    enabled: enabled && !!stream,
    videoEl: videoElRef.current,
    onLandmarks: (landmarks) => {
      if (myAnimal === Animals.OWL) {
        const ear = (eyeEAR(landmarks, LEFT_EYE) + eyeEAR(landmarks, RIGHT_EYE)) / 2;
        const blink = ear < DET.owl.earThresh;
        if (owlWindowActive.current && blink) blinkSeen.current = true;
      }
      if (myAnimal === Animals.GIRAFFE && giraffeWindowActive.current) {
        const noseX = landmarks[NOSE_TIP]?.x;
        if (typeof noseX !== "number") return;
        if (noseBaseX.current == null) noseBaseX.current = noseX;
        noseMin.current = noseMin.current == null ? noseX : Math.min(noseMin.current, noseX);
        noseMax.current = noseMax.current == null ? noseX : Math.max(noseMax.current, noseX);
        const dx = noseX - noseBaseX.current;
        const dir = dx > 0.01 ? 1 : dx < -0.01 ? -1 : 0;
        if (dir !== 0 && lastDir.current !== 0 && dir !== lastDir.current) {
          peaks.current += 1;
        }
        if (dir !== 0) lastDir.current = dir;
      }
    }
  });

  // Frame upload (for OB)
  useCameraFrameUpload({ enabled: enabled && !!stream, videoEl: videoElRef.current });

  // Owl + Giraffe scheduling
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
        noseBaseX.current = null;
        noseMin.current = null;
        noseMax.current = null;
        peaks.current = 0;
        lastDir.current = 0;
        setStatus("GIRAFFE: swing your neck (5s)");
        timeoutId = window.setTimeout(() => {
          giraffeWindowActive.current = false;
          if (!alive) return;
          const amp =
            noseMax.current != null && noseMin.current != null
              ? Math.abs(noseMax.current - noseMin.current)
              : 0;
          const ok = amp >= DET.giraffe.ampThresh && peaks.current >= DET.giraffe.peaksNeeded;
          if (!ok) {
            setStatus(
              `GIRAFFE: not enough swing (amp=${amp.toFixed(3)}, peaks=${peaks.current}) → violation`
            );
            send(ClientMessageTypes.VIOLATION, { detail: "neck swing too small (giraffe rule)" });
          } else {
            setStatus(`GIRAFFE: ok (amp=${amp.toFixed(3)}, peaks=${peaks.current})`);
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

  async function handleStart() {
    const s = await start();
    if (s) setEnabled(true);
  }
  function handleStop() {
    setEnabled(false);
    stop();
    setStatus(t.detOff);
  }

  return (
    <div className="card stack" aria-label="detection-panel">
      <div className="section-title">{t.detectionTitle}</div>
      <div style={{ display: "grid", gap: 8 }}>
        <video
          ref={videoElRef}
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
            {error ? `err: ${error}` : status}
          </span>
        </div>
      </div>
    </div>
  );
}
