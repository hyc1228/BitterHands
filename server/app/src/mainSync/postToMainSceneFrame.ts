import type { AnimalCode, Lang, RoomSnapshot, RulesCard } from "../party/protocol";
import {
  buildPlayerSyncPayload,
  buildRoomPlayersPayload,
  NZ_MSG_SOURCE,
  NZ_MSG_TYPE_ROOM,
  NZ_MSG_TYPE_SYNC
} from "./protocol";

/** Push MainSync + room roster into the static `main-scene` iframe (player or OB). */
export function postToMainSceneFrame(
  w: Window | null | undefined,
  args: {
    myName: string;
    myAnimal: AnimalCode | null;
    rulesCard: RulesCard | null;
    lang: Lang;
    snapshot: RoomSnapshot | null;
  }
): void {
  if (!w) return;
  w.postMessage(
    {
      type: NZ_MSG_TYPE_SYNC,
      source: NZ_MSG_SOURCE,
      payload: buildPlayerSyncPayload({
        myName: args.myName,
        myAnimal: args.myAnimal,
        rulesCard: args.rulesCard,
        lang: args.lang
      })
    },
    "*"
  );
  w.postMessage(
    {
      type: NZ_MSG_TYPE_ROOM,
      source: NZ_MSG_SOURCE,
      payload: buildRoomPlayersPayload(args.snapshot, args.myName)
    },
    "*"
  );
}
