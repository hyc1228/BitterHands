import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import EndGameOverlay from "../components/EndGameOverlay";
import { DEFAULT_ROOM_ID, getMainSceneFrameSrc, OB_FACE_SLOTS } from "../constants";
import { expectedObKey, isObAuthorized, writeStoredObKey } from "../lib/obAuth";
import { animalLocalized, dict } from "../i18n";
import { useMainSceneIframeBridge } from "../hooks/useMainSceneIframeBridge";
import {
  postItemInboxToFrame,
  postMainSceneNetToFrame,
  postMonitorStateToFrame,
  postObCameraToFrame,
  postToMainSceneFrame,
  type ObCameraPayload
} from "../mainSync/postToMainSceneFrame";
import { ClientMessageTypes, animalEmoji, type CameraFrame, type Lang, type PublicPlayer } from "../party/protocol";
import { usePartyStore, type LogEntry } from "../party/store";
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
  const [authorized, setAuthorized] = useState(() => isObAuthorized());
  if (!authorized) {
    return <ObAuthGate onUnlock={() => setAuthorized(true)} />;
  }
  return <ObInner />;
}

function ObAuthGate({ onUnlock }: { onUnlock: () => void }) {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);
  const nav = useNavigate();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;
    if (trimmed === expectedObKey()) {
      writeStoredObKey(trimmed);
      onUnlock();
    } else {
      setError(t.obAuthBadKey);
    }
  }

  return (
    <div className="join-wrap">
      <form className="card join-card" onSubmit={handleSubmit}>
        <h1 className="heading">{t.obAuthTitle}</h1>
        <div className="underline" aria-hidden />
        <div className="stack" style={{ textAlign: "left" }}>
          <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.45 }}>
            {t.obAuthHint}
          </p>
          <div>
            <label className="label" htmlFor="obKey">
              {t.obAuthKeyLabel}
            </label>
            <input
              id="obKey"
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={t.obAuthKeyPlaceholder}
              autoFocus
            />
          </div>
        </div>
        {error ? <div style={{ color: "#ff9a8a" }}>{error}</div> : null}
        <button className="primary" disabled={!key.trim()} type="submit">
          {t.obAuthEnter}
        </button>
        <button type="button" className="ghost" onClick={() => nav("/", { replace: true })}>
          ← {t.obAuthBack}
        </button>
      </form>
    </div>
  );
}

