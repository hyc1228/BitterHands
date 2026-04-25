import { useEffect, useState } from "react";
import { useCameraFrameUpload } from "../hooks/useCameraFrameUpload";
import { useCameraStream } from "../hooks/useCameraStream";
import { usePartyStore } from "../party/store";

/**
 * Headless component: keeps the player's camera live while they're inside the
 * synchronized session (lobby or main scene) and posts a periodic JPEG
 * thumbnail to PartyKit so OB can render the face wall.
 *
 * Why this exists: the previous flow ran the upload from `<DetectionPanel/>`
 * (mounted on `/game`), but the new lobby → main-scene flow never mounts that
 * component, so OB only ever saw initials. We attach the upload to the routes
 * that actually run during the game.
 */
export default function CameraFrameUploader() {
  const conn = usePartyStore((s) => s.conn);
  const { stream, error, start } = useCameraStream({
    video: { width: { ideal: 320 }, height: { ideal: 180 }, facingMode: "user" },
    audio: false
  });
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);

  // Try to grab the camera once the WS is open. The user already granted
  // permission earlier in onboarding so getUserMedia resolves silently on most
  // browsers (no second prompt). If it does fail, we fall back to OB showing
  // initials — non-fatal.
  useEffect(() => {
    if (conn !== "open") return;
    if (stream) return;
    void start();
  }, [conn, stream, start]);

  // Wire the stream to a hidden <video>; useCameraFrameUpload reads frames
  // from this element on a 800ms interval.
  useEffect(() => {
    if (!videoEl) return;
    if (videoEl.srcObject !== stream) videoEl.srcObject = stream;
    if (stream) void videoEl.play().catch(() => undefined);
  }, [stream, videoEl]);

  useCameraFrameUpload({ enabled: conn === "open" && !!stream, videoEl });

  if (error) {
    // Still keep the element mounted so a later retry can succeed; just don't
    // surface anything to the player.
  }

  return (
    <video
      ref={(el) => setVideoEl(el)}
      autoPlay
      playsInline
      muted
      aria-hidden="true"
      style={{
        position: "fixed",
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: "none",
        zIndex: -1
      }}
    />
  );
}
