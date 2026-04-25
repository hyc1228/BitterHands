# Nocturne Zoo PartyKit Server

## Troubleshooting: page won’t open / `GET /` is 404

The SPA is served from `./public` with **single-page-app fallback** enabled in `partykit.json` (`serve.path` + `serve.singlePageApp: true`). Without `singlePageApp`, opening `http://127.0.0.1:<port>/` can return 404 even though websockets work.

After pulling changes, run `npm run build:client` so `public/index.html` and `public/assets/*` exist.

## What this is

`server/` is a minimal PartyKit room server that matches the message types described in **Nocturne Zoo GDD v0.6**:

- `join`
- `submit_photo`
- `submit_answers` (assigns animal + verdict; currently fallback, AI stubs)
- `start`
- `violation`
- `chat`
- `owl_submit`
- `end`

## Run locally

```bash
cd server
npm install
npm run dev
```

By default the PartyKit dev server starts on a local port and prints the URL(s) to connect.

Serves whatever is in `public/` (run `npm run build:client` after pulling so the React app is up to date).

## Quick test (multiplayer on LAN)

One command builds the client and starts PartyKit on a **fixed port** (matches the Vite dev proxy in `app/vite.config.ts` if you use two terminals later):

```bash
cd server
npm install
npm run playtest
```

Then:

1. In the terminal, use the **LAN** URL (e.g. `http://192.168.x.x:1999/`) on other devices on the same Wi‑Fi, or open multiple browsers/tabs to `http://127.0.0.1:1999/`.
2. Use the same **room** (default is `junction` in the app) and different **names** so everyone lands in the same room.

**Hot-reload while coding UI** (two terminals): `npm run dev -- --port 1999` in `server/`, and in `server/app/` run `npm run dev` (Vite proxies WebSocket `/party` → `127.0.0.1:1999`).

## Run on LAN (same Wi‑Fi)

PartyKit dev binds to `0.0.0.0` by default and will print both `127.0.0.1` and your LAN IP (e.g. `192.168.x.x` / `172.20.x.x`).

If you want a fixed port (recommended for LAN), run:

```bash
cd server
npm run dev -- --port 1999
```

If that port is already taken, pick another (or ask for a random free port):

```bash
cd server
npm run dev -- --port 0
```

On another device in the same Wi‑Fi, open the printed LAN URL.

### Camera / microphone on other phones (HTTPS)

Browsers only allow `getUserMedia` in a **secure context**: `https://`, `http://localhost`, or `http://127.0.0.1`. If others open `http://192.168.x.x:1999/`, **`navigator.mediaDevices` is often missing** (you may see a red error on the permission modal). The WebSocket code already uses `wss://` when the page is served over HTTPS.

**Options:**

1. **Tunnel (quickest for demos)** — e.g. `ngrok http 1999` and share the `https://` URL so everyone uses HTTPS.
2. **HTTPS in PartyKit** — install [mkcert](https://github.com/FiloSottile/mkcert), create a cert for your LAN IP, then (after `npm run build:client`):

   ```bash
   cd server
   partykit dev ./src/server.js --port 1999 --https --https-key-path ./certs/localhost+2-key.pem --https-cert-path ./certs/localhost+2.pem
   ```

   Use the file names mkcert prints; **install the mkcert root CA** on the phone so the browser trusts the cert. Open `https://<LAN-IP>:1999/`.

3. **Two-terminal dev (Vite + PartyKit)** — for UI hot-reload, run PartyKit on 1999 with HTTPS as above, and configure Vite with HTTPS + the same (or matching) cert so `https://<LAN-IP>:5173` loads the app and the `/party` proxy still hits `wss` on 1999.

## No public VPS — only this computer (recommended setups)

You do **not** need a dedicated cloud server. Pick one of these.

### A) **Best for “play sessions while my PC is on” (nothing to buy)**

Run PartyKit on a fixed port so **one** process serves both the SPA and `/party` WebSockets, then put a public **HTTPS** URL in front of it with a **tunnel** (the tunnel is not “your” server; it just forwards to `127.0.0.1` on your machine).

1. In `server/`: `npm run playtest` (serves the built client and PartyKit on **1999** by default).
2. On the same computer, start a tunnel to **1999**:
   - [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) (`cloudflared` quick tunnel), or
   - [ngrok](https://ngrok.com/): `ngrok http 1999`
3. Share the printed `https://…` link. Everyone (including other Wi‑Fi / mobile data) opens that; the browser gets a **real HTTPS** origin, so **camera/mic and `wss://` work** with your current `location.host` code (same host for page + WebSocket).
4. **Your PC must stay on** and the game process + tunnel must keep running for that play session.

**Notes:** Free tunnels sometimes add a one-time interstitial (ngrok) or change the URL when you restart the tunnel. For repeated tests, a fixed tunnel in a free Cloudflare/ngrok account is smoother.

### B) **Best for “I don’t want my PC on 24/7” (still no VPS to manage)**

1. **Deploy PartyKit** (the room + WebSocket server; see [PartyKit deploying](https://docs.partykit.io/guides/deploying-your-server)):
   ```bash
   cd server
   npm install
   npx partykit login
   npm run build:client
   npx partykit deploy ./src/server.js --name nocturne-zoo
   ```
   The CLI prints your app URL. Note the **hostname** (e.g. `nocturne-zoo.<user>.partykit.dev` — exact shape depends on your account).

2. **Deploy the static client (Vercel recommended)** from `server/app/`:
   - In the [Vercel](https://vercel.com) project settings, set **Root Directory** to `server/app` (or import this monorepo and point the app at that folder).
   - Add an environment variable **`VITE_PARTYKIT_HOST`** = that hostname **only** (no `https://`). Example: `nocturne-zoo.xxx.partykit.dev`  
     Copy from `server/app/.env.example` if you like.
   - Vercel sets `VERCEL=1` during build so the client is emitted to `dist/`; `vercel.json` is included for a plain Vite static deploy.
   - Redeploy whenever you change `VITE_PARTYKIT_HOST` or after a new `partykit deploy`.

3. The browser loads your game from Vercel (`https://…`) and opens WebSockets to `wss://<VITE_PARTYKIT_HOST>/party/<room>`.

**Local dev (unchanged):** do **not** set `VITE_PARTYKIT_HOST` — the app still uses the Vite dev server + `/party` proxy to `127.0.0.1:1999` as before.

The heavy lifting runs on **PartyKit + static host**; you develop on your own computer.

### Quick comparison

| | **A) PC + tunnel** | **B) PartyKit deploy + static** |
| --- | --- | --- |
| Your PC on | Required during the session | Not required to play |
| Public HTTPS for phones | From tunnel (no router port-forward) | From Vercel + PartyKit’s host |
| WebSocket to PartyKit | Same origin as the page (tunnel) | `VITE_PARTYKIT_HOST` in Vite env |

## Debug endpoints

- `GET /party/<roomId>/health`
- `GET /party/<roomId>/state`

