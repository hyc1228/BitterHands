import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_ROOM_ID, getMainSceneFrameSrc, OB_FACE_SLOTS } from "../constants";
import { dict } from "../i18n";
import { postToMainSceneFrame } from "../mainSync/postToMainSceneFrame";
import type { CameraFrame, PublicPlayer } from "../party/protocol";
import { usePartyStore, type LogEntry } from "../party/store";
import PlayerRowFace from "../components/PlayerRowFace";

export default function Ob() {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);
  const conn = usePartyStore((s) => s.conn);
  const myName = usePartyStore((s) => s.myName);
  const myAnimal = usePartyStore((s) => s.myAnimal);
  const rulesCard = usePartyStore((s) => s.rulesCard);
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
      return localStorage.getItem("nz.obRoom") || DEFAULT_ROOM_ID;
    } catch {
      return DEFAULT_ROOM_ID;
    }
  });
  const [error, setError] = useState<string | null>(null);
  const mainSceneIframeRef = useRef<HTMLIFrameElement | null>(null);

  const mainSceneSrc = useMemo(() => getMainSceneFrameSrc(), []);

  const pushMainSceneIframe = useCallback(() => {
    postToMainSceneFrame(mainSceneIframeRef.current?.contentWindow, {
      myName,
      myAnimal,
      rulesCard,
      lang,
      snapshot
    });
  }, [myName, myAnimal, rulesCard, lang, snapshot]);

  useEffect(() => {
    pushMainSceneIframe();
  }, [pushMainSceneIframe]);

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
  const facePlayers = useMemo(
    () => players.slice(0, OB_FACE_SLOTS),
    [players]
  );

  const cams = useMemo(() => Array.from(cameraFrames.values()), [cameraFrames]);
  const liveCount = cams.length;

  return (
    <div className="ob-grid">
      <section className="card stack" aria-label="ob-left">
        <div className="ob-room-row">
          <input
            className="ob-room-input"
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

      <section className="card stack ob-scene-card" aria-label="ob-right">
        <div className="section-title ob-scene-title">
          <span>
            {t.cameras} <span className="muted">({liveCount} live)</span>
          </span>
          <span className="muted ob-scene-hint" style={{ fontSize: 12, letterSpacing: "0.06em" }}>
            {t.obMainSceneLabel}
          </span>
        </div>

        <div className="ob-scene-layout">
          <div className="ob-face-column" aria-label="ob-faces-left">
            {Array.from({ length: 5 }, (_, j) => {
              const i = j;
              const player = facePlayers[i] ?? null;
              return (
                <ObFaceSlot
                  key={player?.id ?? `ob-slot-${i}`}
                  index={i}
                  player={player}
                  frame={player ? cameraFrames.get(player.id) ?? null : null}
                />
              );
            })}
          </div>

          <div className="ob-scene-center">
            <iframe
              ref={mainSceneIframeRef}
              className="ob-scene-iframe"
              title="Main scene"
              src={mainSceneSrc}
              onLoad={pushMainSceneIframe}
            />
          </div>

          <div className="ob-face-column" aria-label="ob-faces-right">
            {Array.from({ length: 5 }, (_, j) => {
              const i = j + 5;
              const player = facePlayers[i] ?? null;
              return (
                <ObFaceSlot
                  key={player?.id ?? `ob-slot-${i}`}
                  index={i}
                  player={player}
                  frame={player ? cameraFrames.get(player.id) ?? null : null}
                />
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

function ObFaceSlot({
  index,
  player,
  frame
}: {
  index: number;
  player: PublicPlayer | null;
  frame: CameraFrame | null;
}) {
  return (
    <div className="ob-face-slot" data-ob-slot={index}>
      <div className="ob-face-circle" title={player?.name ?? undefined}>
        {frame ? (
          <img src={frame.dataUrl} alt={player ? `${player.name} face` : "camera"} />
        ) : (
          <div className="ob-face-placeholder" aria-hidden>
            {player ? <span className="ob-face-initial">{player.name.charAt(0).toUpperCase()}</span> : null}
            {!player ? <span className="ob-face-empty">·</span> : null}
          </div>
        )}
      </div>
      {player ? (
        <div className="ob-face-name" title={player.name}>
          {player.name.length > 8 ? `${player.name.slice(0, 7)}…` : player.name}
        </div>
      ) : (
        <div className="ob-face-name muted"> </div>
      )}
    </div>
  );
}

function ObPlayer({ player }: { player: PublicPlayer }) {
  return (
    <div className="player">
      <span className="name">
        <PlayerRowFace player={player} />
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
