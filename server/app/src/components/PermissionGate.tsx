import { useState } from "react";
import { getGetUserMediaBlockReason } from "../lib/mediaAccess";
import { dict } from "../i18n";
import { usePartyStore } from "../party/store";

interface Props {
  open: boolean;
  onCancel: () => void;
  onAccept: (stream: MediaStream | null) => void;
}

export default function PermissionGate({ open, onCancel, onAccept }: Props) {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);
  const [cam, setCam] = useState(true);
  const [mic, setMic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function handleContinue() {
    setError(null);
    setBusy(true);
    try {
      if (!cam && !mic) {
        onAccept(null);
        return;
      }
      const block = getGetUserMediaBlockReason();
      if (block) {
        setError(block === "insecure" ? t.permInsecureContext : t.permMediaUnavailable);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: cam,
        audio: mic
      });
      onAccept(stream);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-mask" role="dialog" aria-modal="true" aria-labelledby="permTitle">
      <div className="modal">
        <h2 id="permTitle">{t.permTitle}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t.permIntro}
        </p>
        <label className="toggle-row">
          <div>
            <strong>{t.permCamera}</strong>
            <div className="hint">{t.permCameraHint}</div>
          </div>
          <input
            type="checkbox"
            checked={cam}
            onChange={(e) => setCam(e.target.checked)}
            aria-label={t.permCamera}
          />
        </label>
        <label className="toggle-row">
          <div>
            <strong>{t.permMic}</strong>
            <div className="hint">{t.permMicHint}</div>
          </div>
          <input
            type="checkbox"
            checked={mic}
            onChange={(e) => setMic(e.target.checked)}
            aria-label={t.permMic}
          />
        </label>
        {error ? (
          <div style={{ color: "#ff9a8a", fontSize: 13 }}>{error}</div>
        ) : null}
        <div className="row">
          <button onClick={onCancel} disabled={busy}>
            {t.permLater}
          </button>
          <button className="primary" onClick={handleContinue} disabled={busy}>
            {busy ? "…" : t.permContinue}
          </button>
        </div>
      </div>
    </div>
  );
}
