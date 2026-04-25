import { Animals, ClientMessageTypes, ServerEventTypes } from "./protocol.js";
import { fnv1a32, pickLooksRoast, similarityPercentFor } from "./photoAnalysis.js";

/** Max players (JOIN) per room — matches GDD 5–10; hard cap 10. */
const MAX_ROOM_PLAYERS = 10;

/** Must match `main scene/index.html` MAP_W / MAP_H and `state.items` ids/positions. */
const MAP_W_MS = 1080;
const MAP_H_MS = 1500;
const CX_MS = MAP_W_MS / 2;
const CY_MS = MAP_H_MS / 2;
const MAIN_SCENE_ITEM_DEFS = [
  { id: "h1", type: "heart", x: CX_MS - 80, y: CY_MS - 340 },
  { id: "h2", type: "heart", x: CX_MS - 320, y: CY_MS - 60 },
  { id: "h3", type: "heart", x: CX_MS + 270, y: CY_MS + 380 },
  { id: "a1", type: "alarm", x: CX_MS + 140, y: CY_MS + 40 },
  { id: "a2", type: "alarm", x: CX_MS - 200, y: CY_MS + 220 },
  { id: "a3", type: "alarm", x: CX_MS + 320, y: CY_MS - 260 }
];

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
    this.durationMs = 4 * 60 * 1000;

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
  }

  /**
   * SPA static hosting serves the React shell for `*.html` when the file is not matched first.
   * The main-scene iframe is `nz-scene.html` in the deploy bundle; load it from the asset store.
   * @param {import("partykit/server").Request} req
   * @param {import("partykit/server").FetchLobby} lobby
   * @param {import("partykit/server").ExecutionContext} _ctx
   */
  /**
   * SPA mode is off (we use HashRouter so `/` is the only HTML page the browser requests).
   * PartyKit static auto-serves `*.html` as text/html; we only need to handle the bare `/`.
   * @param {import("partykit/server").Request} req
   * @param {import("partykit/server").FetchLobby} lobby
   * @param {import("partykit/server").ExecutionContext} _ctx
   */
  static async onFetch(req, lobby, _ctx) {
    if (req.method !== "GET" && req.method !== "HEAD") return;
    const url = new URL(req.url);
    if (url.pathname === "/") {
      const r = await lobby.assets.fetch("/index.html");
      if (r && r.ok) return r;
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
            photoSeed: undefined
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
          params: { name: player.name },
          message: `${player.name} 已提交照片`
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
          params: { name: player.name, animal: animal },
          message: `${player.name} 已进入 ${this._animalEmoji(animal)} 区域`
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

      case ClientMessageTypes.START: {
        if (this.started) return;
        this.started = true;
        this.startedAt = Date.now();
        this.mainSceneItemsRemoved = new Set();

        this._broadcast(ServerEventTypes.GAME_STARTED, {
          startedAt: this.startedAt,
          durationMs: this.durationMs
        });

        this._broadcast(ServerEventTypes.SYSTEM, { message: "游戏开始" });
        this._sendRoomSnapshot();
        return;
      }

      case ClientMessageTypes.VIOLATION: {
        const player = this.players.get(conn.id);
        if (!player || !player.alive) return;

        player.violations += 1;
        player.lives = Math.max(0, player.lives - 1);
        player.alive = player.lives > 0;

        const violationText =
          typeof msg?.detail === "string"
            ? msg.detail.slice(0, 120)
            : "触犯了守则";

        // Public narrative (GDD: should be Claude generated). Stub for now.
        this._broadcast(ServerEventTypes.VIOLATION_NARRATIVE, {
          playerId: player.id,
          playerName: player.name,
          animal: player.animal,
          text: `【${player.name}】${violationText}。动物园的黑暗似乎更近了一点。`
        });

        // Simple "净化" counter hook for giraffe (GDD: giraffe 3 violations =>净化)
        // We'll just announce it; detailed win logic can be added later.
        if (player.animal === Animals.GIRAFFE && player.violations >= 3) {
          this._broadcast(ServerEventTypes.SYSTEM, {
            code: "GIRAFFE_PURIFIED",
            params: { name: player.name },
            message: `${player.name} 的感染似乎被“净化”了（累计违规 3 次）`
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
        this._broadcast(ServerEventTypes.CAMERA_FRAME, {
          playerId: conn.id,
          playerName: player.name,
          dataUrl,
          ts
        });
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

      case ClientMessageTypes.MAIN_SCENE_STATE: {
        if (!this.started) return;
        const player = this.players.get(conn.id);
        if (!player) return;
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
        const payload = {
          playerId: conn.id,
          x: clampPos(x),
          y: clampPos(y),
          vx: clampVel(Number(msg?.vx)),
          vy: clampVel(Number(msg?.vy)),
          moving: Boolean(msg?.moving),
          animKey: typeof msg?.animKey === "string" ? msg.animKey.slice(0, 48) : "idle",
          facing: typeof msg?.facing === "number" && Number.isFinite(msg.facing) ? msg.facing : 0,
          t: now,
          fx: msg?.fx && typeof msg.fx === "object" ? msg.fx : null
        };
        this._broadcast(ServerEventTypes.MAIN_SCENE_BROADCAST, payload);
        return;
      }

      case ClientMessageTypes.MAIN_SCENE_ITEM_PICKUP: {
        if (!this.started) return;
        const player = this.players.get(conn.id);
        if (!player) return;
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
        this._broadcast(ServerEventTypes.MAIN_SCENE_ITEM_TAKEN, {
          itemId,
          itemType: meta.type,
          byPlayerId: conn.id,
          alarmLured: meta.type === "alarm" ? { x: meta.x, y: meta.y } : null
        });
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
      params: { name: player.name },
      message: `${player.name} 离开了房间`
    });
    this._sendRoomSnapshot();
  }

  async onRequest(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
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

  _endGame() {
    if (!this.started) return;
    this.started = false;

    this._broadcast(ServerEventTypes.GAME_ENDED, {
      endedAt: Date.now(),
      reveal: Array.from(this.players.values()).map((p) => ({
        id: p.id,
        name: p.name,
        animal: p.animal,
        verdict: p.verdict
      })),
      owlGuesses: Object.fromEntries(this.owlGuessesByPlayerId.entries())
    });
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
      avatarUrl: p.avatarUrl ?? null
    };
  }

  _publicSnapshot() {
    return {
      roomId: this.party.id,
      started: this.started,
      startedAt: this.startedAt,
      durationMs: this.durationMs,
      players: Array.from(this.players.values()).map((p) => this._publicPlayer(p)),
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

