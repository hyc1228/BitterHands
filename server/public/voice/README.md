# Monitor PA voice library — recording sheet

Drop **24 pre-recorded MP3s** into this folder. The server (`_dispatchMonitorLine`)
broadcasts `/voice/<filename>` and the client plays it directly — zero runtime
API calls, identical voice quality every time.

Player names are added to **captions** at runtime, never to the audio, so
this script is a fixed list of 24 generic announcements.

---

## Character: Bunbury, AI Rabbit Monitor

**One-line persona**: A pastel-cheerful AI rabbit mascot trapped inside a
corporate PA system at a nocturnal zoo. Polite. Bureaucratic. Mildly
threatening. Never raises its voice. The dissonance is the joke.

**Reference**: Two Point Hospital PA × Welcome to Night Vale × Portal's GLaDOS
× a children's theme-park mascot reading HR termination notices.

**Tone rules**:
- Deadpan British delivery is the floor. Add a fake-chipper warmth on top.
- Never sounds angry. Never sounds scared. Never *loud*.
- "Customer service voice but the customer is being eaten."
- All lines are 7-18 words. Recordings should land 2.5-5 seconds.

You can paste this paragraph into ElevenLabs as the voice description:

> Bunbury is the polite, deadpan AI rabbit announcer of Nocturne Zoo. Mid-range
> female British voice, calm and measured, with a corporate-mascot warmth that
> makes every threat sound like a wellness tip. Always polite, never raised,
> always slightly amused. Think: Two Point Hospital PA system voiced by a HR
> chatbot wearing a bunny costume.

---

## ElevenLabs setup

**Model**: `Eleven v3 (alpha)` — the audio-tag-aware expressive model.
Plain v2/Turbo also works but you lose the tag direction.

**Recommended voice library picks** (pick **one** and lock it for all 24):
1. **Lily** — gentle British female, deadpan range. Best fit for Bunbury.
2. **Charlotte** — sweet British, slightly playful.
3. **Rachel** — calmer / more neutral British.
4. **Aria** — modern expressive, US accent (if you want non-British).

If your account allows voice cloning, clone a polite British receptionist
sample for max effect.

**Style settings** (v3 alpha):
- Stability: **Natural** (the middle preset). Don't go Robust — it kills the
  ironic warmth.
- Style exaggeration: **0–30**. v3 is already expressive; don't oversteer.
- Speed: **1.0** (or 0.95 for slightly more bureaucratic weight).

