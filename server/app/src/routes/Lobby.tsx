import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import CameraFrameUploader from "../components/CameraFrameUploader";
import PlayerRowFace from "../components/PlayerRowFace";
import { readStoredRoomId } from "../constants";
import { animalLocalized, dict } from "../i18n";
import { expectedObKey, writeStoredObKey } from "../lib/obAuth";
import { ClientMessageTypes, type PublicPlayer } from "../party/protocol";
import { usePartyStore } from "../party/store";

/**
 * Always-on lobby. The flow is now:
 *   /              → enter room code
 *   /lobby         → arrive here, see roster + my own status
 *     ├ "Setup character"  → /onboard (photo + quiz + reveal + final check)
 *     │                    ↳ comes back here as ready
 *     └ "Spectate as OB"   → /ob  (no character, just watch the room)
 *
 * The first human to JOIN the room is automatically the host. Host gets
 * Start / Spawn AI / Clear AI / Kick controls. Other players just wait.
 *
 * State machine for ME (the local viewer):
 *   - "lurker"    → joined the room with a placeholder name, hasn't done
 *                   character setup yet. Sees the [Setup] / [Spectate]
 *                   choices.
 *   - "in-setup"  → on /onboard right now (this component isn't mounted)
 *   - "ready"     → done with everything, server has flipped `ready: true`,
 *                   waiting for host. Host sees the room controls here.
 */
