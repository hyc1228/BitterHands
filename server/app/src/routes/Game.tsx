import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import DetectionPanel from "../components/DetectionPanel";
import PlayerRowFace from "../components/PlayerRowFace";
import { dict, animalLocalized } from "../i18n";
import { ClientMessageTypes, type PublicPlayer } from "../party/protocol";
import { usePartyStore, type LogEntry } from "../party/store";

export default function Game() {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);
  const nav = useNavigate();
  const conn = usePartyStore((s) => s.conn);
  const snapshot = usePartyStore((s) => s.snapshot);
  const log = usePartyStore((s) => s.log);
  const rulesCard = usePartyStore((s) => s.rulesCard);
  const myAnimal = usePartyStore((s) => s.myAnimal);
  const send = usePartyStore((s) => s.send);
  const myName = usePartyStore((s) => s.myName);

  const [chat, setChat] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);

  // If user lands on /game without an active connection, send back to Join.
  useEffect(() => {
    if (conn === "idle" || (conn === "closed" && !rulesCard)) {
      nav("/", { replace: true });
    }
  }, [conn, rulesCard, nav]);

  function handleSendChat(e: React.FormEvent) {
    e.preventDefault();
    const text = chat.trim();
    if (!text) return;
    send(ClientMessageTypes.CHAT, { text });
    setChat("");
  }

  function handleStart() {
    send(ClientMessageTypes.START);
    nav("/main-scene", { replace: true });
  }

  function handleViolation() {
    send(ClientMessageTypes.VIOLATION, { detail: "manual test" });
  }

  return (
    <div className="game-grid">
      <section className="card stack" aria-label="my-status">
        <h2 className="section-title">{myName ? `${myName}` : "—"}</h2>
        <div className="muted" style={{ fontSize: 13 }}>
          {t.ownAnimalUnknown}: {myAnimal ? animalLocalized[lang][myAnimal] || myAnimal : t.ownAnimalUnknown}
        </div>

        {rulesCard ? (
          <div className="rules-card">
            <div className="row-line">
              <span className="label-inline">{t.rulesCardTitle}</span>
              <strong>
                {rulesCard.emoji}{" "}
                {rulesCard.animal ? animalLocalized[lang][rulesCard.animal] || rulesCard.animal : "—"}
              </strong>
            </div>
            <div className="row-line">
              <span className="label-inline">{t.ruleLabel}</span>
              <span>{rulesCard.rule}</span>
            </div>
            <div className="row-line">
              <span className="label-inline">{t.winLabel}</span>
              <span>{rulesCard.win}</span>
            </div>
            <div className="row-line">
              <span className="label-inline">{t.teammatesLabel}</span>
              <span>
                {rulesCard.teammates.length
                  ? rulesCard.teammates.map((m) => m.name).join("、 ")
                  : t.noTeammates}
              </span>
            </div>
          </div>
        ) : (
          <div className="muted" style={{ fontStyle: "italic" }}>
            {t.analyzing}
          </div>
        )}

        <div className="row" style={{ marginTop: 4 }}>
          <button onClick={handleStart}>{t.startGame}</button>
          <button className="ghost" onClick={handleViolation}>
            violation
          </button>
        </div>

        <DetectionPanel />
      </section>

      <section className="card stack" aria-label="log-and-players">
        <PlayersList players={snapshot?.players ?? []} />
        <div>
          <div className="section-title">{t.log}</div>
          <div className="log" ref={logRef}>
            {log.length === 0 ? (
              <div className="muted">—</div>
            ) : (
              log.map((entry, i) => <LogLine key={`${entry.ts}-${i}`} entry={entry} />)
            )}
          </div>
        </div>
        <form className="chat-row" onSubmit={handleSendChat}>
          <input
            value={chat}
            onChange={(e) => setChat(e.target.value)}
            placeholder={t.chatPlaceholder}
          />
          <button className="primary" type="submit" disabled={!chat.trim()}>
            {t.send}
          </button>
        </form>
      </section>
    </div>
  );
}

function PlayersList({ players }: { players: PublicPlayer[] }) {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);
  return (
    <div>
      <div className="section-title">{t.players}</div>
      <div className="players-list">
        {players.length === 0 ? (
          <div className="muted">—</div>
        ) : (
          players.map((p) => (
            <div className="player" key={p.id}>
              <span className="name">
                <PlayerRowFace player={p} />
                <span>{p.name}</span>
              </span>
              <span className="badge">{`♥ ${p.lives}`}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  const ts = useMemo(() => new Date(entry.ts).toLocaleTimeString(), [entry.ts]);
  return (
    <div className={`log-line kind-${entry.kind}`}>
      <span className="muted">[{ts}]</span> {entry.text}
    </div>
  );
}
