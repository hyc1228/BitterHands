import { Animals, ClientMessageTypes, ServerEventTypes } from "./protocol.js";
import { fnv1a32, pickLooksRoast, similarityPercentFor } from "./photoAnalysis.js";
import { generateMonitorLine } from "./monitorLines.js";
import { synthesize as synthesizeVoice, getCachedAudio } from "./voice.js";

// #region agent log
// Lightweight runtime logging (multiplayer debug pass). Inert when DEBUG_LOG_URL
// is unreachable (best-effort fetch). Only useful in local PartyKit dev where
// 127.0.0.1:7518 is reachable from the worker runtime.
const _DBG_URL = "http://127.0.0.1:7518/ingest/d4c760a9-8d27-4a7c-8005-12a2cff8b553";
const _DBG_SID = "b26e2b";
function _dbgPost(location, message, data) {
  try {
    fetch(_DBG_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": _DBG_SID },
      body: JSON.stringify({
        sessionId: _DBG_SID, location, message,
        data: data || {}, timestamp: Date.now()
      })
    }).catch(() => {});
  } catch { /* ignore */ }
}
// #endregion

/** Max players (JOIN) per room — bumped to 20 for the hackathon demo (was
 *  10 in the GDD draft). The OB face wall + iframe scene scale fine to 20;
 *  bandwidth dominator is CAMERA_FRAME at ~5 fps × N which is still reasonable. */
const MAX_ROOM_PLAYERS = 20;
/** End-game ceremony: how many action-edge stills the server keeps per kind, per player. */
const HIGHLIGHTS_MAX_PER_KIND = 3;

/** Must match `main scene/index.html` MAP_W / MAP_H and `state.items` ids/positions. */
const MAP_W_MS = 1080;
const MAP_H_MS = 1500;
const CX_MS = MAP_W_MS / 2;
const CY_MS = MAP_H_MS / 2;
/** Mirror of iframe constants used by the Monitor AI tick. */
const MAP_BORDER = 110;
const MON_SPEED = 110;
const CONE_LEN = 260;
const CONE_HALF = Math.PI / 6;
const CHAL_MAX = 8;
const MONITOR_TICK_MS = 100;
const MAIN_SCENE_ITEM_DEFS = [
  { id: "h1", type: "heart", x: CX_MS - 80, y: CY_MS - 340 },
  { id: "h2", type: "heart", x: CX_MS - 320, y: CY_MS - 60 },
  { id: "h3", type: "heart", x: CX_MS + 270, y: CY_MS + 380 },
  // Alarm field — densified so the room has a steady stream of luring
  // distractions for the Monitor. Spread across the playfield so multiple
  // players can grab one without colliding.
  { id: "a1", type: "alarm", x: CX_MS + 140, y: CY_MS + 40 },
  { id: "a2", type: "alarm", x: CX_MS - 200, y: CY_MS + 220 },
  { id: "a3", type: "alarm", x: CX_MS + 320, y: CY_MS - 260 },
  { id: "a4", type: "alarm", x: CX_MS - 360, y: CY_MS - 280 },
  { id: "a5", type: "alarm", x: CX_MS + 400, y: CY_MS + 180 },
  { id: "a6", type: "alarm", x: CX_MS - 80, y: CY_MS + 320 },
  { id: "a7", type: "alarm", x: CX_MS + 200, y: CY_MS - 80 }
];
/** How long a taken item stays gone before the server respawns it.
 * Hearts are scarcer (HP-restoring), alarms refresh fast for action density. */
const ITEM_RESPAWN_MS = { heart: 18_000, alarm: 7_000 };

/**
 * @typedef {object} Player
 * @property {string} id
 * @property {string} name
 * @property {keyof typeof Animals | string | null} animal
 * @property {number} lives
 * @property {string | null} verdict
 * @property {string | null} impression
 * @property {{q1?: string, q2?: string, q3?: string} | null} answers
 * @property {number} violations
 * @property {boolean} alive
 * @property {number} joinedAt
 * @property {"en" | "zh"} lang
 * @property {string | null} avatarUrl public URL path for profile photo
 * @property {number | undefined} photoSeed stable hash from photo sample + id (for reveal copy)
 */

/**
 * Minimal PartyKit room server for Nocturne Zoo (GDD v0.6).
 *
 * - Keeps authoritative room state (players, game timer)
 * - Broadcasts public events + sends private messages (rules card, owl roster)
 * - AI/vision calls are stubbed (wire in later via env + fetch)
 */
export default class Server {
  constructor(party) {
    /** @type {import("partykit/server").Party} */
    this.party = party;

    /** @type {Map<string, Player>} */
    this.players = new Map();

    /** @type {boolean} */
    this.started = false;

    /** @type {number | null} */
    this.startedAt = null;

    /** @type {number} */
    this.durationMs = 2 * 60 * 1000;
    /** Auto-end timer handle (cleared on _endGame so it doesn't double-fire). */
    this._endTimer = null;

    /** @type {Map<string, any>} */
    this.owlGuessesByPlayerId = new Map();

    /** @type {Map<string, {dataUrl: string, ts: number}>} */
    this.lastCameraFrameByPlayerId = new Map();

    /** @type {Map<string, number>} */
    this._lastMainSceneAt = new Map();

    /** In-room profile avatars (data URLs decoded); keyed by connection id. */
    /** @type {Map<string, { mime: string, bytes: Uint8Array }>} */
    this._avatarByPlayerId = new Map();

    /** @type {Set<string>} */
    this.mainSceneItemsRemoved = new Set();
    /** @type {Map<string, (typeof MAIN_SCENE_ITEM_DEFS)[0]>} */
    this._mainSceneItemRegistry = new Map(MAIN_SCENE_ITEM_DEFS.map((d) => [d.id, d]));
    /** Per-item respawn handles so we can cancel them on game end. */
    /** @type {Map<string, ReturnType<typeof setTimeout>>} */
    this._itemRespawnTimers = new Map();
    /** When each player was last picked as a Monitor lock target. Used to
     * spread attention across multiple players in the cone instead of
     * camping the unlucky one. Cleared on game start. */
    /** @type {Map<string, number>} */
    this._monitorLastLockAt = new Map();

    // #region agent log
    // Per-2s message counters for the multiplayer debug pass. Skip the
    // `health` durable-object PartyKit instantiates for its own monitoring —
    // it has no players and only spams empty pings.
    const _roomId = (this.party && this.party.id) || "";
    this._dbg = {
      enabled: _roomId !== "health",
      counts: { broadcast: 0, cameraFrame: 0, highlight: 0, highlightBytes: 0, mainSceneState: 0, monitorBroadcast: 0 },
      itemTaken: [],
      lastFlush: Date.now(),
    };
    if (this._dbg.enabled) {
      this._dbgInterval = setInterval(() => {
        const c = this._dbg.counts;
        const took = this._dbg.itemTaken.splice(0);
        // Skip flushes that have nothing to report (idle room) so we don't
        // drown actual gameplay signal in zeroes.
        const isIdle = c.broadcast === 0 && c.cameraFrame === 0 && c.highlight === 0 && took.length === 0;
        if (!isIdle) {
          _dbgPost("server.js:per-sec", "broadcast counts (last ~2s)", {
            hyp: "H2+H3+H6",
            room: _roomId,
            players: this.players.size,
            counts: c,
            itemTaken: took
          });
        }
        this._dbg.counts = { broadcast: 0, cameraFrame: 0, highlight: 0, highlightBytes: 0, mainSceneState: 0, monitorBroadcast: 0 };
        this._dbg.lastFlush = Date.now();
      }, 2000);
    }
    // #endregion

    /** Monotonic counter for monitor_voice ids when no audio hash is available. */
    this._monitorVoiceSeq = 0;

    /**
     * Server-authoritative Monitor (AI flashlight) state. Mirror of the iframe
     * `state.monitor` shape. Ticks at MONITOR_TICK_MS while the room is started
     * and the result is broadcast to every connection so all phones + the OB
     * tab see the same position / aim / lock target.
     *
     * @type {{
     *   x: number, y: number, aimAngle: number, mode: "sweep"|"locked",
     *   moving: boolean, targetId: string|null, lockTimer: number,
     *   sweepDir: 1|-1, sweepTimer: number,
     *   patrolTarget: {x:number,y:number}|null, patrolTimer: number,
     *   lured: {x:number,y:number}|null, retargetIn: number
     * }}
     */
    this.monitor = this._initialMonitorState();

    /** Latest known position per player from MAIN_SCENE_STATE; the monitor
     * tick uses these to chase / cone-detect. Cleared on game end. */
    /** @type {Map<string, {x:number, y:number, ts:number}>} */
    this._playerPositions = new Map();

    /** Monitor tick handle (setInterval). Started on game start, cleared on end. */
    this._monitorTick = null;
    this._monitorLastTickAt = 0;

    /**
     * Synthetic AI players spawned via OB_SPAWN_AI. Same shape as `_playerPositions`
     * but kept separately so we can wander them on a server tick (the human players
     * report their own positions). Each AI also has a corresponding entry in
     * `this.players` so the iframe + OB camera grid render them like real peers.
     * @type {Map<string, {x:number, y:number, vx:number, vy:number, dir:number}>}
     */
    this._aiBots = new Map();
    this._aiTick = null;
  }

