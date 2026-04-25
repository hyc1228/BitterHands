import { Animals, type AnimalCode, type Lang, type RulesCard, type RoomSnapshot } from "../party/protocol";

/** `postMessage` `source` — must match `main scene` listener. */
export const NZ_MSG_SOURCE = "nocturne-zoo" as const;

export const NZ_MSG_TYPE_SYNC = "NZ_PLAYER_SYNC" as const;
export const NZ_MSG_TYPE_ROOM = "NZ_ROOM_PLAYERS" as const;

/** Payload applied inside `main scene/index.html` (MainSync bridge). */
export interface NzPlayerSyncPayload {
  playerName: string;
  /** Main-scene sprite key — must be `lion` | `owl` | `giraffe` */
  sceneAnimal: "lion" | "owl" | "giraffe";
  lang: Lang;
  ruleText?: string;
  winText?: string;
  lives: number;
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
}): NzPlayerSyncPayload {
  const ruleText = opts.rulesCard?.rule?.trim();
  const winText = opts.rulesCard?.win?.trim();
  return {
    playerName: opts.myName || "—",
    sceneAnimal: mapAnimalToMainScene(opts.myAnimal),
    lang: opts.lang,
    ruleText: ruleText || undefined,
    winText: winText || undefined,
    lives: 3
  };
}

/** One row in NZ_ROOM_PLAYERS (all PartyKit connections in the room, including self). */
export interface NzRoomPlayerRow {
  id: string;
  name: string;
  sceneAnimal: NzPlayerSyncPayload["sceneAnimal"];
}

export function buildRoomPlayersPayload(snapshot: RoomSnapshot | null, myName: string): {
  selfId: string;
  /** Fallback when `selfId` is missing (race) — exclude this display name from `others`. */
  selfName: string;
  players: NzRoomPlayerRow[];
} {
  if (!snapshot?.players?.length) {
    return { selfId: "", selfName: myName, players: [] };
  }
  const me = snapshot.players.find((p) => p.name === myName);
  const selfId = me?.id ?? "";
  const players: NzRoomPlayerRow[] = snapshot.players.map((p) => ({
    id: p.id,
    name: p.name,
    sceneAnimal: mapAnimalToMainScene(p.animal)
  }));
  return { selfId, selfName: myName, players };
}
