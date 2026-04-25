import { create } from "zustand";
import {
  Animals,
  ClientMessageTypes,
  type AnimalCode,
  type CameraFrame,
  type Lang,
  type OwlRosterEntry,
  type PublicPlayer,
  type RoomSnapshot,
  type MainSceneItemInboxEntry,
  type MainSceneItemTaken,
  type MainScenePeerState,
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
 * `wss` when a deploy host is set (Vercel + PartyKit cloud) or the page is HTTPS; otherwise
 * `ws` for local HTTP (e.g. Vite + PartyKit on localhost).
 */
function partyUrl(roomId: string): string {
  const host = partykitHostFromEnv();
  if (host) {
    return `wss://${host}/party/${encodeURIComponent(roomId)}`;
  }
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/party/${encodeURIComponent(roomId)}`;
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

  drainMainSceneItemInbox: () => {
    const q = get().mainSceneItemInbox;
    if (q.length) set({ mainSceneItemInbox: [] });
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

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(partyUrl(roomId));

      ws.addEventListener("open", () => {
        set({ ws, conn: "open" });
        if (get().mode === "player" && name) {
          ws.send(JSON.stringify({ type: ClientMessageTypes.JOIN, name, lang }));
        }
        resolve();
      });

      ws.addEventListener("close", () => {
        set((s) => ({ conn: "closed", ws: null, connectError: s.connectError }));
      });

      ws.addEventListener("error", () => {
        set({ conn: "error" });
        reject(new Error("ws_error"));
      });

      ws.addEventListener("message", (ev) => {
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
      mainSceneItemInbox: []
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
      return { snapshot: snap, mainScenePeers: next };
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
    const n = msg.data as { text: string };
    get().pushLog({ kind: "narrative", text: n.text });
    return;
  }
  if (t === ServerEventTypes.GAME_STARTED) {
    const g = msg.data as { durationMs: number };
    get().pushLog({
      kind: "system",
      text: `game_started: ${Math.round((g.durationMs || 0) / 1000)}s`
    });
    return;
  }
  if (t === ServerEventTypes.GAME_ENDED) {
    get().pushLog({ kind: "system", text: "game_ended" });
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
    get().pushLog({
      kind: "private",
      text: `private rules: ${card.emoji} ${card.animal ?? ""}`
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
    GIRAFFE_PURIFIED: (p) => `${p.name} 的感染似乎被"净化"了（累计违规 3 次）`,
    PLAYER_LEFT: (p) => `${p.name} 离开了房间`
  };
  const dictEn: Record<string, (p: Record<string, unknown>) => string> = {
    PLAYER_SUBMITTED_PHOTO: (p) => `${p.name} submitted a photo`,
    PLAYER_ENTERED_ZONE: (p) => `${p.name} entered ${animalEmojiByCode(p.animal as string)} zone`,
    GIRAFFE_PURIFIED: (p) => `${p.name} seems "purified" (3 violations)`,
    PLAYER_LEFT: (p) => `${p.name} left the room`
  };
  const dict = lang === "zh" ? dictZh : dictEn;
  if (code && dict[code]) return dict[code](params);
  return sys.message || code || "system";
}

function animalEmojiByCode(animal: string | null | undefined): string {
  if (animal === Animals.LION) return "🦁";
  if (animal === Animals.OWL) return "🦉";
  if (animal === Animals.GIRAFFE) return "🦒";
  return "❓";
}
