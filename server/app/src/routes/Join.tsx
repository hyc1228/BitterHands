import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { pickRandomDefaultName, readStoredRoomId } from "../constants";
import { dict } from "../i18n";
import { usePartyStore } from "../party/store";

export default function Join() {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);
  const nav = useNavigate();
  const loc = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [roomId, setRoomId] = useState(() => readStoredRoomId("nz.roomId"));
  /** Fun random default each time you open Join; not read from localStorage (submit still saves). */
  const [name, setName] = useState(() => pickRandomDefaultName());

  const setMyName = usePartyStore((s) => s.setName);
  const setMode = usePartyStore((s) => s.setMode);

  const submitDisabled = useMemo(() => !roomId.trim() || !name.trim() || busy, [roomId, name, busy]);

  useEffect(() => {
    setMode("player");
  }, [setMode]);

  useEffect(() => {
    const st = loc.state as { joinError?: string } | undefined;
    if (!st?.joinError) return;
    setError(st.joinError);
    nav("/", { replace: true, state: null });
  }, [loc.state, nav]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitDisabled) return;
    setBusy(true);
    setError(null);
    setMyName(name.trim());
    try {
      try {
        localStorage.setItem("nz.roomId", roomId.trim());
        localStorage.setItem("nz.name", name.trim());
      } catch {
        /* ignore */
      }
      // Hand off to onboard route, which will run the WS connect and permission gate.
      nav("/onboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="splash-wrap" role="region" aria-label={t.splashTitle}>
      <div className="splash-bg" aria-hidden />
      <div className="splash-vignette" aria-hidden />
      <form className="splash-stage splash-stage--form" onSubmit={handleSubmit}>
        <h1 className="splash-title">{t.splashTitle}</h1>
        <p className="splash-tagline">{t.splashTagline}</p>
        <div className="splash-fields">
          <div>
            <label className="label" htmlFor="roomId">
              {t.roomLabel}
            </label>
            <input
              id="roomId"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder={t.roomPlaceholder}
            />
          </div>
          <div>
            <label className="label" htmlFor="name">
              {t.nameLabel}
            </label>
            <input
              id="name"
              autoComplete="nickname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.namePlaceholder}
            />
          </div>
        </div>
        {error ? <div className="splash-error">{error}</div> : null}
        <button className="primary splash-start" disabled={submitDisabled} type="submit">
          {busy ? t.joining : t.splashStart}
        </button>
        {/* OB link intentionally hidden — only the operator should reach `/ob`, and even
            then they need the key gate (see ObAuthGate in Ob.tsx). */}
      </form>
    </div>
  );
}
