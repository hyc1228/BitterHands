# Nocturne Zoo — itch.io page assets

Everything you need to fill out the itch.io project page, ready to copy-paste.
Open the project in **Edit** mode at:

  https://huyuchen.itch.io/nocturne-zoo/edit

The build is already live (butler push #17329097, version `2026-04-27-2988d6c`).
You only need to add: cover image, screenshots, description, tags, embed
options. Everything below is in English as you requested.

---

## 1. Cover image

Drag-and-drop into the **Cover image** field at the top of the edit page:

  itch-assets/cover.png   (1200 × 950, ~230 KB)

itch will downscale this for the grid; the title is centered so it survives
both wide thumbnails and the small browse-page tile.

---

## 2. Screenshots

Use the **Screenshots** section — drag all six in this order so the gallery
reads "concept first, then mobile reality":

  1. itch-assets/screenshot-1-title.png        (1920×1080, hero / title)
  2. itch-assets/screenshot-2-howitplays.png   (1920×1080, game flow)
  3. itch-assets/screenshot-3-ai.png           (1920×1080, AI tech)
  4. itch-assets/screenshot-4-mobile-lobby.png (mobile, in-game lobby)
  5. itch-assets/screenshot-5-mobile-camera.png (mobile, camera detection)
  6. itch-assets/screenshot-6-mobile-ai.png    (mobile, AI animal reveal)

---

## 3. Title & tagline

  Title:    Nocturne Zoo
  Subtitle: A 2-minute AI horror social game — played on your phone

(Subtitle goes in the **"Short description or tagline"** field.)

---

## 4. Description (paste into the rich-text body)

> ### A 2-minute AI horror social game — played on your phone.
>
> Five to ten players gather in the same room (or on the same call). Each
> player joins from their phone — no app, no install, just the URL. Claude
> looks at your face, listens to your answers, and decides whether you are
> a **Lion**, an **Owl**, or a **Giraffe**. Then the lights go down, the
> Monitor's voice comes on the PA system, and you have two minutes to obey
> the rules of your animal.
>
> **Roar for at least two seconds.** **Don't blink for three seconds.**
> **Shake your head when you hear the bell.**
>
> Your phone's front camera watches you in real time. MediaPipe detects
> blinks, head shakes, and roars; ElevenLabs gives the Monitor its calm,
> faintly menacing PA voice; Claude writes the verdicts and one-line
> commentary. The gaze locks onto one player at a time, and survivors
> are announced at roll call.
>
> ---
>
> **How to play**
>
> 1. Open the game on your phone — pick a 4-letter room code and share it
>    with the table.
> 2. Each player joins the same code. Hold your phone steady; Claude
>    scans your face and assigns your animal.
> 3. The host (first player in) presses **Start**. Two minutes on the
>    clock. Obey your private rules. Survive the gaze.
> 4. Roll call. Survivors win. The award ceremony picks the loudest, the
>    least-blinking, and the most-roared.
>
> ---
>
> **Spectator mode (Observer / OB)**
>
> Want to project the game on a TV? Open the same room on a laptop, hit
> **Spectate**, and you get a live wall of every player's camera feed,
> the shared map, the Monitor's voice, and the running scoreboard.
> Perfect for a hackathon demo or a living-room screen.
>
> ---
>
> **Tech**
>
> Built in 48 hours at **Junction 2026**. Real-time multiplayer on
> [PartyKit](https://www.partykit.io/) (Cloudflare Durable Objects),
> face detection via [MediaPipe FaceMesh](https://developers.google.com/mediapipe),
> animal verdicts and commentary by [Claude](https://www.anthropic.com/claude),
> Monitor voice synthesised by [ElevenLabs](https://elevenlabs.io/),
> all running on the open Web Audio API in the browser.
>
> ---
>
> ⚠️ **Camera permission required.** When the page loads, click the
> fullscreen icon — itch.io's iframe doesn't pass camera access through,
> but the fullscreen button opens the game in a top-level browsing
> context where the browser will ask you to share the camera. Accept,
> and you're in.
>
> 🎧 Headphones recommended — the Monitor's PA voice is half the show.

---

## 5. Genre / Tags / Classification

  Genre:           Simulation  (closest fit; the game has no clean genre)
  Made with:       HTML5
  Tags:            multiplayer, horror, social, party-game, webcam,
                   ai, claude, elevenlabs, mobile, hackathon
  Average session: A few minutes
  Languages:       English, Simplified Chinese
  Inputs:          Mouse, Touchscreen
  Accessibility:   Configurable difficulty level
                   (none of the others apply — leave blank)

---

## 6. Embed options (the section that decides if it actually works)

This section is critical because the game needs the camera. itch.io's
default iframe does NOT forward `getUserMedia` permissions — but the
"fullscreen" button opens the game in a real browser tab where the
camera prompt fires normally.

  Viewport dimensions:           1280 × 800
  Frame options:
    [x] Mobile friendly  (orientation: Sensor)
    [x] Automatically start on page load   (optional, off is also fine)
    [x] Fullscreen button
    [x] Click anywhere to launch in fullscreen   <-- REQUIRED
    [ ] Enable scrollbars
  Display:
    [ ] Show preloader before game loads   (off — game has its own splash)

---

## 7. Pricing & visibility

  Pricing:               No payments  (or "Free, with optional donation")
  Release status:        Released  (after you've tested fullscreen mode)
  Visibility & access:   Public  (or keep Draft until you've tested)

---

## 8. Devlog post (optional but nice for hackathon)

After saving, click **"Edit game" → "Devlog" → "New post"** and paste:

  Title:  Built in 48h at Junction 2026
  Body:
    > Nocturne Zoo started as a single question: what if Claude could
    > see your face? Two minutes, 5–10 players, three animal identities,
    > one PA voice. Built in a long Helsinki weekend with PartyKit,
    > MediaPipe, Claude, and ElevenLabs.
    >
    > Source: https://github.com/hyc1228/BitterHands

---

## 9. Sanity checks before going public

- [ ] Click **View page** and try **Run game** → fullscreen → camera grants
- [ ] Open `https://huyuchen.itch.io/nocturne-zoo` on a phone — try joining
- [ ] Open a second tab as **Spectate** to verify OB mode renders
- [ ] If anything breaks, just rebuild + re-push:
        npm --prefix server/app run deploy:itch

---

Push history (butler tags every upload with date + git sha):
  v=2026-04-27-2988d6c  →  build #1640246
