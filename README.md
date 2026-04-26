# Nocturne Zoo / 深夜动物园

AI Social Horror Game · Hackathon Edition · April 2026

---

## In One Line

Take a photo with your camera, answer 3 eerie questions → get assigned one of three animal identities → survive under the AI Monitor's flashlight by following its rules → the player with the most HP after 2 minutes wins.

---

## At a Glance


|          |                                            |
| -------- | ------------------------------------------ |
| Players  | 3–10 players + 1 OB (Observer)             |
| Duration | 2 minutes per round                        |
| Device   | Mobile or desktop browser, camera required |
| Roles    | 🦁 White Lion · 🦉 Owl · 🦒 Giraffe        |


---

## How to Play

### ① Role Assignment

1. Each player takes a selfie and submits it
2. Answer 3 random multiple-choice questions (A / B / C)
3. The server assigns an animal based on majority answer: most B → 🦁 White Lion, most A → 🦉 Owl, otherwise → 🦒 Giraffe
4. Each player receives a private **Role Card** (visible only to them): animal identity + a unique verdict line

### ② Lobby

- All players enter the Lobby and are automatically marked as ready
- The OB clicks "Start Game" once everyone is ready — all players jump to the main game scene simultaneously

### ③ In Game (2 Minutes)

Players move their animal avatar around the map while the camera drives their character's eyes and mouth in real time.

**Universal Rules** — one rule is broadcast at random every 15 seconds; all players must complete it within 5 seconds:


| Rule                      | Detection                                             |
| ------------------------- | ----------------------------------------------------- |
| 👁️ Blink once            | FaceMesh EAR (eye aspect ratio) drops below threshold |
| 😮 Open your mouth        | FaceMesh MAR (mouth aspect ratio) exceeds threshold   |
| 🙂 Shake or nod your head | FaceMesh nose-tip lateral/vertical displacement       |


**Character Rules** — triggered when the Monitor's flashlight sweeps onto you; complete the action within 8 seconds:


| Role          | Required Action                     | Detection                              |
| ------------- | ----------------------------------- | -------------------------------------- |
| 🦁 White Lion | Open your mouth                     | FaceMesh MAR                           |
| 🦉 Owl        | Keep eyes open for 3s (no blinking) | FaceMesh EAR                           |
| 🦒 Giraffe    | Shake your head                     | FaceMesh nose-tip lateral displacement |


**Victory Conditions** — survive.

### ④ The Monitor (AI)

- Default **Sweep Mode**: flashlight sweeps back and forth while the Monitor patrols the map
- When the cone catches a player, it randomly locks onto one of them → **Lock Mode**
- Lock Mode: the Monitor chases the target; after the 8-second challenge window closes, it returns to sweep
- Touching an ⏰ Alarm item immediately lures the Monitor to that location

### ⑤ HP & Elimination

- Each player starts with **3 HP** (♥♥♥)
- Failing to complete a rule in time → lose 1 HP (synced to server)
- HP reaches 0 → avatar disappears from the map → **Spectator Mode**
  - HP display hidden
  - Free camera: move with WASD / joystick to pan around the full map
  - No more rule challenges

### ⑥ Items

The map always has **3 hearts + 3 alarms** placed at fixed positions:


| Item     | Effect                                                 |
| -------- | ------------------------------------------------------ |
| ❤️ Heart | Touch to restore 1 HP (max 3)                          |
| ⏰ Alarm  | Touch to immediately lure the Monitor to your location |


### ⑦ End of Round

When time runs out, the surviving player with the **most HP wins**.

---

## Controls


| Input               | Action                        |
| ------------------- | ----------------------------- |
| WASD / Arrow keys   | Move in four directions       |
| Virtual joystick    | Drag on mobile — analog input |
| Click / tap the map | Auto-walk to that point       |


---

## Monitor Voice (PA System)

The game has a built-in AI Monitor PA broadcast system — tone: calm officialese + dry black humour (inspired by Two Point Hospital's PA).

- **Audio**: pre-recorded static MP3s (generated with ElevenLabs), served from `server/public/voice/`
- **Triggers**: game start, rule violation, item pickup, player eliminated, time warnings, game end
- **Captions**: every line has a real-time caption with the player's name interpolated — works silent too
- **Playback rules**: priority queue · mono · ≥3s cooldown between lines · same-kind dedup within 10s
- **Optional live TTS**: set `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` to switch to real-time synthesis

---

## OB (Observer)

- Join via `/#/ob` with the same room name
- See all players' positions on the full map in real time
- Sidebar shows a live camera wall of every player's face
- Three map camera modes: centroid follow / follow one player / free pan
- Responsible for clicking "Start Game" once all players are ready
- OB device is the main audio channel (best for streaming or a shared screen)

---

## Tech Stack


| Layer              | Technology                                                          |
| ------------------ | ------------------------------------------------------------------- |
| Multiplayer server | PartyKit WebSocket                                                  |
| Client framework   | Vite + React + TypeScript                                           |
| Game world         | SVG map with camera group following the player                      |
| Action detection   | MediaPipe FaceMesh (EAR / MAR / nose-tip offset)                    |
| Expression driving | FaceMesh drives avatar eyes & mouth in real time (Live2D-style)     |
| Sound effects      | Web Audio API (`.wav` files)                                        |
| Background music   | `bgm/Midnight Gate Rules.wav`                                       |
| Voice broadcast    | ElevenLabs pre-recorded MP3 / optional live TTS                     |
| Role assignment    | Answer-majority deterministic fallback (Claude Vision API reserved) |


---

## Folder Structure

```
BitterHands/
├── main scene/          # Main game view (SVG world + FaceMesh, standalone HTML)
├── determination/       # Action detection demo (shake / mouth / blink)
├── resource/            # Sound effects (addHealth.wav, minusHealth.wav, alarm.mp3)
├── bgm/                 # Background music
└── server/
    ├── src/             # PartyKit server (server.js, monitorLines.js, voice.js…)
    ├── app/             # React + TypeScript client source
    └── public/          # Build output (SPA + main-scene iframe + audio assets)
```

---

## Running Locally

```bash
cd server
npm install
npm run dev -- --port 0
```

After starting, the terminal prints your local address (`127.0.0.1`) and LAN IP — phones on the same Wi-Fi can join using the LAN IP.

**After editing the React client source, rebuild:**

```bash
cd server/app
npm run build
```

> Note: mobile devices load from `server/public/` (the build output). Changes to `server/app/src/` won't take effect on mobile until you rebuild.

