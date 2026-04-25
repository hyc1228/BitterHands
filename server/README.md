# Nocturne Zoo PartyKit Server

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

## Debug endpoints

- `GET /party/<roomId>/health`
- `GET /party/<roomId>/state`

