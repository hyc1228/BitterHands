/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * When set, WebSockets use `wss://<this-host>/party/<room>` (PartyKit cloud / custom deploy)
   * instead of the page’s `location.host`. Use when the static app is on Vercel and rooms run on PartyKit.
   * Example: `nocturne-zoo.yourname.partykit.dev` (no `https://`).
   */
  readonly VITE_PARTYKIT_HOST?: string;
  /** Optional path for the main-scene iframe (default `main-scene/_iframe` — see constants.ts). */
  readonly VITE_MAIN_SCENE_PATH?: string;
  /**
   * Operator-only key required to enter `/ob`. If unset at build time, falls back to a
   * hardcoded default in `lib/obAuth.ts` (still keeps casual users out — they don't know
   * the URL nor the key — but you should set this in `.env.production` for real games).
   */
  readonly VITE_OB_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
