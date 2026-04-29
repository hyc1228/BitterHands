import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useCameraFrameUpload } from "../hooks/useCameraFrameUpload";
import { usePartyStore } from "../party/store";

export interface CameraCircleHandle {
  /** Returns a (mirrored) JPEG dataURL snapshot of the current video frame, or null if unavailable. */
  snapshot: (quality?: number) => string | null;
  /** Returns the underlying video element. */
  video: () => HTMLVideoElement | null;
}

interface Props {
  stream: MediaStream | null;
  /** Optional snapshot dataURL to display instead of live video. */
  shotDataUrl?: string | null;
}

const CameraCircle = forwardRef<CameraCircleHandle, Props>(function CameraCircle(
  { stream, shotDataUrl },
  ref
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Pipe the photo-step camera into OB's face wall so operators see players
  // mid-onboarding. Same video element used for the live preview — `videoEl`
  // state below mirrors `videoRef` so the hook re-runs when React mounts the
  // <video>.
  const [videoEl, setVideoElState] = useState<HTMLVideoElement | null>(null);
  const conn = usePartyStore((s) => s.conn);
  useCameraFrameUpload({
    enabled: conn === "open" && !!stream && !!videoEl,
    videoEl
  });
  /** Bumps each time `shotDataUrl` transitions to a fresh non-null value, so the snap-flash
   *  CSS keyframe re-runs (re-mounting the overlay via `key`). */
  const [flashKey, setFlashKey] = useState(0);
  const lastShotRef = useRef<string | null>(null);
  useEffect(() => {
    if (shotDataUrl && shotDataUrl !== lastShotRef.current) {
      setFlashKey((k) => k + 1);
    }
    lastShotRef.current = shotDataUrl ?? null;
  }, [shotDataUrl]);

  // Always keep <video> mounted (so the retake flow doesn't lose the stream
  // attachment). We layer the captured photo as an absolutely-positioned
  // overlay on top of it via CSS — see `.cam-circle.shot` rules in screens.css.

  // Callback ref: every time React assigns a new <video> element, immediately
  // rewire srcObject. This is more robust than a useEffect with [stream] deps
  // because it survives unmount/remount of the element.
  //
  // Android resilience (mirrors the same pattern as ExpressionGate's video
  // handler): wire `loadedmetadata` / `canplay` / track `unmute` listeners
  // and re-call `play()` from each one.  Without this some Android builds
  // hand back a stream whose video track is initially muted (no frames),
  // ignore the synchronous `play()` call, and never recover — leaving the
  // <video> stuck on a black frame even though the camera light is on.
  const setVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      setVideoElState(el);
      if (!el) return;
      if (stream) {
        if (el.srcObject !== stream) el.srcObject = stream;
        el.muted = true;
        el.playsInline = true;
        const tryPlay = () => {
          const p = el.play();
          if (p && typeof p.catch === "function") {
            p.catch(() => {
              /* autoplay rejected; first user tap will resume */
            });
          }
        };
        const onLoaded = () => tryPlay();
        const onCanPlay = () => tryPlay();
        el.addEventListener("loadedmetadata", onLoaded, { once: true });
        el.addEventListener("canplay", onCanPlay, { once: true });
        const tracks = stream.getVideoTracks();
        const onUnmute = () => tryPlay();
        for (const tr of tracks) tr.addEventListener("unmute", onUnmute);
        tryPlay();
        // Stash a one-shot teardown on the element so the next setVideoEl
        // call (or unmount) can detach the per-stream listeners without
        // leaking handles.  Same-element reuse with a fresh stream falls
        // through this branch which re-attaches a new closure.
        const teardown = () => {
          el.removeEventListener("loadedmetadata", onLoaded);
          el.removeEventListener("canplay", onCanPlay);
          for (const tr of tracks) tr.removeEventListener("unmute", onUnmute);
        };
        type ElWithTeardown = HTMLVideoElement & { __nzPlayTeardown?: () => void };
        const elWith = el as ElWithTeardown;
        elWith.__nzPlayTeardown?.();
        elWith.__nzPlayTeardown = teardown;
      } else {
        type ElWithTeardown = HTMLVideoElement & { __nzPlayTeardown?: () => void };
        (el as ElWithTeardown).__nzPlayTeardown?.();
        el.srcObject = null;
      }
    },
    [stream]
  );

  // Pause the live preview while a snapshot is being shown; resume on retake.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (shotDataUrl) {
      try {
        v.pause();
      } catch {
        /* ignore */
      }
    } else if (stream) {
      const p = v.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          /* ignore — user can tap to resume */
        });
      }
    }
  }, [shotDataUrl, stream]);

  useImperativeHandle(
    ref,
    () => ({
      snapshot(quality = 0.85) {
        const v = videoRef.current;
        if (!v) return null;
        if (!canvasRef.current) {
          canvasRef.current = document.createElement("canvas");
        }
        const c = canvasRef.current;
        const w = v.videoWidth || 640;
        const h = v.videoHeight || 480;
        if (!w || !h) return null;
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) return null;
        // Mirror the frame so the saved JPEG matches the previewed selfie.
        ctx.save();
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(v, 0, 0, w, h);
        ctx.restore();
        try {
          return c.toDataURL("image/jpeg", quality);
        } catch {
          return null;
        }
      },
      video() {
        return videoRef.current;
      }
    }),
    []
  );

  return (
    <div className="cam-circle-wrap">
      <div
        className={"cam-circle cat-head" + (shotDataUrl ? " shot" : "")}
        aria-label="Camera preview circle"
      >
        {/* Hand-drawn cat ears (left + right) */}
        <svg
          className="cat-ear cat-ear--L"
          viewBox="0 0 100 100"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M16 94 Q9 58 22 32 Q34 14 46 10 Q54 11 60 22 Q82 56 92 92 Q88 96 70 95 Q40 96 16 94 Z"
            fill="var(--nz-black)"
            stroke="var(--nz-cream)"
            strokeWidth="4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d="M30 84 Q33 56 42 36 Q49 32 56 42 Q66 60 72 84 Q60 86 48 85 Q38 85 30 84 Z"
            fill="rgba(214,64,46,0.20)"
            stroke="rgba(242,239,233,0.42)"
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
        <svg
          className="cat-ear cat-ear--R"
          viewBox="0 0 100 100"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M84 94 Q91 58 78 32 Q66 14 54 10 Q46 11 40 22 Q18 56 8 92 Q12 96 30 95 Q60 96 84 94 Z"
            fill="var(--nz-black)"
            stroke="var(--nz-cream)"
            strokeWidth="4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d="M70 84 Q67 56 58 36 Q51 32 44 42 Q34 60 28 84 Q40 86 52 85 Q62 85 70 84 Z"
            fill="rgba(214,64,46,0.20)"
            stroke="rgba(242,239,233,0.42)"
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
        {/* Whisker squiggles */}
        <svg className="cat-whisker cat-whisker--L" viewBox="0 0 60 40" aria-hidden="true">
          <path d="M2 10 Q26 14 56 10" fill="none" stroke="var(--nz-cream)" strokeWidth="2" strokeLinecap="round" />
          <path d="M2 22 Q28 22 58 18" fill="none" stroke="var(--nz-cream)" strokeWidth="2" strokeLinecap="round" />
          <path d="M4 34 Q28 32 56 28" fill="none" stroke="var(--nz-cream)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <svg className="cat-whisker cat-whisker--R" viewBox="0 0 60 40" aria-hidden="true">
          <path d="M58 10 Q34 14 4 10" fill="none" stroke="var(--nz-cream)" strokeWidth="2" strokeLinecap="round" />
          <path d="M58 22 Q32 22 2 18" fill="none" stroke="var(--nz-cream)" strokeWidth="2" strokeLinecap="round" />
          <path d="M56 34 Q32 32 4 28" fill="none" stroke="var(--nz-cream)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <video ref={setVideoEl} autoPlay playsInline muted />
        {shotDataUrl ? <img src={shotDataUrl} alt="snapshot" className="cam-shot" /> : null}
        {flashKey > 0 && shotDataUrl ? (
          <span key={flashKey} className="cam-flash" aria-hidden="true" />
        ) : null}
      </div>
    </div>
  );
});

export default CameraCircle;
