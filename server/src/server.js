import { Animals, ClientMessageTypes, ServerEventTypes } from "./protocol.js";
import { fnv1a32, pickLooksRoast, similarityPercentFor } from "./photoAnalysis.js";
import { generateMonitorLine } from "./monitorLines.js";
import { synthesize as synthesizeVoice, getCachedAudio } from "./voice.js";

/** Max real human players that can JOIN a room.  Bumped to 20 for the
 *  hackathon demo (was 10 in the GDD draft).  The OB face wall + iframe scene
 *  scale fine to 20; bandwidth dominator is CAMERA_FRAME at ~5 fps × N which
 *  is still reasonable.
 *
 *  IMPORTANT: this cap intentionally counts ONLY real humans.  OB observer
 *  tabs (name === "ob") and AI bots (id starts with `ai_`) are excluded by
 *  `_humanPlayerCount()` below, so spawning a few AI for testing or opening
 *  multiple OB tabs does NOT eat into the human-player budget.  Older builds
 *  used `players.size >= MAX_ROOM_PLAYERS` directly, which is why a room with
 *  some AI bots / OB tabs would fill at ~12 humans even though the cap says
 *  20. */
const MAX_ROOM_PLAYERS = 20;
/** Hard ceiling on AI bots in a single room — guards against accidental
 *  fills from `OB_SPAWN_AI count: 999`.  AI bots live alongside the human
 *  player cap (they're not counted toward MAX_ROOM_PLAYERS), and we keep
 *  parity with the human cap so a host can stress-test a 20-entity room
 *  end-to-end without juggling human + AI budgets. */
const MAX_AI_BOTS = 20;
/** End-game ceremony: how many action-edge stills the server keeps per kind, per player. */
const HIGHLIGHTS_MAX_PER_KIND = 3;
/** End-game ceremony: how many recent camera frames to keep as a fallback
 *  burst for each player. Used when a player triggered no mouth/shake/blink
 *  highlights this round, so their class-photo / collage tile still cycles
 *  multiple frames instead of being a still image. 3 is enough to read as a
 *  GIF and small enough to fit comfortably in the GAME_ENDED payload. */
const RECENT_FRAMES_MAX = 3;
/** Minimum spacing between saved fallback-burst frames. CAMERA_FRAME arrives
 *  ~5 fps; without this gap we'd save 3 adjacent stills and the tile would
 *  look static. ~900ms gives a visible "the head moved" pulse between frames. */
const RECENT_FRAMES_MIN_GAP_MS = 900;

/** Must match `main scene/index.html` MAP_W / MAP_H and `state.items` ids/positions. */
const MAP_W_MS = 1080;
const MAP_H_MS = 1500;
const CX_MS = MAP_W_MS / 2;
const CY_MS = MAP_H_MS / 2;
/** Mirror of iframe constants used by the Monitor AI tick. */
const MAP_BORDER = 110;
const MON_SPEED = 110;
/** Max range of the flashlight cone for server-side detection. Tuned a hair
 *  longer than the rendered `light range.svg` (~324 units) so the rule
 *  "if you can see the flashlight on you, the Monitor sees you" actually
 *  holds — previous 260 left a sliver where the visual cone landed on the
 *  player but the server didn't react, which is what made the Monitor
 *  feel "blind" up close. */
const CONE_LEN = 330;
/** Half-angle of the cone in radians (~35°). Slightly wider than the
 *  visual SVG (~33°) to forgive minor pose drift. */
const CONE_HALF = 0.62;
/** Proximity detection: if any alive player is within this many units of
 *  the Monitor, regardless of cone direction, the Monitor instantly turns
 *  to face them and locks. Stops the "I'm hugging the rabbit, why won't
 *  he see me" failure mode. */
const NEAR_RADIUS = 95;
/** How fast the Monitor sweeps its head when patrolling, in rad/s. Up
 *  from 1.0 → 1.6 (~92°/s) so the cone passes over the same spot every
 *  ~4 s instead of every ~6 s. */
const SWEEP_RATE = 1.6;
/** How fast the Monitor's aim snaps to a freshly-noticed nearby player.
 *  Higher than the locked-chase rate (8 rad/s) because "you walked next
 *  to the rabbit" should read as "INSTANT spot, not gradual rotate." */
const NEAR_TURN_RATE = 12;
const CHAL_MAX = 8;
const MONITOR_TICK_MS = 100;
/** Scaling rule: 1 monitor per N humans, minimum 1.  GDD: "every 5 players,
 *  add another supervisor".  Bumped down or up by `_recomputeMonitorRoster()`
 *  on game start + every JOIN/onClose while a round is live. */
