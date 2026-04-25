import { useEffect, useMemo, useState } from "react";
import { dict } from "../i18n";
import { animalEmoji, type PublicPlayer } from "../party/protocol";
import { usePartyStore, type LogEntry } from "../party/store";

export default function Ob() {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);
  const conn = usePartyStore((s) => s.conn);
  const setMode = usePartyStore((s) => s.setMode);
  const connect = usePartyStore((s) => s.connect);
  const disconnect = usePartyStore((s) => s.disconnect);
  const snapshot = usePartyStore((s) => s.snapshot);
  const log = usePartyStore((s) => s.log);
  const cameraFrames = usePartyStore((s) => s.cameraFrames);

  const [room, setRoom] = useState(() => {
    const params = new URLSearchParams(location.hash.split("?")[1] || "");
    const fromQuery = params.get("room");
    if (fromQuery) return fromQuery;
    try {
      return localStorage.getItem("nz.obRoom") || "test-room";
    } catch {
      return "test-room";
    }
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode("ob");
    return () => {
      // Don't auto-disconnect when leaving—OB might be left running.
    };
  }, [setMode]);

  async function handleConnect() {
    setError(null);
    try {
      try {
        localStorage.setItem("nz.obRoom", room);
      } catch {
        /* ignore */
      }
      await connect({ roomId: room, name: "ob", lang, mode: "ob" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const players = snapshot?.players ?? [];
  const cams = useMemo(() => Array.from(cameraFrames.values()), [cameraFrames]);

  return (
    <div className="ob-grid">
      <section className="card stack" aria-label="ob-left">
        <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
          <input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder={t.roomPlaceholder}
            aria-label={t.roomLabel}
          />
          {conn === "open" ? (
            <button onClick={() => disconnect()}>disconnect</button>
          ) : (
            <button className="primary" onClick={handleConnect}>
              connect
            </button>
          )}
        </div>
        {error ? <div style={{ color: "#ff9a8a" }}>{error}</div> : null}
        <div>
          <div className="section-title">
            {t.players} <span className="muted">({players.length})</span>
          </div>
          <div className="players-list">
            {players.length === 0 ? (
              <div className="muted">—</div>
            ) : (
              players.map((p) => <ObPlayer key={p.id} player={p} />)
            )}
          </div>
        </div>
        <div>
          <div className="section-title">{t.events}</div>
          <div className="log">
            {log.length === 0 ? (
              <div className="muted">—</div>
            ) : (
              log.map((entry, i) => <ObLogLine key={`${entry.ts}-${i}`} entry={entry} />)
            )}
          </div>
        </div>
      </section>

      <section className="card stack" aria-label="ob-right">
        <div className="section-title">
          {t.cameras} <span className="muted">({cams.length})</span>
        </div>
        {cams.length === 0 ? (
          <div className="empty-cams">
            (no live camera frames yet —— ask a player to enable detection)
          </div>
        ) : (
          <div className="cams-grid">
            {cams.map((c) => (
              <div key={c.playerId} className="cam-card">
                <div className="meta">
                  <span>{c.playerName ?? c.playerId.slice(0, 6)}</span>
                  <span>{new Date(c.ts).toLocaleTimeString()}</span>
                </div>
                <img src={c.dataUrl} alt={`camera ${c.playerName ?? c.playerId}`} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ObPlayer({ player }: { player: PublicPlayer }) {
  return (
    <div className="player">
      <span className="name">
        <span aria-hidden>{animalEmoji(player.animal)}</span>
        <span>{player.name}</span>
      </span>
      <span className="badge">
        {`♥ ${player.lives} · V ${player.violations}`}
      </span>
    </div>
  );
}

function ObLogLine({ entry }: { entry: LogEntry }) {
  const ts = new Date(entry.ts).toLocaleTimeString();
  return (
    <div className={`log-line kind-${entry.kind}`}>
      <span className="muted">[{ts}]</span> {entry.text}
    </div>
  );
}
