import { create } from "zustand";
import { animalLocalized } from "../i18n";
import {
  Animals,
  ClientMessageTypes,
  type AnimalCode,
  type CameraFrame,
  type GameEnded,
  type Lang,
  type OwlRosterEntry,
  type PublicPlayer,
  type RoomSnapshot,
  type MainSceneItemInboxEntry,
  type MainSceneItemTaken,
  type MainScenePeerState,
  type MonitorVoiceMessage,
  type RulesCard,
  type ServerEnvelope,
  ServerEventTypes
} from "./protocol";

export type ConnState = "idle" | "connecting" | "open" | "closed" | "error";
export type Mode = "player" | "ob";

export interface LogEntry {
  ts: number;
  kind: "system" | "chat" | "narrative" | "private" | "info";
  text: string;
}

interface PartyStoreState {
  mode: Mode;
  conn: ConnState;
  ws: WebSocket | null;
  roomId: string | null;
  myName: string;
  lang: Lang;
  rulesCard: RulesCard | null;
  owlRoster: OwlRosterEntry[] | null;
  myAnimal: AnimalCode | null;
  snapshot: RoomSnapshot | null;
  log: LogEntry[];
  cameraFrames: Map<string, CameraFrame>;
  // Onboarding lifecycle helpers
  photoSubmitted: boolean;
  answersSubmitted: boolean;
  /** Set when server sends `{ type: "error" }` (e.g. room_full). */
  connectError: string | null;
  /** Latest main-scene pose per connection id (from `main_scene_broadcast`). */
  mainScenePeers: Record<string, MainScenePeerState>;
  mainSceneItemInbox: MainSceneItemInboxEntry[];
  drainMainSceneItemInbox: () => MainSceneItemInboxEntry[];
  /** Push-only inbox of Monitor PA broadcasts; the audio hook drains this. */
  monitorVoiceInbox: MonitorVoiceMessage[];
  drainMonitorVoiceInbox: () => MonitorVoiceMessage[];
  /** Last GAME_ENDED payload — drives the settlement overlay; null between matches. */
  gameEnded: GameEnded | null;
  clearGameEnded: () => void;
  // Actions
  setLang: (lang: Lang) => void;
  setName: (name: string) => void;
  setMode: (mode: Mode) => void;
  connect: (opts: { roomId: string; name: string; lang: Lang; mode?: Mode }) => Promise<void>;
  disconnect: () => void;
  /** @returns true if the message was sent; false if socket not open (caller should show error) */
  send: (type: string, payload?: Record<string, unknown>) => boolean;
  /** Clear assignment UI state before a new onboarding / resubmit. */
  clearOnboardingAssignment: () => void;
  pushLog: (entry: Omit<LogEntry, "ts"> & { ts?: number }) => void;
  clearConnectError: () => void;
  reset: () => void;
}

const DEFAULT_APP_LANG: Lang = "en";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem("nz.lang");
    if (saved === "en" || saved === "zh") return saved;
  } catch {
    /* ignore */
  }
  // Default UI language: English (switch with bottom-right control; persists as `nz.lang`).
  return DEFAULT_APP_LANG;
}

const ENV_LANG: Lang = initialLang();

