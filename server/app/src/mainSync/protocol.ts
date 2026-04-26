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
export const NZ_MSG_TYPE_ITEM = "NZ_MS_ITEM" as const;
/** OB: main map camera — centroid, follow a player, or free pan. */
export const NZ_MSG_TYPE_OB_CAM = "NZ_OB_CAMERA" as const;

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

export function mapAnimalToMainScene(a: AnimalCode | string | null | undefined): NzPlayerSyncPayload["sceneAnimal"] {
  if (a === Animals.LION) return "lion";
  if (a === Animals.GIRAFFE) return "giraffe";
  if (a === Animals.OWL) return "owl";
  return "owl";
}

export function buildPlayerSyncPayload(opts: {
  myName: string;
  myAnimal: AnimalCode | null;
  rulesCard: RulesCard | null;
  lang: Lang;
  lives?: number;
  alive?: boolean;
}): NzPlayerSyncPayload {
  const ruleText = opts.rulesCard?.rule?.trim();
  const winText = opts.rulesCard?.win?.trim();
  const lives = typeof opts.lives === "number" ? Math.max(0, Math.min(3, opts.lives)) : 3;
  // If the caller didn't pass `alive`, derive it from lives so callers that
  // can't see the snapshot still get a consistent signal.
  const alive = typeof opts.alive === "boolean" ? opts.alive : lives > 0;
  return {
    playerName: opts.myName || "—",
    sceneAnimal: mapAnimalToMainScene(opts.myAnimal),
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
} {
  const spectator = Boolean(opts?.spectator);
  if (!snapshot?.players?.length) {
    return {
      selfId: "",
      selfName: myName,
      roomStarted: Boolean(snapshot?.started),
      spectator,
      itemsRemoved: snapshot?.mainSceneItemsRemoved ?? [],
      players: []
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
    sceneAnimal: mapAnimalToMainScene(p.animal),
    alive: p.alive !== false
  }));
  return {
    selfId,
    selfName: myName,
    roomStarted: Boolean(snapshot.started),
    spectator,
    itemsRemoved: snapshot.mainSceneItemsRemoved ?? [],
    players
  };
}
