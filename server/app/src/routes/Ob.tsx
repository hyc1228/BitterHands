import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_ROOM_ID, getMainSceneFrameSrc, OB_FACE_SLOTS, OB_LOBBY_SPOTLIGHTS } from "../constants";
import { animalLocalized, dict } from "../i18n";
import { useMainSceneIframeBridge } from "../hooks/useMainSceneIframeBridge";
import {
  postItemInboxToFrame,
  postMainSceneNetToFrame,
  postObCameraToFrame,
  postToMainSceneFrame,
  type ObCameraPayload
} from "../mainSync/postToMainSceneFrame";
import { ClientMessageTypes, type CameraFrame, type Lang, type PublicPlayer } from "../party/protocol";
import { usePartyStore, type LogEntry } from "../party/store";
import { pickObSpotlight } from "../utils/obSpotlight";
import PlayerRowFace from "../components/PlayerRowFace";

function obAnimalLabel(lang: Lang, animal: PublicPlayer["animal"], unknown: string): string {
  if (animal == null) return unknown;
  return animalLocalized[lang][animal] ?? animal;
}

function obFrameVisualEqual(
  a: CameraFrame | null,
  b: CameraFrame | null
): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  return a.dataUrl === b.dataUrl;
}

/** Fields used to render face / spotlight name + animal; avoids re-renders when snapshot reuses new object refs. */
function obPlayerTileEqual(a: PublicPlayer | null, b: PublicPlayer | null): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  return a.id === b.id && a.name === b.name && a.animal === b.animal;
}

type ObCamState = { mode: "centroid" | "follow" | "free"; followId: string | null };

