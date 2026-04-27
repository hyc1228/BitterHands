import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import EndGameOverlay from "../components/EndGameOverlay";
import Toast from "../components/Toast";
import { getMainSceneFrameSrc, OB_FACE_SLOTS, readStoredRoomId } from "../constants";
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
import { usePartyStore } from "../party/store";
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
  // OB is open to anyone in the room — no auth gate. Users can reach this
  // route either by clicking "Spectate" from the lobby or by typing /ob
  // directly. They still need to know / type the room code to join, which
  // is the actual gate.
  return <ObInner />;
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
  const cameraFrames = usePartyStore((s) => s.cameraFrames);
  const selfPlayerId = usePartyStore(
    (s) => s.snapshot?.players.find((p) => p.name === s.myName)?.id ?? ""
  );
  useMainSceneIframeBridge();
  const obNav = useNavigate();

  const [room, setRoom] = useState(() => {
    const params = new URLSearchParams(location.hash.split("?")[1] || "");
    const fromQuery = params.get("room");
    if (fromQuery) return fromQuery;
    return readStoredRoomId("nz.obRoom");
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

  // Spectate-from-lobby handoff: when the lobby's "Spectate as OB" button is
  // clicked it sets `nz.ob.autoConnect = roomId` in sessionStorage, then
  // navigates here. Pick that up once on mount and auto-run the connect flow
  // so the operator doesn't have to click Connect again.
  useEffect(() => {
    let target: string | null = null;
    try { target = sessionStorage.getItem("nz.ob.autoConnect"); } catch { /* ignore */ }
    if (!target) return;
    try { sessionStorage.removeItem("nz.ob.autoConnect"); } catch { /* ignore */ }
    if (conn === "open" || conn === "connecting") return;
    setRoom(target);
    try { localStorage.setItem("nz.obRoom", target); } catch { /* ignore */ }
    connect({ roomId: target, name: "ob", lang, mode: "ob" }).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleStartGame() {
    // Don't yank lurkers (no profile yet) into the live scene — surface a
    // toast listing who still needs to finish character creation. Server
    // also enforces this with `start_not_all_ready`.
    const waiting = realPlayers.filter((p) => !p.ready).map((p) => p.name);
    if (waiting.length > 0) {
      const list = waiting.join(", ");
      usePartyStore.getState().showToast(
        lang === "zh"
          ? `${list} 还在创建角色 — 等所有人就绪后再开始`
          : `${list} hasn't created a profile yet — wait until everyone's ready`
      );
      return;
    }
    send(ClientMessageTypes.START);
  }

  const [aiFlashKey, setAiFlashKey] = useState(0);
  function handleSpawnAi() {
    send(ClientMessageTypes.OB_SPAWN_AI, { count: 4 });
    // Re-trigger the AI counter flash animation each click. The keyed
    // wrapper below remounts so the CSS animation actually replays.
    setAiFlashKey((k) => k + 1);
  }

  function handleDespawnAi() {
    send(ClientMessageTypes.OB_DESPAWN_AI);
    setAiFlashKey((k) => k + 1);
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
  const aiCount = useMemo(
    () => realPlayers.filter((p) => p.id.startsWith("ai_")).length,
    [realPlayers]
  );
  const canSpawnAi = conn === "open" && totalPlayers < 10;
  const facePlayers = useMemo(
    () => realPlayers.slice(0, OB_FACE_SLOTS),
    [realPlayers]
  );

  // `liveCount` only needs the count, not the array — avoid allocating a new
  // Array of N CameraFrame objects on every CAMERA_FRAME message (5 fps × N players).
  const liveCount = cameraFrames.size;

  // #region agent log
  // OB-perf instrumentation: per-player CAMERA_FRAME inter-arrival times. If OB
  // looks "choppy" we'll see the gap between frames balloon here. Logged every
  // 2 s as a histogram so we don't flood the endpoint at 5 fps × N players.
  const _dbgFrameTracker = useRef<{
    lastByPlayer: Map<string, number>;
    gaps: Map<string, number[]>;
    lastFlush: number;
  }>({ lastByPlayer: new Map(), gaps: new Map(), lastFlush: Date.now() });
  useEffect(() => {
    const enabled = /^(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.)/.test(
      window.location.hostname
    );
    if (!enabled) return;
    const tr = _dbgFrameTracker.current;
    const now = Date.now();
    cameraFrames.forEach((frame, pid) => {
      const last = tr.lastByPlayer.get(pid);
      if (last && frame.ts !== last) {
        const gap = frame.ts - last;
        if (gap > 0 && gap < 5000) {
          let arr = tr.gaps.get(pid);
          if (!arr) { arr = []; tr.gaps.set(pid, arr); }
          arr.push(gap);
        }
      }
      tr.lastByPlayer.set(pid, frame.ts);
    });
    if (now - tr.lastFlush >= 2000 && tr.gaps.size > 0) {
      const summary: Record<string, { n: number; avg: number; max: number; p95: number }> = {};
      tr.gaps.forEach((arr, pid) => {
        if (arr.length === 0) return;
        const sorted = arr.slice().sort((a, b) => a - b);
        summary[pid.slice(0, 8)] = {
          n: arr.length,
          avg: Math.round(arr.reduce((s, x) => s + x, 0) / arr.length),
          max: sorted[sorted.length - 1],
          p95: sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1]
        };
      });
      try {
        fetch(
          "http://127.0.0.1:7518/ingest/d4c760a9-8d27-4a7c-8005-12a2cff8b553",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "b26e2b" },
            body: JSON.stringify({
              sessionId: "b26e2b",
              location: "Ob.tsx:cam-gaps",
              message: "OB camera-frame inter-arrival (ms) per player",
              data: { hyp: "H3", players: realPlayers.length, summary },
              timestamp: now
            })
          }
        ).catch(() => {});
      } catch { /* ignore */ }
      tr.gaps.clear();
      tr.lastFlush = now;
    }
  }, [cameraFrames, realPlayers.length]);
  // #endregion

  /** Click on any face avatar / player row → enter "follow this player" mode.
   *  In-game: iframe camera follows them (existing behavior). Pre-game: the
   *  lobby center pane swaps from the generic Waiting card to a live spotlight
   *  for the selected player so OB can drill into anyone at any phase. */
  const pickObFollow = useCallback((id: string) => {
    setObCam({ mode: "follow", followId: id });
  }, []);
  const clearObFollow = useCallback(() => {
    setObCam({ mode: "centroid", followId: null });
  }, []);
  const followedPlayer = useMemo(
    () => (obCam.followId ? realPlayers.find((p) => p.id === obCam.followId) ?? null : null),
    [obCam.followId, realPlayers]
  );
  const followedFrame = obCam.followId ? cameraFrames.get(obCam.followId) ?? null : null;

  function handleBackToLobby() {
    // Switch the WS back to player mode so the user appears in the lobby
    // roster again (otherwise they'd stay as an invisible OB conn). The
    // lobby's mount effect then re-runs JOIN with their stored name.
    try { disconnect(); } catch { /* ignore */ }
    obNav("/lobby");
  }

  return (
    <>
    {/* Same scrolling grass + vignette as the splash + lobby. Pinned to the
        viewport so OB pages with long scroll keep the background in place. */}
    <div className="nz-grass-bg" aria-hidden />
    <div className="nz-grass-vignette" aria-hidden />
    <Toast />
    {/* Top control bar — back, room input, connect, Start, AI, ready/AI counts.
        Replaces the entire former left column so the camera wall + iframe can
        own the rest of the page. Keeps host/OB controls reachable without
        eating real estate from the actual focus (everyone's faces). */}
    <div className="ob-topbar" aria-label="ob-controls">
      <button
        type="button"
        className="ghost ob-topbar__back"
        onClick={handleBackToLobby}
        title={lang === "zh" ? "返回大厅创建角色" : "Back to lobby"}
      >
        ← {lang === "zh" ? "返回大厅" : "Back to lobby"}
      </button>
      <input
        className="ob-room-input ob-topbar__room"
        value={room}
        onChange={(e) => setRoom(e.target.value)}
        placeholder={t.roomPlaceholder}
        aria-label={t.roomLabel}
      />
      {conn === "open" ? (
        <button className="ob-topbar__btn" onClick={() => disconnect()}>disconnect</button>
      ) : (
        <button className="primary ob-topbar__btn" onClick={handleConnect}>connect</button>
      )}

      {!gameLive ? (
        <button
          type="button"
          className={
            "primary ob-topbar__btn ob-topbar__btn--start" +
            (allReady ? " is-all-ready" : "")
          }
          onClick={handleStartGame}
          disabled={!canStart}
          aria-disabled={!canStart}
        >
          {t.obStartGame}
        </button>
      ) : null}

      <span className="muted ob-topbar__count" title={lang === "zh" ? "已就绪 / 总人数" : "ready / total"}>
        <span key={`r-${readyCount}`} className="nz-num-pop">{readyCount}</span>
        {" / "}
        <span key={`t-${totalPlayers}`} className="nz-num-pop">{totalPlayers}</span>
      </span>

      <button
        type="button"
        className="ob-topbar__btn ob-ai-btn"
        onClick={handleSpawnAi}
        disabled={!canSpawnAi}
        title={lang === "zh" ? "添加 4 个 AI 玩家" : "Spawn 4 AI players"}
      >
        + AI
      </button>
      <button
        type="button"
        className="ob-topbar__btn ob-ai-btn ob-ai-btn--ghost"
        onClick={handleDespawnAi}
        disabled={conn !== "open" || aiCount === 0}
      >
        {lang === "zh" ? "清除 AI" : "Clear AI"}
      </button>
      <span key={aiFlashKey} className="muted ob-topbar__count is-flash">
        <span key={`ai-${aiCount}`} className="nz-num-pop">{aiCount}</span>
        {" AI"}
      </span>

      {error ? <div className="ob-topbar__err">{error}</div> : null}
    </div>

    <div className="ob-grid ob-grid--single">
      <section className="card stack ob-scene-card ob-scene-card--full" aria-label="ob-right">
        {!gameLive ? (
          // Mirror the in-game layout (5 face slots ┃ center waiting card ┃ 5 face slots) so
          // the screen doesn't reshuffle when OB hits Start. The center cell shows lobby state
          // (ready count + "Waiting for OB" / Start hint) instead of the main-scene iframe.
          <div className="ob-scene-layout ob-scene-layout--lobby">
            <div className="ob-face-column" aria-label="ob-faces-left">
              {Array.from({ length: 10 }, (_, j) => {
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
              {followedPlayer ? (
                <ObLobbySpotlight
                  player={followedPlayer}
                  frame={followedFrame}
                  lang={lang}
                  onClose={clearObFollow}
                />
              ) : (
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
              )}
            </div>

            <div className="ob-face-column" aria-label="ob-faces-right">
              {Array.from({ length: 10 }, (_, j) => {
                const i = j + 10;
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
              {Array.from({ length: 10 }, (_, j) => {
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
              {Array.from({ length: 10 }, (_, j) => {
                const i = j + 10;
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
    // "Live" if the latest frame is fresher than ~3 s; the upload runs at 5 fps,
    // so anything older than that means the player's camera is paused / lost.
    const isLive = !!frame && Date.now() - frame.ts < 3000;
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
            data-nz-ripple
            aria-label={t.obCamFollow + ": " + player.name}
          >
            {face}
          </button>
        ) : (
          <div className="ob-face-circle" title={player?.name ?? undefined}>
            {face}
          </div>
        )}
        {isLive ? <span className="ob-live-dot" aria-hidden /> : null}
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

/**
 * Inline spotlight rendered in the OB lobby center pane when a face avatar
 * has been clicked pre-game. No popup — the operator clicks once, and the
 * Waiting card swaps for a big camera + that player's stage. "Back to lobby"
 * exits follow mode.
 */
function derivePlayerStage(p: PublicPlayer, gameLive: boolean): {
  key: "onboarding" | "quiz" | "reveal" | "lobby" | "ingame" | "eliminated";
  zh: string;
  en: string;
} {
  if (gameLive) {
    if (p.alive === false) return { key: "eliminated", zh: "已淘汰 · 观察阶段", en: "Eliminated · spectating" };
    return { key: "ingame", zh: "比赛中", en: "In game" };
  }
  if (p.ready) return { key: "lobby", zh: "等待大厅", en: "Lobby (ready)" };
  if (p.animal) return { key: "reveal", zh: "揭晓 / Final Check", en: "Reveal / Final Check" };
  if (p.avatarUrl) return { key: "quiz", zh: "答题中", en: "Quiz" };
  return { key: "onboarding", zh: "入场中", en: "Onboarding" };
}

/**
 * Renders a stage-aware preview of "what this player is currently doing".
 * Builds an OB-side mock of the player's onboarding screen: which step icon
 * they see, the prompt text, and any data we know about (their submitted
 * profile photo, their assigned animal, etc.). For the live game stages we
 * just defer to the in-scene HUD that's already on the right.
 */
function PlayerScreenMock({
  player,
  lang
}: {
  player: PublicPlayer;
  lang: Lang;
}) {
  const stage = derivePlayerStage(player, false);
  const animalIcon = animalEmoji(player.animal);
  const animalSvg = mockAnimalSvg(player.animal);
  // i18n inline — these strings only appear in the OB spotlight, so keeping
  // them here avoids polluting the shared dict for what's effectively dev UX.
  const TXT = {
    permission: { zh: "正在请求摄像头权限…", en: "Granting camera permission…" },
    photo: { zh: "正在拍照", en: "Taking profile photo" },
    photoHint: { zh: "对着镜头微笑 📸", en: "Smile at the camera 📸" },
    quiz: { zh: "正在答题（共 3 题）", en: "Answering quiz (3 questions)" },
    quizHint: { zh: "选 A / B / C", en: "Picking A / B / C" },
    analyzing: { zh: "AI 分析中…", en: "AI analyzing…" },
    revealHead: { zh: "已分配身份 / 揭晓", en: "Role assigned · reveal" },
    revealAnimal: { zh: "你的身份是", en: "You are" },
    check: { zh: "Final Check：3 个表情任务", en: "Final Check · 3 expression tasks" },
    checkTasks: {
      zh: ["🙂 摇头", "😮 张嘴", "👀 2 秒别眨眼"],
      en: ["🙂 Shake head", "😮 Open mouth", "👀 Don't blink 2s"]
    },
    lobby: { zh: "已就绪 · 等待 OB 开局", en: "Ready · waiting for OB to start" },
    awaiting: { zh: "尚未提交照片", en: "Awaiting profile photo" }
  };
  const pick = <K extends keyof typeof TXT>(k: K) =>
    (lang === "zh" ? TXT[k].zh : TXT[k].en) as string;

  switch (stage.key) {
    case "onboarding":
      return (
        <div className="ob-spot-mock ob-spot-mock--onboarding">
          <div className="ob-spot-mock__icon">📸</div>
          <div className="ob-spot-mock__title">{pick("permission")}</div>
          <div className="ob-spot-mock__sub muted">{pick("awaiting")}</div>
        </div>
      );
    case "quiz":
      return (
        <div className="ob-spot-mock ob-spot-mock--quiz">
          {player.avatarUrl ? (
            <img className="ob-spot-mock__photo" src={player.avatarUrl} alt="profile" />
          ) : (
            <div className="ob-spot-mock__icon">📝</div>
          )}
          <div className="ob-spot-mock__title">{pick("quiz")}</div>
          <div className="ob-spot-mock__sub muted">{pick("quizHint")}</div>
          <div className="ob-spot-mock__quiz">
            <span>A</span><span>B</span><span>C</span>
          </div>
        </div>
      );
    case "reveal":
      return (
        <div className="ob-spot-mock ob-spot-mock--reveal">
          {animalSvg ? (
            <img className="ob-spot-mock__animal-svg" src={animalSvg} alt={player.animal ?? "animal"} />
          ) : (
            <div className="ob-spot-mock__icon">{animalIcon}</div>
          )}
          <div className="ob-spot-mock__title">{pick("revealAnimal")}</div>
          <div className="ob-spot-mock__animal-name">
            {animalIcon} {obAnimalLabel(lang, player.animal, "?")}
          </div>
          <div className="ob-spot-mock__sub muted">{pick("check")}</div>
          <ul className="ob-spot-mock__tasks">
            {(lang === "zh" ? TXT.checkTasks.zh : TXT.checkTasks.en).map((task, i) => (
              <li key={i}>{task}</li>
            ))}
          </ul>
        </div>
      );
    case "lobby":
      return (
        <div className="ob-spot-mock ob-spot-mock--lobby">
          {animalSvg ? (
            <img className="ob-spot-mock__animal-svg" src={animalSvg} alt={player.animal ?? "animal"} />
          ) : (
            <div className="ob-spot-mock__icon">✓</div>
          )}
          <div className="ob-spot-mock__title">{pick("lobby")}</div>
          <div className="ob-spot-mock__animal-name">
            {animalIcon} {obAnimalLabel(lang, player.animal, "?")}
          </div>
        </div>
      );
    default:
      return null;
  }
}

function mockAnimalSvg(animal: PublicPlayer["animal"]): string | null {
  if (animal === "白狮子") return "/main-scene/lion.svg";
  if (animal === "猫头鹰") return "/main-scene/Owl%20body.svg";
  if (animal === "长颈鹿") return "/main-scene/giraffe.svg";
  return null;
}

function ObLobbySpotlight({
  player,
  frame,
  lang,
  onClose
}: {
  player: PublicPlayer;
  frame: CameraFrame | null;
  lang: Lang;
  onClose: () => void;
}) {
  const t = dict(lang);
  const stage = derivePlayerStage(player, false);
  const stageLabel = lang === "zh" ? stage.zh : stage.en;
  const animal = obAnimalLabel(lang, player.animal, t.ownAnimalUnknown);
  const animalIcon = animalEmoji(player.animal);
  return (
    <div className="ob-lobby-spotlight">
      <div className={"ob-lobby-spotlight__feed" + (frame ? "" : " is-empty")}>
        {frame ? (
          <img src={frame.dataUrl} alt={`${player.name} live camera`} />
        ) : (
          <span className="ob-lobby-spotlight__initial" aria-hidden>
            {player.name.charAt(0).toUpperCase()}
          </span>
        )}
        <span className={"ob-lobby-spotlight__stage stage-" + stage.key}>{stageLabel}</span>
      </div>
      <div className="ob-lobby-spotlight__screen">
        <div className="ob-lobby-spotlight__screen-label">
          {lang === "zh" ? "玩家正在看到的画面" : "What this player sees"}
        </div>
        <PlayerScreenMock player={player} lang={lang} />
      </div>
      <div className="ob-lobby-spotlight__meta">
        <h3 className="ob-lobby-spotlight__name" title={player.name}>{player.name}</h3>
        <div className="ob-lobby-spotlight__animal">
          <span aria-hidden>{animalIcon}</span> {animal}
        </div>
      </div>
      <button type="button" className="ghost ob-lobby-spotlight__close" onClick={onClose}>
        ← {lang === "zh" ? "返回大厅总览" : "Back to lobby"}
      </button>
    </div>
  );
}

