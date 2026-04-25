// Mirrors server/src/protocol.js — keep in sync if the server-side protocol
// adds or renames events.

export const Animals = {
  LION: "白狮子",
  OWL: "猫头鹰",
  GIRAFFE: "长颈鹿"
} as const;

export type AnimalCode = (typeof Animals)[keyof typeof Animals];

export const ServerEventTypes = {
  ROOM_SNAPSHOT: "room_snapshot",
  PLAYER_JOINED: "player_joined",
  PLAYER_UPDATED: "player_updated",
  SYSTEM: "system",
  CHAT: "chat",
  VIOLATION_NARRATIVE: "violation_narrative",
  GAME_STARTED: "game_started",
  GAME_ENDED: "game_ended",
  CAMERA_FRAME: "camera_frame",
  PRIVATE_RULES_CARD: "private_rules_card",
  PRIVATE_OWL_ROSTER: "private_owl_roster"
} as const;

export const ClientMessageTypes = {
  JOIN: "join",
  SUBMIT_PHOTO: "submit_photo",
  SUBMIT_ANSWERS: "submit_answers",
  START: "start",
  VIOLATION: "violation",
  CHAT: "chat",
  CAMERA_FRAME: "camera_frame",
  OWL_SUBMIT: "owl_submit",
  END: "end"
} as const;

export type Lang = "en" | "zh";

export interface PublicPlayer {
  id: string;
  name: string;
  animal: AnimalCode | null;
  lives: number;
  alive: boolean;
  violations: number;
  /** URL path to profile photo, e.g. `/avatars/...` (static) or `/party/.../__nz_avatar?...` (in-memory). */
  avatarUrl: string | null;
}

export interface RoomSnapshot {
  roomId: string;
  started: boolean;
  startedAt: number | null;
  durationMs: number;
  players: PublicPlayer[];
}

export interface SystemEvent {
  code?: string;
  params?: Record<string, unknown>;
  message?: string;
}

export interface ChatEvent {
  playerId: string;
  playerName: string;
  text: string;
  ts: number;
}

export interface ViolationNarrative {
  playerId: string;
  playerName: string;
  animal: AnimalCode | null;
  text: string;
}

export interface CameraFrame {
  playerId: string;
  playerName: string | null;
  dataUrl: string;
  ts: number;
}

export interface RulesCard {
  animal: AnimalCode | null;
  emoji: string;
  verdict: string | null;
  rule: string;
  win: string;
  teammates: { id: string; name: string }[];
}

export interface OwlRosterEntry {
  id: string;
  name: string;
  animal: AnimalCode | null;
}

export interface GameStarted {
  startedAt: number;
  durationMs: number;
}

export interface GameEnded {
  endedAt: number;
  reveal: { id: string; name: string; animal: AnimalCode | null; verdict: string | null }[];
  owlGuesses: Record<string, unknown>;
}

export type ServerEnvelope =
  | { type: typeof ServerEventTypes.ROOM_SNAPSHOT; data: RoomSnapshot }
  | { type: typeof ServerEventTypes.PLAYER_JOINED; data: PublicPlayer }
  | { type: typeof ServerEventTypes.PLAYER_UPDATED; data: PublicPlayer }
  | { type: typeof ServerEventTypes.SYSTEM; data: SystemEvent }
  | { type: typeof ServerEventTypes.CHAT; data: ChatEvent }
  | { type: typeof ServerEventTypes.VIOLATION_NARRATIVE; data: ViolationNarrative }
  | { type: typeof ServerEventTypes.GAME_STARTED; data: GameStarted }
  | { type: typeof ServerEventTypes.GAME_ENDED; data: GameEnded }
  | { type: typeof ServerEventTypes.CAMERA_FRAME; data: CameraFrame }
  | { type: typeof ServerEventTypes.PRIVATE_RULES_CARD; data: RulesCard }
  | { type: typeof ServerEventTypes.PRIVATE_OWL_ROSTER; data: OwlRosterEntry[] }
  | { type: "error"; error: string }
  | { type: string; data?: unknown };

export function animalEmoji(animal: AnimalCode | string | null | undefined): string {
  if (animal === Animals.LION) return "🦁";
  if (animal === Animals.OWL) return "🦉";
  if (animal === Animals.GIRAFFE) return "🦒";
  return "❓";
}