function partykitHostFromEnv(): string | null {
  const raw = import.meta.env.VITE_PARTYKIT_HOST;
  if (raw == null || String(raw).trim() === "") return null;
  let h = String(raw).trim();
  h = h.replace(/^(wss?|https?):\/\//i, "");
  h = h.split("/")[0] ?? h;
  return h;
}

/**
 * Stable per-browser id used as PartyKit's `?_pk=` connection id, so refreshes / reconnects
 * reuse the same room slot (otherwise every new socket gets a fresh `conn.id`, which
 * eats `MAX_ROOM_PLAYERS` until the platform finally GCs stale slots).
 *
 * `mode` matters: same browser opening a player tab AND an OB tab needs DIFFERENT conn.ids
 * (otherwise the server sees the OB connection as an already-joined player and blocks
 * `START` with `start_forbidden_player`). We segregate by storing one id per role.
 */
function stableConnectionId(mode: "player" | "ob" = "player"): string {
  const k = mode === "ob" ? "nz.connId.ob" : "nz.connId";
  try {
    const v = localStorage.getItem(k);
    if (v && /^[a-zA-Z0-9_-]{8,64}$/.test(v)) return v;
    const fresh =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(k, fresh);
    return fresh;
  } catch {
    return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * `wss` when a deploy host is set (Vercel + PartyKit cloud) or the page is HTTPS; otherwise
 * `ws` for local HTTP (e.g. Vite + PartyKit on localhost).
 */
function partyUrl(roomId: string, mode: "player" | "ob" = "player"): string {
  const cid = encodeURIComponent(stableConnectionId(mode));
  const host = partykitHostFromEnv();
  if (host) {
    return `wss://${host}/party/${encodeURIComponent(roomId)}?_pk=${cid}`;
  }
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/party/${encodeURIComponent(roomId)}?_pk=${cid}`;
}

export const usePartyStore = create<PartyStoreState>((set, get) => ({
  mode: "player",
  conn: "idle",
  ws: null,
  roomId: null,
  myName: "",
  lang: ENV_LANG,
  rulesCard: null,
  owlRoster: null,
  myAnimal: null,
  snapshot: null,
  log: [],
  cameraFrames: new Map(),
  photoSubmitted: false,
  answersSubmitted: false,
  connectError: null,
  mainScenePeers: {},
  mainSceneItemInbox: [],
  monitorVoiceInbox: [],
  gameEnded: null,

  clearGameEnded: () => set({ gameEnded: null }),

  drainMainSceneItemInbox: () => {
    const q = get().mainSceneItemInbox;
    if (q.length) set({ mainSceneItemInbox: [] });
    return q;
  },

  drainMonitorVoiceInbox: () => {
    const q = get().monitorVoiceInbox;
    if (q.length) set({ monitorVoiceInbox: [] });
    return q;
  },

  clearConnectError: () => set({ connectError: null }),

  setLang: (lang) => {
    try {
      localStorage.setItem("nz.lang", lang);
    } catch {
      /* ignore */
    }
    set({ lang });
  },
  setName: (myName) => set({ myName }),
  setMode: (mode) => set({ mode }),

  pushLog: (entry) =>
    set((s) => ({
      log: [{ ts: Date.now(), ...entry }, ...s.log].slice(0, 200)
    })),

  send: (type, payload) => {
    const ws = get().ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type, ...(payload || {}) }));
    return true;
  },

  clearOnboardingAssignment: () =>
    set({ rulesCard: null, myAnimal: null, owlRoster: null }),

  connect: ({ roomId, name, lang, mode }) => {
    const existing = get().ws;
    if (existing) {
      try {
        existing.close();
      } catch {
        /* ignore */
      }
    }

    set({
      conn: "connecting",
      roomId,
      myName: name,
      lang,
      mode: mode ?? get().mode,
      connectError: null
    });

    const wsMode: "player" | "ob" = mode === "ob" ? "ob" : "player";
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(partyUrl(roomId, wsMode));
      // Each ws's listeners must only mutate state when it's still the current ws;
      // a previous-connection close event arrives async after `set({ws})` and would
      // otherwise wipe the new ws (= "joined then instantly disconnected" UX).
      let settled = false;

      ws.addEventListener("open", () => {
        set({ ws, conn: "open" });
        if (get().mode === "player" && name) {
          ws.send(JSON.stringify({ type: ClientMessageTypes.JOIN, name, lang }));
        }
        settled = true;
        resolve();
      });

      ws.addEventListener("close", () => {
        if (get().ws !== ws) return;
        set((s) => ({ conn: "closed", ws: null, connectError: s.connectError }));
      });

      ws.addEventListener("error", () => {
        if (get().ws === ws || !settled) {
          set((s) => (get().ws === ws ? { conn: "error" } : s));
        }
        if (!settled) {
          settled = true;
          reject(new Error("ws_error"));
        }
      });

      ws.addEventListener("message", (ev) => {
        if (get().ws && get().ws !== ws) return;
        let msg: ServerEnvelope | null = null;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (!msg) return;
        handleServerEnvelope(msg, set, get);
      });
    });
  },

  disconnect: () => {
    const ws = get().ws;
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    set({ ws: null, conn: "closed", connectError: null });
  },

  reset: () =>
    set({
      conn: "idle",
      ws: null,
      roomId: null,
      myName: "",
      rulesCard: null,
      owlRoster: null,
      myAnimal: null,
      snapshot: null,
      log: [],
      cameraFrames: new Map(),
      photoSubmitted: false,
      answersSubmitted: false,
      connectError: null,
      mainScenePeers: {},
      mainSceneItemInbox: [],
      monitorVoiceInbox: [],
      gameEnded: null
    })
}));

function handleServerEnvelope(
  msg: ServerEnvelope,
  set: (
    partial:
      | Partial<PartyStoreState>
      | ((s: PartyStoreState) => Partial<PartyStoreState>)
  ) => void,
  get: () => PartyStoreState
) {
  const t = msg.type;
  if (t === "error") {
    const e = msg as { type: "error"; error: string; max?: number };
    set({ connectError: e.error });
    return;
  }
  if (t === ServerEventTypes.ROOM_SNAPSHOT) {
    const raw = msg.data as RoomSnapshot;
    const snap: RoomSnapshot = {
      ...raw,
      mainSceneItemsRemoved: raw.mainSceneItemsRemoved ?? []
    };
    set((s) => {
      const next: Record<string, MainScenePeerState> = { ...s.mainScenePeers };
      const alive = new Set(snap.players.map((p) => p.id));
      for (const k of Object.keys(next)) {
        if (!alive.has(k)) delete next[k];
      }
      // A new round starts → wipe last round's GAME_ENDED so the ceremony
      // overlay (still in-state from the previous game) doesn't sit on top
      // of the live scene.
      const wasStarted = !!s.snapshot?.started;
      const nowStarted = !!snap.started;
      const clearEnded = !wasStarted && nowStarted ? { gameEnded: null } : null;
      return { snapshot: snap, mainScenePeers: next, ...(clearEnded ?? {}) };
    });
    return;
  }
  if (t === ServerEventTypes.MAIN_SCENE_ITEM_TAKEN) {
    const data = msg.data as MainSceneItemTaken;
    set((s) => ({
      mainSceneItemInbox: [...s.mainSceneItemInbox, { kind: "taken" as const, data }]
    }));
    return;
  }
  if (t === ServerEventTypes.MAIN_SCENE_ITEMS_RESYNC) {
    const d = msg.data as { removedItemIds: string[] };
    if (!d?.removedItemIds?.length) return;
    set((s) => ({
      mainSceneItemInbox: [
        ...s.mainSceneItemInbox,
        { kind: "resync" as const, removedItemIds: d.removedItemIds }
      ]
    }));
    return;
  }
  if (t === ServerEventTypes.MONITOR_VOICE) {
    const data = msg.data as MonitorVoiceMessage;
    console.log("[nz-voice] WS recv MONITOR_VOICE", data?.kind, data?.audioUrl);
    if (!data || typeof data.captions !== "string") {
      console.warn("[nz-voice] dropped: bad payload", data);
      return;
    }
    set((s) => ({ monitorVoiceInbox: [...s.monitorVoiceInbox, data] }));
    return;
  }
  if (t === ServerEventTypes.MAIN_SCENE_BROADCAST) {
    const d = msg.data as MainScenePeerState;
    if (!d?.playerId) return;
    set((s) => ({
      mainScenePeers: { ...s.mainScenePeers, [d.playerId]: d }
    }));
    return;
  }
  if (t === ServerEventTypes.PLAYER_JOINED || t === ServerEventTypes.PLAYER_UPDATED) {
    const p = msg.data as PublicPlayer;
    get().pushLog({
      kind: "info",
      text: `${p.name} ${p.animal ?? ""} (lives ${p.lives})`
    });
    return;
  }
  if (t === ServerEventTypes.SYSTEM) {
    const sys = msg.data as { code?: string; params?: Record<string, unknown>; message?: string };
    const lang = get().lang;
    const text = renderSystemMessage(sys, lang);
    get().pushLog({ kind: "system", text });
    return;
  }
  if (t === ServerEventTypes.CHAT) {
    const c = msg.data as { playerName: string; text: string };
    get().pushLog({ kind: "chat", text: `${c.playerName}: ${c.text}` });
    return;
  }
  if (t === ServerEventTypes.VIOLATION_NARRATIVE) {
    const n = msg.data as { playerName: string; detail?: string; text?: string };
    const lang = get().lang;
    get().pushLog({
      kind: "narrative",
      text: renderViolationNarrative(n, lang)
    });
    return;
  }
  if (t === ServerEventTypes.GAME_STARTED) {
    const g = msg.data as { durationMs: number };
    const lang = get().lang;
    const seconds = Math.round((g.durationMs || 0) / 1000);
    get().pushLog({
      kind: "system",
      text:
        lang === "zh"
          ? `游戏开始 · 时长 ${seconds} 秒`
          : `Game started · ${seconds}s`
    });
    return;
  }
  if (t === ServerEventTypes.GAME_ENDED) {
    const lang = get().lang;
    const data = msg.data as GameEnded;
    set({ gameEnded: data });
    get().pushLog({
      kind: "system",
      text: lang === "zh" ? "游戏结束" : "Game ended"
    });
    return;
  }
  if (t === ServerEventTypes.CAMERA_FRAME) {
    const f = msg.data as CameraFrame;
    set((s) => {
      const next = new Map(s.cameraFrames);
      next.set(f.playerId, f);
      return { cameraFrames: next };
    });
    return;
  }
  if (t === ServerEventTypes.PRIVATE_RULES_CARD) {
    const card = msg.data as RulesCard;
    set({ rulesCard: card, myAnimal: card.animal });
    const lang = get().lang;
    const animalName = animalLocalized[lang][card.animal ?? ""] ?? card.animal ?? "?";
    get().pushLog({
      kind: "private",
      text:
        lang === "zh"
          ? `已收到守则卡：${card.emoji} ${animalName}`
          : `Rules card received: ${card.emoji} ${animalName}`
    });
    return;
  }
  if (t === ServerEventTypes.PRIVATE_OWL_ROSTER) {
    set({ owlRoster: msg.data as OwlRosterEntry[] });
    return;
  }
}

function renderSystemMessage(
  sys: { code?: string; params?: Record<string, unknown>; message?: string },
  lang: Lang
): string {
  const code = sys.code;
  const params = sys.params || ({} as Record<string, unknown>);
  const dictZh: Record<string, (p: Record<string, unknown>) => string> = {
    PLAYER_SUBMITTED_PHOTO: (p) => `${p.name} 已提交照片`,
    PLAYER_ENTERED_ZONE: (p) => `${p.name} 已进入 ${animalEmojiByCode(p.animal as string)} 区域`,
    PLAYER_READY: (p) => `${p.name} 已就绪，等待 OB 开局`,
    GAME_STARTED: () => "游戏开始",
    GAME_ENDED: () => "游戏结束",
    GIRAFFE_PURIFIED: (p) => `${p.name} 的感染似乎被"净化"了（累计违规 3 次）`,
    PLAYER_LEFT: (p) => `${p.name} 离开了房间`
  };
  const dictEn: Record<string, (p: Record<string, unknown>) => string> = {
    PLAYER_SUBMITTED_PHOTO: (p) => `${p.name} submitted a photo`,
    PLAYER_ENTERED_ZONE: (p) => `${p.name} entered ${animalEmojiByCode(p.animal as string)} zone`,
    PLAYER_READY: (p) => `${p.name} is ready — waiting for OB to start`,
    GAME_STARTED: () => "Game started",
    GAME_ENDED: () => "Game ended",
    GIRAFFE_PURIFIED: (p) => `${p.name} seems "purified" (3 violations)`,
    PLAYER_LEFT: (p) => `${p.name} left the room`
  };
  const dict = lang === "zh" ? dictZh : dictEn;
  if (code && dict[code]) return dict[code](params);
  return sys.message || code || "system";
}

function renderViolationNarrative(
  n: { playerName: string; detail?: string; text?: string },
  lang: Lang
): string {
  // Legacy server: pre-localized text already in `text` (always Chinese). New server: only
  // sends the raw cause in `detail`, we wrap it in the viewer's language.
  if (n.detail !== undefined) {
    const reason = n.detail || (lang === "zh" ? "触犯了守则" : "broke a rule");
    return lang === "zh"
      ? `【${n.playerName}】${reason}。动物园的黑暗似乎更近了一点。`
      : `[${n.playerName}] ${reason}. The zoo's darkness creeps closer.`;
  }
  return n.text || `${n.playerName}: violation`;
}

function animalEmojiByCode(animal: string | null | undefined): string {
  if (animal === Animals.LION) return "🦁";
  if (animal === Animals.OWL) return "🦉";
  if (animal === Animals.GIRAFFE) return "🦒";
  return "❓";
}
