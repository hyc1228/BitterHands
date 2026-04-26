import type { AnimalCode, Lang, MainScenePeerState, MonitorStateMessage, RoomSnapshot, RulesCard } from "../party/protocol";
import {
  buildPlayerSyncPayload,
  buildRoomPlayersPayload,
  NZ_MSG_SOURCE,
  NZ_MSG_TYPE_ITEM,
  NZ_MSG_TYPE_MONITOR,
  NZ_MSG_TYPE_MS_VIEW,
  NZ_MSG_TYPE_NET,
  NZ_MSG_TYPE_OB_CAM,
  NZ_MSG_TYPE_ROOM,
  NZ_MSG_TYPE_SYNC
} from "./protocol";
import type { MainSceneItemInboxEntry } from "../party/protocol";

export interface PostToMainSceneArgs {
  myName: string;
  myAnimal: AnimalCode | null;
  rulesCard: RulesCard | null;
  lang: Lang;
  snapshot: RoomSnapshot | null;
  /** OB / spectators: no local avatar, see everyone on the shared map. */
  spectator?: boolean;
  /** `PublicPlayer.id` for this client (from snapshot). */
  selfPlayerId: string;
  mainScenePeers: Record<string, MainScenePeerState>;
}

/** Push MainSync + room roster + network poses into the static `main-scene` iframe. */
export function postToMainSceneFrame(
  w: Window | null | undefined,
  args: PostToMainSceneArgs
): void {
  if (!w) return;
  w.postMessage(
    {
      type: NZ_MSG_TYPE_MS_VIEW,
      source: NZ_MSG_SOURCE,
      payload: { spectator: Boolean(args.spectator) }
    },
    "*"
  );
  const matchedPlayer = args.snapshot?.players.find((p) => p.name === args.myName);
  w.postMessage(
    {
      type: NZ_MSG_TYPE_SYNC,
      source: NZ_MSG_SOURCE,
      payload: buildPlayerSyncPayload({
        myName: args.myName,
        myAnimal: args.myAnimal,
        rulesCard: args.rulesCard,
        lang: args.lang,
        lives: matchedPlayer?.lives,
        alive: matchedPlayer?.alive
      })
    },
    "*"
  );
  const roomPayload = buildRoomPlayersPayload(args.snapshot, args.myName, {
    spectator: args.spectator
  });
  w.postMessage(
    {
      type: NZ_MSG_TYPE_ROOM,
      source: NZ_MSG_SOURCE,
      payload: roomPayload
    },
    "*"
  );
  w.postMessage(
    {
      type: NZ_MSG_TYPE_NET,
      source: NZ_MSG_SOURCE,
      payload: { peers: args.mainScenePeers, selfId: args.selfPlayerId }
    },
    "*"
  );
}

export function postItemInboxToFrame(
  w: Window | null | undefined,
  events: MainSceneItemInboxEntry[]
): void {
  if (!w || !events.length) return;
  w.postMessage(
    { type: NZ_MSG_TYPE_ITEM, source: NZ_MSG_SOURCE, payload: { events } },
    "*"
  );
}

/** Throttled: only playfield positions / anim from PartyKit (lighter than a full re-push). */
export function postMainSceneNetToFrame(
  w: Window | null | undefined,
  selfId: string,
  peers: Record<string, MainScenePeerState>
): void {
  if (!w) return;
  w.postMessage(
    {
      type: NZ_MSG_TYPE_NET,
      source: NZ_MSG_SOURCE,
      payload: { peers, selfId }
    },
    "*"
  );
}

/** Forward the latest server-authoritative Monitor pose to the iframe. */
export function postMonitorStateToFrame(
  w: Window | null | undefined,
  state: MonitorStateMessage | null
): void {
  if (!w || !state) return;
  w.postMessage(
    { type: NZ_MSG_TYPE_MONITOR, source: NZ_MSG_SOURCE, payload: state },
    "*"
  );
}

export type ObCameraPayload = {
  mode: "centroid" | "follow" | "free";
  followPlayerId?: string | null;
  /** Optional explicit free-cam center in world space. */
  freeCenter?: { x: number; y: number } | null;
  /** If true, copy current view center (centroid/follow) into free target before applying mode. */
  initFromCurrent?: boolean;
};

/** OB-only: set how the main map camera behaves inside the main-scene iframe. */
export function postObCameraToFrame(w: Window | null | undefined, payload: ObCameraPayload): void {
  if (!w) return;
  w.postMessage(
    { type: NZ_MSG_TYPE_OB_CAM, source: NZ_MSG_SOURCE, payload },
    "*"
  );
}
