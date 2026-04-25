/** Default PartyKit room id when none is stored in localStorage */
export const DEFAULT_ROOM_ID = "junction";

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