export default function Lobby() {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);
  const nav = useNavigate();
  const conn = usePartyStore((s) => s.conn);
  const myName = usePartyStore((s) => s.myName);
  const setMyName = usePartyStore((s) => s.setName);
  const setMode = usePartyStore((s) => s.setMode);
  const send = usePartyStore((s) => s.send);
  const connect = usePartyStore((s) => s.connect);
  const snapshot = usePartyStore((s) => s.snapshot);
  const rulesCard = usePartyStore((s) => s.rulesCard);

  // The room code lives in localStorage from the Join screen.
  const roomId = useMemo(() => readStoredRoomId("nz.roomId"), []);

  // Drop the user back to the room-code entrance if they hit /lobby with no
  // room set yet (e.g. directly typing the URL).
  useEffect(() => {
    if (!roomId) {
      nav("/", { replace: true });
    }
  }, [roomId, nav]);

  // Auto-generate a placeholder visitor name so the user becomes a real
  // room participant the moment they hit /lobby. The character-setup
  // flow renames them when they get to the photo step.
  const [draftName, setDraftName] = useState<string>(() => {
    if (myName && myName.trim()) return myName.trim();
    const seed = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `Visitor-${seed}`;
  });

  // Connect to the room as a player on first mount (or on retry). We use the
  // current draftName so the lurker is visible to others right away. JOIN is
  // re-sent as part of `connect`, and re-running connect later (e.g. after a
  // close) just renames the same WS slot.
  useEffect(() => {
    setMode("player");
    if (conn === "open" || conn === "connecting") return;
    if (!roomId) return;
    setMyName(draftName);
    connect({ roomId, name: draftName, lang, mode: "player" }).catch(() => {
      /* surfaced via connectError in store; we render it below */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Once the round actually starts, jump everyone into the live scene.
  useEffect(() => {
    if (snapshot?.started) {
      nav("/main-scene", { replace: true });
    }
  }, [snapshot?.started, nav]);

  // Re-send READY automatically when we already have an animal but the
  // server lost our `ready` flag (reconnect after refresh).
  const sentReady = useRef(false);
  useEffect(() => {
    if (conn !== "open") return;
    const me = snapshot?.players.find((p) => p.name === myName);
    if (me?.animal && me.ready === false && !sentReady.current) {
      if (send(ClientMessageTypes.READY)) sentReady.current = true;
    }
    if (me?.ready) sentReady.current = true;
  }, [conn, snapshot, myName, send]);

  const players = snapshot?.players ?? [];
  const realPlayers = useMemo(
    () => players.filter((p) => p.name.toLowerCase() !== "ob"),
    [players]
  );
  const me: PublicPlayer | null = useMemo(
    () => players.find((p) => p.name === myName) ?? null,
    [players, myName]
  );
  const iAmHost = !!me?.host;
  const total = realPlayers.length;
  const readyCount = realPlayers.filter((p) => p.ready).length;

  // What stage is the LOCAL me in?
  // - "ready"  : ready=true on server (Final Check passed)
  // - "in-setup": animal assigned but not ready yet (mid-onboarding)
  // - "lurker"  : no animal yet (haven't done photo + quiz)
  const myStage: "ready" | "in-setup" | "lurker" = me?.ready
    ? "ready"
    : me?.animal
      ? "in-setup"
      : "lurker";

  const handleSetupCharacter = useCallback(() => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== myName) {
      // Rename before walking into onboarding so the photo step / system log
      // already shows the chosen name.
      setMyName(trimmed);
      // Re-JOIN to update server-side name on the same conn.id.
      send(ClientMessageTypes.JOIN, { name: trimmed, lang });
    }
    nav("/onboard");
  }, [draftName, myName, setMyName, send, lang, nav]);

  const handleSpectate = useCallback(() => {
    // Anyone already in the room is allowed to spectate — stash the
    // expected key so the OB auth gate passes silently, and set a one-shot
    // sessionStorage flag so the OB route auto-connects to this same room
    // without making the user click Connect again.
    try {
      writeStoredObKey(expectedObKey());
      sessionStorage.setItem("nz.ob.autoConnect", roomId);
    } catch { /* ignore */ }
    nav("/ob");
  }, [nav, roomId]);

  const handleStartGame = useCallback(() => {
    send(ClientMessageTypes.START);
  }, [send]);

  const handleSpawnAi = useCallback(() => {
    send(ClientMessageTypes.OB_SPAWN_AI, { count: 4 });
  }, [send]);

  const handleClearAi = useCallback(() => {
    send(ClientMessageTypes.OB_DESPAWN_AI);
  }, [send]);

  const handleKick = useCallback((targetId: string) => {
    send(ClientMessageTypes.KICK_PLAYER, { targetId });
  }, [send]);

  return (
    <div className="lobby-wrap lobby-wrap--hub">
      {/* Camera upload covers the lurker phase too — the player's camera (if
          permission was granted earlier in this browser) feeds the OB face
          wall + this lobby's roster avatars while they decide. */}
      <CameraFrameUploader />

      <div className="card lobby-card lobby-card--hub">
        <div className="lobby-pulse" aria-hidden="true">
          <span /><span /><span />
        </div>
        <div className="lobby-roomtag">
          <span className="lobby-roomtag__label">{t.roomLabel}</span>
          <span className="lobby-roomtag__code">{roomId.toUpperCase()}</span>
        </div>
        <h1 className="section-title lobby-title">{t.lobbyTitle}</h1>

        <div className="lobby-counter" role="status" aria-live="polite">
          <span key={`r-${readyCount}`} className="lobby-counter__big nz-num-pop">{readyCount}</span>
          <span className="lobby-counter__sep">/</span>
          <span key={`t-${total}`} className="lobby-counter__big nz-num-pop">{total}</span>
          <span className="lobby-counter__label">{t.lobbyReadyLabel}</span>
        </div>

        {/* === Self block — actions specific to the local viewer ============ */}
        {myStage === "lurker" ? (
          <LurkerActions
            draftName={draftName}
            onDraftName={setDraftName}
            onSetup={handleSetupCharacter}
            onSpectate={handleSpectate}
            t={t}
          />
        ) : myStage === "in-setup" ? (
          <div className="lobby-self-card">
            <div className="muted">
              {lang === "zh" ? "尚未完成 Final Check…" : "Finish Final Check…"}
            </div>
            <button type="button" className="primary" onClick={handleSetupCharacter}>
              {lang === "zh" ? "继续设置" : "Continue setup"}
            </button>
          </div>
        ) : (
          <ReadySelfCard me={me!} lang={lang} t={t} />
        )}

        {/* === Host control row =========================================== */}
        {iAmHost && conn === "open" && !snapshot?.started ? (
          <div className="lobby-host-row">
            <div className="lobby-host-row__label">
              {lang === "zh" ? "👑 你是房主" : "👑 You're the host"}
            </div>
            <div className="lobby-host-row__btns">
              <button
                type="button"
                className="primary"
                onClick={handleStartGame}
              >
                {t.obStartGame}
              </button>
              <button type="button" onClick={handleSpawnAi}>
                + {lang === "zh" ? "添加 AI" : "Spawn AI"}
              </button>
              <button type="button" className="ghost" onClick={handleClearAi}>
                {lang === "zh" ? "清除 AI" : "Clear AI"}
              </button>
            </div>
          </div>
        ) : null}

        {/* === Roster ====================================================== */}
        <div className="lobby-rosters">
          <div className="lobby-section-label">{t.players}</div>
          {realPlayers.length === 0 ? (
            <div className="muted lobby-empty">—</div>
          ) : (
            <ul className="lobby-list lobby-list--hub">
              {realPlayers.map((p) => (
                <li
                  key={p.id}
                  className={
                    "lobby-row" +
                    (p.name === myName ? " is-self" : "") +
                    (p.ready ? "" : " is-waiting") +
                    (p.host ? " is-host" : "")
                  }
                >
                  <PlayerRowFace player={p} />
                  <span className="lobby-row-name" title={p.name}>
                    {p.name}
                    {p.host ? <span className="lobby-row-host" aria-hidden> 👑</span> : null}
                  </span>
                  <span className="lobby-row-mark" aria-hidden>
                    {p.ready ? "✓" : "…"}
                  </span>
                  {iAmHost && p.id !== me?.id ? (
                    <button
                      type="button"
                      className="ghost lobby-row-kick"
                      onClick={() => handleKick(p.id)}
                      title={lang === "zh" ? "踢出" : "Kick"}
                      aria-label={lang === "zh" ? "踢出 " + p.name : "Kick " + p.name}
                    >
                      ✕
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lobby-foot muted">
          {iAmHost
            ? (lang === "zh" ? "等所有人就绪后点 Start。" : "Press Start once everyone's ready.")
            : t.lobbyOpHint}
        </div>
      </div>
    </div>
  );
}

function LurkerActions({
  draftName,
  onDraftName,
  onSetup,
  onSpectate,
  t
}: {
  draftName: string;
  onDraftName: (s: string) => void;
  onSetup: () => void;
  onSpectate: () => void;
  t: ReturnType<typeof dict>;
}) {
  return (
    <div className="lobby-self-card lobby-self-card--lurker">
      <label className="label" htmlFor="lobbyName">
        {t.nameLabel}
      </label>
      <input
        id="lobbyName"
        autoComplete="nickname"
        value={draftName}
        onChange={(e) => onDraftName(e.target.value)}
        placeholder={t.namePlaceholder}
      />
      <div className="lobby-self-card__btns">
        <button
          type="button"
          className="primary"
          disabled={!draftName.trim()}
          onClick={onSetup}
        >
          {t.splashStart}
        </button>
        <button type="button" className="ghost" onClick={onSpectate}>
          {t.obTitle ?? "Spectate"}
        </button>
      </div>
    </div>
  );
}

function ReadySelfCard({
  me,
  lang,
  t
}: {
  me: PublicPlayer;
  lang: "en" | "zh";
  t: ReturnType<typeof dict>;
}) {
  const animalLabel = me.animal
    ? animalLocalized[lang][me.animal] ?? me.animal
    : null;
  return (
    <div className="lobby-self-card lobby-self-card--ready">
      <div className="lobby-self-card__name">{me.name}</div>
      {animalLabel ? (
        <div className="lobby-self-card__animal">
          {t.lobbySelfPrefix} <strong>{animalLabel}</strong>
        </div>
      ) : null}
      <div className="lobby-self-card__status">
        ✓ {t.lobbyReadyLabel}
      </div>
    </div>
  );
}