  _initialMonitorState() {
    return {
      x: CX_MS,
      y: CY_MS - 200,
      aimAngle: 0,
      mode: "sweep",
      moving: false,
      targetId: null,
      lockTimer: 0,
      sweepDir: 1,
      sweepTimer: 1,
      patrolTarget: null,
      patrolTimer: 0,
      lured: null,
      retargetIn: 0
    };
  }

  // -------------------------------------------------------------
  // AI bots — synthetic players for multiplayer testing.
  // Each bot has a `Player` entry (so it appears everywhere a real player would:
  // OB face wall, iframe avatar list, snapshot) plus a separate motion record in
  // `_aiBots` driven by `_aiTick`.
  // -------------------------------------------------------------
  _aiCharacterPreset(slot) {
    /** Animal cycle keeps the visible mix balanced (lion / owl / giraffe). */
    const cycle = [
      { animal: Animals.LION, name: "Lion", avatar: "/main-scene/lion.svg" },
      { animal: Animals.OWL, name: "Owl", avatar: "/main-scene/Owl%20body.svg" },
      { animal: Animals.GIRAFFE, name: "Giraffe", avatar: "/main-scene/giraffe.svg" }
    ];
    return cycle[slot % cycle.length];
  }

  _aiVerdictFor(animal) {
    if (animal === Animals.LION) return "Probably a Lion. Calm under pressure.";
    if (animal === Animals.OWL) return "An Owl. Reads the room before moving.";
    if (animal === Animals.GIRAFFE) return "A Giraffe. Hyper-alert, slow to commit.";
    return null;
  }

  _spawnAiBot() {
    if (this.players.size >= MAX_ROOM_PLAYERS) return null;
    const slot = this._aiBots.size;
    const preset = this._aiCharacterPreset(slot);
    const id = `ai_${slot + 1}_${Math.random().toString(36).slice(2, 6)}`;
    const idx = this.players.size + 1;
    /** @type {Player} */
    const player = {
      id,
      name: `${preset.name}-${String(idx).padStart(2, "0")}`,
      animal: preset.animal,
      lives: 3,
      verdict: this._aiVerdictFor(preset.animal),
      impression: "(AI bot — wanders the map for testing.)",
      answers: { qz_01: "A", qz_02: "B", qz_03: "C" },
      violations: 0,
      alive: true,
      joinedAt: Date.now(),
      lang: "en",
      avatarUrl: preset.avatar,
      photoSeed: undefined,
      ready: true,
      faceCounts: { mouthOpens: 0, headShakes: 0, blinks: 0 },
      highlights: { mouth: [], shake: [], blink: [] }
    };
    this.players.set(id, player);
    // Random spawn point inside the inner playfield, with a starting heading.
    const x = MAP_BORDER + 40 + Math.random() * (MAP_W_MS - 2 * (MAP_BORDER + 40));
    const y = MAP_BORDER + 40 + Math.random() * (MAP_H_MS - 2 * (MAP_BORDER + 40));
    this._aiBots.set(id, { x, y, vx: 0, vy: 0, dir: Math.random() * Math.PI * 2 });
    this._playerPositions.set(id, { x, y, ts: Date.now() });
    this._broadcast(ServerEventTypes.PLAYER_JOINED, this._publicPlayer(player));
    // Push a "camera frame" pointing to the character SVG so OB's face tile
    // shows the in-game art instead of the initials fallback. We round-trip
    // through `lastCameraFrameByPlayerId` so a fresh OB connection (onConnect
    // replay) also sees it.
    const camFrame = { dataUrl: preset.avatar, ts: Date.now() };
    this.lastCameraFrameByPlayerId.set(id, camFrame);
    this._broadcast(ServerEventTypes.CAMERA_FRAME, {
      playerId: id,
      playerName: player.name,
      dataUrl: camFrame.dataUrl,
      ts: camFrame.ts
    });
    return id;
  }

  _removeAiBot(id) {
    if (!this._aiBots.has(id)) return;
    this._aiBots.delete(id);
    this.players.delete(id);
    this._playerPositions.delete(id);
    this.lastCameraFrameByPlayerId.delete(id);
    this._broadcast(ServerEventTypes.SYSTEM, {
      code: "PLAYER_LEFT",
      params: { name: id }
    });
  }

