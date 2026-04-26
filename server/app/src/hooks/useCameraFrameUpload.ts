import { useEffect, useRef } from "react";
import { ClientMessageTypes } from "../party/protocol";
import { usePartyStore } from "../party/store";

interface Opts {
  enabled: boolean;
  videoEl: HTMLVideoElement | null;
  /** Square thumbnail edge in px. */
  size?: number;
  intervalMs?: number;
  quality?: number;
}

/**
 * Periodically grabs a low-res JPEG snapshot from the given <video> element
 * and sends it over the WebSocket as a `camera_frame` message so the OB view
 * can render a live thumbnail wall.
 *
 * Outputs a SQUARE thumbnail (center-cropped from the source video) because OB
 * renders these inside circular avatars — a 16:9 source going through
 * `object-fit: cover` clips the sides and pushes the face off-center.
 *
 * Defaults are tuned for a smooth-looking OB feed (5 fps, ~4 KB / frame) without
 * crushing mobile uplink: 10 players × 5 fps × ~5 KB ≈ 250 KB/s aggregate at OB.
 * Mobile JPEG encoding at 128² is ~2 ms per frame on a modern phone (negligible).
 */
export function useCameraFrameUpload({
  enabled,
  videoEl,
  size = 128,
  intervalMs = 200,
  quality = 0.42
}: Opts) {
  const send = usePartyStore((s) => s.send);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!enabled || !videoEl) return;
    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }
    const c = canvasRef.current;
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d", { alpha: false });
    if (!ctx) return;

    const id = window.setInterval(() => {
      if (!videoEl || videoEl.readyState < 2) return;
      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      if (!vw || !vh) return;
      // Center-crop the larger dimension so the face stays centered in the circle.
      const side = Math.min(vw, vh);
      const sx = (vw - side) / 2;
      const sy = (vh - side) / 2;
      try {
        ctx.drawImage(videoEl, sx, sy, side, side, 0, 0, size, size);
        const dataUrl = c.toDataURL("image/jpeg", quality);
        send(ClientMessageTypes.CAMERA_FRAME, { dataUrl });
      } catch {
        /* swallow */
      }
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [enabled, videoEl, size, intervalMs, quality, send]);
}
