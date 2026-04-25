# Nocturne Zoo · web client (React)

Vite + React + TypeScript SPA for the player and OB UIs. Build output is written
into `../public/`, which PartyKit serves via `npm run dev` from the `server/`
folder.

## Routes

| Path                  | Page                                                         |
| --------------------- | ------------------------------------------------------------ |
| `#/`                  | Join (room id + name)                                        |
| `#/onboard`           | Permission gate → photo (cat-face frame) → quiz → reveal     |
| `#/game`              | Player main: rules card, players, log, chat, detection panel |
| `#/ob`                | OB landscape view: players, event log, camera wall           |

`HashRouter` is used so refreshes always work even when PartyKit serves the
SPA without a history fallback.

## Workflow

```bash
# from server/
npm run install:client   # install React dependencies (one-off)
npm run build:client     # build SPA into ./public/
npm run dev              # start PartyKit + serve ./public
```

While iterating quickly:

```bash
npm run dev:client       # vite dev server with HMR (proxies /party → :1999)
npm run dev              # in another terminal, run partykit on the default port
```

## Responsive notes

- Mobile-portrait first, breakpoint upgrades in `src/styles/screens.css`.
- `safe-area-inset-*` is honoured everywhere.
- `prefers-reduced-motion` disables the REC pulse and CSS transitions.
- All inputs use 17px font to avoid iOS Safari auto-zoom.
- HashRouter avoids 404s when reloading sub-routes.

## Camera + detection

- `useCameraStream` wraps `getUserMedia` lifecycle.
- `useFaceMesh` lazy-loads MediaPipe FaceMesh from CDN; if it fails, the rest
  of the UI still works.
- `useCameraFrameUpload` periodically pushes a low-res JPEG over the WS for
  the OB camera wall.
