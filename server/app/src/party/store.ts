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
  // Actions
  setLang: (lang: Lang) => void;
  setName: (name: string) => void;
  setMode: (mode: Mode) => void;
  connect: (opts: { roomId: string; name: string; lang: Lang; mode?: Mode }) => Promise<void>;
  disconnect: () => void;
  send: (type: string, payload?: Record<string, unknown>) => void;
  pushLog: (entry: Omit<LogEntry, "ts"> & { ts?: number }) => void;
  reset: () => void;
}

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem("nz.lang");
    if (saved === "en" || saved === "zh") return saved;
  } catch {
    /* ignore */
  }
  // Default to English; only switch to zh if explicitly chosen via the pill.
  return "en";
}

const ENV_LANG: Lang = initialLang();

function partyUrl(roomId: string): string {
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
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type, ...(payload || {}) }));
  },

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
      mode: mode ?? get().mode
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
        set({ conn: "closed", ws: null });
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
    set({ ws: null, conn: "closed" });
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
      answersSubmitted: false
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
  if (t === ServerEventTypes.ROOM_SNAPSHOT) {
    set({ snapshot: msg.data as RoomSnapshot });
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
