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
  PRIVATE_RULES_CARD: "private_rules_card",
  PRIVATE_OWL_ROSTER: "private_owl_roster"
});

export const ClientMessageTypes = /** @type {const} */ ({
  JOIN: "join",
  SUBMIT_PHOTO: "submit_photo",
  SUBMIT_ANSWERS: "submit_answers",
  START: "start",
  VIOLATION: "violation",
  CHAT: "chat",
  OWL_SUBMIT: "owl_submit",
  END: "end"
});

