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
  /** Heavy per-player media (highlights / fallback frames / avatar) split
   *  off from GAME_ENDED so each WS frame stays under the 1 MiB limit. One
   *  message per player, arriving immediately after GAME_ENDED. */
  GAME_ENDED_MEDIA: "game_ended_media",
  CAMERA_FRAME: "camera_frame",
  PRIVATE_RULES_CARD: "private_rules_card",
  PRIVATE_OWL_ROSTER: "private_owl_roster",
  MAIN_SCENE_BROADCAST: "main_scene_broadcast",
  MAIN_SCENE_ITEM_TAKEN: "main_scene_item_taken",
  MAIN_SCENE_ITEM_RESPAWN: "main_scene_item_respawn",
  MAIN_SCENE_ITEMS_RESYNC: "main_scene_items_resync",
  MONITOR_VOICE: "monitor_voice",
  MONITOR_STATE: "monitor_state",
  /** Live Final Check gate progress relayed to OB. */
  GATE_PROGRESS: "gate_progress"
} as const;

export const ClientMessageTypes = {
  JOIN: "join",
  SUBMIT_PHOTO: "submit_photo",
  SUBMIT_ANSWERS: "submit_answers",
  /** Player passed Final Check; entered the lobby waiting for OB to start. */
  READY: "ready",
  /** OB-only on the server; player START is rejected with `start_forbidden_player`. */
  START: "start",
  VIOLATION: "violation",
  CHAT: "chat",
  CAMERA_FRAME: "camera_frame",
  OWL_SUBMIT: "owl_submit",
  END: "end",
  /** Test/dev: bypass OB-only START gate so a single tab can drive the game. */
  TEST_FORCE_START: "test_force_start",
  /** OB-only: spawn synthetic AI players (camera tiles + map wander). */
  OB_SPAWN_AI: "ob_spawn_ai",
  /** OB-only: clear all AI players from the room. */
  OB_DESPAWN_AI: "ob_despawn_ai",
  /** Host-only: forcibly remove a specific player from the room. */
  KICK_PLAYER: "kick_player",
  MAIN_SCENE_STATE: "main_scene_state",
  MAIN_SCENE_ITEM_PICKUP: "main_scene_item_pickup",
  /** Per-client cumulative face-action counters reported every few seconds. */
  FACE_COUNTS: "face_counts",
  /** Webcam still at action-edge time, used to build the end-game ceremony collage. */
  HIGHLIGHT: "highlight",
  /** Live Final Check gate progress (head-shake / mouth / no-blink) — OB only consumer. */
  GATE_PROGRESS: "gate_progress"
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
  /** Player passed Final Check and is in the lobby. OB starts the game when enough are ready. */
  ready?: boolean;
  /** Lobby host (oldest human player). Server-derived; flips automatically when
   *  the previous host leaves. UI uses this to show host-only controls. */
  host?: boolean;
}

