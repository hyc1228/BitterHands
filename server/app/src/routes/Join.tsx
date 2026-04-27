import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { readStoredRoomId } from "../constants";
import { dict } from "../i18n";
import { usePartyStore } from "../party/store";

/**
 * First-screen room-code entry. Single field. Submit normalises the code
 * (case-insensitive: trim + lowercase the visible letters), persists it,
 * and hands off to /lobby. Lobby is now the always-on hub — once you're
 * in the room you decide there whether to set up a character or spectate.
 */
export default function Join() {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);
  const nav = useNavigate();
  const loc = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [roomId, setRoomId] = useState(() => readStoredRoomId("nz.roomId"));
  const setMode = usePartyStore((s) => s.setMode);

  const submitDisabled = useMemo(
    () => !roomId.trim() || busy,
    [roomId, busy]
  );

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
    try {
      // Case-insensitive: normalise to lowercase before saving + handing off
      // so two tabs typing "Hackathon" / "HACKATHON" / "hackathon" all wind
      // up in the same PartyKit room. The visible name keeps original case
      // for branding via i18n.
      const code = roomId.trim().toLowerCase();
      try {
        localStorage.setItem("nz.roomId", code);
      } catch {
        /* ignore */
      }
      nav("/lobby");
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
              autoFocus
            />
          </div>
        </div>
        {error ? <div className="splash-error">{error}</div> : null}
        <button className="primary splash-start" disabled={submitDisabled} type="submit">
          {busy ? t.joining : t.splashStart}
        </button>
      </form>
    </div>
  );
}
