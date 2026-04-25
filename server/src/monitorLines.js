// Monitor PA lines for Nocturne Zoo.
//
// Plan A: ship pre-recorded MP3s for the audio side and personalize the
// caption side at runtime. Each kind has parallel `audio` and `caption`
// arrays — same index, paired output.
//
// - `audio[i]` is the line a player HEARS. Generic, no player names — that's
//   what makes it ship-able as a static file. The line is also the script
//   for recording `<kind>_<i>.mp3` (see `server/public/voice/README.md`).
// - `caption[i]` is what they SEE. Same wording, but with `{name}`
//   interpolated. Falls back to `audio[i]` when no name is needed.
//
// `generateMonitorLine()` returns both, plus the audio file path. The
// optional Claude rewrite is left in place for later experiments but
// disabled by default; under Plan A the audio side is fixed by recording.

const TEMPLATES = {
  game_started: {
    audio: [
      "Welcome back, residents. The night shift has begun.",
      "All visitors, please proceed to the nearest existential crisis. Thank you.",
      "The zoo is now open. Please remain delicious."
    ],
    caption: [
      "Welcome back, residents. The night shift has begun.",
      "All visitors, please proceed to the nearest existential crisis. Thank you.",
      "The zoo is now open. Please remain delicious."
    ]
  },
  game_ended: {
    audio: [
      "The night shift has concluded. Please collect your belongings and your soul.",
      "Closing time. The Monitor has had a perfectly normal evening."
    ],
    caption: [
      "The night shift has concluded. Please collect your belongings and your soul.",
      "Closing time. The Monitor has had a perfectly normal evening."
    ]
  },
  winner: {
    audio: [
      "Congratulations to our survivor. You may now go home. Please leave your soul in the lobby.",
      "We have a winner. A modest plaque has been ordered."
    ],
    caption: [
      "Congratulations, {name}. You may now go home. Please leave your soul in the lobby.",
      "{name} has outlasted the competition. A modest plaque has been ordered."
    ]
  },
  pickup_heart: {
    audio: [
      "A resident has acquired one unit of joy. Productivity is up zero point three percent.",
      "Heart detected. Please consume responsibly.",
      "Someone is now thirty-three percent more alive. Please don't get used to it."
    ],
    caption: [
      "{name} has acquired one (1) unit of joy. Productivity is up 0.3%.",
      "Heart detected on {name}. Please consume responsibly.",
      "{name} is now 33% more alive. Please don't get used to it."
    ]
  },
  pickup_alarm: {
    audio: [
      "An alarm clock has been triggered. The Monitor would like a word.",
      "The Monitor is on the way. Please prepare a small smile.",
      "Attention: somebody has rung the dinner bell. Unfortunately, they are the dinner."
    ],
    caption: [
      "{name} has triggered an alarm clock. The Monitor would like a word.",
      "{name}, the Monitor is on the way. Please prepare a small smile.",
      "Attention: {name} has rung the dinner bell. Unfortunately, they are the dinner."
    ]
  },
  violation: {
    audio: [
      "A resident has failed to comply. Please apologize to the camera.",
      "Someone appears to have forgotten the rules. The Monitor remembers.",
      "Compliance failure detected. Minus one life. Have a tolerable day."
    ],
    caption: [
      "Unfortunately, {name} has failed to comply. Please apologize to the camera.",
      "{name} appears to have forgotten the rules. The Monitor remembers.",
      "Compliance failure for {name}. Minus one (1) life. Have a tolerable day."
    ]
  },
  eliminated: {
    audio: [
      "A resident has been promoted to compost. Please congratulate the management.",
      "One of you is no longer with us. Their performance review is final.",
      "We thank the deceased for their service. Their locker will be cleaned."
    ],
    caption: [
      "{name} has been promoted to compost. Please congratulate {name}.",
      "{name} is no longer with us. Their performance review is final.",
      "We thank {name} for their service. Their locker will be cleaned."
    ]
  },
  monitor_lock: {
    audio: [
      "The Monitor has noticed someone. Please do the thing.",
      "You are now the subject of the Monitor's full attention. Lucky you."
    ],
    caption: [
      "The Monitor has noticed {name}. {name}, please do the thing.",
      "{name}, you are now the subject of the Monitor's full attention. Lucky you."
    ]
  },
  ambient: {
    audio: [
      "All systems nominal. Probably.",
      "Reminder: blinking is a privilege, not a right.",
      "If you can hear this announcement, you are statistically still alive."
    ],
    caption: [
      "All systems nominal. Probably.",
      "Reminder: blinking is a privilege, not a right.",
      "If you can hear this announcement, you are statistically still alive."
    ]
  }
};

const _rotation = new Map();

function pickIndex(kind) {
  const entry = TEMPLATES[kind] ?? TEMPLATES.ambient;
  const len = entry.audio.length;
  if (len <= 0) return 0;
  const last = _rotation.get(kind) ?? -1;
  let next = Math.floor(Math.random() * len);
  if (len > 1 && next === last) next = (next + 1) % len;
  _rotation.set(kind, next);
  return next;
}

function fillTemplate(line, params) {
  return line.replace(/\{(\w+)\}/g, (_, key) => {
    const v = params?.[key];
    return v != null && v !== "" ? String(v) : "someone";
  });
}

/**
 * @param {string} kind
 * @param {number} idx
 * @returns {string} Path to the static MP3 served from `server/public/voice/`.
 */
export function audioPathFor(kind, idx) {
  const safeKind = String(kind || "ambient").replace(/[^a-z0-9_]/gi, "_");
  return `/voice/${safeKind}_${idx}.wav`;
}

/**
 * @param {{ kind: string, params?: Record<string, string|number|undefined> }} event
 * @returns {Promise<{ kind: string, idx: number, audioText: string, caption: string, audioPath: string, source: "template" }>}
 */
export async function generateMonitorLine(event) {
  const kind = event?.kind && TEMPLATES[event.kind] ? event.kind : "ambient";
  const params = event?.params || {};
  const idx = pickIndex(kind);
  const entry = TEMPLATES[kind];
  const audioText = entry.audio[idx];
  const captionTpl = entry.caption[idx] ?? entry.audio[idx];
  return {
    kind,
    idx,
    audioText,
    caption: fillTemplate(captionTpl, params),
    audioPath: audioPathFor(kind, idx),
    source: "template"
  };
}

/** All required `<kind>_<idx>.mp3` filenames + their script (for recording). */
export function listRequiredAudio() {
  const items = [];
  for (const [kind, entry] of Object.entries(TEMPLATES)) {
    entry.audio.forEach((text, idx) => {
      items.push({ filename: `${kind}_${idx}.mp3`, kind, idx, text });
    });
  }
  return items;
}

export const MONITOR_LINE_KINDS = Object.keys(TEMPLATES);