**Audio tag conventions used below**:
- `[deadpan]` `[bureaucratic]` `[chipper]` — voice direction
- `[british]` — accent reinforce (only needed if base voice drifts)
- `[whispers]` — for the monitor_lock variant
- `...` (ellipsis) = beat / micro-pause
- CAPS = soft emphasis (don't over-use)
- Tags go at the **start** of the line; one or two max.

---

## Recording workflow

1. Set the voice + settings above. Lock the voice for the entire batch.
2. For each line: copy the **v3 prompt** (the boxed text), generate, listen,
   regenerate once or twice if needed, download MP3.
3. Rename to the **filename** in backticks. Drop into this directory.
4. Optional: in Audacity, trim ~50 ms of leading/trailing silence so lines
   chain cleanly when the queue plays back-to-back.

When all 24 files exist here, the game is fully voiced. Missing files just
play caption-only — the rest of the game is unaffected.

---

## The 24 lines

> Each block has: filename · v3 prompt to paste · plain caption text (already
> in `monitorLines.js`, here for reference).

### Game start

- [ ] **`game_started_0.mp3`**
  - **Prompt**: `[chipper, deadpan british] Welcome back, residents... the night shift has begun.`
  - Caption: `Welcome back, residents. The night shift has begun.`

- [ ] **`game_started_1.mp3`**
  - **Prompt**: `[bureaucratic, polite] All visitors, please proceed to the nearest existential crisis... thank you.`
  - Caption: `All visitors, please proceed to the nearest existential crisis. Thank you.`

- [ ] **`game_started_2.mp3`**
  - **Prompt**: `[chipper, deadpan] The zoo is now open... please remain delicious.`
  - Caption: `The zoo is now open. Please remain delicious.`

### Game ended

- [ ] **`game_ended_0.mp3`**
  - **Prompt**: `[deadpan, soothing] The night shift has concluded. Please collect your belongings... and your soul.`
  - Caption: `The night shift has concluded. Please collect your belongings and your soul.`

- [ ] **`game_ended_1.mp3`**
  - **Prompt**: `[deadpan, faintly amused] Closing time. The Monitor has had a perfectly normal evening.`
  - Caption: `Closing time. The Monitor has had a perfectly normal evening.`

### Winner

- [ ] **`winner_0.mp3`**
  - **Prompt**: `[chipper, bureaucratic] Congratulations to our survivor. You may now go home... please leave your soul in the lobby.`
  - Caption: `Congratulations, {name}. You may now go home. Please leave your soul in the lobby.`

- [ ] **`winner_1.mp3`**
  - **Prompt**: `[deadpan, polite] We have a winner. A modest plaque has been ordered.`
  - Caption: `{name} has outlasted the competition. A modest plaque has been ordered.`

### Heart pickup

- [ ] **`pickup_heart_0.mp3`**
  - **Prompt**: `[chipper, bureaucratic] A resident has acquired one unit of joy. Productivity is up zero point three percent.`
  - Caption: `{name} has acquired one (1) unit of joy. Productivity is up 0.3%.`

- [ ] **`pickup_heart_1.mp3`**
  - **Prompt**: `[deadpan, mildly cheerful] Heart detected. Please consume responsibly.`
  - Caption: `Heart detected on {name}. Please consume responsibly.`

- [ ] **`pickup_heart_2.mp3`**
  - **Prompt**: `[deadpan, fake-warm] Someone is now thirty-three percent more alive. Please don't get used to it.`
  - Caption: `{name} is now 33% more alive. Please don't get used to it.`

### Alarm pickup

- [ ] **`pickup_alarm_0.mp3`**
  - **Prompt**: `[deadpan, slightly concerned] An alarm clock has been triggered. The Monitor would like a word.`
  - Caption: `{name} has triggered an alarm clock. The Monitor would like a word.`

- [ ] **`pickup_alarm_1.mp3`**
  - **Prompt**: `[chipper, deadpan] The Monitor is on the way. Please prepare a small smile.`
  - Caption: `{name}, the Monitor is on the way. Please prepare a small smile.`

- [ ] **`pickup_alarm_2.mp3`**
  - **Prompt**: `[bureaucratic, deadpan] Attention. Somebody has rung the dinner bell. Unfortunately... they are the dinner.`
  - Caption: `Attention: {name} has rung the dinner bell. Unfortunately, they are the dinner.`

### Violation

- [ ] **`violation_0.mp3`**
  - **Prompt**: `[deadpan, faintly disappointed] A resident has failed to comply. Please apologize to the camera.`
  - Caption: `Unfortunately, {name} has failed to comply. Please apologize to the camera.`

- [ ] **`violation_1.mp3`**
  - **Prompt**: `[deadpan, polite] Someone appears to have forgotten the rules. The Monitor remembers.`
  - Caption: `{name} appears to have forgotten the rules. The Monitor remembers.`

- [ ] **`violation_2.mp3`**
  - **Prompt**: `[bureaucratic, deadpan] Compliance failure detected. Minus one life. Have a tolerable day.`
  - Caption: `Compliance failure for {name}. Minus one (1) life. Have a tolerable day.`

### Eliminated

- [ ] **`eliminated_0.mp3`**
  - **Prompt**: `[chipper, deadpan] A resident has been promoted to compost. Please congratulate the management.`
  - Caption: `{name} has been promoted to compost. Please congratulate {name}.`

- [ ] **`eliminated_1.mp3`**
  - **Prompt**: `[deadpan, soothing] One of you is no longer with us. Their performance review is final.`
  - Caption: `{name} is no longer with us. Their performance review is final.`

- [ ] **`eliminated_2.mp3`**
  - **Prompt**: `[deadpan, polite] We thank the deceased for their service. Their locker will be cleaned.`
  - Caption: `We thank {name} for their service. Their locker will be cleaned.`

### Monitor lock

- [ ] **`monitor_lock_0.mp3`**
  - **Prompt**: `[whispers, deadpan] The Monitor has noticed someone... please do the thing.`
  - Caption: `The Monitor has noticed {name}. {name}, please do the thing.`

- [ ] **`monitor_lock_1.mp3`**
  - **Prompt**: `[chipper, deadpan] You are now the subject of the Monitor's full attention. Lucky you.`
  - Caption: `{name}, you are now the subject of the Monitor's full attention. Lucky you.`

### Ambient

- [ ] **`ambient_0.mp3`**
  - **Prompt**: `[bored, deadpan] All systems nominal... probably.`
  - Caption: `All systems nominal. Probably.`

- [ ] **`ambient_1.mp3`**
  - **Prompt**: `[deadpan, polite reminder] Reminder. Blinking is a privilege, not a right.`
  - Caption: `Reminder: blinking is a privilege, not a right.`

- [ ] **`ambient_2.mp3`**
  - **Prompt**: `[bureaucratic, deadpan] If you can hear this announcement, you are statistically still alive.`
  - Caption: `If you can hear this announcement, you are statistically still alive.`

---

## ElevenLabs Music — background tracks (optional)

For the BGM layer. Compose **one main loop** + **two short stingers**. All
should sit *quietly* under the PA voice, never compete with it. Keep BPM
slow (60–80) and avoid drum kits.

### Main loop (60–90 s, looped) — `voice/bgm_main.mp3`

> **Prompt**:
> `Slow lo-fi elevator music for a haunted nocturnal zoo. Gentle vintage xylophone over a soft upright bass, slightly detuned, looping bossa nova rhythm at 70 BPM. No drum kit. Sparse glockenspiel chimes. Mood: polite corporate hold music in an empty waiting room that may not be safe. Two Point Hospital meets a 1970s zoo PA system. Mildly unsettling, never frightening.`
>
> **Style preset**: `Lo-fi / Ambient / Cinematic`. Loopable: yes. Length: 60-90s.

### Tension swell (final 30s) — `voice/bgm_endgame.mp3`

> **Prompt**:
> `Cheerful vintage zoo mascot theme slowly distorting and detuning over 25 seconds. Starts as a music-box bunny waltz at 80 BPM, gradually adds reverb tail, pitch wobble, and a low brass drone underneath. Resolves into a single sweet bell chime. No drums. Like a children's mascot song slowly being eaten by static.`
>
> **Style preset**: `Cinematic / Score`. Length: 25-30s.

### Round-end sting (3-5s) — `voice/bgm_outro.mp3`

> **Prompt**:
> `Three-second ironic corporate outro jingle. Two notes of warm brass, a polite female "thank you" chime on glockenspiel, then silence. Style: end of a 1980s HR training video. No vocals.`
>
> **Style preset**: `Score / Sting`. Length: 3-5s.

### Lobby loop (optional, 60s) — `voice/bgm_lobby.mp3`

> **Prompt**:
> `Soft music-box bunny lullaby at 60 BPM. Vintage celesta and felt piano playing a gentle four-note motif. Light tape hiss for analog warmth. Mood: an empty kindergarten waiting room, slightly off-key. No percussion. No vocals. Loopable.`
>
> **Style preset**: `Ambient / Music Box`. Length: 60s.

> **BGM mixing tip**: target **-22 dB to -18 dB** loudness so the PA voice
> sits clearly on top. Add a **-12 dB sidechain duck** (or simulate by mixing
> the BGM ~6 dB lower under voice events) — this is what gives Two Point its
> "PA cuts through the muzak" feel.

---

## Adding a new line

1. Edit `server/src/monitorLines.js` and append a new entry to the matching
   `audio` and `caption` arrays.
2. Note the new index — filename is `<kind>_<idx>.mp3`.
3. Add an entry above with the v3 prompt and caption text.
4. Record it in ElevenLabs and drop it here.
5. The server starts using it automatically on next start.

## Regenerating this filename list

`node -e "import('../../src/monitorLines.js').then(m => m.listRequiredAudio().forEach(it => console.log(it.filename, '—', it.text)))"`
from this directory.