  _ensureAiTick() {
    if (this._aiTick) return;
    let last = Date.now();
    this._aiTick = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.5, (now - last) / 1000);
      last = now;
      if (this._aiBots.size === 0) {
        clearInterval(this._aiTick);
        this._aiTick = null;
        return;
      }
      const speed = 95;
      for (const [id, bot] of this._aiBots.entries()) {
        const p = this.players.get(id);
        if (!p) continue;
        // Lazy random-walk: re-pick heading every ~1.5 s, plus a small jitter
        // each tick. Keeps the bots feeling alive without being chaotic.
        bot.dir += (Math.random() - 0.5) * 0.6 * dt;
        if (Math.random() < dt / 1.5) bot.dir = Math.random() * Math.PI * 2;
        const vx = Math.cos(bot.dir) * speed;
        const vy = Math.sin(bot.dir) * speed;
        let nx = bot.x + vx * dt;
        let ny = bot.y + vy * dt;
        if (nx < MAP_BORDER) { nx = MAP_BORDER; bot.dir = Math.PI - bot.dir; }
        if (nx > MAP_W_MS - MAP_BORDER) { nx = MAP_W_MS - MAP_BORDER; bot.dir = Math.PI - bot.dir; }
        if (ny < MAP_BORDER) { ny = MAP_BORDER; bot.dir = -bot.dir; }
        if (ny > MAP_H_MS - MAP_BORDER) { ny = MAP_H_MS - MAP_BORDER; bot.dir = -bot.dir; }
        bot.x = nx;
        bot.y = ny;
        bot.vx = vx;
        bot.vy = vy;
        this._playerPositions.set(id, { x: nx, y: ny, ts: now });
        // Mirror what real players send via MAIN_SCENE_STATE so the iframe's
        // `applyMainSceneNet` hook moves the bot's avatar smoothly.
        this._broadcast(ServerEventTypes.MAIN_SCENE_BROADCAST, {
          playerId: id,
          x: nx,
          y: ny,
          vx,
          vy,
          moving: true,
          animKey: "walk",
          facing: vx >= 0 ? 1 : -1,
          t: now,
          fx: null
        });
      }
    }, 200);
  }

  /**
   * SPA static hosting serves the React shell for `*.html` when the file is not matched first.
   * The main-scene iframe is `nz-scene.html` in the deploy bundle; load it from the asset store.
   * @param {import("partykit/server").Request} req
   * @param {import("partykit/server").FetchLobby} lobby
   * @param {import("partykit/server").ExecutionContext} _ctx
   */
  /**
   * PartyKit static layer always returns existing files (with default `X-Frame-Options: DENY`),
   * so this handler intercepts paths that DO NOT match a real asset:
   *  - `/__main-scene` → re-serve `main-scene/index.html` with `X-Frame-Options: SAMEORIGIN`
   *    so the React shell (`HashRouter`) can embed it as an iframe.
   *  - `/__app-shell` → unused fallback for future SPA routes that need rewritten headers.
   * The bare `/` is auto-served by PartyKit static (we use `HashRouter`, no SPA fallback needed).
   * @param {import("partykit/server").Request} req
   * @param {import("partykit/server").FetchLobby} lobby
   * @param {import("partykit/server").ExecutionContext} _ctx
   */
  static async onFetch(req, lobby, _ctx) {
    if (req.method !== "GET" && req.method !== "HEAD") return;
    const url = new URL(req.url);
    // `_iframe` lives under `/main-scene/` so the doc's relative URLs (SVG <image href="…">,
    // <link href="player-id-labels.css">, etc.) still resolve under `/main-scene/`.
    if (url.pathname === "/main-scene/_iframe") {
      const r = await lobby.assets.fetch("/main-scene/index.html");
      if (r && r.ok) return _withFrameSameOrigin(r);
    }
  }

  /**
   * @param {import("partykit/server").Connection} conn
   */
  onConnect(conn) {
    conn.send(
      JSON.stringify({
        type: ServerEventTypes.ROOM_SNAPSHOT,
        data: this._publicSnapshot()
      })
    );

    // Best-effort: send last known camera frames so OB doesn't start blank.
    for (const [playerId, frame] of this.lastCameraFrameByPlayerId.entries()) {
      const p = this.players.get(playerId);
      conn.send(
        JSON.stringify({
          type: ServerEventTypes.CAMERA_FRAME,
          data: {
            playerId,
            playerName: p?.name ?? null,
            dataUrl: frame.dataUrl,
            ts: frame.ts
          }
        })
      );
    }
  }

  /**
   * @param {string} raw
   * @param {import("partykit/server").Connection} conn
   */
  async onMessage(raw, conn) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      conn.send(JSON.stringify({ type: "error", error: "invalid_json" }));
      return;
    }

    switch (msg?.type) {
      case ClientMessageTypes.JOIN: {
        const name = typeof msg?.name === "string" ? msg.name.slice(0, 24) : null;
        if (!name) {
          conn.send(JSON.stringify({ type: "error", error: "missing_name" }));
          return;
        }
        const lang = msg?.lang === "zh" ? "zh" : "en";

        // Reap dead slots (CF/PartyKit may not always fire `onClose` if a tab is killed,
        // a phone backgrounds the page, or the network drops without a TCP FIN). Without
        // this, MAX_ROOM_PLAYERS gets exhausted and new joiners see `room_full` until the
        // platform finally GCs.
        this._reapStaleSlots();

        const existing = this.players.get(conn.id);
        if (existing) {
          existing.name = name;
          existing.lang = lang;
          this._broadcast(ServerEventTypes.PLAYER_UPDATED, this._publicPlayer(existing));
        } else if (this.players.size >= MAX_ROOM_PLAYERS) {
          conn.send(
            JSON.stringify({
              type: "error",
              error: "room_full",
              max: MAX_ROOM_PLAYERS
            })
          );
          try {
            conn.close(4000, "room_full");
          } catch {
            /* ignore */
          }
          return;
        } else {
          /** @type {Player} */
          const player = {
            id: conn.id,
            name,
            animal: null,
            lives: 3,
            verdict: null,
            impression: null,
            answers: null,
            violations: 0,
            alive: true,
            joinedAt: Date.now(),
            lang,
            avatarUrl: null,
            photoSeed: undefined,
            ready: false,
            // Cumulative face-action counts (incremented client-side, reported via FACE_COUNTS).
            // Used at GAME_ENDED for personal stats + Mario Party–style awards.
            faceCounts: { mouthOpens: 0, headShakes: 0, blinks: 0 },
            // Action-edge webcam stills used to build the end-game ceremony collage.
            // Server caps each kind at HIGHLIGHTS_MAX_PER_KIND; oldest is dropped.
            highlights: { mouth: [], shake: [], blink: [] }
          };
          this.players.set(conn.id, player);
          this._broadcast(ServerEventTypes.PLAYER_JOINED, this._publicPlayer(player));
        }

        this._sendRoomSnapshot();
        return;
      }

      case ClientMessageTypes.SUBMIT_PHOTO: {
        const player = this.players.get(conn.id);
        if (!player) return;

        // Optional: Vite dev saved file under /avatars/ — use as stable URL.
        const publicPath =
          typeof msg?.avatarPublicPath === "string" ? msg.avatarPublicPath : "";
        if (
          publicPath.length > 0 &&
          publicPath.length < 200 &&
          /^\/avatars\/[a-zA-Z0-9._-]+\.(jpe?g|png|webp)$/.test(publicPath)
        ) {
          this._avatarByPlayerId.delete(conn.id);
          player.avatarUrl = publicPath;
        } else {
          const raw = typeof msg?.photoBase64 === "string" ? msg.photoBase64 : "";
          if (!raw.startsWith("data:image/")) {
            conn.send(JSON.stringify({ type: "error", error: "bad_photo" }));
            return;
          }
          if (raw.length > 500_000) {
            conn.send(JSON.stringify({ type: "error", error: "photo_too_large" }));
            return;
          }
          const parsed = this._dataUrlToBytes(raw);
          if (!parsed) {
            conn.send(JSON.stringify({ type: "error", error: "bad_photo" }));
            return;
          }
          this._avatarByPlayerId.set(conn.id, { mime: parsed.mime, bytes: parsed.bytes });
          const rid = encodeURIComponent(this.party.id);
          const pid = encodeURIComponent(conn.id);
          player.avatarUrl = `/party/${rid}/__nz_avatar?id=${pid}`;
        }

        const sample = publicPath ? `av:${publicPath}` : (raw || "").slice(0, 12000);
        player.photoSeed = fnv1a32(String(sample) + player.id + player.name);
        player.impression = player.lang === "zh" ? "（正在建立影像档案…）" : "(Indexing portrait…)";

        void this._runDeferredPhotoIndexing(player);

        this._broadcast(ServerEventTypes.SYSTEM, {
          code: "PLAYER_SUBMITTED_PHOTO",
          params: { name: player.name }
        });
        this._sendRoomSnapshot();
        return;
      }

      case ClientMessageTypes.SUBMIT_ANSWERS: {
        const player = this.players.get(conn.id);
        if (!player) return;

        const answers = msg?.answers && typeof msg.answers === "object" ? msg.answers : null;
        if (!answers) {
          conn.send(JSON.stringify({ type: "error", error: "missing_answers" }));
          return;
        }

        if (msg?.lang === "en" || msg?.lang === "zh") player.lang = msg.lang;

        player.answers = answers;

        // GDD: server calls Claude (text) to decide animal + verdict.
        // For now: deterministic fallback mapping by majority choice.
        const animal = this._fallbackAnimalFromAnswers(answers);
        player.animal = animal;
        player.verdict = this._fallbackVerdict(animal, player.lang);

        // Public: broadcast "XX 已进入 🦁 区域" (no rules content)
        this._broadcast(ServerEventTypes.SYSTEM, {
          code: "PLAYER_ENTERED_ZONE",
          params: { name: player.name, animal: animal }
        });

        // Private: send rules card + win condition + teammates (GDD)
        conn.send(
          JSON.stringify({
            type: ServerEventTypes.PRIVATE_RULES_CARD,
            data: this._rulesCardFor(player)
          })
        );

        // Private owl roster: owl knows everyone animal type, but not other owls existence.
        // We implement the roster push only after assignment (so it can be refreshed).
        this._pushOwlRosters();

        this._sendRoomSnapshot();
        return;
      }

      case ClientMessageTypes.READY: {
        const player = this.players.get(conn.id);
        if (!player) return;
        if (player.ready) return;
        player.ready = true;
        this._broadcast(ServerEventTypes.PLAYER_UPDATED, this._publicPlayer(player));
        this._broadcast(ServerEventTypes.SYSTEM, {
          code: "PLAYER_READY",
          params: { name: player.name }
        });
        this._sendRoomSnapshot();
        return;
      }

      case ClientMessageTypes.START: {
        if (this.started) return;
        // Two callers can start the round:
        //  1. The legacy /ob console: a non-player connection (no JOIN sent),
        //     so `this.players.has(conn.id)` is false. Always allowed.
        //  2. The lobby host (oldest human player). Identified by
        //     `_hostPlayerId()`. Anyone else with a player entry is rejected.
        if (this.players.has(conn.id)) {
          if (this._hostPlayerId() !== conn.id) {
            conn.send(JSON.stringify({ type: "error", error: "start_forbidden_non_host" }));
            return;
          }
        }
        // Refuse to start when any HUMAN player hasn't completed character
        // setup yet — otherwise lurkers get yanked into the live scene with
        // no animal / no role and the round is broken for them. AI bots are
        // always treated as ready (they don't have a setup flow).
        const waiting = [];
        for (const p of this.players.values()) {
          if (this._aiBots.has(p.id)) continue;
          if (!p.ready) waiting.push(p.name);
        }
        if (waiting.length > 0) {
          conn.send(JSON.stringify({
            type: "error",
            error: "start_not_all_ready",
            waiting
          }));
          return;
        }
        this.started = true;
        this.startedAt = Date.now();
        this.mainSceneItemsRemoved = new Set();
        this.monitor = this._initialMonitorState();
        this._playerPositions.clear();
        this._monitorLastLockAt.clear();
        this._startMonitorTick();

        this._broadcast(ServerEventTypes.GAME_STARTED, {
          startedAt: this.startedAt,
          durationMs: this.durationMs
        });

        this._broadcast(ServerEventTypes.SYSTEM, { code: "GAME_STARTED" });
        this._sendRoomSnapshot();

        // Auto-settle when the timer runs out. setTimeout survives PartyKit hibernation
        // because we keep at least one connection alive during play; if the room sleeps
        // before the timer fires, OB / players reconnecting will trigger fresh state and
        // the snapshot's `started === false` (set by _endGame on next ping) re-syncs.
        if (this._endTimer) clearTimeout(this._endTimer);
        this._endTimer = setTimeout(() => {
          this._endTimer = null;
          this._endGame();
        }, this.durationMs);
        // Opening Monitor PA voice intentionally muted for now — the cold-open line
        // was too jarring on first load. Re-enable by uncommenting:
        //   void this._dispatchMonitorLine({ kind: "game_started", priority: 8, ttlMs: 9000 });
        return;
      }

      case ClientMessageTypes.VIOLATION: {
        // Gate by game-running state. Otherwise a stray VIOLATION before
        // the round starts (e.g. a stale iframe rule timer firing during
        // onboarding, or a flaky client) would leak HP into the snapshot
        // and the player walks in already wounded.
        if (!this.started) return;
        const player = this.players.get(conn.id);
        if (!player || !player.alive) return;

        player.violations += 1;
        player.lives = Math.max(0, player.lives - 1);
        player.alive = player.lives > 0;

        // Raw, untranslated detail (e.g. "blinked (owl rule)" or "manual test"). Localized
        // narrative is composed by the client in `renderViolationNarrative` so the wrapping
        // sentence matches the viewer's UI language.
        const detailRaw =
          typeof msg?.detail === "string" ? msg.detail.slice(0, 120) : "";

        this._broadcast(ServerEventTypes.VIOLATION_NARRATIVE, {
          playerId: player.id,
          playerName: player.name,
          animal: player.animal,
          detail: detailRaw
        });

        // Simple "净化" counter hook for giraffe (GDD: giraffe 3 violations =>净化)
        // We'll just announce it; detailed win logic can be added later.
        if (player.animal === Animals.GIRAFFE && player.violations >= 3) {
          this._broadcast(ServerEventTypes.SYSTEM, {
            code: "GIRAFFE_PURIFIED",
            params: { name: player.name }
          });
        }

        if (!player.alive) {
          void this._dispatchMonitorLine({
            kind: "eliminated",
            params: { name: player.name },
            priority: 9,
            ttlMs: 9000
          });
        } else {
          void this._dispatchMonitorLine({
            kind: "violation",
            params: { name: player.name },
            priority: 7,
            ttlMs: 7000
          });
        }

        this._sendRoomSnapshot();
        return;
      }

      case ClientMessageTypes.CHAT: {
        const player = this.players.get(conn.id);
        if (!player) return;
        const text = typeof msg?.text === "string" ? msg.text.slice(0, 280) : "";
        if (!text.trim()) return;

        this._broadcast(ServerEventTypes.CHAT, {
          playerId: player.id,
          playerName: player.name,
          text,
          ts: Date.now()
        });
        return;
      }

      case ClientMessageTypes.CAMERA_FRAME: {
        const player = this.players.get(conn.id);
        if (!player) return;

        const dataUrl = typeof msg?.dataUrl === "string" ? msg.dataUrl : "";
        // Guardrails: small, jpeg/webp dataurl only, and cap size.
        if (!dataUrl.startsWith("data:image/")) return;
        if (dataUrl.length > 120_000) return; // ~<90KB payload typical

        const ts = Date.now();
        this.lastCameraFrameByPlayerId.set(conn.id, { dataUrl, ts });
        // Don't echo the frame back to the sender — they don't render their own
        // tile in the OB face wall, and at 5 fps × N players this saves a lot of
        // pointless WS bytes on each client's downlink.
        this.party.broadcast(
          JSON.stringify({
            type: ServerEventTypes.CAMERA_FRAME,
            data: { playerId: conn.id, playerName: player.name, dataUrl, ts }
          }),
          [conn.id]
        );
        return;
      }

      case ClientMessageTypes.OWL_SUBMIT: {
        const player = this.players.get(conn.id);
        if (!player) return;
        this.owlGuessesByPlayerId.set(conn.id, msg?.guesses ?? null);
        conn.send(JSON.stringify({ type: "ok", ok: true }));
        return;
      }

      case ClientMessageTypes.END: {
        this._endGame();
        return;
      }

      case ClientMessageTypes.OB_SPAWN_AI: {
        // Allowed for: OB-side console (no player entry) OR the lobby host
        // (oldest human player). Other players are ignored.
        if (!this._isHostOrOb(conn)) return;
        const requested = Number(msg?.count);
        const count = Number.isFinite(requested) && requested > 0
          ? Math.min(MAX_ROOM_PLAYERS - this.players.size, Math.floor(requested))
          : Math.min(MAX_ROOM_PLAYERS - this.players.size, 4);
        if (count <= 0) return;
        for (let i = 0; i < count; i++) {
          this._spawnAiBot();
        }
        this._ensureAiTick();
        this._sendRoomSnapshot();
        return;
      }

      case ClientMessageTypes.OB_DESPAWN_AI: {
        if (!this._isHostOrOb(conn)) return;
        for (const id of Array.from(this._aiBots.keys())) {
          this._removeAiBot(id);
        }
        if (this._aiBots.size === 0 && this._aiTick) {
          clearInterval(this._aiTick);
          this._aiTick = null;
        }
        this._sendRoomSnapshot();
        return;
      }

      case ClientMessageTypes.KICK_PLAYER: {
        // Host-only: forcibly remove a specific player (or AI bot) from the
        // room. OB-side console is also allowed since it has the same
        // operator-level authority.
        if (!this._isHostOrOb(conn)) return;
        const targetId = typeof msg?.targetId === "string" ? msg.targetId : "";
        if (!targetId || targetId === conn.id) return;
        if (this._aiBots.has(targetId)) {
          this._removeAiBot(targetId);
          this._sendRoomSnapshot();
          return;
        }
        const target = this.players.get(targetId);
        if (!target) return;
        this._broadcast(ServerEventTypes.SYSTEM, {
          code: "PLAYER_LEFT",
          params: { name: target.name }
        });
        this.players.delete(targetId);
        this.lastCameraFrameByPlayerId.delete(targetId);
        this._lastMainSceneAt.delete(targetId);
        this._avatarByPlayerId.delete(targetId);
        // Hint the kicked WS to close itself; PartyKit lets us address a
        // specific connection by id via `getConnection`.
        try {
          const targetConn = typeof this.party.getConnection === "function"
            ? this.party.getConnection(targetId)
            : null;
          if (targetConn) {
            try { targetConn.send(JSON.stringify({ type: "error", error: "kicked" })); } catch { /* ignore */ }
            try { targetConn.close(4001, "kicked"); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
        this._sendRoomSnapshot();
        return;
      }

      case ClientMessageTypes.TEST_FORCE_START: {
        // Test-only: lets a /test tab (which IS a player) start the game itself.
        // Same body as the OB-driven START path, minus the "must not be a player" check.
        if (this.started) return;
        // Round reset for back-to-back /test cycles: the previous round may have
        // left players dead / with accumulated faceCounts / highlights, which the
        // OB START path normally avoids by happening on a fresh room. Test mode
        // is meant to be re-runnable, so wipe transient per-round state here.
        for (const p of this.players.values()) {
          p.lives = 3;
          p.alive = true;
          p.violations = 0;
          p.faceCounts = { mouthOpens: 0, headShakes: 0, blinks: 0 };
          p.highlights = { mouth: [], shake: [], blink: [] };
          this._broadcast(ServerEventTypes.PLAYER_UPDATED, this._publicPlayer(p));
        }
        this.started = true;
        this.startedAt = Date.now();
        this.mainSceneItemsRemoved = new Set();
        this.monitor = this._initialMonitorState();
        this._playerPositions.clear();
        this._monitorLastLockAt.clear();
        this._startMonitorTick();

        this._broadcast(ServerEventTypes.GAME_STARTED, {
          startedAt: this.startedAt,
          durationMs: this.durationMs
        });
        this._broadcast(ServerEventTypes.SYSTEM, { code: "GAME_STARTED" });
        this._sendRoomSnapshot();

        if (this._endTimer) clearTimeout(this._endTimer);
        this._endTimer = setTimeout(() => {
          this._endTimer = null;
          if (this.started) this._endGame();
        }, this.durationMs);
        return;
      }

      case ClientMessageTypes.MAIN_SCENE_STATE: {
        if (!this.started) return;
        const player = this.players.get(conn.id);
        if (!player) return;
        // Dead players are spectators; ignore further movement broadcasts so the
        // shared playfield doesn't show their avatar drifting around.
        if (!player.alive) return;
        // ~20 Hz cap per client
        const now = Date.now();
        const last = this._lastMainSceneAt.get(conn.id) ?? 0;
        if (now - last < 50) return;
        this._lastMainSceneAt.set(conn.id, now);
        const x = Number(msg?.x);
        const y = Number(msg?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const MAP_MAX = 10000;
        const clampPos = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(MAP_MAX, v)) : 0);
        const clampVel = (v) =>
          Number.isFinite(v) ? Math.max(-800, Math.min(800, v)) : 0;
        const cx = clampPos(x);
        const cy = clampPos(y);
        const payload = {
          playerId: conn.id,
          x: cx,
          y: cy,
          vx: clampVel(Number(msg?.vx)),
          vy: clampVel(Number(msg?.vy)),
          moving: Boolean(msg?.moving),
          animKey: typeof msg?.animKey === "string" ? msg.animKey.slice(0, 48) : "idle",
          facing: typeof msg?.facing === "number" && Number.isFinite(msg.facing) ? msg.facing : 0,
          t: now,
          fx: msg?.fx && typeof msg.fx === "object" ? msg.fx : null
        };
        // Cache for the Monitor AI tick (chase / cone-detect).
        this._playerPositions.set(conn.id, { x: cx, y: cy, ts: now });
        this._broadcast(ServerEventTypes.MAIN_SCENE_BROADCAST, payload);
        return;
      }

      case ClientMessageTypes.HIGHLIGHT: {
        const player = this.players.get(conn.id);
        if (!player) return;
        if (!this.started) return;
        const kind = msg && msg.kind;
        if (kind !== "mouth" && kind !== "shake" && kind !== "blink") return;
        // #region agent log
        if (this._dbg) {
          this._dbg.counts.highlight += 1;
          const frames = Array.isArray(msg && msg.frames) ? msg.frames : (msg && msg.dataUrl ? [msg.dataUrl] : []);
          for (const f of frames) if (typeof f === "string") this._dbg.counts.highlightBytes += f.length;
        }
        // #endregion
        // New shape: { frames: string[] } (each frame a 96² JPEG dataURL). We
        // also accept the legacy { dataUrl } shape so older clients still drop
        // a single still in.
        let frames = Array.isArray(msg && msg.frames) ? msg.frames : null;
        if (!frames && typeof msg?.dataUrl === "string") frames = [msg.dataUrl];
        if (!frames || frames.length === 0) return;
        // Sanitize each frame; cap aggregate burst size so a misbehaving client
        // can't push megabytes through the WS.
        const cleaned = [];
        let totalLen = 0;
        for (const f of frames) {
          if (typeof f !== "string") continue;
          if (!f.startsWith("data:image/")) continue;
          if (f.length > 60_000) continue;
          totalLen += f.length;
          if (totalLen > 280_000) break; // ~4 frames × ~5 KB headroom
          cleaned.push(f);
        }
        if (cleaned.length === 0) return;
        const bucket = player.highlights[kind];
        bucket.push(cleaned);
        if (bucket.length > HIGHLIGHTS_MAX_PER_KIND) bucket.shift();
        return;
      }

      case ClientMessageTypes.FACE_COUNTS: {
        const player = this.players.get(conn.id);
        if (!player) return;
        // Trust the highest value we've seen — clients send cumulative totals every few
        // seconds, so the server treats their report as authoritative-but-monotonic.
        const c = msg && typeof msg === "object" ? msg : {};
        const m = Number(c.mouthOpens);
        const s = Number(c.headShakes);
        const b = Number(c.blinks);
        if (Number.isFinite(m) && m >= 0) {
          player.faceCounts.mouthOpens = Math.max(player.faceCounts.mouthOpens, Math.floor(m));
        }
        if (Number.isFinite(s) && s >= 0) {
          player.faceCounts.headShakes = Math.max(player.faceCounts.headShakes, Math.floor(s));
        }
        if (Number.isFinite(b) && b >= 0) {
          player.faceCounts.blinks = Math.max(player.faceCounts.blinks, Math.floor(b));
        }
        return;
      }

      case ClientMessageTypes.MAIN_SCENE_ITEM_PICKUP: {
        if (!this.started) return;
        const player = this.players.get(conn.id);
        if (!player) return;
        // Dead players cannot pick up items.
        if (!player.alive) return;
        const itemId = typeof msg?.itemId === "string" ? msg.itemId.slice(0, 32) : "";
        if (!itemId || !this._mainSceneItemRegistry.has(itemId)) {
          return;
        }
        if (this.mainSceneItemsRemoved.has(itemId)) {
          // #region agent log
          if (this._dbg) this._dbg.itemTaken.push({ id: itemId, by: player.name, race: "lost" });
          // #endregion
          conn.send(
            JSON.stringify({
              type: ServerEventTypes.MAIN_SCENE_ITEMS_RESYNC,
              data: { removedItemIds: Array.from(this.mainSceneItemsRemoved) }
            })
          );
          return;
        }
        this.mainSceneItemsRemoved.add(itemId);
        // #region agent log
        if (this._dbg) this._dbg.itemTaken.push({ id: itemId, by: player.name, race: "won" });
        // #endregion
        const meta = this._mainSceneItemRegistry.get(itemId);
        // Heart restores 1 HP (capped at 3 — GDD).
        if (meta.type === "heart" && player.lives < 3) {
          player.lives += 1;
          this._broadcast(ServerEventTypes.PLAYER_UPDATED, this._publicPlayer(player));
        }
        // Alarm: lure the Monitor AI toward the pickup site server-side, so
        // every client sees the same diversion (was previously each client's
        // own independent monitor reacting locally).
        if (meta.type === "alarm") {
          this.monitor.lured = { x: meta.x, y: meta.y };
          this.monitor.retargetIn = 4;
          this.monitor.mode = "sweep";
          this.monitor.targetId = null;
        }
        this._broadcast(ServerEventTypes.MAIN_SCENE_ITEM_TAKEN, {
          itemId,
          itemType: meta.type,
          byPlayerId: conn.id,
          alarmLured: meta.type === "alarm" ? { x: meta.x, y: meta.y } : null
        });
        void this._dispatchMonitorLine({
          kind: meta.type === "alarm" ? "pickup_alarm" : "pickup_heart",
          params: { name: player.name },
          priority: meta.type === "alarm" ? 7 : 4,
          ttlMs: 7000
        });
        // Schedule a respawn so the field stays populated. Type-specific delays:
        // alarms come back fast (action density), hearts slow (HP scarcity).
        this._scheduleItemRespawn(itemId, meta);
        this._sendRoomSnapshot();
        return;
      }

      default: {
        conn.send(JSON.stringify({ type: "error", error: "unknown_message_type" }));
      }
    }
  }

  onClose(conn) {
    const player = this.players.get(conn.id);
    if (!player) return;

    this.players.delete(conn.id);
    this.owlGuessesByPlayerId.delete(conn.id);
    this.lastCameraFrameByPlayerId.delete(conn.id);
    this._lastMainSceneAt.delete(conn.id);
    this._avatarByPlayerId.delete(conn.id);

    this._broadcast(ServerEventTypes.SYSTEM, {
      code: "PLAYER_LEFT",
      params: { name: player.name }
    });
    this._sendRoomSnapshot();
  }

  /**
   * Clears `players` entries whose connection is no longer in `getConnections()`.
   * Called on every JOIN as a fallback when `onClose` was missed (mobile background,
   * tab kill, network drop, etc.). Cheap — O(players + connections).
   */
  _reapStaleSlots() {
    if (typeof this.party.getConnections !== "function") return;
    const live = new Set();
    for (const c of this.party.getConnections()) live.add(c.id);
    let changed = false;
    for (const pid of Array.from(this.players.keys())) {
      if (live.has(pid)) continue;
      // AI bots have synthetic ids and no WS connection; OB_DESPAWN_AI is the
      // only way to remove them. Without this guard every JOIN would wipe them.
      if (this._aiBots.has(pid)) continue;
      const p = this.players.get(pid);
      this.players.delete(pid);
      this.owlGuessesByPlayerId.delete(pid);
      this.lastCameraFrameByPlayerId.delete(pid);
      this._lastMainSceneAt.delete(pid);
      this._avatarByPlayerId.delete(pid);
      if (p) {
        this._broadcast(ServerEventTypes.SYSTEM, {
          code: "PLAYER_LEFT",
          params: { name: p.name }
        });
        changed = true;
      }
    }
    if (changed) this._sendRoomSnapshot();
  }

  async onRequest(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname.endsWith("/__nz_voice")) {
      const id = url.searchParams.get("id");
      if (!id) return new Response("missing id", { status: 400 });
      const data = getCachedAudio(id);
      if (!data) return new Response("not found", { status: 404 });
      return new Response(data.bytes, {
        headers: {
          "Content-Type": data.mime,
          "Cache-Control": "private, max-age=600",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
    if (url.pathname.endsWith("/__nz_avatar")) {
      const id = url.searchParams.get("id");
      if (!id) return new Response("missing id", { status: 400 });
      const data = this._avatarByPlayerId.get(id);
      if (!data) return new Response("not found", { status: 404 });
      return new Response(data.bytes, {
        headers: {
          "Content-Type": data.mime,
          "Cache-Control": "private, max-age=60"
        }
      });
    }
    if (url.pathname === "/state") {
      return Response.json({
        room: this.party.id,
        started: this.started,
        startedAt: this.startedAt,
        durationMs: this.durationMs,
        players: Array.from(this.players.values())
      });
    }
    return new Response(`Nocturne Zoo room ${this.party.id}\n`, { status: 200 });
  }

  /**
   * Generate a Monitor PA line and (best-effort) ElevenLabs audio, then broadcast.
   * Fire-and-forget — callers don't await.
   *
   * `kind` is a stable tag (e.g. "violation", "pickup_alarm") used by the client
   * for dedup; `priority` is 1–10 (higher preempts lower in the audio queue).
   *
   * @param {{ kind: string, params?: Record<string, string|number>, priority?: number, ttlMs?: number }} event
   */
  async _dispatchMonitorLine(event) {
    if (!event || typeof event.kind !== "string") return;
    const priority = typeof event.priority === "number" ? event.priority : 5;
    const ttlMs = typeof event.ttlMs === "number" ? event.ttlMs : 8000;

    let line;
    try {
      line = await generateMonitorLine({ kind: event.kind, params: event.params || {} });
    } catch {
      return;
    }
    if (!line) return;

    // Plan A: prefer the pre-recorded MP3 shipped under `server/public/voice/`.
    // The client just plays the static path; no API call at runtime.
    let audioUrl = line.audioPath;
    let voiceId = `${line.kind}_${line.idx}`;

    // Optional fallback: if ELEVENLABS_API_KEY is configured, try live TTS for
    // the audio side too. Useful when a static file is missing or you want to
    // A/B compare. Skipped silently when not configured.
    if (process.env && process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) {
      try {
        const tts = await synthesizeVoice(line.audioText);
        if (tts.ok && tts.id) {
          voiceId = tts.id;
          const rid = encodeURIComponent(this.party.id);
          audioUrl = `/party/${rid}/__nz_voice?id=${tts.id}`;
        }
      } catch {
        /* keep the static path */
      }
    }

    this._broadcast(ServerEventTypes.MONITOR_VOICE, {
      id: voiceId || `nz-${++this._monitorVoiceSeq}`,
      kind: event.kind,
      priority,
      audioUrl,
      captions: line.caption,
      ttlMs,
      source: line.source
    });
  }

  // -------------------------------------------------------------
  // Monitor (AI flashlight) — server-authoritative tick.
  // Mirror of `updateMonitor()` from `main scene/index.html`. Runs while the
  // room is started; broadcasts the new pose at MONITOR_TICK_MS so every
  // client (players + OB) renders the same flashlight position / lock.
  // -------------------------------------------------------------
  _startMonitorTick() {
    this._stopMonitorTick();
    this._monitorLastTickAt = Date.now();
    this._monitorTick = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.5, (now - this._monitorLastTickAt) / 1000);
      this._monitorLastTickAt = now;
      this._tickMonitor(dt);
      this._broadcastMonitorState();
    }, MONITOR_TICK_MS);
  }
  _stopMonitorTick() {
    if (this._monitorTick) {
      clearInterval(this._monitorTick);
      this._monitorTick = null;
    }
  }
  _broadcastMonitorState() {
    const m = this.monitor;
    this._broadcast(ServerEventTypes.MONITOR_STATE, {
      x: m.x,
      y: m.y,
      aimAngle: m.aimAngle,
      mode: m.mode,
      moving: m.moving,
      targetId: m.targetId,
      lured: m.lured ? { x: m.lured.x, y: m.lured.y } : null,
      ts: Date.now()
    });
  }
  _tickMonitor(dt) {
    const m = this.monitor;
    const wrap = (a) => {
      while (a > Math.PI) a -= 2 * Math.PI;
      while (a < -Math.PI) a += 2 * Math.PI;
      return a;
    };
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const inCone = (mx, my, ang, px, py) => {
      const dx = px - mx, dy = py - my;
      const d = Math.hypot(dx, dy);
      if (d > CONE_LEN || d < 1) return false;
      let bear = Math.atan2(dy, dx) - ang;
      bear = ((bear + Math.PI) % (2 * Math.PI)) - Math.PI;
      return Math.abs(bear) <= CONE_HALF;
    };

    // ----- Alarm lure: tilt toward lure for retargetIn seconds, then resume sweep.
    // Slowed turn rate: 4 rad/s used to feel like a teleport ("AI immediately
    // looks over there"); 1.2 rad/s ≈ 70°/s gives the keeper a deliberate
    // ~1.3 s head turn that reads as "noticing" instead of "snapping".
    if (m.lured) {
      const desired = Math.atan2(m.lured.y - m.y, m.lured.x - m.x);
      m.aimAngle += clamp(wrap(desired - m.aimAngle), -1.2 * dt, 1.2 * dt);
      m.retargetIn -= dt;
      if (m.retargetIn <= 0) {
        m.lured = null;
        m.mode = "sweep";
        m.sweepTimer = 1;
      }
      return;
    }

    if (m.mode === "sweep") {
      m.aimAngle += m.sweepDir * 1.0 * dt;
      m.sweepTimer -= dt;
      if (m.sweepTimer <= 0) {
        m.sweepTimer = 2 + Math.random() * 3;
        if (Math.random() < 0.6) m.sweepDir *= -1;
      }
      // Patrol waypoint
      if (
        !m.patrolTarget ||
        m.patrolTimer <= 0 ||
        Math.hypot(m.patrolTarget.x - m.x, m.patrolTarget.y - m.y) < 60
      ) {
        m.patrolTimer = 3 + Math.random() * 5;
        m.patrolTarget = {
          x: MAP_BORDER + Math.random() * (MAP_W_MS - 2 * MAP_BORDER),
          y: MAP_BORDER + Math.random() * (MAP_H_MS - 2 * MAP_BORDER)
        };
      }
      m.patrolTimer -= dt;
      const pdx = m.patrolTarget.x - m.x;
      const pdy = m.patrolTarget.y - m.y;
      const pd = Math.hypot(pdx, pdy);
      m.moving = pd > 10;
      if (m.moving) {
        m.x = clamp(m.x + (pdx / pd) * MON_SPEED * 0.55 * dt, MAP_BORDER, MAP_W_MS - MAP_BORDER);
        m.y = clamp(m.y + (pdy / pd) * MON_SPEED * 0.55 * dt, MAP_BORDER, MAP_H_MS - MAP_BORDER);
      }
      // Cone detect against alive players
      const candidates = [];
      for (const [pid, pos] of this._playerPositions.entries()) {
        const player = this.players.get(pid);
        if (!player || !player.alive) continue;
        candidates.push({ id: pid, x: pos.x, y: pos.y });
      }
      const eligible = candidates.filter((p) =>
        inCone(m.x, m.y, m.aimAngle, p.x, p.y)
      );
      if (eligible.length > 0) {
        // Spread the love: pick the eligible player whose last lock-on is
        // OLDEST (or who has never been locked yet), so when the cone has
        // multiple players the Monitor rotates attention round-robin instead
        // of repeatedly singling out the same unlucky one. Random jitter
        // breaks ties so two players locked at the same tick still alternate.
        const now = Date.now();
        eligible.sort((a, b) => {
          const la = this._monitorLastLockAt.get(a.id) ?? 0;
          const lb = this._monitorLastLockAt.get(b.id) ?? 0;
          if (la !== lb) return la - lb;
          return Math.random() - 0.5;
        });
        const pick = eligible[0];
        m.targetId = pick.id;
        m.mode = "locked";
        m.lockTimer = CHAL_MAX;
        this._monitorLastLockAt.set(pick.id, now);
      }
      return;
    }

    // ----- locked
    m.lockTimer -= dt;
    if (m.lockTimer <= 0) {
      m.mode = "sweep";
      m.targetId = null;
      m.sweepTimer = 1;
      return;
    }
    const target = this._playerPositions.get(m.targetId);
    const player = this.players.get(m.targetId);
    if (!target || !player || !player.alive) {
      m.mode = "sweep";
      m.targetId = null;
      m.sweepTimer = 1;
      return;
    }
    const desired = Math.atan2(target.y - m.y, target.x - m.x);
    m.aimAngle += clamp(wrap(desired - m.aimAngle), -8 * dt, 8 * dt);
    const dx = target.x - m.x;
    const dy = target.y - m.y;
    const dist = Math.hypot(dx, dy);
    const COMFORT = 150;
    const RAMP = 70;
    m.moving = dist > COMFORT;
    if (m.moving) {
      const speedFactor = Math.min(1, (dist - COMFORT) / RAMP);
      m.x += (dx / dist) * MON_SPEED * speedFactor * dt;
      m.y += (dy / dist) * MON_SPEED * speedFactor * dt;
    }
    m.x = clamp(m.x, MAP_BORDER, MAP_W_MS - MAP_BORDER);
    m.y = clamp(m.y, MAP_BORDER, MAP_H_MS - MAP_BORDER);
  }

  /**
   * Schedule a taken item to come back after a type-specific delay.
   * Cancels any existing timer for the same id (safety net — there shouldn't
   * normally be one). Skipped after _endGame so respawns don't fire post-round.
   */
  _scheduleItemRespawn(itemId, meta) {
    const prev = this._itemRespawnTimers.get(itemId);
    if (prev) clearTimeout(prev);
    const delay = ITEM_RESPAWN_MS[meta.type] ?? 10_000;
    const handle = setTimeout(() => {
      this._itemRespawnTimers.delete(itemId);
      // If the room ended (or restarted) while we were waiting, drop silently.
      if (!this.started) return;
      if (!this.mainSceneItemsRemoved.has(itemId)) return;
      this.mainSceneItemsRemoved.delete(itemId);
      this._broadcast(ServerEventTypes.MAIN_SCENE_ITEM_RESPAWN, {
        itemId,
        itemType: meta.type,
        x: meta.x,
        y: meta.y
      });
      this._sendRoomSnapshot();
    }, delay);
    this._itemRespawnTimers.set(itemId, handle);
  }

  _endGame() {
    if (!this.started) return;
    this.started = false;
    this._stopMonitorTick();
    // Cancel any in-flight respawn timers so they don't fire post-round.
    for (const h of this._itemRespawnTimers.values()) clearTimeout(h);
    this._itemRespawnTimers.clear();
    if (this._endTimer) {
      clearTimeout(this._endTimer);
      this._endTimer = null;
    }

    const revealList = Array.from(this.players.values()).map((p) => {
      // Last live camera frame this player sent in. Used by the ceremony as a
      // fallback portrait so the collage can still show every player's face
      // even if their highlight bursts are sparse / empty.
      const lastFrame = this.lastCameraFrameByPlayerId.get(p.id);
      return {
        id: p.id,
        name: p.name,
        animal: p.animal,
        verdict: p.verdict,
        alive: p.alive,
        lives: p.lives,
        violations: p.violations,
        faceCounts: { ...p.faceCounts },
        highlights: {
          mouth: p.highlights.mouth.slice(),
          shake: p.highlights.shake.slice(),
          blink: p.highlights.blink.slice()
        },
        avatarUrl: p.avatarUrl ?? null,
        lastFrame: lastFrame ? lastFrame.dataUrl : null
      };
    });
    // Mario Party–style awards: highest count per face-action (only among players who
    // actually scored ≥1, ties broken by joined-order). OB renders a dedicated podium.
    const realPlayers = revealList.filter((p) => p.name.toLowerCase() !== "ob");
    const pickAward = (key) => {
      let best = null;
      for (const p of realPlayers) {
        const v = (p.faceCounts && p.faceCounts[key]) || 0;
        if (v <= 0) continue;
        if (!best || v > best.count) best = { id: p.id, name: p.name, count: v };
      }
      return best;
    };
    const awards = {
      mouthOpens: pickAward("mouthOpens"),
      headShakes: pickAward("headShakes"),
      blinks: pickAward("blinks")
    };

    this._broadcast(ServerEventTypes.GAME_ENDED, {
      endedAt: Date.now(),
      reveal: revealList,
      awards,
      owlGuesses: Object.fromEntries(this.owlGuessesByPlayerId.entries())
    });
    // Push a fresh snapshot too so `started=false` propagates to clients that route on snapshot
    // (Lobby / Onboard auto-redirect listeners).
    this._sendRoomSnapshot();

    const survivors = Array.from(this.players.values()).filter((p) => p.alive);
    const winner = survivors.length
      ? survivors.reduce((a, b) => (a.lives >= b.lives ? a : b))
      : null;
    if (winner) {
      void this._dispatchMonitorLine({
        kind: "winner",
        params: { name: winner.name },
        priority: 9,
        ttlMs: 9000
      });
    } else {
      void this._dispatchMonitorLine({ kind: "game_ended", priority: 8, ttlMs: 9000 });
    }
  }

  _sendRoomSnapshot() {
    this._broadcast(ServerEventTypes.ROOM_SNAPSHOT, this._publicSnapshot());
  }

  /**
   * @param {string} dataUrl
   * @returns {{ mime: string, bytes: Uint8Array } | null}
   */
  _dataUrlToBytes(dataUrl) {
    const m = dataUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,([\s\S]+)$/);
    if (!m) return null;
    const b64 = m[2].replace(/\s/g, "");
    if (b64.length > 500_000) return null;
    if (typeof atob !== "function") return null;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { mime: m[1], bytes };
  }

  _broadcast(type, data) {
    this.party.broadcast(JSON.stringify({ type, data }));
    // #region agent log
    if (this._dbg) {
      this._dbg.counts.broadcast += 1;
      if (type === ServerEventTypes.CAMERA_FRAME) this._dbg.counts.cameraFrame += 1;
      if (type === ServerEventTypes.MAIN_SCENE_BROADCAST) this._dbg.counts.mainSceneState += 1;
      if (type === ServerEventTypes.MONITOR_STATE) this._dbg.counts.monitorBroadcast += 1;
    }
    // #endregion
  }

  _publicPlayer(p) {
    return {
      id: p.id,
      name: p.name,
      animal: p.animal, // UI uses emoji; per GDD, animal itself is public after assignment
      lives: p.lives,
      alive: p.alive,
      violations: p.violations,
      avatarUrl: p.avatarUrl ?? null,
      ready: !!p.ready,
      host: this._hostPlayerId() === p.id
    };
  }

  /** True for either an OB-side connection (no player entry) OR the lobby
   *  host. Used to gate room-management messages (start, spawn AI, kick). */
  _isHostOrOb(conn) {
    if (!this.players.has(conn.id)) return true;
    return this._hostPlayerId() === conn.id;
  }

  /** Host = the human (non-AI) player with the smallest joinedAt. AI bots
   *  never host. Recomputed every snapshot/update so when the current host
   *  leaves, the next-oldest player automatically inherits the controls. */
  _hostPlayerId() {
    let best = null;
    for (const p of this.players.values()) {
      if (this._aiBots.has(p.id)) continue;
      if (!best || p.joinedAt < best.joinedAt) best = p;
    }
    return best ? best.id : null;
  }

  _publicSnapshot() {
    const players = Array.from(this.players.values())
      // Stable order across clients: humans by joinedAt, AI last.
      .sort((a, b) => {
        const aAi = this._aiBots.has(a.id) ? 1 : 0;
        const bAi = this._aiBots.has(b.id) ? 1 : 0;
        if (aAi !== bAi) return aAi - bAi;
        return a.joinedAt - b.joinedAt;
      })
      .map((p) => this._publicPlayer(p));
    const readyCount = players.reduce((n, p) => (p.ready ? n + 1 : n), 0);
    return {
      roomId: this.party.id,
      started: this.started,
      startedAt: this.startedAt,
      durationMs: this.durationMs,
      readyCount,
      players,
      mainSceneItemsRemoved: this.started
        ? Array.from(this.mainSceneItemsRemoved)
        : []
    };
  }

  _animalEmoji(animal) {
    if (animal === Animals.LION) return "🦁";
    if (animal === Animals.OWL) return "🦉";
    if (animal === Animals.GIRAFFE) return "🦒";
    return "❓";
  }

  _fallbackAnimalFromAnswers(answers) {
    const vals = Object.values(answers).map((v) => String(v).toUpperCase());
    const a = vals.filter((v) => v === "A").length;
    const b = vals.filter((v) => v === "B").length;
    const c = vals.filter((v) => v === "C").length;

    if (b >= a && b >= c) return Animals.LION;
    if (a >= b && a >= c) return Animals.OWL;
    return Animals.GIRAFFE;
  }

  _fallbackVerdict(animal, lang = "en") {
    const en = {
      [Animals.LION]: "Your voice keeps the darkness at bay.",
      [Animals.OWL]: "Nothing escapes your gaze.",
      [Animals.GIRAFFE]: "Something has already started changing you.",
      _: "The zoo hasn't quite figured you out yet."
    };
    const zh = {
      [Animals.LION]: "你的声音能让黑暗退开。",
      [Animals.OWL]: "你从不放过任何细节。",
      [Animals.GIRAFFE]: "有什么东西已经开始改变你了。",
      _: "动物园还没看清你。"
    };
    const dict = lang === "zh" ? zh : en;
    return dict[animal] || dict._;
  }

  _rulesCardFor(player) {
    const animal = player.animal;
    const lang = player.lang || "en";
    const teammates = Array.from(this.players.values())
      .filter((p) => p.id !== player.id && p.animal && p.animal === animal)
      .map((p) => ({ id: p.id, name: p.name }));

    const text = {
      en: {
        [Animals.LION]: {
          rule: "Every 60s you must let out a roar of ≥2s. Stay silent too long and ‘it’ will think you’re gone.",
          win: "Drive at least one Giraffe to 3 violations (purification). All Lions must succeed."
        },
        [Animals.OWL]: {
          rule: "Every 40s a detection window opens — for 5s you cannot blink. Blink and ‘it’ sees you.",
          win: "At settlement, correctly guess every other player’s animal. All Owls must be right."
        },
        [Animals.GIRAFFE]: {
          rule: "Every 45s, swing your neck (a wide lateral head shake). Stop for too long and ‘it’ erases you.",
          win: "Cause at least one White Lion to die from violations. Any surviving Giraffe wins."
        }
      },
      zh: {
        [Animals.LION]: {
          rule: "你必须每隔 60 秒发出一次持续 ≥2 秒的低吼。沉默太久，“它”会认为你已经离开。",
          win: "让至少 1 名长颈鹿玩家违规累计 3 次（净化）。白狮子全员完成才算胜利。"
        },
        [Animals.OWL]: {
          rule: "每 40 秒触发一次检测窗口，窗口内 5 秒不能眨眼。如果你眨了眼，“它”就看见你了。",
          win: "结算时正确猜出所有其他玩家的动物身份。猫头鹰全员猜对才算胜利。"
        },
        [Animals.GIRAFFE]: {
          rule: "你必须每隔 45 秒做一次甩脖子（头部大幅横向摆动）。停止太久，“它”会把你清除。",
          win: "让至少 1 名白狮子玩家违规死亡。长颈鹿任意 1 人存活即算胜利。"
        }
      }
    };
    const dict = (text[lang] && text[lang][animal]) || null;
    if (!dict) {
      return {
        animal: null,
        emoji: "❓",
        verdict: null,
        rule: "",
        win: "",
        teammates,
        similarityPercent: 0,
        looksRoast: ""
      };
    }
    const seed = player.photoSeed ?? fnv1a32(String(player.id) + (player.name || ""));
    const similarityPercent = similarityPercentFor(seed, animal, player.id);
    const looksRoast = pickLooksRoast(seed, lang);
    return {
      animal,
      emoji: this._animalEmoji(animal),
      verdict: player.verdict,
      rule: dict.rule,
      win: dict.win,
      teammates: animal === Animals.OWL ? [] : teammates,
      similarityPercent,
      looksRoast
    };
  }

  /**
   * Simulates async vision/indexing; replace with real job queue later.
   * @param {Player} player
   */
  _runDeferredPhotoIndexing(player) {
    const delay = 120 + (player.photoSeed & 0x7f);
    return new Promise((resolve) => {
      setTimeout(() => {
        const tag = (player.photoSeed >>> 0) % 997;
        player.impression =
          player.lang === "zh" ? `（影像已建档 · 特征簇 #${tag}）` : `(Image indexed · cluster #${tag})`;
        resolve();
      }, delay);
    });
  }

  _pushOwlRosters() {
    const roster = Array.from(this.players.values())
      .filter((p) => p.animal)
      .map((p) => ({ id: p.id, name: p.name, animal: p.animal }));

    const connections = this.party.getConnections ? this.party.getConnections() : [];
    for (const conn of connections) {
      const p = this.players.get(conn.id);
      if (!p || p.animal !== Animals.OWL) continue;
      conn.send(
        JSON.stringify({
          type: ServerEventTypes.PRIVATE_OWL_ROSTER,
          data: roster
        })
      );
    }
  }
}

/**
 * Re-emit a static-asset Response with `X-Frame-Options: SAMEORIGIN` (PartyKit defaults to `DENY`,
 * which blocks the React shell from embedding `/main-scene/index.html` as an iframe).
 * @param {Response} r
 * @returns {Promise<Response>}
 */
async function _withFrameSameOrigin(r) {
  const headers = new Headers(r.headers);
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.delete("Content-Security-Policy");
  const body = await r.arrayBuffer();
  return new Response(body, { status: r.status, statusText: r.statusText, headers });
}

