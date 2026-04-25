import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getMainSceneFrameSrc } from "../constants";
import { usePartyStore } from "../party/store";

/**
 * Full-screen main scene: always loads the latest copy from repo `main scene/` (synced into `public/main-scene` on build). Do not hand-edit the copy — update `main scene/*` in git and run `build:client`.
 */
export default function MainScene() {
  const nav = useNavigate();
  const conn = usePartyStore((s) => s.conn);
  const rulesCard = usePartyStore((s) => s.rulesCard);

  useEffect(() => {
    if (conn === "idle" || (conn === "closed" && !rulesCard)) {
      nav("/", { replace: true });
    }
  }, [conn, rulesCard, nav]);

  const src = useMemo(() => getMainSceneFrameSrc(), []);

  return (
    <iframe
      className="main-scene-iframe"
      title="Nocturne Zoo main scene"
      src={src}
      allow="camera; microphone"
    />
  );
}
