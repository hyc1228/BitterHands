import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { usePartyStore } from "../party/store";

/**
 * Full-screen main scene prototype (served from `/main-scene/*`, produced by sync from `main scene/`.
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

  const base = import.meta.env.BASE_URL;
  const src = base.endsWith("/") ? `${base}main-scene/index.html` : `${base}/main-scene/index.html`;

  return (
    <iframe
      className="main-scene-iframe"
      title="Nocturne Zoo main scene"
      src={src}
      allow="camera; microphone"
    />
  );
}
