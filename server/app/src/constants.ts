/** Default PartyKit room id when none is stored in localStorage */
export const DEFAULT_ROOM_ID = "junction";

/**
 * Iframe page for the in-zoo prototype, relative to the SPA origin. Source of truth: repo
 * root `main scene/` (copied to `public/main-scene` by `server/scripts/sync-main-scene.mjs` on build).
 * Set `VITE_MAIN_SCENE_PATH` in `.env` to override. Lives at site root: PartyKit rewrites
 * `main-scene/*.html` to the React shell, so the prototype is `nz-scene.html` with `<base href="/main-scene/">`.
 */
export const DEFAULT_MAIN_SCENE_PATH = "nz-scene.html";

/** Max face slots on the OB “camera wall” (matches server room cap). */
export const OB_FACE_SLOTS = 10;

/** In lobby, how many player feeds to highlight up top (build-profile watch). */
export const OB_LOBBY_SPOTLIGHTS = 4;

/**
 * Public URL for the main-scene HTML (iframe). Same for player MainScene and OB backdrop.
 */
export function getMainSceneFrameSrc(): string {
  const rel = import.meta.env.VITE_MAIN_SCENE_PATH?.trim() || DEFAULT_MAIN_SCENE_PATH;
  const base = import.meta.env.BASE_URL;
  return base.endsWith("/") ? `${base}${rel}` : `${base}/${rel}`;
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
