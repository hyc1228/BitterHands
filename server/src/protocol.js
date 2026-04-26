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
  MAIN_SCENE_ITEMS_RESYNC: "main_scene_items_resync",
  /**
   * Monitor PA broadcast. Carries audio URL (may be null when TTS is unavailable),
   * captions, priority, and a kind tag (used for client-side dedup).
   */
  MONITOR_VOICE: "monitor_voice",
  /** Server-authoritative Monitor (AI flashlight) position + lock target. */
  MONITOR_STATE: "monitor_state"
});

export const ClientMessageTypes = /** @type {const} */ ({
  JOIN: "join",
  SUBMIT_PHOTO: "submit_photo",
  SUBMIT_ANSWERS: "submit_answers",
  /** Player passed the Final Check and is in the lobby waiting for OB to start. */
  READY: "ready",
  /** Only OB-side connections (non-players) may send START; ignored otherwise. */
  START: "start",
  VIOLATION: "violation",
  CHAT: "chat",
  CAMERA_FRAME: "camera_frame",
  OWL_SUBMIT: "owl_submit",
  END: "end",
  /**
   * Test/dev convenience: bypass the OB-only START gate so a single tab can both
   * play AND drive the game (see /test route). Server still validates the room
   * isn't already running, so this is a no-op once a real game is live.
   */
  TEST_FORCE_START: "test_force_start",
  /** Authoritative playfield: position, anim id, optional FX; relayed to everyone including OB. */
  MAIN_SCENE_STATE: "main_scene_state",
  /** Request picking up a map item (id matches main-scene h1, a1, …). */
  MAIN_SCENE_ITEM_PICKUP: "main_scene_item_pickup",
  /** Per-client cumulative face-action counts (mouth opens / head shakes / blinks). */
  FACE_COUNTS: "face_counts",
  /** A still snapshot of the player's webcam at the moment a face-action triggered. */
  HIGHLIGHT: "highlight"
});

