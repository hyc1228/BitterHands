import { useEffect, useRef, useState } from "react";

interface Landmarks {
  x: number;
  y: number;
  z?: number;
}

interface Opts {
  enabled: boolean;
  videoEl: HTMLVideoElement | null;
  onLandmarks?: (landmarks: Landmarks[]) => void;
}

/**
 * Loads MediaPipe FaceMesh from CDN on demand and feeds the given <video>
 * frames into it. Lightweight wrapper around the legacy global FaceMesh API
 * already used by the previous HTML implementation.
 *
 * If MediaPipe scripts fail to load, the hook silently does nothing — the
 * caller can still keep the rest of the UI working.
 */
/**
 * UMD 构建里 `window.FaceMesh` 多为构造函数本身（与 `determination/index.html` 一致），
 * 少数版本为命名空间、类在 `.FaceMesh` 上。
 */
function resolveMediaPipeClass(mod: unknown, name: "FaceMesh" | "Camera"): new (...a: any[]) => any {
  if (mod == null) throw new Error(`${name} global missing`);
  if (typeof mod === "function") return mod as new (...a: any[]) => any;
  if (typeof mod === "object" && mod !== null && name in (mod as object)) {
    const inner = (mod as Record<string, unknown>)[name];
    if (typeof inner === "function") return inner as new (...a: any[]) => any;
  }
  throw new Error(`${name} is not a constructor`);
}

export function useFaceMesh({ enabled, videoEl, onLandmarks }: Opts) {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const cbRef = useRef(onLandmarks);
  cbRef.current = onLandmarks;

  useEffect(() => {
    if (!enabled || !videoEl) return;
    let cancelled = false;
    let cameraInstance: { stop: () => void } | null = null;
    let mesh: { close?: () => void } | null = null;

    setStatus("loading");
    setLastError(null);

    (async () => {
      try {
        const [meshMod, camMod] = await Promise.all([
          loadScript(
            "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js"
          ),
          loadScript(
            "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js"
          )
        ]);
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        const FaceMeshCls = resolveMediaPipeClass(w.FaceMesh, "FaceMesh");
        const CameraCls = resolveMediaPipeClass(w.Camera, "Camera");

        const faceMesh = new FaceMeshCls({
          locateFile: (file: string) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });
        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.6
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        faceMesh.onResults((results: any) => {
          const landmarks = results.multiFaceLandmarks?.[0];
          if (landmarks && cbRef.current) cbRef.current(landmarks);
        });
        mesh = faceMesh;

        const camera = new CameraCls(videoEl, {
          onFrame: async () => {
            if (!faceMesh) return;
            await faceMesh.send({ image: videoEl });
          },
          width: 640,
          height: 360
        });
        cameraInstance = camera;
        await camera.start();
        if (cancelled) return;
        setStatus("ready");
        // unused vars guard
        void meshMod;
        void camMod;
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setLastError(err instanceof Error ? err.message : String(err));
        }
        // eslint-disable-next-line no-console
        console.warn("FaceMesh failed", err);
      }
    })();

    return () => {
      cancelled = true;
      try {
        cameraInstance?.stop();
      } catch {
        /* ignore */
      }
      try {
        mesh?.close?.();
      } catch {
        /* ignore */
      }
      setStatus("idle");
      setLastError(null);
    };
  }, [enabled, videoEl]);

  return { status, lastError };
}

const loadedScripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (loadedScripts.has(src)) return loadedScripts.get(src)!;
  const p = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
  loadedScripts.set(src, p);
  return p;
}
