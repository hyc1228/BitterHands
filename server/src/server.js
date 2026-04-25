import { Animals, ClientMessageTypes, ServerEventTypes } from "./protocol.js";

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

        const existing = this.players.get(conn.id);
        if (existing) {
          existing.name = name;
          this._broadcast(ServerEventTypes.PLAYER_UPDATED, this._publicPlayer(existing));
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
            joinedAt: Date.now()
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

        // GDD: client uploads base64 photo; server calls Claude Vision -> "impression"
        // For now we store a placeholder so the rest of the flow can run.
        player.impression = "（外貌印象：待接入 Vision）";
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

        player.answers = answers;

        // GDD: server calls Claude (text) to decide animal + verdict.
        // For now: deterministic fallback mapping by majority choice.
        const animal = this._fallbackAnimalFromAnswers(answers);
        player.animal = animal;
        player.verdict = this._fallbackVerdict(animal);

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
      violations: p.violations
    };
  }

  _publicSnapshot() {
    return {
      roomId: this.party.id,
      started: this.started,
      startedAt: this.startedAt,
      durationMs: this.durationMs,
      players: Array.from(this.players.values()).map((p) => this._publicPlayer(p))
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

  _fallbackVerdict(animal) {
    if (animal === Animals.LION) return "你的声音能让黑暗退开。";
    if (animal === Animals.OWL) return "你从不放过任何细节。";
    if (animal === Animals.GIRAFFE) return "有什么东西已经开始改变你了。";
    return "动物园还没看清你。";
  }

  _rulesCardFor(player) {
    const animal = player.animal;
    const teammates = Array.from(this.players.values())
      .filter((p) => p.id !== player.id && p.animal && p.animal === animal)
      .map((p) => ({ id: p.id, name: p.name }));

    if (animal === Animals.LION) {
      return {
        animal,
        emoji: "🦁",
        verdict: player.verdict,
        rule: "你必须每隔 60 秒发出一次持续 ≥2 秒的低吼。沉默太久，“它”会认为你已经离开。",
        win: "让至少 1 名长颈鹿玩家违规累计 3 次（净化）。白狮子全员完成才算胜利。",
        teammates
      };
    }
    if (animal === Animals.OWL) {
      return {
        animal,
        emoji: "🦉",
        verdict: player.verdict,
        rule: "每 40 秒触发一次检测窗口，窗口内 5 秒不能眨眼。如果你眨了眼，“它”就看见你了。",
        win: "结算时正确猜出所有其他玩家的动物身份。猫头鹰全员猜对才算胜利。",
        teammates: [] // per GDD: owl doesn't know other owls
      };
    }
    if (animal === Animals.GIRAFFE) {
      return {
        animal,
        emoji: "🦒",
        verdict: player.verdict,
        rule: "你必须每隔 45 秒做一次甩脖子（头部大幅横向摆动）。停止太久，“它”会把你清除。",
        win: "让至少 1 名白狮子玩家违规死亡。长颈鹿任意 1 人存活即算胜利。",
        teammates
      };
    }
    return { animal: null, emoji: "❓", verdict: null, rule: "", win: "", teammates };
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

