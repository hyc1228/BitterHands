import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import CameraFrameUploader from "../components/CameraFrameUploader";
import PlayerRowFace from "../components/PlayerRowFace";
import { animalLocalized, dict } from "../i18n";
import { ClientMessageTypes } from "../party/protocol";
import { usePartyStore } from "../party/store";

/**
 * Synchronized waiting room. Player lands here after passing the Final Check.
 *
 * - Sends `READY` once on mount so the server marks this connection ready.
 * - Listens for the server's `started` flag (via the snapshot) and navigates everyone
 *   to `/main-scene` together when OB triggers START.
 * - Shows the live ready count + roster so it's obvious who else is waiting.
 */
export default function Lobby() {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);
  const nav = useNavigate();
  const conn = usePartyStore((s) => s.conn);
  const myName = usePartyStore((s) => s.myName);
  const send = usePartyStore((s) => s.send);
  const snapshot = usePartyStore((s) => s.snapshot);
  const rulesCard = usePartyStore((s) => s.rulesCard);

  const sentReady = useRef(false);

  // Bounce back to the entrance if the connection died before reaching the lobby.
  useEffect(() => {
    if (conn === "idle" || (conn === "closed" && !rulesCard)) {
      nav("/", { replace: true });
    }
  }, [conn, rulesCard, nav]);

  // Send READY exactly once whenever the WS is open.
  useEffect(() => {
    if (sentReady.current) return;
    if (conn !== "open") return;
    if (send(ClientMessageTypes.READY)) {
      sentReady.current = true;
    }
  }, [conn, send]);

  // Re-send READY automatically after a reconnect (server resets ready on new conn.id).
  useEffect(() => {
    if (conn !== "open") return;
    if (sentReady.current && snapshot) {
      const me = snapshot.players.find((p) => p.name === myName);
      if (me && me.ready === false) {
        send(ClientMessageTypes.READY);
      }
    }
  }, [conn, snapshot, myName, send]);

  // The whole point of this screen: when OB starts the game, jump to main scene as a group.
  useEffect(() => {
    if (snapshot?.started) {
      nav("/main-scene", { replace: true });
    }
  }, [snapshot?.started, nav]);

  const players = snapshot?.players ?? [];
  const readyPlayers = useMemo(() => players.filter((p) => p.ready), [players]);
  const waitingPlayers = useMemo(() => players.filter((p) => !p.ready), [players]);
  const total = players.length;
  const readyCount = readyPlayers.length;
  const myEntry = players.find((p) => p.name === myName);
  const animalLabel = myEntry?.animal
    ? animalLocalized[lang][myEntry.animal] ?? myEntry.animal
    : null;

  return (
    <div className="lobby-wrap">
      <CameraFrameUploader />
      <div className="card lobby-card">
        <div className="lobby-pulse" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h1 className="section-title lobby-title">{t.lobbyTitle}</h1>
        <p className="muted lobby-sub">{t.lobbyHint}</p>

        <div className="lobby-counter" role="status" aria-live="polite">
          <span className="lobby-counter__big">{readyCount}</span>
          <span className="lobby-counter__sep">/</span>
          <span className="lobby-counter__big">{total}</span>
          <span className="lobby-counter__label">{t.lobbyReadyLabel}</span>
        </div>

        {animalLabel ? (
          <div className="lobby-self muted">
            {t.lobbySelfPrefix} <strong>{animalLabel}</strong>
          </div>
        ) : null}

        <div className="lobby-rosters">
          <div>
            <div className="lobby-section-label">{t.lobbyReadyHead}</div>
            {readyPlayers.length === 0 ? (
              <div className="muted lobby-empty">—</div>
            ) : (
              <ul className="lobby-list">
                {readyPlayers.map((p) => (
                  <li key={p.id} className={"lobby-row" + (p.name === myName ? " is-self" : "")}>
                    <PlayerRowFace player={p} />
                    <span className="lobby-row-name">{p.name}</span>
                    <span className="lobby-row-mark" aria-hidden>✓</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {waitingPlayers.length > 0 ? (
            <div>
              <div className="lobby-section-label">{t.lobbyWaitingHead}</div>
              <ul className="lobby-list">
                {waitingPlayers.map((p) => (
                  <li key={p.id} className={"lobby-row" + (p.name === myName ? " is-self" : "") + " is-waiting"}>
                    <PlayerRowFace player={p} />
                    <span className="lobby-row-name">{p.name}</span>
                    <span className="lobby-row-mark muted" aria-hidden>…</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="lobby-foot muted">{t.lobbyOpHint}</div>
      </div>
    </div>
  );
}
