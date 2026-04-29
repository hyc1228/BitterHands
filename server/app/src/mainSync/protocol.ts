import { Animals, type AnimalCode, type Lang, type RulesCard, type RoomSnapshot } from "../party/protocol";

/** `postMessage` `source` — must match `main scene` listener. */
export const NZ_MSG_SOURCE = "nocturne-zoo" as const;

export const NZ_MSG_TYPE_SYNC = "NZ_PLAYER_SYNC" as const;
export const NZ_MSG_TYPE_ROOM = "NZ_ROOM_PLAYERS" as const;
export const NZ_MSG_TYPE_MS_VIEW = "NZ_MS_VIEW" as const;
export const NZ_MSG_TYPE_NET = "NZ_MAIN_SCENE_NET" as const;
export const NZ_MSG_OUT = "NZ_OUT_MAIN_SCENE" as const;
export const NZ_MSG_OUT_ITEM = "NZ_OUT_ITEM_PICKUP" as const;
export const NZ_MSG_OUT_VIOLATION = "NZ_OUT_VIOLATION" as const;
/** Out: cumulative face-action counts since game start (mouth opens / head shakes / blinks). */
export const NZ_MSG_OUT_FACE_COUNTS = "NZ_OUT_FACE_COUNTS" as const;
/** Out: action-edge highlight still (96² JPEG dataURL) for the end-game ceremony. */
export const NZ_MSG_OUT_HIGHLIGHT = "NZ_OUT_HIGHLIGHT" as const;
export const NZ_MSG_TYPE_ITEM = "NZ_MS_ITEM" as const;
/** OB: main map camera — centroid, follow a player, or free pan. */
export const NZ_MSG_TYPE_OB_CAM = "NZ_OB_CAMERA" as const;
/** Server-authoritative Monitor (AI flashlight) pose, forwarded into the iframe. */
export const NZ_MSG_TYPE_MONITOR = "NZ_MONITOR_STATE" as const;

/** Payload applied inside `main scene/index.html` (MainSync bridge). */
export interface NzPlayerSyncPayload {
  playerName: string;
  /** Main-scene sprite key — must be `lion` | `owl` | `giraffe` */
  sceneAnimal: "lion" | "owl" | "giraffe";
  lang: Lang;
  ruleText?: string;
  winText?: string;
  lives: number;
  /** Server-authoritative — false once lives reach 0 server-side; iframe transitions to spectator. */
  alive: boolean;
}

/** Animals known to the iframe sprite system. Must mirror `ANIMAL_SPEC`
 *  in `main scene/index.html`. */
const SCENE_ANIMALS = ["lion", "owl", "giraffe"] as const;

/** Deterministic 32-bit hash of an arbitrary string — used to spread
 *  animal-less players across the 3 sprites instead of collapsing them
 *  all onto "owl" (the legacy fallback). FNV-1a, identical to the
 *  server-side `fnv1a32` so a player's fallback animal is stable across
 *  reconnects + matches what the OB/face-wall uses for the same id. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mapAnimalToMainScene(
  a: AnimalCode | string | null | undefined,
  /** Optional stable id (player.id). When the server hasn't assigned an animal
   *  yet (null/undefined) we fall back to a deterministic hash of `seed` so
   *  remote players don't all default to owl on every other client. */
  seed?: string
): NzPlayerSyncPayload["sceneAnimal"] {
  if (a === Animals.LION) return "lion";
  if (a === Animals.GIRAFFE) return "giraffe";
  if (a === Animals.OWL) return "owl";
  // Unknown / null animal → spread evenly across the 3 sprites. Without
  // this the iframe collapsed every pre-onboarded / null-animal peer onto
  // "owl", which is what other clients reported as "everyone shows up as
  // an owl" during play. Visual variety only — server still drives the
  // real role once the player finishes onboarding.
  if (seed && seed.length > 0) {
    return SCENE_ANIMALS[hash32(seed) % SCENE_ANIMALS.length];
  }
  return "owl";
}

export function buildPlayerSyncPayload(opts: {
  myName: string;
  myAnimal: AnimalCode | null;
  rulesCard: RulesCard | null;
  lang: Lang;
  lives?: number;
  alive?: boolean;
  /** Stable id (player.id from the snapshot). Used as the deterministic seed
   *  for `sceneAnimal` when the animal hasn't been assigned yet, so the
   *  fallback sprite matches what other clients render for the same player. */
  selfId?: string;
}): NzPlayerSyncPayload {
  const ruleText = opts.rulesCard?.rule?.trim();
  const winText = opts.rulesCard?.win?.trim();
  const lives = typeof opts.lives === "number" ? Math.max(0, Math.min(3, opts.lives)) : 3;
  // If the caller didn't pass `alive`, derive it from lives so callers that
  // can't see the snapshot still get a consistent signal.
  const alive = typeof opts.alive === "boolean" ? opts.alive : lives > 0;
  return {
    playerName: opts.myName || "—",
    sceneAnimal: mapAnimalToMainScene(opts.myAnimal, opts.selfId || opts.myName),
    lang: opts.lang,
    ruleText: ruleText || undefined,
    winText: winText || undefined,
    lives,
    alive
  };
}

/** One row in NZ_ROOM_PLAYERS (all PartyKit connections in the room, including self). */
export interface NzRoomPlayerRow {
  id: string;
  name: string;
  sceneAnimal: NzPlayerSyncPayload["sceneAnimal"];
  /** Server-authoritative; iframe uses this so the local Monitor AI doesn't lock onto a corpse. */
  alive: boolean;
}

export function buildRoomPlayersPayload(
  snapshot: RoomSnapshot | null,
  myName: string,
  opts?: { spectator?: boolean }
): {
  selfId: string;
  selfName: string;
  roomStarted: boolean;
  spectator: boolean;
  itemsRemoved: string[];
  players: NzRoomPlayerRow[];
  /** Server's wall-clock timestamp for round start (or null when not started). */
  startedAt: number | null;
  /** Round length in milliseconds; mirrors server.durationMs (2 min today). */
  durationMs: number;
} {
  const spectator = Boolean(opts?.spectator);
  const startedAt = snapshot?.startedAt ?? null;
  const durationMs = snapshot?.durationMs ?? 0;
  if (!snapshot?.players?.length) {
    return {
      selfId: "",
      selfName: myName,
      roomStarted: Boolean(snapshot?.started),
      spectator,
      itemsRemoved: snapshot?.mainSceneItemsRemoved ?? [],
      players: [],
      startedAt,
      durationMs
    };
  }
  const roster = spectator
    ? snapshot.players.filter((p) => p.name.toLowerCase() !== "ob")
    : snapshot.players;
  const me = !spectator ? snapshot.players.find((p) => p.name === myName) : null;
  const selfId = me?.id ?? "";
  const players: NzRoomPlayerRow[] = roster.map((p) => ({
    id: p.id,
    name: p.name,
    // Pass `p.id` so animal-less peers fall back to a deterministic
    // sprite (lion / owl / giraffe) keyed off id — fixes the bug where
    // every other client rendered the entire roster as owls until the
    // animal field arrived. Each player still gets the same fallback on
    // every viewer (id is identical), so it's not visually inconsistent.
    sceneAnimal: mapAnimalToMainScene(p.animal, p.id),
    alive: p.alive !== false
  }));
  return {
    selfId,
    selfName: myName,
    roomStarted: Boolean(snapshot.started),
    spectator,
    itemsRemoved: snapshot.mainSceneItemsRemoved ?? [],
    players,
    startedAt,
    durationMs
  };
}
