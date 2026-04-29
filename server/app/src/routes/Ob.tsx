import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import {
  Animals,
  ClientMessageTypes,
  animalEmoji,
  type AnimalCode,
  type CameraFrame,
  type GateProgress,
  type Lang,
  type PublicPlayer
} from "../party/protocol";
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
  const gateProgressByPlayerId = usePartyStore((s) => s.gateProgressByPlayerId);
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

  // Live game-clock for the OB top bar.  Server already publishes
  // `startedAt` + `durationMs` in every ROOM_SNAPSHOT, so the client just
  // re-derives remaining time off `Date.now()` at 4 Hz — no extra wire
  // traffic, and the OB clock stays in sync with the in-iframe HUD without
  // having to reach into the iframe's internal `state.timer`.
  const startedAt = snapshot?.startedAt ?? null;
  const durationMs = snapshot?.durationMs ?? 0;
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  useEffect(() => {
    if (!gameLive || !startedAt || !durationMs) {
      setRemainingMs(null);
      return;
    }
    const compute = () => Math.max(0, startedAt + durationMs - Date.now());
    setRemainingMs(compute());
    const id = setInterval(() => setRemainingMs(compute()), 250);
    return () => clearInterval(id);
  }, [gameLive, startedAt, durationMs]);
  const formattedTimer = useMemo(() => {
    if (remainingMs == null) return "";
    const sec = Math.ceil(remainingMs / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [remainingMs]);
  const isLowTime = remainingMs != null && remainingMs <= 15000;

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
  // Server's MAX_AI_BOTS (server.js) — keep in lockstep with that constant
  // so the disable threshold matches what JOIN/OB_SPAWN_AI will actually
  // accept.  AI bots get their own budget and don't consume the human-player
  // cap, so we only gate on the AI count, not totalPlayers.
  const MAX_AI_BOTS_CLIENT = 20;
  const canSpawnAi = conn === "open" && aiCount < MAX_AI_BOTS_CLIENT;
  const facePlayers = useMemo(
    () => realPlayers.slice(0, OB_FACE_SLOTS),
    [realPlayers]
  );

  // `liveCount` only needs the count, not the array — avoid allocating a new
  // Array of N CameraFrame objects on every CAMERA_FRAME message (5 fps × N players).
  const liveCount = cameraFrames.size;

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
  const followedGate = obCam.followId
    ? gateProgressByPlayerId.get(obCam.followId) ?? null
    : null;
  const animalCounts = useMemo(() => computeAnimalCounts(realPlayers), [realPlayers]);

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
      {/* Connection status — moved here from the now-removed app header so
          the operator can still see "live / off" at a glance. Same visual
          language as the old conn-pill (cream dot = open, red = down). */}
      <span
        className="conn-pill ob-topbar__live"
        aria-label={lang === "zh" ? "连接状态" : "connection status"}
      >
        <span
          className={
            "conn-dot " +
            (conn === "open" ? "ok" : conn === "connecting" || conn === "idle" ? "" : "bad")
          }
        />
        {conn === "open" ? "live" : conn === "connecting" ? "..." : conn === "idle" ? "idle" : "off"}
      </span>
      {/* Game clock — only rendered while the round is live; sits high in the
          top bar so the operator can read remaining time at a glance without
          looking down at the iframe HUD.  Switches to a pulsing red state
          under 15 s to mirror the in-iframe low-time treatment. */}
      {gameLive && remainingMs != null ? (
        <span
          className={"ob-topbar__timer" + (isLowTime ? " is-low" : "")}
          aria-label={lang === "zh" ? "游戏剩余时间" : "Game time remaining"}
          aria-live="off"
        >
          <span className="ob-topbar__timer-dot" aria-hidden />
          {/* Key the digits span on the formatted text so React remounts it
              every second tick — that re-fires the CSS pulse animation,
              giving the operator a subtle "still ticking" beat without us
              having to drive a separate animation timer. */}
          <span key={formattedTimer} className="ob-topbar__timer-digits">{formattedTimer}</span>
        </span>
      ) : null}
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
                  gate={followedGate}
                  lang={lang}
                  onClose={clearObFollow}
                />
              ) : (
                <div className={"ob-lobby-card" + (allReady ? " is-all-ready" : "")}>
                  <div className="ob-lobby-card__head">
                    <div className="ob-lobby-card__title">{t.obLobbyWaitingTitle}</div>
                    <div className="ob-lobby-card__count">
                      <span className="ob-lobby-card__big">{readyCount}</span>
                      <span className="ob-lobby-card__sep">/</span>
                      <span className="ob-lobby-card__big">{totalPlayers}</span>
                      <span className="ob-lobby-card__label">{t.lobbyReadyLabel}</span>
                    </div>
                  </div>
                  <AnimalChart counts={animalCounts} total={totalPlayers} lang={lang} t={t} />
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
    {/* EndGameOverlay is mounted globally in App.tsx so the ceremony
        survives any route-level unmount during GAME_ENDED. */}
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
 * has been clicked pre-game. The right-hand "what player sees" mock was
 * replaced with a live action-capture panel: real progress bars + counters
 * driven by the GATE_PROGRESS messages the player tab streams during Final
 * Check. Pre-gate (just joined / quiz / reveal) the panel falls back to a
 * stage label so OB still knows where the player is.
 */
type LobbyStageKey = "onboarding" | "quiz" | "reveal" | "gate" | "lobby" | "ingame" | "eliminated";

function derivePlayerStage(p: PublicPlayer, gateActive: boolean, gameLive: boolean): {
  key: LobbyStageKey;
  zh: string;
  en: string;
} {
  if (gameLive) {
    if (p.alive === false) return { key: "eliminated", zh: "已淘汰 · 观察阶段", en: "Eliminated · spectating" };
    return { key: "ingame", zh: "比赛中", en: "In game" };
  }
  if (p.ready) return { key: "lobby", zh: "等待大厅", en: "Lobby (ready)" };
  if (gateActive) return { key: "gate", zh: "Final Check · 摄像头测试中", en: "Final Check · camera test" };
  if (p.animal) return { key: "reveal", zh: "身份揭晓中", en: "Role reveal" };
  if (p.avatarUrl) return { key: "quiz", zh: "答题中", en: "Quiz" };
  return { key: "onboarding", zh: "入场中", en: "Onboarding" };
}

/** Real-time action panel for the spotlighted player. Shows the 3 Final-Check
 *  task progress bars (head shake / mouth / no-blink) populated from the
 *  player's live GATE_PROGRESS stream — falls back to a stage label when no
 *  gate data is available yet. */
function PlayerActionFeed({
  gate,
  player,
  lang
}: {
  gate: GateProgress | null;
  player: PublicPlayer;
  lang: Lang;
}) {
  const TXT = {
    waitingTitle: { zh: "实时动作捕捉", en: "Live action capture" },
    waitingHint: {
      zh: "等待玩家打开摄像头（Final Check）",
      en: "Waiting for the player to open the camera (Final Check)"
    },
    readyHint: {
      zh: "已通过 Final Check · 等待开始",
      en: "Passed Final Check · waiting for start"
    },
    shake: { zh: "🙂 摇头", en: "🙂 Head shake" },
    mouth: { zh: "😮 张嘴", en: "😮 Mouth open" },
    eyes: { zh: "👀 不眨眼", en: "👀 No-blink hold" },
    shakeUnit: { zh: "次", en: "shakes" },
    mouthUnit: { zh: "帧", en: "frames" },
    eyesUnit: { zh: "秒", en: "s" },
    targetEyes: { zh: "目标 2.0 秒", en: "target 2.0 s" }
  };
  const pick = <K extends keyof typeof TXT>(k: K) => (lang === "zh" ? TXT[k].zh : TXT[k].en);

  if (!gate || gate.active === false) {
    if (player.ready) {
      return (
        <div className="ob-action-feed ob-action-feed--ready">
          <div className="ob-action-feed__title">{pick("waitingTitle")}</div>
          <div className="ob-action-feed__empty muted">{pick("readyHint")}</div>
        </div>
      );
    }
    return (
      <div className="ob-action-feed ob-action-feed--idle">
        <div className="ob-action-feed__title">{pick("waitingTitle")}</div>
        <div className="ob-action-feed__empty muted">{pick("waitingHint")}</div>
      </div>
    );
  }

  const eyesSec = (gate.eyes.holdMs / 1000).toFixed(1);
  return (
    <div className="ob-action-feed ob-action-feed--live">
      <div className="ob-action-feed__title">
        <span className="ob-action-feed__live-dot" aria-hidden /> {pick("waitingTitle")}
      </div>
      <ActionTask
        label={pick("shake")}
        progress={gate.shake.progress}
        done={gate.shake.done}
        value={`${gate.shake.count}`}
        unit={pick("shakeUnit")}
      />
      <ActionTask
        label={pick("mouth")}
        progress={gate.mouth.progress}
        done={gate.mouth.done}
        value={`${gate.mouth.openFrames}`}
        unit={pick("mouthUnit")}
      />
      <ActionTask
        label={pick("eyes")}
        progress={gate.eyes.progress}
        done={gate.eyes.done}
        value={eyesSec}
        unit={pick("eyesUnit")}
        sub={pick("targetEyes")}
      />
    </div>
  );
}

function ActionTask({
  label,
  progress,
  done,
  value,
  unit,
  sub
}: {
  label: string;
  progress: number;
  done: boolean;
  value: string;
  unit: string;
  sub?: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div className={"ob-action-task" + (done ? " is-done" : progress > 0 ? " is-active" : "")}> 
      <div className="ob-action-task__head">
        <span className="ob-action-task__label">{label}</span>
        <span className="ob-action-task__count">
          <strong>{done ? "✓" : value}</strong>
          {!done ? <span className="ob-action-task__unit"> {unit}</span> : null}
        </span>
      </div>
      <div className="ob-action-task__bar" aria-hidden="true">
        <div className="ob-action-task__fill" style={{ width: `${pct}%` }} />
      </div>
      {sub ? <div className="ob-action-task__sub muted">{sub}</div> : null}
    </div>
  );
}

function ObLobbySpotlight({
  player,
  frame,
  gate,
  lang,
  onClose
}: {
  player: PublicPlayer;
  frame: CameraFrame | null;
  gate: GateProgress | null;
  lang: Lang;
  onClose: () => void;
}) {
  const t = dict(lang);
  const gateActive = !!gate && gate.active === true;
  const stage = derivePlayerStage(player, gateActive, false);
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
      <div className="ob-lobby-spotlight__panel">
        <PlayerActionFeed gate={gate} player={player} lang={lang} />
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

/** Mini pre-game animal-distribution chart shown in the OB lobby center pane.
 *  Counts come from `snapshot.players[].animal` (server assigns one of three
 *  codes after SUBMIT_ANSWERS); players who haven't been assigned yet are
 *  bucketed into "pending". Real-time reactivity is "free" — the snapshot
 *  drives store updates and this chart is a `useMemo` over its players. */
const ANIMAL_ORDER: AnimalCode[] = [Animals.LION, Animals.OWL, Animals.GIRAFFE];
const ANIMAL_COLORS: Record<AnimalCode, string> = {
  [Animals.LION]: "#f0b14a",
  [Animals.OWL]: "#7d6cff",
  [Animals.GIRAFFE]: "#3fbf8a"
};

function computeAnimalCounts(players: PublicPlayer[]): {
  byAnimal: Record<AnimalCode, number>;
  pending: number;
} {
  const byAnimal: Record<AnimalCode, number> = {
    [Animals.LION]: 0,
    [Animals.OWL]: 0,
    [Animals.GIRAFFE]: 0
  };
  let pending = 0;
  for (const p of players) {
    if (p.animal && p.animal in byAnimal) {
      byAnimal[p.animal as AnimalCode] += 1;
    } else {
      pending += 1;
    }
  }
  return { byAnimal, pending };
}

/**
 * Live "Animal leaderboard". As players finish onboarding the server assigns
 * an animal; this chart sorts the three species by current head-count and
 * animates row reorders (FLIP technique — measure before, measure after,
 * inverse-transform to 0). Tie-breaker is the canonical ANIMAL_ORDER so the
 * board doesn't flicker when two species are level.
 */
function AnimalChart({
  counts,
  total,
  lang,
  t
}: {
  counts: ReturnType<typeof computeAnimalCounts>;
  total: number;
  lang: Lang;
  t: ReturnType<typeof dict>;
}) {
  const assigned = total - counts.pending;
  const titleLabel = t.obAnimalLeaderTitle;
  const subLabel = t.obAnimalLeaderSub(assigned, total);
  const pendingLabel = t.obAnimalLeaderPending;

  const ranked = useMemo(() => {
    const rows = ANIMAL_ORDER.map((animal, idx) => ({
      animal,
      count: counts.byAnimal[animal],
      tieBreak: idx
    }));
    rows.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.tieBreak - b.tieBreak;
    });
    return rows;
  }, [counts]);

  // Scale bars relative to the largest bucket — keeps the chart readable
  // when only one animal has people in it, instead of the bars all being 33%.
  const maxBar = Math.max(ranked[0]?.count ?? 0, 1);

  // FLIP-style row reorder animation. We measure each row's `top` before the
  // commit, again after the commit, and animate the delta to zero. This makes
  // a 3rd-place → 1st-place jump feel like an actual leaderboard swap instead
  // of a hard snap. We deliberately animate `transform` only — `width`
  // already transitions on the bar fill via CSS.
  const listRef = useRef<HTMLOListElement | null>(null);
  const lastTopsRef = useRef<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const items = list.querySelectorAll<HTMLElement>("[data-animal-row]");
    const newTops = new Map<string, number>();
    items.forEach((el) => {
      const key = el.dataset.animalRow ?? "";
      newTops.set(key, el.getBoundingClientRect().top);
    });
    items.forEach((el) => {
      const key = el.dataset.animalRow ?? "";
      const oldTop = lastTopsRef.current.get(key);
      const newTop = newTops.get(key);
      if (oldTop == null || newTop == null) return;
      const delta = oldTop - newTop;
      if (Math.abs(delta) < 1) return;
      // Cancel any in-flight animation so rapid updates don't queue.
      el.getAnimations().forEach((a) => a.cancel());
      el.animate(
        [
          { transform: `translateY(${delta}px)` },
          { transform: "translateY(0)" }
        ],
        { duration: 380, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" }
      );
    });
    lastTopsRef.current = newTops;
  }, [ranked, counts.pending]);

  return (
    <div className="ob-animal-chart ob-animal-chart--leader" aria-label={titleLabel}>
      <div className="ob-animal-chart__head">
        <div className="ob-animal-chart__title">{titleLabel}</div>
        <div className="ob-animal-chart__sub muted">
          <span className="ob-animal-chart__live-dot" aria-hidden />
          {subLabel}
        </div>
      </div>
      <ol className="ob-animal-chart__list" ref={listRef}>
        {ranked.map((row, rank) => {
          const animal = row.animal;
          const n = row.count;
          const label = animalLocalized[lang][animal] ?? animal;
          const pct = (n / maxBar) * 100;
          const ratio = total > 0 ? Math.round((n / total) * 100) : 0;
          const isLeader = rank === 0 && n > 0;
          return (
            <li
              key={animal}
              data-animal-row={animal}
              className={
                "ob-animal-row" +
                (n > 0 ? " is-on" : "") +
                (isLeader ? " is-leader" : "") +
                (rank === 1 ? " is-second" : "") +
                (rank === 2 ? " is-third" : "")
              }
            >
              <span
                key={`rank-${animal}-${rank}`}
                className="ob-animal-row__rank nz-num-pop"
                aria-hidden
              >
                {isLeader ? "👑" : t.obAnimalRank(rank + 1)}
              </span>
              <div className="ob-animal-row__label">
                <span className="ob-animal-row__icon" aria-hidden>
                  {animalEmoji(animal)}
                </span>
                <span className="ob-animal-row__name">{label}</span>
              </div>
              <div className="ob-animal-row__bar-wrap" aria-hidden="true">
                <div
                  className="ob-animal-row__bar"
                  style={{ width: `${pct}%`, background: ANIMAL_COLORS[animal] }}
                />
              </div>
              <div className="ob-animal-row__count">
                <span key={`n-${animal}-${n}`} className="nz-num-pop">{n}</span>
                <span className="ob-animal-row__pct muted"> · {ratio}%</span>
              </div>
            </li>
          );
        })}
        {counts.pending > 0 ? (
          <li
            data-animal-row="pending"
            className="ob-animal-row ob-animal-row--pending"
          >
            <span className="ob-animal-row__rank ob-animal-row__rank--pending" aria-hidden>···</span>
            <div className="ob-animal-row__label">
              <span className="ob-animal-row__icon" aria-hidden>⌛</span>
              <span className="ob-animal-row__name muted">{pendingLabel}</span>
            </div>
            <div className="ob-animal-row__bar-wrap" aria-hidden="true">
              <div
                className="ob-animal-row__bar ob-animal-row__bar--pending"
                style={{ width: `${(counts.pending / Math.max(maxBar, counts.pending)) * 100}%` }}
              />
            </div>
            <div className="ob-animal-row__count">
              <span key={`p-${counts.pending}`} className="nz-num-pop">{counts.pending}</span>
            </div>
          </li>
        ) : null}
      </ol>
      {assigned === 0 ? (
        <div className="ob-animal-chart__empty muted">{t.obAnimalLeaderEmpty}</div>
      ) : null}
    </div>
  );
}