export interface RoomSnapshot {
  roomId: string;
  started: boolean;
  startedAt: number | null;
  durationMs: number;
  /** Mirror of `players.filter(p => p.ready).length` for OB UI. */
  readyCount?: number;
  players: PublicPlayer[];
  /** Authoritative: item ids (h1, a1, …) already picked up in this run. */
  mainSceneItemsRemoved?: string[];
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
  /** Raw violation cause from the client (e.g. "blinked (owl rule)"). May be empty. */
  detail?: string;
  /** Legacy pre-localized text — still accepted as fallback. New code uses `detail`. */
  text?: string;
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
  /** 55–99; pseudo-metric from photo seed + animal + id */
  similarityPercent: number;
  /** Meme / playful face commentary (server-generated from photo analysis stub). */
  looksRoast: string;
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

export interface FaceCounts {
  mouthOpens: number;
  headShakes: number;
  blinks: number;
}

export interface GameEndedAward {
  id: string;
  name: string;
  count: number;
}

/** A single highlight = a short burst of JPEG dataURLs (acts as a tiny GIF). */
export type HighlightBurst = string[];

export interface PlayerHighlights {
  /** Up to N bursts per kind (server caps; each burst is a short frame loop). */
  mouth: HighlightBurst[];
  shake: HighlightBurst[];
  blink: HighlightBurst[];
}

export interface GameEndedRevealEntry {
  id: string;
  name: string;
  animal: AnimalCode | null;
  verdict: string | null;
  alive?: boolean;
  lives?: number;
  violations?: number;
  faceCounts?: FaceCounts;
  /** Legacy: pre-split servers embedded media here. Modern servers send
   *  these via separate GAME_ENDED_MEDIA broadcasts (see GameEndedMedia)
   *  so the headline GAME_ENDED message stays small.  Kept optional so
   *  fresh clients keep working against an older server build. */
  highlights?: PlayerHighlights;
  avatarUrl?: string | null;
  lastFrame?: string | null;
  fallbackBurst?: string[];
}

export interface GameEnded {
  endedAt: number;
  reveal: GameEndedRevealEntry[];
  /** Mario Party–style "best at" winners per face action, OB end screen. */
  awards?: {
    mouthOpens: GameEndedAward | null;
    headShakes: GameEndedAward | null;
    blinks: GameEndedAward | null;
  };
  owlGuesses: Record<string, unknown>;
}

/**
 * Per-player media follow-up to GAME_ENDED. The server emits one of these
 * for each player immediately after GAME_ENDED so the heavy payload stays
 * within the WebSocket per-message limit. Clients accumulate them keyed by
 * `playerId` and merge with the matching `GameEnded.reveal` entry to fill
 * in tile portraits / highlight bursts. Any field can be absent if the
 * server dropped it under the size guard.
 */
export interface GameEndedMedia {
  playerId: string;
  highlights?: PlayerHighlights;
  avatarUrl?: string | null;
  lastFrame?: string | null;
  fallbackBurst?: string[];
}

/** Relayed to all clients (players + OB) for the shared playfield. */
export interface MainScenePeerState {
  playerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  moving: boolean;
  /** e.g. idle, walk, interact_* — use for future skeletal animation. */
  animKey: string;
  facing: number;
  t: number;
  /** Optional one-shot or timed interaction effect. */
  fx: { id: string; at: number; extra?: Record<string, unknown> } | null;
}

export interface MainSceneItemTaken {
  itemId: string;
  itemType: "heart" | "alarm";
  byPlayerId: string;
  alarmLured: { x: number; y: number } | null;
}

/** Server respawned a previously-taken item; iframe re-creates the SVG node. */
export interface MainSceneItemRespawn {
  itemId: string;
  itemType: "heart" | "alarm";
  x: number;
  y: number;
}

export type MainSceneItemInboxEntry =
  | { kind: "taken"; data: MainSceneItemTaken }
  | { kind: "respawn"; data: MainSceneItemRespawn }
  | { kind: "resync"; removedItemIds: string[] };

/** One supervisor's authoritative pose. Multiple supervisors can be present;
 *  count scales with the human player roster (1 per 5, capped server-side). */
export interface MonitorPose {
  /** Stable id (`m0`, `m1`, ...) so iframe consumers can upsert by id. */
  id: string;
  x: number;
  y: number;
  aimAngle: number;
  mode: "sweep" | "locked";
  moving: boolean;
  targetId: string | null;
  lured: { x: number; y: number } | null;
}

/** Authoritative Monitor (AI flashlight) roster, broadcast at ~10 Hz. */
export interface MonitorStateMessage {
  monitors: MonitorPose[];
  /** Wall-clock timestamp from the server; clients can use it to drop stale frames. */
  ts: number;
}

/**
 * Snapshot of one player's onboarding "Final Check" gate. Sent from the
 * player ~4 Hz while the gate is active; the server validates + relays as a
 * `gate_progress` server event. OB consumes this to render a live action
 * feed (counters + bar fills) for the spotlighted player.
 */
export interface GateProgress {
  playerId: string;
  /** Wall-clock at the moment the player's tab sampled the detectors. */
  ts: number;
  /** True only while the gate UI is mounted + camera is on; flips false on pass. */
  active: boolean;
  shake: { done: boolean; count: number; progress: number };
  mouth: { done: boolean; openFrames: number; progress: number };
  /** `holdMs` is the no-blink streak length; `progress` is normalized 0..1. */
  eyes: { done: boolean; holdMs: number; progress: number };
}

export interface MonitorVoiceMessage {
  /** Stable id (audio hash when TTS succeeded; sequence string otherwise). */
  id: string;
  /** Tag like "violation" / "pickup_alarm" — used for client-side dedup. */
  kind: string;
  /** 1–10; higher preempts lower in the audio queue. */
  priority: number;
  /** May be null if ElevenLabs is unconfigured — captions still display. */
  audioUrl: string | null;
  /** English caption text. */
  captions: string;
  /** Hint for caption fade timeout. */
  ttlMs: number;
  source?: "template" | "claude";
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
  | { type: typeof ServerEventTypes.GAME_ENDED_MEDIA; data: GameEndedMedia }
  | { type: typeof ServerEventTypes.CAMERA_FRAME; data: CameraFrame }
  | { type: typeof ServerEventTypes.PRIVATE_RULES_CARD; data: RulesCard }
  | { type: typeof ServerEventTypes.PRIVATE_OWL_ROSTER; data: OwlRosterEntry[] }
  | { type: typeof ServerEventTypes.MAIN_SCENE_BROADCAST; data: MainScenePeerState }
  | { type: typeof ServerEventTypes.MAIN_SCENE_ITEM_TAKEN; data: MainSceneItemTaken }
  | { type: typeof ServerEventTypes.MAIN_SCENE_ITEM_RESPAWN; data: MainSceneItemRespawn }
  | { type: typeof ServerEventTypes.MAIN_SCENE_ITEMS_RESYNC; data: { removedItemIds: string[] } }
  | { type: typeof ServerEventTypes.MONITOR_VOICE; data: MonitorVoiceMessage }
  | { type: typeof ServerEventTypes.MONITOR_STATE; data: MonitorStateMessage }
  | { type: typeof ServerEventTypes.GATE_PROGRESS; data: GateProgress }
  | { type: "error"; error: string; max?: number }
  | { type: string; data?: unknown };

export function animalEmoji(animal: AnimalCode | string | null | undefined): string {
  if (animal === Animals.LION) return "🦁";
  if (animal === Animals.OWL) return "🦉";
  if (animal === Animals.GIRAFFE) return "🦒";
  return "❓";
}
