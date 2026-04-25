import { useEffect, useRef } from "react";
import { ClientMessageTypes } from "../party/protocol";
import { usePartyStore } from "../party/store";

interface Opts {
  enabled: boolean;
  videoEl: HTMLVideoElement | null;
  width?: number;
  height?: number;
  intervalMs?: number;
  quality?: number;
}

/**
 * Periodically grabs a low-res JPEG snapshot from the given <video> element
 * and sends it over the WebSocket as a `camera_frame` message so the OB view
 * can render a live thumbnail wall. Defaults are tuned for small OB tiles
 * (lower resolution and quality to cut bandwidth and main-thread work).
 */
export function useCameraFrameUpload({
  enabled,
  videoEl,
  width = 160,
  height = 90,
  intervalMs = 800,
  quality = 0.4
}: Opts) {
  const send = usePartyStore((s) => s.send);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!enabled || !videoEl) return;
    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }
    const c = canvasRef.current;
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d", { alpha: false });
    if (!ctx) return;

    const id = window.setInterval(() => {
      if (!videoEl || videoEl.readyState < 2) return;
      try {
        ctx.drawImage(videoEl, 0, 0, width, height);
        const dataUrl = c.toDataURL("image/jpeg", quality);
        send(ClientMessageTypes.CAMERA_FRAME, { dataUrl });
      } catch {
        /* swallow */
      }
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [enabled, videoEl, width, height, intervalMs, quality, send]);
}