const PLAYERS_PER_MONITOR = 5;
/** Hard ceiling so a flooded room (or AI-bot stress test pushing past 20)
 *  doesn't end up with more flashlights than there is map.  Matches the
 *  MAX_ROOM_PLAYERS / 5 ceiling but kept explicit so changing the cap on
 *  one side doesn't silently change the monitor count. */
const MAX_MONITORS = 6;
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

    /** Small ring buffer of recent camera frames per player, used by the
     *  end-game ceremony as a "fallback burst" so every player tile
     *  cycles SOMETHING even when they triggered zero highlight events
     *  (mouth/shake/blink) during the round.  Sampled every
     *  `RECENT_FRAMES_MIN_GAP_MS` so the saved frames have temporal
     *  spread instead of three near-identical adjacent stills. Capped at
     *  `RECENT_FRAMES_MAX` per player to bound memory + GAME_ENDED size.
     *  @type {Map<string, Array<{dataUrl: string, ts: number}>>} */
    this.recentCameraFramesByPlayerId = new Map();

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

    /** Monotonic counter for monitor_voice ids when no audio hash is available. */
    this._monitorVoiceSeq = 0;

    /**
     * Server-authoritative Monitor (AI flashlight) roster.  Multiple monitors
     * scale with the human player count via `_recomputeMonitorRoster()`
     * (1 per `PLAYERS_PER_MONITOR`, capped at `MAX_MONITORS`).  Each entry
     * ticks independently at MONITOR_TICK_MS and the full list is broadcast
     * so every phone + the OB tab render the same N flashlights.
     *
     * Empty between rounds; populated when the game starts and adjusted on
     * JOIN / onClose while a round is live.  Ids are `m0`..`m{N-1}` so the
     * iframe can upsert by id without rebuilding nodes every frame.
     *
     * @type {Array<{
     *   id: string, x: number, y: number, aimAngle: number,
     *   mode: "sweep"|"locked", moving: boolean, targetId: string|null,
     *   lockTimer: number, sweepDir: 1|-1, sweepTimer: number,
     *   patrolTarget: {x:number,y:number}|null, patrolTimer: number,
     *   lured: {x:number,y:number}|null, retargetIn: number
     * }>}
     */
    this.monitors = [];

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

  /**
   * Build a fresh monitor record for slot index `slot` out of `total` total.
   * Spawns are spread around the map center on a circle so multiple monitors
   * don't overlap on game start (would look like one fat flashlight).  Slot 0
   * sits at the legacy single-monitor pose (top-center) so a 1-monitor room
   * matches the old behaviour byte-for-byte.
   */
  _makeMonitor(id, slot, total) {
    if (total <= 1) {
      return {
        id,
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
    // Spread around a ring centered on the map. Start at the top so slot 0
    // is roughly where the single-monitor build used to spawn.
    const angle = -Math.PI / 2 + (slot / total) * Math.PI * 2;
    const radius = 320;
    const x = Math.max(MAP_BORDER, Math.min(MAP_W_MS - MAP_BORDER, CX_MS + Math.cos(angle) * radius));
    const y = Math.max(MAP_BORDER, Math.min(MAP_H_MS - MAP_BORDER, CY_MS + Math.sin(angle) * radius));
    return {
      id,
      x,
      y,
      aimAngle: angle,            // each monitor starts looking outward
      mode: "sweep",
      moving: false,
      targetId: null,
      lockTimer: 0,
      sweepDir: slot % 2 === 0 ? 1 : -1, // alternate scan dir so they don't sync up
      sweepTimer: 1 + Math.random() * 2,
      patrolTarget: null,
      patrolTimer: 0,
      lured: null,
      retargetIn: 0
    };
  }

  /** GDD scaling rule: 1 monitor per PLAYERS_PER_MONITOR humans, min 1, capped. */
  _targetMonitorCount() {
    const humans = this._humanPlayerCount();
    const target = Math.max(1, Math.ceil(humans / PLAYERS_PER_MONITOR));
    return Math.min(MAX_MONITORS, target);
  }

  /**
   * Add or remove monitors so `this.monitors.length === _targetMonitorCount()`.
   * Idempotent + incremental: existing entries keep their pose / lock state, so
   * a mid-round JOIN that triggers a new spawn doesn't yank flashlights off
   * the players the existing monitors were already chasing.  Only called while
   * the round is started; bails otherwise.
   */
  _recomputeMonitorRoster() {
    if (!this.started) return;
    const target = this._targetMonitorCount();
    const current = this.monitors.length;
    if (current === target) return;
    if (current < target) {
      for (let slot = current; slot < target; slot++) {
        this.monitors.push(this._makeMonitor(`m${slot}`, slot, target));
      }
    } else {
      // Drop the highest-index monitors. They're the most recently spawned,
      // so removing them is least disruptive (a monitor that's been chasing
      // someone for the last 30s sits at a low index and stays).
      while (this.monitors.length > target) {
        this.monitors.pop();
      }
    }
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
    if (this._aiBots.size >= MAX_AI_BOTS) return null;
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
    this.recentCameraFramesByPlayerId.delete(id);
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

        // Try to reclaim a stale slot owned by the SAME name before reaping.
        // Mobile clients reconnect with a fresh conn.id every time the WS
        // drops (background tab, lock screen, network blip), so without
        // this, the server treats every reconnect as a brand-new player —
        // erasing the assigned animal / verdict / lives / ready flag and
        // making other phones render the player with the wrong sprite.
        // We skip this for OB / AI: OB tabs are name-collision-prone (often
        // all literally "ob") and AI ids never collide with human conns.
        const isObConn = name.toLowerCase() === "ob";
        if (!isObConn && !this.players.get(conn.id)) {
          this._reclaimStaleSlotByName(name, conn.id);
        }

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
          // If this came from `_reclaimStaleSlotByName` the player already
          // has an animal + rules card; resend it so the freshly-reconnected
          // tab restores the role HUD without redoing onboarding.
          if (existing.animal) {
            try {
              conn.send(JSON.stringify({
                type: ServerEventTypes.PRIVATE_RULES_CARD,
                data: this._rulesCardFor(existing)
              }));
            } catch {
              /* ignore — best-effort restore */
            }
          }
        } else if (!isObConn && this._humanPlayerCount() >= MAX_ROOM_PLAYERS) {
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
          // Mid-round join: a 6th human means a 2nd supervisor spawns now,
          // an 11th means a 3rd, etc.  No-op pre-round (`started === false`).
          this._recomputeMonitorRoster();
        }

        this._sendRoomSnapshot();
        // A new human joining bumps the participant total — if the round
        // is already live, scale the rabbit pack to match.
        this._syncLiveMonitorCount();
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
        if (this.started) {
          // Surface the rejection so the client toast / Start button can
          // un-busy itself. Without this, the OB sees "Start game" do nothing.
          conn.send(JSON.stringify({ type: "error", error: "already_started" }));
          return;
        }
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
        this.monitors = [];
        this._recomputeMonitorRoster();
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
        // Also append to the rolling fallback-burst buffer used by the
        // end-game ceremony so even players with zero highlight events get
        // an animated class-photo tile instead of a single still image.
        // We sample at most 1 frame per RECENT_FRAMES_MIN_GAP_MS to keep
        // the burst visually distinct (≈3 frames spread over ~3 s).
        const buf = this.recentCameraFramesByPlayerId.get(conn.id) ?? [];
        const lastSample = buf[buf.length - 1];
        if (!lastSample || ts - lastSample.ts >= RECENT_FRAMES_MIN_GAP_MS) {
          buf.push({ dataUrl, ts });
          if (buf.length > RECENT_FRAMES_MAX) buf.shift();
          this.recentCameraFramesByPlayerId.set(conn.id, buf);
        }
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
        // AI bots have their own budget (`MAX_AI_BOTS`) and do NOT eat into
        // the human-player cap, so spawning bots for testing won't lock out
        // real players who try to join afterwards.
        const aiSlotsLeft = Math.max(0, MAX_AI_BOTS - this._aiBots.size);
        const count = Number.isFinite(requested) && requested > 0
          ? Math.min(aiSlotsLeft, Math.floor(requested))
          : Math.min(aiSlotsLeft, 4);
        if (count <= 0) return;
        for (let i = 0; i < count; i++) {
          this._spawnAiBot();
        }
        this._ensureAiTick();
        this._sendRoomSnapshot();
        // AI counts toward monitor scaling, so a mid-round "spawn AI" call
        // (or even a pre-round one if the host spawns bots after Start) has
        // to re-evaluate the rabbit pack. No-op when not started.
        this._syncLiveMonitorCount();
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
        this._syncLiveMonitorCount();
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
        this.recentCameraFramesByPlayerId.delete(targetId);
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
        // Mirror onClose: keep the supervisor count in step with the
        // post-kick headcount.
        if (this.started) this._recomputeMonitorRoster();
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
        this.monitors = [];
        this._recomputeMonitorRoster();
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

      case ClientMessageTypes.GATE_PROGRESS: {
        // Live "Final Check" progress relayed to OB so the lobby spotlight can
        // show real captured-action data while the player is testing their
        // camera. Sender must be a known player; payload is sanitized + the
        // server stamps `playerId` from the conn (clients can't spoof another
        // player's progress). Throttled at ~5 Hz per player to cap traffic.
        const player = this.players.get(conn.id);
        if (!player) return;
        // Server-side throttle: drop bursts under 150 ms apart per player so
        // a buggy client can't flood the room.
        const now = Date.now();
        const last = this._gateProgressLastTs?.get(conn.id) ?? 0;
        if (now - last < 150) return;
        if (!this._gateProgressLastTs) this._gateProgressLastTs = new Map();
        this._gateProgressLastTs.set(conn.id, now);
        const c = msg && typeof msg === "object" ? msg : {};
        const sh = c.shake && typeof c.shake === "object" ? c.shake : {};
        const mo = c.mouth && typeof c.mouth === "object" ? c.mouth : {};
        const ey = c.eyes && typeof c.eyes === "object" ? c.eyes : {};
        const clamp01 = (v) => {
          const n = Number(v);
          if (!Number.isFinite(n)) return 0;
          if (n < 0) return 0;
          if (n > 1) return 1;
          return n;
        };
        const safeInt = (v, max = 9999) => {
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0) return 0;
          return Math.min(max, Math.floor(n));
        };
        const data = {
          playerId: conn.id,
          ts: now,
          active: c.active === true,
          shake: {
            done: sh.done === true,
            count: safeInt(sh.count, 999),
            progress: clamp01(sh.progress)
          },
          mouth: {
            done: mo.done === true,
            openFrames: safeInt(mo.openFrames, 9999),
            progress: clamp01(mo.progress)
          },
          eyes: {
            done: ey.done === true,
            holdMs: safeInt(ey.holdMs, 60_000),
            progress: clamp01(ey.progress)
          }
        };
        this.party.broadcast(
          JSON.stringify({ type: ServerEventTypes.GATE_PROGRESS, data }),
          [conn.id]
        );
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
          conn.send(
            JSON.stringify({
              type: ServerEventTypes.MAIN_SCENE_ITEMS_RESYNC,
              data: { removedItemIds: Array.from(this.mainSceneItemsRemoved) }
            })
          );
          return;
        }
        this.mainSceneItemsRemoved.add(itemId);
        const meta = this._mainSceneItemRegistry.get(itemId);
        // Heart restores 1 HP (capped at 3 — GDD).
        if (meta.type === "heart" && player.lives < 3) {
          player.lives += 1;
          this._broadcast(ServerEventTypes.PLAYER_UPDATED, this._publicPlayer(player));
        }
        // Alarm: lure the NEAREST monitor toward the pickup site server-side,
        // so every client sees the same diversion (was previously each
        // client's own independent monitor reacting locally).  With multiple
        // monitors we pick just the closest one — distractions read better as
        // "that one supervisor heard it" than every flashlight pivoting in
        // unison.
        if (meta.type === "alarm") {
          let nearest = null;
          let bestD = Infinity;
          for (const mon of this.monitors) {
            const d = Math.hypot(mon.x - meta.x, mon.y - meta.y);
            if (d < bestD) { bestD = d; nearest = mon; }
          }
          if (nearest) {
            nearest.lured = { x: meta.x, y: meta.y };
            nearest.retargetIn = 4;
            nearest.mode = "sweep";
            nearest.targetId = null;
          }
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
    this.recentCameraFramesByPlayerId.delete(conn.id);
    this._lastMainSceneAt.delete(conn.id);
    this._avatarByPlayerId.delete(conn.id);
    if (this._gateProgressLastTs) this._gateProgressLastTs.delete(conn.id);
    // Notify OB so the lobby spotlight panel doesn't hang on stale gate data
    // (the live action bars / counters belong to a player who's now gone).
    this.party.broadcast(
      JSON.stringify({
        type: ServerEventTypes.GATE_PROGRESS,
        data: {
          playerId: conn.id,
          ts: Date.now(),
          active: false,
          shake: { done: false, count: 0, progress: 0 },
          mouth: { done: false, openFrames: 0, progress: 0 },
          eyes: { done: false, holdMs: 0, progress: 0 }
        }
      })
    );

    this._broadcast(ServerEventTypes.SYSTEM, {
      code: "PLAYER_LEFT",
      params: { name: player.name }
    });
    this._sendRoomSnapshot();

    // When the last human leaves a started round, terminate it so the monitor
    // tick stops and `started` flips back to false. Otherwise the DO ticks at
    // 10 Hz forever and the next joiner is stranded in a stale game. AI bots
    // are server-puppets, not real attendees — they should not keep a ghost
    // round alive.
    if (this.started) {
      const realRemaining = Array.from(this.players.values())
        .filter((p) => !this._aiBots.has(p.id)).length;
      if (realRemaining === 0) {
        this._endGame();
      } else {
        // Otherwise keep the supervisor count in step with the new headcount
        // (e.g. dropping from 6→5 humans removes the 2nd monitor mid-round).
        this._recomputeMonitorRoster();
      }
    }
  }

  /**
   * Counts only "real" human players for capacity decisions.  Excludes AI
   * bots (id-prefixed `ai_`) and OB observer tabs (lowercased name === "ob").
   * Used by JOIN's room-full check and the AI-spawn budget so that opening
   * spectator tabs or filling the map with AI never forces real players out
   * of the lobby.
   */
  _humanPlayerCount() {
    let n = 0;
    for (const p of this.players.values()) {
      if (this._aiBots.has(p.id)) continue;
      if (typeof p.name === "string" && p.name.toLowerCase() === "ob") continue;
      n++;
    }
    return n;
  }

  /**
   * Look for a player slot whose `name` matches `name` (exact, case-sensitive)
   * but whose conn.id is NOT in active connections. If found, re-key it to
   * `newConnId` so the reconnecting client picks up exactly where they left
   * off — animal, rules, lives, ready flag, even highlight bursts. Side
   * maps (avatar bytes, last camera frame, last main-scene ts, owl guesses,
   * monitor lock-time, AI motion, _aiBots, _gateProgressLastTs, player
   * positions) are all migrated atomically.
   *
   * Returns true when a reclaim happened.
   */
  _reclaimStaleSlotByName(name, newConnId) {
    if (typeof this.party.getConnections !== "function") return false;
    const live = new Set();
    for (const c of this.party.getConnections()) live.add(c.id);
    let staleId = null;
    for (const [pid, p] of this.players.entries()) {
      if (this._aiBots.has(pid)) continue;
      if (p.name !== name) continue;
      if (live.has(pid)) continue; // someone else is genuinely connected with this id
      staleId = pid;
      break;
    }
    if (!staleId) return false;
    if (staleId === newConnId) return false;

    // Re-key the player object itself.
    const player = this.players.get(staleId);
    this.players.delete(staleId);
    player.id = newConnId;
    this.players.set(newConnId, player);

    // Move every per-player side map keyed by id. Anything missing the key
    // is silently a no-op (the .get just returns undefined).
    const moveOnMap = (m) => {
      if (!m || typeof m.get !== "function" || typeof m.set !== "function") return;
      const v = m.get(staleId);
      if (v === undefined) return;
      m.delete(staleId);
      m.set(newConnId, v);
    };
    moveOnMap(this.owlGuessesByPlayerId);
    moveOnMap(this.lastCameraFrameByPlayerId);
    moveOnMap(this.recentCameraFramesByPlayerId);
    moveOnMap(this._lastMainSceneAt);
    moveOnMap(this._avatarByPlayerId);
    moveOnMap(this._monitorLastLockAt);
    moveOnMap(this._playerPositions);
    if (this._gateProgressLastTs) moveOnMap(this._gateProgressLastTs);

    // Avatar URL was minted with the OLD conn.id baked in; rewrite it so
    // the restored client can keep loading the portrait.
    if (player.avatarUrl && typeof player.avatarUrl === "string") {
      const oldFrag = `id=${encodeURIComponent(staleId)}`;
      const newFrag = `id=${encodeURIComponent(newConnId)}`;
      if (player.avatarUrl.includes(oldFrag)) {
        player.avatarUrl = player.avatarUrl.replace(oldFrag, newFrag);
      }
    }
    return true;
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
      this.recentCameraFramesByPlayerId.delete(pid);
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
    // Mirror of the onClose end-on-empty: if the reaper just emptied a started
    // room (mobile-bg path where onClose never fired), terminate the round so
    // the monitor tick stops.
    if (this.started) {
      const realRemaining = Array.from(this.players.values())
        .filter((p) => !this._aiBots.has(p.id)).length;
      if (realRemaining === 0) {
        this._endGame();
      } else if (changed) {
        // Stale-slot reaper just dropped at least one player — resync the
        // supervisor count along with the cleaned-up roster.
        this._recomputeMonitorRoster();
      }
    }
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
      this._tickMonitors(dt);
      this._broadcastMonitorState();
    }, MONITOR_TICK_MS);
  }
  _stopMonitorTick() {
    if (this._monitorTick) {
      clearInterval(this._monitorTick);
      this._monitorTick = null;
    }
  }
  /** Total participants for monitor scaling: every real human + every AI
   *  bot. OB observer tabs are excluded (they don't take a player slot). */
  _participantCountForMonitors() {
    let n = 0;
    for (const p of this.players.values()) {
      if (typeof p.name === "string" && p.name.toLowerCase() === "ob") continue;
      n++;
    }
    return n;
  }

  /** Desired Monitor count given current participants. 1 per
   *  `PLAYERS_PER_MONITOR` total players, but never less than 1 (the
   *  primary ZooKeeper is always present so empty / tiny rooms still get
   *  the supervision flavor). Rabbit count = this minus 1, capped. */
  _desiredMonitorCount() {
    const total = this._participantCountForMonitors();
    const ratio = Math.floor(total / PLAYERS_PER_MONITOR);
    const want = Math.max(1, ratio);
    return Math.min(1 + MAX_EXTRA_MONITORS, want);
  }

  /** Refresh the monitor roster at game-start. Always keeps a primary
   *  ZooKeeper at index 0; appends rabbit Monitors based on
   *  `_desiredMonitorCount()`. */
  _resetMonitorsForRound() {
    const want = this._desiredMonitorCount();
    const extras = Math.max(0, want - 1);
    this.monitors = [this._initialMonitorState({ id: "main", kind: "main", spawnSlot: 0 })];
    for (let i = 0; i < extras; i++) {
      this.monitors.push(
        this._initialMonitorState({
          id: `rabbit_${i + 1}`,
          kind: "rabbit",
          spawnSlot: i + 1
        })
      );
    }
  }

  /** Adjust the live monitor roster mid-round to match `_desiredMonitorCount()`.
   *  Adds new rabbits at the back of the list, drops the rightmost rabbits
   *  when the headcount falls. The primary ZooKeeper is never touched.
   *  No-op when not started — `_resetMonitorsForRound()` already handles
   *  the pre-game / start-of-round case. */
  _syncLiveMonitorCount() {
    if (!this.started) return;
    const want = this._desiredMonitorCount();
    const have = this.monitors.length;
    if (have === want) return;
    if (have < want) {
      for (let i = have; i < want; i++) {
        // Pick a fresh id; reuse the next free `rabbit_N` slot so OB / clients
        // can dedupe by id across reconciliations.
        let n = i;
        let id = `rabbit_${n}`;
        while (this.monitors.some((m) => m.id === id)) {
          n++;
          id = `rabbit_${n}`;
        }
        this.monitors.push(
          this._initialMonitorState({ id, kind: "rabbit", spawnSlot: i })
        );
      }
    } else {
      // Drop trailing rabbits, never the primary at index 0.
      this.monitors = this.monitors.slice(0, Math.max(1, want));
    }
    // Push an immediate broadcast so clients re-render flashlights
    // without waiting for the next ~100ms tick.
    this._broadcastMonitorState();
  }
  _broadcastMonitorState() {
    this._broadcast(ServerEventTypes.MONITOR_STATE, {
      monitors: this.monitors.map((m) => ({
        id: m.id,
        x: m.x,
        y: m.y,
        aimAngle: m.aimAngle,
        mode: m.mode,
        moving: m.moving,
        targetId: m.targetId,
        lured: m.lured ? { x: m.lured.x, y: m.lured.y } : null
      })),
      ts: Date.now()
    });
  }
  _tickMonitors(dt) {
    for (const m of this.monitors) {
      this._tickMonitor(dt, m);
    }
  }
  _tickMonitor(dt, m) {
    const wrap = (a) => {
      while (a > Math.PI) a -= 2 * Math.PI;
      while (a < -Math.PI) a += 2 * Math.PI;
      return a;
    };
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const inCone = (mx, my, ang, px, py) => {
      const dx = px - mx, dy = py - my;
      const d = Math.hypot(dx, dy);
      if (d > CONE_LEN || d < 0.5) return false;
      let bear = Math.atan2(dy, dx) - ang;
      bear = ((bear + Math.PI) % (2 * Math.PI)) - Math.PI;
      return Math.abs(bear) <= CONE_HALF;
    };

    // Build the alive-player roster once per tick — used by every detection
    // path below (cone, proximity, lure-passthrough). Skips dead players
    // and any cached positions whose owner already left the room.
    const alivePlayers = [];
    for (const [pid, pos] of this._playerPositions.entries()) {
      const player = this.players.get(pid);
      if (!player || !player.alive) continue;
      alivePlayers.push({ id: pid, x: pos.x, y: pos.y });
    }
    const nearestPlayer = (mx, my, radius) => {
      let best = null;
      let bestD = radius;
      for (const p of alivePlayers) {
        const d = Math.hypot(p.x - mx, p.y - my);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      return best;
    };

    // ----- Alarm lure: tilt toward lure for retargetIn seconds, then resume
    // sweep. Slowed turn rate: 4 rad/s used to feel like a teleport ("AI
    // immediately looks over there"); 1.2 rad/s ≈ 70°/s gives the keeper a
    // deliberate ~1.3 s head turn that reads as "noticing" instead of
    // "snapping". BUT — even while distracted, a player literally hugging
    // the keeper should break the lure and trigger a chase, otherwise the
    // monitor reads as "deaf and blind" while a violator stands next to him.
    if (m.lured) {
      const intruder = nearestPlayer(m.x, m.y, NEAR_RADIUS);
      if (intruder) {
        m.lured = null;
        const desired = Math.atan2(intruder.y - m.y, intruder.x - m.x);
        m.aimAngle += clamp(wrap(desired - m.aimAngle), -NEAR_TURN_RATE * dt, NEAR_TURN_RATE * dt);
        m.targetId = intruder.id;
        m.mode = "locked";
        m.lockTimer = CHAL_MAX;
        this._monitorLastLockAt.set(intruder.id, Date.now());
        return;
      }
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
      // Proximity check FIRST, every tick: if anyone is within NEAR_RADIUS
      // (regardless of where the cone is pointing), the keeper instantly
      // pivots to face them and locks. This is the single biggest fix to
      // the "monitor doesn't even notice me when I'm right next to him"
      // bug — the original logic only locked on cone hits, so walking up
      // from behind / the side was a free pass.
      const intruder = nearestPlayer(m.x, m.y, NEAR_RADIUS);
      if (intruder) {
        const desired = Math.atan2(intruder.y - m.y, intruder.x - m.x);
        m.aimAngle += clamp(wrap(desired - m.aimAngle), -NEAR_TURN_RATE * dt, NEAR_TURN_RATE * dt);
        m.targetId = intruder.id;
        m.mode = "locked";
        m.lockTimer = CHAL_MAX;
        this._monitorLastLockAt.set(intruder.id, Date.now());
        return;
      }

      m.aimAngle += m.sweepDir * SWEEP_RATE * dt;
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
        // Bumped from 0.55x → 0.70x of MON_SPEED so the keeper covers more
        // ground between sweeps and isn't trivially out-walked by a player.
        m.x = clamp(m.x + (pdx / pd) * MON_SPEED * 0.7 * dt, MAP_BORDER, MAP_W_MS - MAP_BORDER);
        m.y = clamp(m.y + (pdy / pd) * MON_SPEED * 0.7 * dt, MAP_BORDER, MAP_H_MS - MAP_BORDER);
      }
      // Cone detect against alive players (already filtered above).
      const eligible = alivePlayers.filter((p) =>
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
    // While the target is within sight (cone OR proximity), keep refreshing
    // the lock timer so a player who fails to break line-of-sight can't just
    // wait out the chase. The lockTimer only really decays when the target
    // has slipped away, giving the keeper a believable "I lost him" timeout.
    const stillSeen =
      dist <= NEAR_RADIUS ||
      inCone(m.x, m.y, m.aimAngle, target.x, target.y);
    if (stillSeen) {
      m.lockTimer = Math.min(CHAL_MAX, m.lockTimer + dt * 1.5);
    }
    // Tighter chase: smaller comfort gap (140) and faster ramp (50) so the
    // keeper actually closes the distance instead of "loitering" 150 units
    // behind a moving target. Speed factor saturates at 1.0 within 50 units
    // of the comfort radius, so the keeper is at full sprint while pursuing.
    const COMFORT = 140;
    const RAMP = 50;
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
    // Drop the supervisor roster so a stale list doesn't leak into the next
    // round — `_recomputeMonitorRoster()` rebuilds it on game start.
    this.monitors = [];
    // Cancel any in-flight respawn timers so they don't fire post-round.
    for (const h of this._itemRespawnTimers.values()) clearTimeout(h);
    this._itemRespawnTimers.clear();
    if (this._endTimer) {
      clearTimeout(this._endTimer);
      this._endTimer = null;
    }

    // Build a metadata-only reveal list for the headline GAME_ENDED.
    // Heavy media (highlight bursts, fallback frames, avatar) ships in
    // separate per-player GAME_ENDED_MEDIA broadcasts below — splitting
    // keeps every WS frame well under PartyKit's ~1 MiB cap even at 20
    // webcam-active players.  A single combined message at that scale
    // would silently fail to broadcast and the ceremony would never
    // appear on clients (the very bug this method now avoids).
    const playerEntries = Array.from(this.players.values());
    const revealList = playerEntries.map((p) => ({
      id: p.id,
      name: p.name,
      animal: p.animal,
      verdict: p.verdict,
      alive: p.alive,
      lives: p.lives,
      violations: p.violations,
      faceCounts: { ...p.faceCounts }
    }));
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
    // Stream per-player media as separate broadcasts — each one carries
    // ONE player's highlight bursts + fallback frames + avatar URL, sized
    // to stay safely under the per-message limit.  Clients merge these
    // into the ceremony tiles as they arrive (progressive enhancement;
    // tiles render with letter fallbacks until their media lands).
    this._broadcastEndGameMedia(playerEntries);

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

  /**
   * Emit one GAME_ENDED_MEDIA broadcast per player, carrying highlight
   * bursts + fallback frames + portrait sources.  Each message is sized
   * via `_pruneMediaToFit` to stay under `MEDIA_SOFT_CAP_BYTES` so even
   * a player with the maximum permitted bursts won't push a single WS
   * frame past PartyKit's per-message limit.  Order isn't significant —
   * clients accumulate them keyed by `playerId` and merge with the
   * already-sent GAME_ENDED reveal entry.
   *
   * @param {Array<Player & { highlights: { mouth: string[][], shake: string[][], blink: string[][] } }>} playerEntries
   */
  _broadcastEndGameMedia(playerEntries) {
    for (const p of playerEntries) {
      const lastFrame = this.lastCameraFrameByPlayerId.get(p.id);
      const recentBuf = this.recentCameraFramesByPlayerId.get(p.id) ?? [];
      const fallbackBurst = recentBuf.map((f) => f.dataUrl);
      const media = {
        playerId: p.id,
        highlights: {
          mouth: p.highlights.mouth.map((b) => b.slice()),
          shake: p.highlights.shake.map((b) => b.slice()),
          blink: p.highlights.blink.map((b) => b.slice())
        },
        avatarUrl: p.avatarUrl ?? null,
        lastFrame: lastFrame ? lastFrame.dataUrl : null,
        fallbackBurst
      };
      const safeMedia = this._pruneMediaToFit(media);
      this._broadcast(ServerEventTypes.GAME_ENDED_MEDIA, safeMedia);
    }
  }

  /**
   * Progressive media sizer: if the JSON-serialized payload is over
   * MEDIA_SOFT_CAP_BYTES (≈ 800 KiB, leaves ~200 KiB headroom under the
   * 1 MiB per-message limit), strip the heaviest contributions in priority
   * order until it fits.  We keep the cheapest "always show something"
   * portrait sources (lastFrame, then avatarUrl) and degrade the bursts
   * first because the ceremony tolerates fewer/smaller bursts gracefully.
   *
   * Strip order:
   *   1. Drop fallbackBurst entirely (least-loved tile fallback)
   *   2. Trim each highlight kind to 1 burst
   *   3. Trim each remaining burst to 1 frame
   *   4. Drop avatarUrl (lastFrame remains as portrait)
   *   5. Drop lastFrame (final degraded mode: letter tile)
   *
   * Returns the original `media` object reference if it already fits.
   */
  _pruneMediaToFit(media) {
    const SOFT_CAP = 800 * 1024;
    const sizeOf = (obj) => {
      try {
        return JSON.stringify(obj).length;
      } catch {
        return Number.POSITIVE_INFINITY;
      }
    };
    if (sizeOf(media) <= SOFT_CAP) return media;
    let pruned = { ...media, fallbackBurst: [] };
    if (sizeOf(pruned) <= SOFT_CAP) return pruned;
    pruned = {
      ...pruned,
      highlights: {
        mouth: pruned.highlights.mouth.slice(0, 1),
        shake: pruned.highlights.shake.slice(0, 1),
        blink: pruned.highlights.blink.slice(0, 1)
      }
    };
    if (sizeOf(pruned) <= SOFT_CAP) return pruned;
    pruned = {
      ...pruned,
      highlights: {
        mouth: pruned.highlights.mouth.map((b) => b.slice(0, 1)),
        shake: pruned.highlights.shake.map((b) => b.slice(0, 1)),
        blink: pruned.highlights.blink.map((b) => b.slice(0, 1))
      }
    };
    if (sizeOf(pruned) <= SOFT_CAP) return pruned;
    pruned = { ...pruned, avatarUrl: null };
    if (sizeOf(pruned) <= SOFT_CAP) return pruned;
    pruned = { ...pruned, lastFrame: null };
    return pruned;
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

