/** Default PartyKit room id when none is stored in localStorage. Lowercase so
 *  case-insensitive entry ("Supercell" / "SUPERCELL" / "supercell") all
 *  resolve to the same Durable Object. UI displays via .toUpperCase(). */
export const DEFAULT_ROOM_ID = "supercell";

/** Older defaults we want to overwrite if a returning visitor still has them in
 *  localStorage; otherwise they'd silently keep landing in the wrong room.
 *  Stored values are compared case-insensitively. */
const STALE_DEFAULT_ROOM_IDS = new Set([
  "junction", "main", "lobby", "default", "test-room", "hackathon", "supercell"
]);

/** Read the user's chosen room from localStorage. Always normalises to
 *  lowercase + auto-clears stale legacy defaults. Lowercase match is what
 *  makes the room code case-insensitive end-to-end. */
export function readStoredRoomId(storageKey: "nz.roomId" | "nz.obRoom" = "nz.roomId"): string {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return DEFAULT_ROOM_ID;
    const lower = raw.trim().toLowerCase();
    if (!lower) return DEFAULT_ROOM_ID;
    if (STALE_DEFAULT_ROOM_IDS.has(lower) && lower !== DEFAULT_ROOM_ID) {
      localStorage.removeItem(storageKey);
      return DEFAULT_ROOM_ID;
    }
    // Backfill: rewrite the stored value in canonical lowercase so future
    // reads (and other tabs sharing localStorage) all land on the same room.
    if (lower !== raw) {
      try { localStorage.setItem(storageKey, lower); } catch { /* ignore */ }
    }
    return lower;
  } catch {
    return DEFAULT_ROOM_ID;
  }
}

/**
 * Iframe page for the in-zoo prototype, relative to the SPA origin. Source of truth: repo
 * root `main scene/` (copied to `public/main-scene` by `server/scripts/sync-main-scene.mjs` on build).
 * Set `VITE_MAIN_SCENE_PATH` in `.env` to override. Production: `/main-scene/_iframe` is
 * intercepted by `server/src/server.js#onFetch` to re-emit `main-scene/index.html` with
 * `X-Frame-Options: SAMEORIGIN` (PartyKit static defaults to `DENY` which blocks iframes).
 * Local Vite dev: `nz-iframe-dev` middleware in `vite.config.ts` serves the same path.
 */
export const DEFAULT_MAIN_SCENE_PATH = "main-scene/_iframe";

/** Max face slots on the OB “camera wall” (matches server room cap). */
export const OB_FACE_SLOTS = 20;

/** In lobby, how many player feeds to highlight up top (build-profile watch). */
export const OB_LOBBY_SPOTLIGHTS = 4;

/**
 * Public URL for the main-scene HTML (iframe). Same for player MainScene and OB backdrop.
 */
export function getMainSceneFrameSrc(): string {
  const rel = import.meta.env.VITE_MAIN_SCENE_PATH?.trim() || DEFAULT_MAIN_SCENE_PATH;
  const base = import.meta.env.BASE_URL;
  const sep = base.endsWith("/") ? "" : "/";
  // Absolute path so HashRouter location changes don't shift relative resolution.
  if (rel.startsWith("/")) return rel;
  return `${base}${sep}${rel}`;
}

/** Quirky guest nicknames for the Join screen (one picked at random per visit, English). */
const FUN_DEFAULT_NAMES = [
  "NightWatch_Moth",
  "ThirdBlink",
  "RustLight",
  "OffTheBooks",
  "TicketBooth_Dusk",
  "RoarBuffering",
  "GiraffeInTraining",
  "SilentOwl",
  "RulesLawyer_404",
  "NeckStretch_Pro",
  "Visitor_Anon",
  "LastTrain_Conductor",
  "WhiteLion_SoundCheck",
  "FogWatcher",
  "ZooAfterDark",
  "InscryptionFan_7",
  "OnlyTheWind",
  "ReadOnly_Rules",
  "TempKeeper",
  "AfterHours_Guest",
  "DriftShifter",
  "MidnightArchivist",
  "NocturneTourist"
] as const;

export function pickRandomDefaultName(): string {
  const i = Math.floor(Math.random() * FUN_DEFAULT_NAMES.length);
  return FUN_DEFAULT_NAMES[i] ?? "NocturneTourist";
}
