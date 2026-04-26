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

// gif.js ships as plain JS without bundled types. We only use the constructor
// + addFrame + render + on(event, cb), so a thin declaration is enough.
declare module "gif.js" {
  interface GifOptions {
    workers?: number;
    quality?: number;
    width?: number;
    height?: number;
    workerScript?: string;
    background?: string;
    transparent?: number | null;
    repeat?: number;
    dither?: false | "FloydSteinberg" | "FalseFloydSteinberg" | "Stucki" | "Atkinson";
  }
  interface AddFrameOptions {
    delay?: number;
    copy?: boolean;
    dispose?: number;
  }
  type GifFrameInput =
    | HTMLImageElement
    | HTMLCanvasElement
    | CanvasRenderingContext2D
    | ImageData;
  export default class GIF {
    constructor(opts?: GifOptions);
    addFrame(image: GifFrameInput, opts?: AddFrameOptions): void;
    render(): void;
    abort(): void;
    on(event: "start", cb: () => void): void;
    on(event: "progress", cb: (pct: number) => void): void;
    on(event: "abort", cb: () => void): void;
    on(event: "finished", cb: (blob: Blob) => void): void;
  }
}

// Vite's `?url` import for the gif.js worker script.
declare module "gif.js/dist/gif.worker.js?url" {
  const url: string;
  export default url;
}