function obCameraPayloadFromState(cam: ObCamState): ObCameraPayload {
  if (cam.mode === "centroid") return { mode: "centroid" };
  if (cam.mode === "follow" && cam.followId) {
    return { mode: "follow", followPlayerId: cam.followId };
  }
  if (cam.mode === "free") {
    return { mode: "free" };
  }
  return { mode: "centroid" };
}

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
  const send = usePartyStore((s) => s.send);
  const snapshot = usePartyStore((s) => s.snapshot);
  const log = usePartyStore((s) => s.log);
  const cameraFrames = usePartyStore((s) => s.cameraFrames);
  const selfPlayerId = usePartyStore(
    (s) => s.snapshot?.players.find((p) => p.name === s.myName)?.id ?? ""
  );
  useMainSceneIframeBridge();

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
  const [obCam, setObCam] = useState<ObCamState>({ mode: "centroid", followId: null });
  const obCamRef = useRef(obCam);
  obCamRef.current = obCam;
  const mainSceneIframeRef = useRef<HTMLIFrameElement | null>(null);

  const mainSceneSrc = useMemo(() => getMainSceneFrameSrc(), []);
  const gameLive = Boolean(snapshot?.started);
  const roomId = snapshot?.roomId ?? room;

  const pushMainSceneIframe = useCallback(() => {
    if (!snapshot?.started) return;
    postToMainSceneFrame(mainSceneIframeRef.current?.contentWindow, {
      myName,
      myAnimal,
      rulesCard,
      lang,
      snapshot,
      spectator: true,
      selfPlayerId,
      mainScenePeers: usePartyStore.getState().mainScenePeers
    });
  }, [myName, myAnimal, rulesCard, lang, snapshot, selfPlayerId]);

  useEffect(() => {
    if (!gameLive) return;
    pushMainSceneIframe();
  }, [gameLive, pushMainSceneIframe]);

  useEffect(() => {
    if (!gameLive) return;
    postObCameraToFrame(
      mainSceneIframeRef.current?.contentWindow,
      obCameraPayloadFromState(obCam)
    );
  }, [gameLive, obCam]);

  useEffect(() => {
    if (conn !== "open" || !gameLive) return;
    const t = window.setInterval(() => {
      const s = usePartyStore.getState();
      const sid = s.snapshot?.players.find((p) => p.name === s.myName)?.id ?? "";
      const w = mainSceneIframeRef.current?.contentWindow;
      postMainSceneNetToFrame(w, sid, s.mainScenePeers);
      const inbox = s.drainMainSceneItemInbox();
      postItemInboxToFrame(w, inbox);
    }, 100);
    return () => clearInterval(t);
  }, [conn, gameLive]);

  useEffect(() => {
    setMode("ob");
    return () => {
      // Don't auto-disconnect when leaving—OB might be left running.
    };
  }, [setMode]);

  function handleStartGame() {
    send(ClientMessageTypes.START);
  }

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
  const realPlayers = useMemo(
    () => players.filter((p) => p.name.toLowerCase() !== "ob"),
    [players]
  );
  const readyCount = useMemo(
    () => realPlayers.filter((p) => p.ready).length,
    [realPlayers]
  );
  const totalPlayers = realPlayers.length;
  const canStart = conn === "open" && !gameLive && readyCount > 0;
  const allReady = totalPlayers > 0 && readyCount === totalPlayers;
  const facePlayers = useMemo(
    () => players.slice(0, OB_FACE_SLOTS),
    [players]
  );
  const spotlightPlayers = useMemo(
    () => pickObSpotlight(players, OB_LOBBY_SPOTLIGHTS, roomId),
    [players, roomId]
  );
  const spotlightIds = useMemo(
    () => new Set(spotlightPlayers.map((p) => p.id)),
    [spotlightPlayers]
  );
  const restFacePlayers = useMemo(
    () => players.filter((p) => p.name.toLowerCase() !== "ob" && !spotlightIds.has(p.id)),
    [players, spotlightIds]
  );

  const cams = useMemo(() => Array.from(cameraFrames.values()), [cameraFrames]);
  const liveCount = cams.length;

  const pickObFollow = useCallback((id: string) => {
    setObCam({ mode: "follow", followId: id });
  }, []);

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
        {!gameLive ? (
          <div className={"ob-start-row" + (allReady ? " is-all-ready" : "")}>
            <button
              type="button"
              className="primary ob-start-btn"
              onClick={handleStartGame}
              disabled={!canStart}
              aria-disabled={!canStart}
            >
              {t.obStartGame}
            </button>
            <span className="muted ob-start-meta">
              {t.obReadyCount(readyCount, totalPlayers)}
            </span>
          </div>
        ) : null}
        <div>
          <div className="section-title">
            {t.players} <span className="muted">({players.length})</span>
          </div>
          <div className="players-list">
            {players.length === 0 ? (
              <div className="muted">—</div>
            ) : (
              players.map((p) => (
                <ObPlayer
                  key={p.id}
                  player={p}
                  lang={lang}
                  onPickFollow={gameLive && p.name.toLowerCase() !== "ob" ? () => pickObFollow(p.id) : undefined}
                  followPicked={obCam.mode === "follow" && obCam.followId === p.id}
                />
              ))
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
            {gameLive ? t.obMainSceneLabel : t.obLobbyLabel}
          </span>
        </div>

        {!gameLive ? (
          <div className="ob-lobby">
            <p className="ob-lobby-note muted">{t.obLobbyNote}</p>
            {conn === "open" ? (
              <p className="ob-lobby-cam-hint muted">{t.obCamTapFaceHint}</p>
            ) : null}
            {spotlightPlayers.length === 0 ? (
              <div className="ob-lobby-empty muted">{t.obLobbyEmpty}</div>
            ) : (
              <div
                className="ob-lobby-spotlight-grid"
                aria-label="ob-lobby-spotlight"
              >
                {spotlightPlayers.map((p) => (
                  <ObSpotlightTile
                    key={p.id}
                    player={p}
                    frame={cameraFrames.get(p.id) ?? null}
                    lang={lang}
                    onPickPlayer={() => pickObFollow(p.id)}
                    followSelected={obCam.mode === "follow" && obCam.followId === p.id}
                    pickable
                  />
                ))}
              </div>
            )}
            {restFacePlayers.length > 0 ? (
              <>
                <div className="ob-lobby-rest-title section-title">{t.obLobbyAllPlayers}</div>
                <div className="ob-lobby-rest-row" aria-label="ob-lobby-others">
                  {restFacePlayers.map((p, i) => (
                    <ObFaceSlot
                      key={p.id}
                      index={i}
                      player={p}
                      frame={cameraFrames.get(p.id) ?? null}
                      lang={lang}
                      onPickPlayer={() => pickObFollow(p.id)}
                      followSelected={obCam.mode === "follow" && obCam.followId === p.id}
                      pickable
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : (
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
                    lang={lang}
                    onPickPlayer={player && player.name.toLowerCase() !== "ob" ? () => pickObFollow(player.id) : undefined}
                    followSelected={Boolean(player) && obCam.mode === "follow" && obCam.followId === player?.id}
                    pickable={Boolean(player) && player.name.toLowerCase() !== "ob"}
                  />
                );
              })}
            </div>

            <div className="ob-scene-center">
              <div className="ob-cam-bar" role="group" aria-label="ob main map camera">
                <div className="ob-cam-seg">
                  <button
                    type="button"
                    className={obCam.mode === "centroid" ? "ob-cam-btn active" : "ob-cam-btn"}
                    onClick={() => setObCam({ mode: "centroid", followId: null })}
                  >
                    {t.obCamCentroid}
                  </button>
                  <button
                    type="button"
                    className={obCam.mode === "follow" ? "ob-cam-btn active" : "ob-cam-btn"}
                    onClick={() => {
                      if (obCam.followId) {
                        setObCam({ mode: "follow", followId: obCam.followId });
                      }
                    }}
                    disabled={!obCam.followId}
                    title={!obCam.followId ? t.obCamTapFaceHint : undefined}
                  >
                    {t.obCamFollow}
                  </button>
                  <button
                    type="button"
                    className={obCam.mode === "free" ? "ob-cam-btn active" : "ob-cam-btn"}
                    onClick={() => {
                      setObCam({ mode: "free", followId: null });
                      queueMicrotask(() => {
                        postObCameraToFrame(mainSceneIframeRef.current?.contentWindow, {
                          mode: "free",
                          initFromCurrent: true
                        });
                      });
                    }}
                  >
                    {t.obCamFree}
                  </button>
                </div>
                {obCam.mode === "follow" && obCam.followId ? (
                  <span className="ob-cam-following muted">
                    {t.obCamFollowing(players.find((p) => p.id === obCam.followId)?.name ?? "—")}
                  </span>
                ) : null}
                {obCam.mode === "free" ? (
                  <span className="ob-cam-hint muted">{t.obCamDragHint}</span>
                ) : (
                  <span className="ob-cam-hint muted">{t.obCamTapFaceHint}</span>
                )}
              </div>
              <iframe
                ref={mainSceneIframeRef}
                className="ob-scene-iframe"
                title="Main scene"
                src={mainSceneSrc}
                onLoad={() => {
                  pushMainSceneIframe();
                  const cam = obCamRef.current;
                  if (cam.mode === "free") {
                    postObCameraToFrame(mainSceneIframeRef.current?.contentWindow, {
                      mode: "free",
                      initFromCurrent: true
                    });
                  } else {
                    postObCameraToFrame(
                      mainSceneIframeRef.current?.contentWindow,
                      obCameraPayloadFromState(cam)
                    );
                  }
                }}
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
                    lang={lang}
                    onPickPlayer={player && player.name.toLowerCase() !== "ob" ? () => pickObFollow(player.id) : undefined}
                    followSelected={Boolean(player) && obCam.mode === "follow" && obCam.followId === player?.id}
                    pickable={Boolean(player) && player.name.toLowerCase() !== "ob"}
                  />
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

const ObSpotlightTile = memo(
  function ObSpotlightTile({
    player,
    frame,
    lang,
    onPickPlayer,
    followSelected,
    pickable
  }: {
    player: PublicPlayer;
    frame: CameraFrame | null;
    lang: Lang;
    onPickPlayer?: () => void;
    followSelected?: boolean;
    pickable?: boolean;
  }) {
    const t = dict(lang);
    const animal = obAnimalLabel(lang, player.animal, t.ownAnimalUnknown);
    return (
      <div
        className={`ob-spotlight-tile${followSelected ? " ob-pick-on" : ""}`}
        data-ob-spotlight={player.id}
      >
        {pickable && onPickPlayer ? (
          <button
            type="button"
            className="ob-spotlight-screen ob-spotlight-pick"
            title={player.name}
            onClick={onPickPlayer}
            aria-label={t.obCamFollow + ": " + player.name}
          >
            {frame ? (
              <img
                className="ob-cam-image"
                src={frame.dataUrl}
                alt=""
                width={160}
                height={90}
                decoding="async"
              />
            ) : (
              <div className="ob-spotlight-placeholder" aria-hidden>
                <span className="ob-face-initial">{player.name.charAt(0).toUpperCase()}</span>
              </div>
            )}
          </button>
        ) : (
          <div className="ob-spotlight-screen" title={player.name}>
            {frame ? (
              <img
                className="ob-cam-image"
                src={frame.dataUrl}
                alt={`${player.name} camera`}
                width={160}
                height={90}
                decoding="async"
              />
            ) : (
              <div className="ob-spotlight-placeholder" aria-hidden>
                <span className="ob-face-initial">{player.name.charAt(0).toUpperCase()}</span>
              </div>
            )}
          </div>
        )}
        <div className="ob-spotlight-label">
          <div className="ob-spotlight-name" title={player.name}>
            {player.name.length > 12 ? `${player.name.slice(0, 11)}…` : player.name}
          </div>
          <div className="ob-spotlight-animal" title={animal}>
            {animal}
          </div>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.lang === next.lang &&
    obPlayerTileEqual(prev.player, next.player) &&
    obFrameVisualEqual(prev.frame, next.frame) &&
    prev.onPickPlayer === next.onPickPlayer &&
    prev.followSelected === next.followSelected &&
    prev.pickable === next.pickable
);

const ObFaceSlot = memo(
  function ObFaceSlot({
    index,
    player,
    frame,
    lang,
    onPickPlayer,
    followSelected,
    pickable
  }: {
    index: number;
    player: PublicPlayer | null;
    frame: CameraFrame | null;
    lang: Lang;
    onPickPlayer?: () => void;
    followSelected?: boolean;
    pickable?: boolean;
  }) {
    const t = dict(lang);
    const animal = player ? obAnimalLabel(lang, player.animal, t.ownAnimalUnknown) : null;
    const face = (
      <>
        {frame ? (
          <img
            className="ob-cam-image"
            src={frame.dataUrl}
            alt={player ? `${player.name} face` : "camera"}
            width={160}
            height={90}
            decoding="async"
          />
        ) : (
          <div className="ob-face-placeholder" aria-hidden>
            {player ? <span className="ob-face-initial">{player.name.charAt(0).toUpperCase()}</span> : null}
            {!player ? <span className="ob-face-empty">·</span> : null}
          </div>
        )}
      </>
    );
    return (
      <div
        className={`ob-face-slot${followSelected ? " ob-pick-on" : ""}`}
        data-ob-slot={index}
      >
        {pickable && player && onPickPlayer ? (
          <button
            type="button"
            className="ob-face-circle ob-face-pick"
            title={player.name}
            onClick={onPickPlayer}
            aria-label={t.obCamFollow + ": " + player.name}
          >
            {face}
          </button>
        ) : (
          <div className="ob-face-circle" title={player?.name ?? undefined}>
            {face}
          </div>
        )}
        {player ? (
          <div className="ob-face-label">
            <div className="ob-face-name" title={player.name}>
              {player.name.length > 8 ? `${player.name.slice(0, 7)}…` : player.name}
            </div>
            <div className="ob-face-animal" title={animal ?? undefined}>
              {animal}
            </div>
          </div>
        ) : (
          <div className="ob-face-name muted"> </div>
        )}
      </div>
    );
  },
  (prev, next) =>
    prev.index === next.index &&
    prev.lang === next.lang &&
    obPlayerTileEqual(prev.player, next.player) &&
    obFrameVisualEqual(prev.frame, next.frame) &&
    prev.onPickPlayer === next.onPickPlayer &&
    prev.followSelected === next.followSelected &&
    prev.pickable === next.pickable
);

function ObPlayer({
  player,
  lang,
  onPickFollow,
  followPicked
}: {
  player: PublicPlayer;
  lang: Lang;
  onPickFollow?: () => void;
  followPicked?: boolean;
}) {
  const t = dict(lang);
  const animal = obAnimalLabel(lang, player.animal, t.ownAnimalUnknown);
  return (
    <div className={`player${followPicked ? " ob-player-picked" : ""}`}>
      <span className="name ob-obname">
        {onPickFollow ? (
          <button
            type="button"
            className="ob-player-face-hit"
            onClick={onPickFollow}
            aria-label={t.obCamFollow + ": " + player.name}
          >
            <PlayerRowFace player={player} />
          </button>
        ) : (
          <PlayerRowFace player={player} />
        )}
        <span className="ob-obname-col">
          <span>{player.name}</span>
          <span className="ob-player-animal" title={animal}>
            {animal}
          </span>
        </span>
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