function ObInner() {
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
  const obLogLines = useMemo(() => log.slice(0, 5), [log]);
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
      postMonitorStateToFrame(w, s.monitorState);
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
  // OB can start whenever connected + game not yet running. We don't gate on `readyCount > 0`
  // so solo testing / pre-lobby start works; the count text and the green halo still tell
  // the operator whether everyone is in.
  const canStart = conn === "open" && !gameLive;
  const allReady = totalPlayers > 0 && readyCount === totalPlayers;
  const facePlayers = useMemo(
    () => realPlayers.slice(0, OB_FACE_SLOTS),
    [realPlayers]
  );

  // `liveCount` only needs the count, not the array — avoid allocating a new
  // Array of N CameraFrame objects on every CAMERA_FRAME message (5 fps × N players).
  const liveCount = cameraFrames.size;

  const pickObFollow = useCallback((id: string) => {
    setObCam({ mode: "follow", followId: id });
  }, []);

  return (
    <>
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
          <div className="log ob-log-clip" aria-label="ob-log-recent">
            {obLogLines.length === 0 ? (
              <div className="muted">—</div>
            ) : (
              obLogLines.map((entry, i) => <ObLogLine key={`${entry.ts}-${i}`} entry={entry} />)
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
          // Mirror the in-game layout (5 face slots ┃ center waiting card ┃ 5 face slots) so
          // the screen doesn't reshuffle when OB hits Start. The center cell shows lobby state
          // (ready count + "Waiting for OB" / Start hint) instead of the main-scene iframe.
          <div className="ob-scene-layout ob-scene-layout--lobby">
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
                    onPickPlayer={player ? () => pickObFollow(player.id) : undefined}
                    followSelected={Boolean(player) && obCam.mode === "follow" && obCam.followId === player?.id}
                    pickable={Boolean(player)}
                  />
                );
              })}
            </div>

            <div className="ob-scene-center ob-lobby-center">
              <div className={"ob-lobby-card" + (allReady ? " is-all-ready" : "")}>
                <div className="ob-lobby-card__pulse" aria-hidden="true">
                  <span /><span /><span />
                </div>
                <div className="ob-lobby-card__title">{t.obLobbyWaitingTitle}</div>
                <div className="ob-lobby-card__count">
                  <span className="ob-lobby-card__big">{readyCount}</span>
                  <span className="ob-lobby-card__sep">/</span>
                  <span className="ob-lobby-card__big">{totalPlayers}</span>
                  <span className="ob-lobby-card__label">{t.lobbyReadyLabel}</span>
                </div>
                <p className="muted ob-lobby-card__hint">{t.obLobbyCenterHint}</p>
                {totalPlayers === 0 ? (
                  <div className="ob-lobby-card__empty muted">{t.obLobbyEmpty}</div>
                ) : null}
              </div>
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
                    onPickPlayer={player ? () => pickObFollow(player.id) : undefined}
                    followSelected={Boolean(player) && obCam.mode === "follow" && obCam.followId === player?.id}
                    pickable={Boolean(player)}
                  />
                );
              })}
            </div>
          </div>
        ) : (
          // Original-style layout (cute 3-column: 5 faces ┃ map ┃ 5 faces). Faces are
          // clickable tabs — click switches the map's follow camera to that player. The
          // map cell is taller now so the operator gets a bigger global view.
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
                    onPickPlayer={player ? () => pickObFollow(player.id) : undefined}
                    followSelected={Boolean(player) && obCam.mode === "follow" && obCam.followId === player?.id}
                    pickable={Boolean(player)}
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
                    {t.obCamFollowing(realPlayers.find((p) => p.id === obCam.followId)?.name ?? "—")}
                  </span>
                ) : null}
                {obCam.mode === "free" ? (
                  <span className="ob-cam-hint muted">{t.obCamDragHint}</span>
                ) : (
                  <span className="ob-cam-hint muted">{t.obCamTapFaceHint}</span>
                )}
              </div>
              <div className="ob-scene-stage">
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
                {obCam.mode === "follow" && obCam.followId ? (
                  <ObFollowHud
                    player={realPlayers.find((p) => p.id === obCam.followId) ?? null}
                    frame={cameraFrames.get(obCam.followId) ?? null}
                    lang={lang}
                  />
                ) : null}
              </div>
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
                    onPickPlayer={player ? () => pickObFollow(player.id) : undefined}
                    followSelected={Boolean(player) && obCam.mode === "follow" && obCam.followId === player?.id}
                    pickable={Boolean(player)}
                  />
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
    <EndGameOverlay viewerRole="ob" homePath="/ob" />
    </>
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

/**
 * Floating HUD overlay shown on top of the main-scene iframe when OB is following a
 * specific player. Mirrors the player-side HUD bits (REC + hearts + animal + violation
 * count) that the iframe hides for spectators — when OB is "in" a player's view, the
 * operator wants to read those same stats. We render them in React (not inside the
 * iframe) to keep the iframe cleanly in spectator mode for the world rendering.
 */
function ObFollowHud({
  player,
  frame,
  lang
}: {
  player: PublicPlayer | null;
  frame: CameraFrame | null;
  lang: Lang;
}) {
  const t = dict(lang);
  if (!player) return null;
  const animalLabel = obAnimalLabel(lang, player.animal, t.ownAnimalUnknown);
  const animalIcon = animalEmoji(player.animal);
  const lives = Math.max(0, Math.min(3, player.lives ?? 0));
  return (
    <div className="ob-follow-hud" role="region" aria-label="followed player hud">
      <div className="ob-follow-hud__face">
        {frame ? (
          <img src={frame.dataUrl} alt={`${player.name} face`} className="ob-follow-hud__img" />
        ) : (
          <span className="ob-follow-hud__initial" aria-hidden>
            {player.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="ob-follow-hud__meta">
        <div className="ob-follow-hud__name" title={player.name}>
          {player.name}
        </div>
        <div className="ob-follow-hud__animal">
          <span aria-hidden>{animalIcon}</span> {animalLabel}
        </div>
      </div>
      <div className="ob-follow-hud__stats">
        <div className="ob-follow-hud__hearts" aria-label={`${lives} lives`}>
          {Array.from({ length: 3 }, (_, i) => (
            <span
              key={i}
              className={"ob-follow-hud__heart" + (i < lives ? "" : " is-off")}
              aria-hidden
            >
              {/* U+FE0E forces text (mono) presentation — iOS Safari otherwise
                  auto-renders ♥ as the color emoji, which ignores `color`. */}
              {"\u2665\uFE0E"}
            </span>
          ))}
        </div>
        <div className="ob-follow-hud__violations" aria-label="violations">
          ⚠ {player.violations ?? 0}
        </div>
        {player.alive === false ? (
          <div className="ob-follow-hud__dead" aria-label="eliminated">💀</div>
        ) : null}
      </div>
    </div>
  );
}

