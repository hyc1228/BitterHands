export const Animals = /** @type {const} */ ({
  LION: "白狮子",
  OWL: "猫头鹰",
  GIRAFFE: "长颈鹿"
});

export const ServerEventTypes = /** @type {const} */ ({
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
  PRIVATE_OWL_ROSTER: "private_owl_roster",
  /** Broadcast each client's main-scene pose (movement + animation) to the room. */
  MAIN_SCENE_BROADCAST: "main_scene_broadcast",
  MAIN_SCENE_ITEM_TAKEN: "main_scene_item_taken",
  /** Private: client requested an already-taken item — strip local props. */
  MAIN_SCENE_ITEMS_RESYNC: "main_scene_items_resync"
});

export const ClientMessageTypes = /** @type {const} */ ({
  JOIN: "join",
  SUBMIT_PHOTO: "submit_photo",
  SUBMIT_ANSWERS: "submit_answers",
  START: "start",
  VIOLATION: "violation",
  CHAT: "chat",
  CAMERA_FRAME: "camera_frame",
  OWL_SUBMIT: "owl_submit",
  END: "end",
  /** Authoritative playfield: position, anim id, optional FX; relayed to everyone including OB. */
  MAIN_SCENE_STATE: "main_scene_state",
  /** Request picking up a map item (id matches main-scene h1, a1, …). */
  MAIN_SCENE_ITEM_PICKUP: "main_scene_item_pickup"
});

