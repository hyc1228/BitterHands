/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * When set, WebSockets use `wss://<this-host>/party/<room>` (PartyKit cloud / custom deploy)
   * instead of the page’s `location.host`. Use when the static app is on Vercel and rooms run on PartyKit.
   * Example: `nocturne-zoo.yourname.partykit.dev` (no `https://`).
   */
  readonly VITE_PARTYKIT_HOST?: string;
  /** Optional path under site root for the main-scene iframe (default `main-scene/index.html`). */
  readonly VITE_MAIN_SCENE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
