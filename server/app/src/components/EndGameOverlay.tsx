import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import GIF from "gif.js";
import gifWorkerUrl from "gif.js/dist/gif.worker.js?url";
import { animalLocalized, dict } from "../i18n";
import { usePartyStore } from "../party/store";
import { Animals, animalEmoji } from "../party/protocol";

/**
 * Hard-isolation boundary around each ceremony stage panel.  The end-game
 * overlay sometimes lights up against a server payload it doesn't fully
 * understand — most often when a phone is running a stale JS bundle
 * cached during an earlier deploy.  Without this wrapper, a render-time
 * crash inside `IntroPanel` / `AwardPanel` / `SummaryPanel` unmounts the
 * entire ceremony tree but leaves the dark `endgame-mask` backdrop on
 * screen, producing the "ceremony is just a black screen" failure mode
 * we keep getting bug reports for.  With it, the boundary catches the
 * throw, renders a small fallback card with explicit "reload / back
 * home" actions, and the user always has a way out.
 */
class StageErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[ceremony] stage panel crashed", error, info?.componentStack);
  }
  render() {
    if (this.state.error) return this.props.fallback;
    return this.props.children;
  }
}
import type {
  GameEnded,
  GameEndedAward,
  GameEndedRevealEntry,
  AnimalCode,
  Lang,
  FaceCounts,
  HighlightBurst,
  PlayerHighlights
} from "../party/protocol";
import type { dict as dictFn } from "../i18n";

type Dict = ReturnType<typeof dictFn>;
/**
 * Hydrated reveal entry: server-side metadata from `GAME_ENDED.reveal[]`
 * plus the heavy media (highlights, fallback frames, portrait sources)
 * that arrives via separate `GAME_ENDED_MEDIA` broadcasts.  The ceremony
 * renders against this merged shape so every panel stays oblivious to
 * the split-message wire protocol.  Media fields stay optional because
 * the matching `GAME_ENDED_MEDIA` may not have arrived yet, may have
 * been pruned by the server's size guard, or may have come from an
 * older "single-message" server build that embedded everything in
 * `GAME_ENDED.reveal[]` directly (handled below by the merge fallback).
 */
type RevealEntry = GameEndedRevealEntry;
type AwardKey = "mouth" | "shake" | "blink";

const BURST_PLAY_INTERVAL_MS = 110; // tile frame swap rate (≈9 fps)

interface Props {
  viewerRole?: "player" | "ob";
  homePath?: string;
}

/** One step in the ceremony script. User clicks "Next" to advance — no auto. */
type Stage =
  | { kind: "intro" }
  | { kind: "award"; key: AwardKey }
  | { kind: "summary" };

const AWARD_KEYS: AwardKey[] = ["mouth", "shake", "blink"];

/**
 * Multi-stage end-game ceremony. Replaces the previous single-screen overlay
 * with a "Mario Party"–style awards show:
 *
 *   1. Title card  (Night shift over)
 *   2. For each award: collage of action-edge highlight stills → reveal winner
 *   3. Final summary panel (survivors / eliminated, your stats, back home)
 *
 * Auto-advances on a timer; a "Skip" button jumps straight to the summary so an
 * impatient operator (or someone who's seen the ceremony before) isn't trapped.
 */
export default function EndGameOverlay({ viewerRole = "player", homePath }: Props) {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);
  const nav = useNavigate();
  const gameEnded = usePartyStore((s) => s.gameEnded);
  const gameEndedMedia = usePartyStore((s) => s.gameEndedMedia);
  const myName = usePartyStore((s) => s.myName);
  const clearGameEnded = usePartyStore((s) => s.clearGameEnded);

  // Step machine. Reset to "intro" each time a fresh GameEnded arrives.
  const [stage, setStage] = useState<Stage>({ kind: "intro" });
  const lastGameEndedRef = useRef<GameEnded | null>(null);
  useEffect(() => {
    if (gameEnded && gameEnded !== lastGameEndedRef.current) {
      lastGameEndedRef.current = gameEnded;
      setStage({ kind: "intro" });
    } else if (!gameEnded) {
      lastGameEndedRef.current = null;
    }
  }, [gameEnded]);

  const advance = useCallback(() => {
    setStage((s) => {
      if (s.kind === "intro") return { kind: "award", key: "mouth" };
      if (s.kind === "award") {
        const idx = AWARD_KEYS.indexOf(s.key);
        const next = AWARD_KEYS[idx + 1];
        return next ? { kind: "award", key: next } : { kind: "summary" };
      }
      return s;
    });
  }, []);

  // Merge each player's metadata reveal entry with the heavy media that
  // arrives in separate GAME_ENDED_MEDIA broadcasts.  Modern servers send
  // an empty media payload up-front (or none yet) and stream the bursts
  // afterwards; older "single-message" servers embedded everything inline.
  // The merge prefers a freshly-arrived media entry if present, but falls
  // back to legacy fields baked into the reveal so the overlay keeps
  // working against either server build.  Recomputed whenever any media
  // message lands so ceremony tiles light up progressively.
  const realPlayers = useMemo<RevealEntry[]>(
    () =>
      (gameEnded?.reveal ?? [])
        .filter((p) => p.name.toLowerCase() !== "ob")
        .map((p) => {
          const m = gameEndedMedia.get(p.id);
          if (!m) return p;
          return {
            ...p,
            highlights: m.highlights ?? p.highlights,
            avatarUrl: m.avatarUrl ?? p.avatarUrl ?? null,
            lastFrame: m.lastFrame ?? p.lastFrame ?? null,
            fallbackBurst: m.fallbackBurst ?? p.fallbackBurst ?? []
          };
        }),
    [gameEnded, gameEndedMedia]
  );
  const survivors = useMemo(() => realPlayers.filter((p) => p.alive !== false), [realPlayers]);
  const eliminated = useMemo(() => realPlayers.filter((p) => p.alive === false), [realPlayers]);
  const viewerEntry = useMemo(
    () => (viewerRole === "ob" || !myName ? null : realPlayers.find((p) => p.name === myName) ?? null),
    [realPlayers, myName, viewerRole]
  );
  const isPlayer = viewerRole !== "ob";
  const youLived = isPlayer && viewerEntry ? viewerEntry.alive !== false : false;

  // True while an award stage is in its locked reveal-dwell — the parent uses
  // this to disable the Skip button so a stray tap on "Skip" can't blast
  // past the gold winner the moment they appear. AwardPanel owns the
  // dwell-timer; it pulses this up via callback below.
  //
  // Declared up here (not after the `if (!gameEnded) return null` early
  // exit below) because this overlay is now mounted at the App level
  // and must obey the rules of hooks: every render must call the same
  // hooks in the same order, regardless of whether `gameEnded` is null
  // or not.  Putting the useState after the early return triggered
  // React error #310 (`Rendered more hooks than during the previous
  // render`) on the very first GAME_ENDED transition.
  const [awardDwellActive, setAwardDwellActive] = useState(false);

  // Diagnostic: surface ceremony render counts so a "background but empty"
  // failure in the field points at the right layer immediately. If this
  // never fires, the overlay isn't even mounting (no GAME_ENDED received).
  // If it fires with realPlayers=0, the server's reveal payload was empty.
  // If it fires with realPlayers>0 but the ceremony still looks blank,
  // suspect a render-time error in one of the panels (check the next log
  // line — React tends to spew error stacks adjacent to this).
  useEffect(() => {
    if (!gameEnded) return;
    // eslint-disable-next-line no-console
    console.info(
      "[ceremony] EndGameOverlay render",
      {
        stage: stage.kind + (stage.kind === "award" ? `:${stage.key}` : ""),
        revealRaw: gameEnded.reveal?.length ?? 0,
        realPlayers: realPlayers.length,
        survivors: survivors.length,
        eliminated: eliminated.length,
        viewerRole,
        mediaArrived: gameEndedMedia.size
      }
    );
  }, [gameEnded, stage, realPlayers, survivors, eliminated, viewerRole, gameEndedMedia]);

  if (!gameEnded) return null;

  const handleHome = () => {
    clearGameEnded();
    nav(homePath ?? "/", { replace: true });
  };
  const handleSkip = () => setStage({ kind: "summary" });

  // Hard-fallback: if the server somehow shipped a GAME_ENDED with an
  // empty reveal list, render a clear placeholder card instead of an
  // invisible "background only" panel — that exact symptom kept showing
  // up in the field and was indistinguishable from a hung render. With
  // this a tester can immediately see "ceremony fired but had 0 players"
  // in big text rather than a silent black overlay.
  const ceremonyEmpty = realPlayers.length === 0;

  const stageClass =
    "endgame-stage" + (viewerRole === "ob" ? " endgame-stage--ob" : "");

  // Render once for every stage's fallback card so a panel-level crash
  // never collapses to a blank `endgame-mask`.  The fallback is the same
  // visible shape as the Summary "back home" footer so the user always
  // has a way out, no matter which panel exploded.
  const renderStageFallback = (label: string) => (
    <div className="endgame-card" role="alert">
      <div className="endgame-eyebrow">{t.endGameTitle}</div>
      <h1 id="endgameTitle" className="endgame-headline">
        {lang === "zh" ? "颁奖典礼出错" : "Ceremony hit an error"}
      </h1>
      <p className="endgame-sub muted">
        {lang === "zh"
          ? `内部页面（${label}）渲染失败。可能是浏览器缓存了旧版本的脚本——刷新一次通常就能修复。`
          : `Internal page (${label}) failed to render. Most often a stale cached script — a hard refresh fixes it.`}
      </p>
      <div className="endgame-actions">
        <button className="primary" onClick={() => window.location.reload()}>
          {lang === "zh" ? "刷新页面" : "Hard refresh"}
        </button>
        <button className="ghost" onClick={handleHome}>
          {t.endGameBackHome}
        </button>
      </div>
    </div>
  );

  return (
    <div className="endgame-mask" role="dialog" aria-modal="true" aria-labelledby="endgameTitle">
      {/* Always-visible escape hatch.  Even if every panel below crashes
          during render, this button stays in the DOM so a user never sees
          a "permanent black screen" with no way back to the lobby.  Sits
          in the corner with high z-index so it floats above any animated
          award/summary content. */}
      <button
        type="button"
        className="endgame-escape"
        onClick={handleHome}
        aria-label={t.endGameBackHome}
        title={t.endGameBackHome}
      >
        ✕ {t.endGameBackHome}
      </button>
      <div className={stageClass} key={stageKey(stage)}>
        {ceremonyEmpty ? (
          <div className="endgame-card endgame-intro" role="alert">
            <div className="endgame-eyebrow">{t.endGameTitle}</div>
            <h1 id="endgameTitle" className="endgame-headline endgame-intro__head">
              {lang === "zh" ? "本局没有玩家数据" : "No round data to show"}
            </h1>
            <p className="endgame-sub muted">
              {lang === "zh"
                ? "服务端发来了游戏结束事件，但玩家名单是空的。请检查 PartyKit 部署是否最新，或在控制台查看 [ceremony] 日志。"
                : "The server announced game-end but the player list was empty. Make sure the PartyKit deploy is up to date, then check the [ceremony] logs in the browser console."}
            </p>
            <div className="endgame-actions">
              <button className="primary" onClick={handleHome}>
                {t.endGameBackHome}
              </button>
            </div>
          </div>
        ) : null}
        {!ceremonyEmpty && stage.kind === "intro" ? (
          <StageErrorBoundary fallback={renderStageFallback("Intro")}>
            <IntroPanel
              t={t}
              survivors={survivors.length}
              total={realPlayers.length}
              onNext={advance}
            />
          </StageErrorBoundary>
        ) : null}
        {!ceremonyEmpty && stage.kind === "award" ? (
          <StageErrorBoundary fallback={renderStageFallback(`Award · ${stage.key}`)}>
            <AwardPanel
              t={t}
              kind={stage.key}
              award={awardFor(gameEnded, stage.key)}
              players={realPlayers}
              youName={myName}
              lang={lang}
              viewerRole={viewerRole}
              onNext={advance}
              onDwellChange={setAwardDwellActive}
            />
          </StageErrorBoundary>
        ) : null}
        {!ceremonyEmpty && stage.kind === "summary" ? (
          <StageErrorBoundary fallback={renderStageFallback("Summary")}>
            <SummaryPanel
              t={t}
              lang={lang}
              survivors={survivors}
              eliminated={eliminated}
              viewerEntry={viewerEntry}
              isPlayer={isPlayer}
              youLived={youLived}
              youName={myName}
              gameEnded={gameEnded}
              onHome={handleHome}
              onClose={() => clearGameEnded()}
            />
          </StageErrorBoundary>
        ) : null}
      </div>

      {stage.kind !== "summary" ? (
        <div className="endgame-skip">
          <button
            type="button"
            className="ghost"
            onClick={handleSkip}
            disabled={awardDwellActive}
            title={
              awardDwellActive
                ? lang === "zh"
                  ? "颁奖时刻 · 看完获奖名单再跳过"
                  : "Hold for the winner — Skip unlocks after the reveal"
                : undefined
            }
          >
            {t.endGameSkip}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function stageKey(s: Stage): string {
  if (s.kind === "intro") return "intro";
  if (s.kind === "summary") return "summary";
  return `award:${s.key}`;
}

function awardFor(gameEnded: GameEnded, kind: AwardKey): GameEndedAward | null {
  const a = gameEnded.awards;
  if (!a) return null;
  if (kind === "mouth") return a.mouthOpens;
  if (kind === "shake") return a.headShakes;
  return a.blinks;
}

/* ------------------------------------------------------------------ */
/* Top-3 podium derivation                                             */
/* ------------------------------------------------------------------ */

/** Mapping the ceremony's `AwardKey` ("mouth" / "shake" / "blink") onto the
 *  matching `FaceCounts` field that the server publishes per-player.  Keeping
 *  this in one place means both the per-stage podium reveal AND the
 *  Summary-panel `Awards` cards stay in sync if the keys ever change. */
const FACE_KEY_BY_AWARD: Record<AwardKey, keyof FaceCounts> = {
  mouth: "mouthOpens",
  shake: "headShakes",
  blink: "blinks"
};

interface PodiumEntry {
  id: string;
  name: string;
  count: number;
  animal: AnimalCode | null;
}

const PODIUM_MEDALS: readonly string[] = ["🥇", "🥈", "🥉"] as const;

/** Compute the top-3 podium for a given award.  We rebuild this on the
 *  client (rather than asking the server) because every player's
 *  `faceCounts` is already in the GAME_ENDED payload — so the only real
 *  work is sort + slice, and the server gets to keep its single-winner
 *  contract. Players with count == 0 are excluded so a sparse round
 *  shows fewer rows instead of "—" filler. */
function topPodium(players: RevealEntry[], kind: AwardKey): PodiumEntry[] {
  const fcKey = FACE_KEY_BY_AWARD[kind];
  return players
    .map<PodiumEntry>((p) => ({
      id: p.id,
      name: p.name,
      count: Number((p.faceCounts as FaceCounts | undefined)?.[fcKey] ?? 0) || 0,
      animal: (p.animal as AnimalCode | null) ?? null
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 3);
}

/* ------------------------------------------------------------------ */
/* Stage panels                                                       */
/* ------------------------------------------------------------------ */

function IntroPanel({
  t,
  survivors,
  total,
  onNext
}: {
  t: Dict;
  survivors: number;
  total: number;
  onNext: () => void;
}) {
  return (
    <div className="endgame-card endgame-intro">
      <div className="endgame-eyebrow">{t.endGameTitle}</div>
      <h1 id="endgameTitle" className="endgame-headline endgame-intro__head">
        {t.endGameCeremony}
      </h1>
      <p className="endgame-sub muted">{t.endGameCeremonySub(survivors, total)}</p>
      <div className="endgame-actions">
        <button className="primary" onClick={onNext}>
          {t.endGameNext}
        </button>
      </div>
    </div>
  );
}

const AWARD_META: Record<
  AwardKey,
  { medal: string; emoji: string; titleKey: keyof Dict; subKey: keyof Dict }
> = {
  mouth: { medal: "🥇", emoji: "😮", titleKey: "awardMouthTitle", subKey: "awardMouthSub" },
  shake: { medal: "🥈", emoji: "🌀", titleKey: "awardShakeTitle", subKey: "awardShakeSub" },
  blink: { medal: "🥉", emoji: "👁️", titleKey: "awardBlinkTitle", subKey: "awardBlinkSub" }
};

type AwardPhase = "collage" | "countdown" | "reveal";

/** Award stage timing — tuned so phone viewers can actually read the gold
 *  winner's name before tapping Next. Drumroll is noticeably slower
 *  (≈3 s with bigger between-tick beats) and the reveal forces a short
 *  dwell where Next stays disabled AND visibly counts down, so a stray
 *  double-tap (or accidental Skip tap) can't blink past the podium —
 *  but the gate is short enough that an attentive viewer never feels
 *  stuck. The card still stays open after the timer — only the auto-
 *  advance gate lifts. */
const AWARD_TIMINGS = {
  /** How long the collage breathes before the countdown overlay starts. */
  collageMs: 1000,
  /** Between-tick interval inside the 3 → 2 → 1 drumroll. */
  tickMs: 900,
  /** Forced dwell on the reveal phase before the Next button is enabled. */
  revealDwellMs: 2500,
  /** Step size for the visible Next-button countdown (e.g. "Next (3…)"). */
  countdownStepMs: 1000
};

function AwardPanel({
  t,
  kind,
  award,
  players,
  youName,
  lang,
  viewerRole,
  onNext,
  onDwellChange
}: {
  t: Dict;
  kind: AwardKey;
  award: GameEndedAward | null;
  players: RevealEntry[];
  youName: string;
  lang: Lang;
  viewerRole: "player" | "ob";
  onNext: () => void;
  /** Called true while the locked reveal-dwell is active, false when the
   *  Next button has unlocked (or before reveal even starts). Parent uses
   *  this to disable the Skip button during the dwell. */
  onDwellChange?: (active: boolean) => void;
}) {
  const meta = AWARD_META[kind];
  const titleStr = t[meta.titleKey] as string;
  const subStr = t[meta.subKey] as string;

  // Top-3 podium for this award.  Gold (idx 0) keeps the original winner
  // treatment + confetti; silver/bronze are stacked beneath as a smaller
  // "runners-up" strip so the ceremony actually announces 前三名.
  const podium = useMemo(() => topPodium(players, kind), [players, kind]);
  const goldId = podium[0]?.id ?? award?.id ?? null;

  // Each tile is a player's burst (short frame loop). Winner highlighted.
  const tiles = useMemo(
    () => collageTiles(players, kind, goldId),
    [players, kind, goldId]
  );

  const cardRef = useRef<HTMLDivElement | null>(null);

  // Reveal cinematics: collage breathes, then a slowed 3 → 2 → 1 drumroll
  // overlays it, then the winner block stamps in with a confetti burst.
  // After reveal a `revealDwellMs` gate keeps Next disabled long enough to
  // actually read the podium — the previous version let an impatient Next
  // tap clear the gold winner's name before the eye could land on it.
  // Resets each time `kind` changes (next award).
  const [phase, setPhase] = useState<AwardPhase>("collage");
  const [tick, setTick] = useState(3);
  const [revealReady, setRevealReady] = useState(false);
  // Visible "Next (3…)" countdown so phone viewers can SEE that the button
  // is intentionally disabled and that the screen will hold for N more
  // seconds. Without this, a disabled grey button reads as "broken" and
  // people frantically tap somewhere else (like the Skip button).
  const [secondsLeft, setSecondsLeft] = useState<number>(
    Math.ceil(AWARD_TIMINGS.revealDwellMs / 1000)
  );
  useEffect(() => {
    setPhase("collage");
    setTick(3);
    setRevealReady(false);
    const totalDwellSec = Math.ceil(AWARD_TIMINGS.revealDwellMs / 1000);
    setSecondsLeft(totalDwellSec);
    const { collageMs, tickMs, revealDwellMs, countdownStepMs } = AWARD_TIMINGS;
    const countdownStart = collageMs;
    const tick2At = countdownStart + tickMs;
    const tick1At = countdownStart + tickMs * 2;
    const revealAt = countdownStart + tickMs * 3;
    const dwellEndsAt = revealAt + revealDwellMs;
    const t1 = window.setTimeout(() => setPhase("countdown"), countdownStart);
    const t2 = window.setTimeout(() => setTick(2), tick2At);
    const t3 = window.setTimeout(() => setTick(1), tick1At);
    const t4 = window.setTimeout(() => {
      setPhase("reveal");
      onDwellChange?.(true);
    }, revealAt);
    const t5 = window.setTimeout(() => {
      setRevealReady(true);
      onDwellChange?.(false);
    }, dwellEndsAt);
    // Tick the visible per-second countdown that shows on the Next button.
    // Starts the moment we enter `reveal` and counts down to 0; once the
    // dwell ends, t5 above flips revealReady=true and the button label
    // becomes the regular "Next" again.
    let interval: number | null = null;
    const tStartCountdown = window.setTimeout(() => {
      let remaining = totalDwellSec;
      setSecondsLeft(remaining);
      interval = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          if (interval !== null) {
            window.clearInterval(interval);
            interval = null;
          }
          setSecondsLeft(0);
        } else {
          setSecondsLeft(remaining);
        }
      }, countdownStepMs);
    }, revealAt);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
      window.clearTimeout(t5);
      window.clearTimeout(tStartCountdown);
      if (interval !== null) window.clearInterval(interval);
      // Stage was unmounted (advanced/ended) — release the parent's Skip
      // gate so re-entering an award panel doesn't get stuck disabled.
      onDwellChange?.(false);
    };
    // `onDwellChange` intentionally omitted from deps: it changes identity
    // every render of the parent which would re-run this effect every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // Allow tap-anywhere to skip ahead through the drumroll — useful for impatient
  // players. Tapping during `reveal` no longer collapses the dwell gate; viewers
  // still have to wait `revealDwellMs` (or hit Next once it un-disables) so the
  // winner's name is visible long enough to read.
  const skipToReveal = useCallback(() => {
    if (phase !== "reveal") setPhase("reveal");
  }, [phase]);

  return (
    <div
      ref={cardRef}
      className={"endgame-card endgame-award-stage is-winner phase-" + phase}
      onClick={skipToReveal}
    >
      <div className="endgame-eyebrow">{t.endGameAwardsHead}</div>
      <div className="endgame-award-stage__title">
        <span className="endgame-award-stage__spot" aria-hidden />
        <span className="endgame-award-stage__medal" aria-hidden>{meta.medal}</span>
        <div>
          <h2 className="endgame-award-stage__name">{titleStr}</h2>
          <div className="endgame-award-stage__sub muted">{subStr}</div>
        </div>
      </div>

      <div className="endgame-collage-wrap">
        <Collage tiles={tiles} fallbackEmoji={meta.emoji} />
        {phase === "countdown" ? (
          <div className="endgame-drumroll" aria-hidden>
            <span key={tick} className="endgame-drumroll__digit">{tick}</span>
          </div>
        ) : null}
      </div>

      {phase === "reveal" ? (
        podium.length > 0 ? (
          <div className="endgame-award-stage__podium">
            <Confetti />
            {podium.map((entry, idx) => {
              const isYouRow = !!youName && entry.name === youName;
              const place = idx === 0 ? "gold" : idx === 1 ? "silver" : "bronze";
              const animalLabel = entry.animal
                ? animalLocalized[lang][entry.animal] ?? entry.animal
                : null;
              return (
                <div
                  key={entry.id}
                  className={
                    "endgame-award-stage__podium-row" +
                    " endgame-award-stage__podium-row--" +
                    place +
                    (isYouRow ? " is-self" : "")
                  }
                  style={{
                    ["--podium-delay" as string]: `${idx * 360}ms`
                  }}
                >
                  <span className="endgame-award-stage__podium-medal" aria-hidden>
                    {PODIUM_MEDALS[idx] ?? "🏅"}
                  </span>
                  <div className="endgame-award-stage__podium-line">
                    {idx === 0 ? (
                      <span className="endgame-award-stage__star" aria-hidden>★</span>
                    ) : null}
                    <span className="endgame-award-stage__wname">{entry.name}</span>
                    {isYouRow ? (
                      <span className="endgame-award-stage__you" aria-hidden> · YOU</span>
                    ) : null}
                  </div>
                  <div className="endgame-award-stage__wmeta">
                    {animalLabel ? `${animalLabel} · ` : ""}×{entry.count}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="muted endgame-award-stage__none">{t.endGameAwardNone}</div>
        )
      ) : (
        <div className="endgame-award-stage__placeholder" aria-hidden />
      )}

      <div className="endgame-actions">
        {/* Per-award save buttons removed — saves now live on the final
            SummaryPanel ("Save my GIF" + "Save group GIF") so we don't
            spam buttons on every podium step. */}
        <button
          type="button"
          className="primary"
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          disabled={phase !== "reveal" || !revealReady}
        >
          {/* Visible per-second countdown while Next is locked. Disabled +
              labelled grey buttons read as "broken" on phones, so we show
              the actual seconds remaining ("Next · 6s") so the user knows
              the screen is intentionally holding. Once the dwell elapses
              the label collapses back to plain `endGameNext`. */}
          {phase === "reveal" && !revealReady && secondsLeft > 0
            ? `${t.endGameNext} · ${secondsLeft}s`
            : t.endGameNext}
        </button>
      </div>
    </div>
  );
}

/** Web Share API (with files) → fallback blob download. Used for both PNG and WebM. */
async function shareOrDownload(
  blob: Blob,
  filename: string,
  mime: string,
  title: string,
  text: string
): Promise<void> {
  const file = new File([blob], filename, { type: mime });
  try {
    const navAny = navigator as Navigator & {
      canShare?: (data: { files?: File[] }) => boolean;
      share?: (data: ShareData & { files?: File[] }) => Promise<void>;
    };
    if (navAny.share && navAny.canShare && navAny.canShare({ files: [file] })) {
      await navAny.share({ title, text, files: [file] });
      return;
    }
  } catch {
    /* user cancelled or share failed — fall through to download */
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Convert a `data:image/...` URL into a Blob without going through fetch
 * (some old WebKit builds still choke on `fetch(dataURL)` in workers).
 * Returns null on parse error.
 */
async function dataUrlToBlob(dataUrl: string): Promise<Blob | null> {
  try {
    const m = /^data:([^;,]+)(;base64)?,(.*)$/.exec(dataUrl);
    if (!m) return null;
    const mime = m[1] || "image/jpeg";
    const isBase64 = !!m[2];
    const payload = m[3];
    if (isBase64) {
      const bin = atob(payload);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(payload)], { type: mime });
  } catch (err) {
    if (typeof console !== "undefined") console.warn("[endgame] dataURL → Blob failed", err);
    return null;
  }
}

/**
 * Encode the winner's burst (array of JPEG dataURLs the iframe captured at
 * action-edge moments) into an animated GIF using gif.js. Loops through the
 * burst `loops` times so a 3-frame burst still feels dynamic in the saved file.
 *
 * Returns null on encoder/Worker failure.
 */
async function encodeBurstAsGif(
  frames: HighlightBurst,
  opts: { frameDelayMs: number; loops: number }
): Promise<Blob | null> {
  if (!frames || frames.length < 2) return null;
  const imgs = await Promise.all(
    frames.map(
      (src) =>
        new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = src;
        })
    )
  );
  const valid = imgs.filter((x): x is HTMLImageElement => !!x);
  if (valid.length < 2) return null;
  const W = valid[0].naturalWidth;
  const H = valid[0].naturalHeight;
  return new Promise<Blob | null>((resolve) => {
    try {
      const gif = new GIF({
        workers: 2,
        quality: 10,
        width: W,
        height: H,
        workerScript: gifWorkerUrl
      });
      for (let l = 0; l < opts.loops; l++) {
        for (const img of valid) {
          gif.addFrame(img, { delay: opts.frameDelayMs, copy: true });
        }
      }
      gif.on("finished", (b: Blob) => resolve(b));
      gif.on("abort", () => resolve(null));
      gif.render();
    } catch (err) {
      if (typeof console !== "undefined") console.warn("[endgame] GIF encode failed", err);
      resolve(null);
    }
  });
}

function formatDateSlug(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * Class-photo GIF: render every player as a tile in a grid, with each tile
 * cycling that player's burst frames so the whole roster has motion. Falls
 * back to lastFrame / avatarUrl / initial-letter for players with no burst.
 *
 * Returns null when none of the players have any usable image source.
 */
async function encodeGroupPhotoAsGif(
  players: RevealEntry[]
): Promise<Blob | null> {
  if (players.length === 0) return null;

  type Cell = { name: string; imgs: HTMLImageElement[] };
  const rawCells = await Promise.all(
    players.map(async (p): Promise<Cell> => {
      const h = p.highlights;
      const burst = h?.mouth?.[0] ?? h?.blink?.[0] ?? h?.shake?.[0] ?? null;
      // Same fallback chain as the on-screen class photo: prefer a real
      // burst, then the server's rolling fallback-burst buffer, then a
      // single still — so the saved group GIF cycles every face that has
      // any motion data, instead of rendering most of the grid as
      // identical stills.
      const fallbackArr = (p.fallbackBurst ?? []).filter(
        (s) => typeof s === "string" && s.length > 0
      );
      const sources: string[] = burst && burst.length > 0
        ? burst
        : fallbackArr.length >= 2
          ? fallbackArr
          : p.lastFrame
            ? [p.lastFrame]
            : fallbackArr.length === 1
              ? fallbackArr
              : p.avatarUrl
                ? [p.avatarUrl]
                : [];
      const imgs = await Promise.all(
        sources.map(
          (src) =>
            new Promise<HTMLImageElement | null>((resolve) => {
              const img = new Image();
              img.crossOrigin = "anonymous";
              img.onload = () => resolve(img);
              img.onerror = () => resolve(null);
              img.src = src;
            })
        )
      );
      return { name: p.name, imgs: imgs.filter((x): x is HTMLImageElement => !!x) };
    })
  );
  if (rawCells.every((c) => c.imgs.length === 0)) return null;

  // 5-column grid is the same shape as the live GroupPhoto component, so the
  // saved file looks like a screenshot of what's on screen.
  const COLS = 5;
  const ROWS = Math.max(1, Math.ceil(rawCells.length / COLS));
  const TILE = 144;        // matches HIGHLIGHT_SIZE — burst pixels render 1:1
  const LABEL_H = 22;
  const ROW_H = TILE + LABEL_H;
  const W = COLS * TILE;
  const H = ROWS * ROW_H;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return null;

  // Frame budget — show every burst's longest cycle at least twice.
  const maxBurst = Math.max(1, ...rawCells.map((c) => c.imgs.length));
  const FRAME_COUNT = Math.max(maxBurst * 2, 3);

  return new Promise<Blob | null>((resolve) => {
    try {
      const gif = new GIF({
        workers: 2,
        quality: 12,
        width: W,
        height: H,
        workerScript: gifWorkerUrl
      });
      for (let f = 0; f < FRAME_COUNT; f++) {
        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(0, 0, W, H);
        rawCells.forEach((c, idx) => {
          const col = idx % COLS;
          const row = Math.floor(idx / COLS);
          const x = col * TILE;
          const y = row * ROW_H;
          if (c.imgs.length > 0) {
            const img = c.imgs[f % c.imgs.length];
            // Cover-fit so portrait + landscape JPEGs both look correct.
            const ar = img.naturalWidth / Math.max(1, img.naturalHeight);
            let dw = TILE, dh = TILE, dx = x, dy = y;
            if (ar > 1) { dw = TILE * ar; dx = x - (dw - TILE) / 2; }
            else { dh = TILE / ar; dy = y - (dh - TILE) / 2; }
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, TILE, TILE);
            ctx.clip();
            ctx.drawImage(img, dx, dy, dw, dh);
            ctx.restore();
          } else {
            // Letter fallback so missing-burst players still show.
            ctx.fillStyle = "#1d1010";
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = "#f2efe9";
            ctx.font = "600 56px Helvetica, Arial, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(c.name.charAt(0).toUpperCase(), x + TILE / 2, y + TILE / 2);
          }
          // Border + name strip
          ctx.strokeStyle = "rgba(242, 239, 233, 0.32)";
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
          ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
          ctx.fillRect(x, y + TILE, TILE, LABEL_H);
          ctx.fillStyle = "#f2efe9";
          ctx.font = "11px Helvetica, Arial, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(c.name.slice(0, 18), x + TILE / 2, y + TILE + LABEL_H / 2);
        });
        gif.addFrame(ctx, { delay: 220, copy: true });
      }
      gif.on("finished", (b: Blob) => resolve(b));
      gif.on("abort", () => resolve(null));
      gif.render();
    } catch (err) {
      if (typeof console !== "undefined") console.warn("[endgame] group GIF encode failed", err);
      resolve(null);
    }
  });
}

/** Pure-CSS confetti: 14 absolutely-positioned shards animating outward. */
function Confetti() {
  const shards = useMemo(() => {
    const out: Array<{ x: number; rot: number; delay: number; color: string; shape: string }> = [];
    const palette = ["#ffdc5a", "#ff9a7a", "#d6402e", "#f2efe9", "#b9eab2", "#ffa8d8"];
    for (let i = 0; i < 14; i++) {
      out.push({
        x: -120 + Math.random() * 240,
        rot: Math.random() * 360,
        delay: Math.random() * 120,
        color: palette[i % palette.length] || "#f2efe9",
        shape: i % 3 === 0 ? "circle" : "rect"
      });
    }
    return out;
  }, []);
  return (
    <div className="endgame-confetti" aria-hidden>
      {shards.map((s, i) => (
        <span
          key={i}
          className={"endgame-confetti__shard endgame-confetti__shard--" + s.shape}
          style={{
            ["--cx" as string]: `${s.x}px`,
            ["--cr" as string]: `${s.rot}deg`,
            ["--cd" as string]: `${s.delay}ms`,
            background: s.color
          }}
        />
      ))}
    </div>
  );
}

interface CollageTile {
  /** Frames forming a tiny GIF; if empty, we render the letter fallback. */
  frames: HighlightBurst;
  initial: string;
  isWinner: boolean;
}

/**
 * Build the collage so the audience always sees AS MANY DIFFERENT FACES as we
 * have players (was previously bursts-only, which left the wall empty when a
 * round was light on action).
 *
 * Per player, in priority order:
 *   1. their bursts for this award kind (animated GIF tiles)
 *   2. their last live camera frame (single-frame "burst")
 *   3. their static avatar / profile photo (single-frame "burst")
 *   4. initials letter (final fallback — already what tiles render at length 0)
 *
 * Then we extend with extra bursts up to MAX_TILES so chatty players still
 * appear multiple times (animated GIFs are visually richer than a single
 * still). Winner tiles are always kept by sorting them to the front.
 */
const COLLAGE_MAX_TILES = 12;

function collageTiles(
  players: RevealEntry[],
  kind: AwardKey,
  winnerId: string | null
): CollageTile[] {
  const primary: CollageTile[] = [];
  const extras: CollageTile[] = [];
  for (const p of players) {
    const hl: PlayerHighlights | undefined = p.highlights;
    const bursts = (hl?.[kind] ?? []).slice(0, 3);
    const isWinner = !!winnerId && p.id === winnerId;
    const initial = p.name.charAt(0).toUpperCase();
    // Fallback chain prefers ANY multi-frame burst for this award kind →
    // then the rolling fallback-burst (last few camera frames sampled with
    // temporal spread on the server, ≥2 frames means a real GIF) → then a
    // single still (lastFrame / avatarUrl) → then the initials letter.
    // Without the fallback-burst step every player without a highlight
    // event in the round rendered as a frozen image, which is why a
    // 2-player test where only one face triggered events showed
    // "second player is a static image".
    const fallback = (p.fallbackBurst ?? []).filter((s) => typeof s === "string" && s.length > 0);
    let primaryFrames: HighlightBurst | null = null;
    if (bursts.length > 0) {
      primaryFrames = bursts[0];
    } else if (fallback.length >= 2) {
      primaryFrames = fallback;
    } else if (p.lastFrame) {
      primaryFrames = [p.lastFrame];
    } else if (fallback.length === 1) {
      primaryFrames = fallback;
    } else if (p.avatarUrl) {
      primaryFrames = [p.avatarUrl];
    }
    primary.push({
      frames: primaryFrames ?? [],
      initial,
      isWinner
    });
    // Extra bursts (the rest of this player's GIFs, if any).
    for (let i = 1; i < bursts.length; i++) {
      extras.push({ frames: bursts[i], initial, isWinner });
    }
  }
  // Winners first, then sort by "has frames" so the most visual tiles are kept
  // when we cap at MAX.
  const sortFn = (a: CollageTile, b: CollageTile) => {
    if (a.isWinner !== b.isWinner) return Number(b.isWinner) - Number(a.isWinner);
    if (a.frames.length === 0 && b.frames.length > 0) return 1;
    if (b.frames.length === 0 && a.frames.length > 0) return -1;
    return 0;
  };
  primary.sort(sortFn);
  extras.sort(sortFn);
  return [...primary, ...extras].slice(0, COLLAGE_MAX_TILES);
}

function Collage({ tiles, fallbackEmoji }: { tiles: CollageTile[]; fallbackEmoji: string }) {
  if (tiles.length === 0) {
    return (
      <div className="endgame-collage endgame-collage--empty" aria-hidden>
        <span className="endgame-collage__empty">{fallbackEmoji}</span>
      </div>
    );
  }
  return (
    <div
      className="endgame-collage"
      style={{ ["--tile-count" as string]: String(tiles.length) }}
      aria-hidden
    >
      {tiles.map((tl, i) => (
        <div
          key={i}
          className={"endgame-collage__tile" + (tl.isWinner ? " is-winner" : "")}
          style={{ animationDelay: `${i * 60}ms` }}
        >
          {tl.frames.length > 0 ? (
            <BurstImage frames={tl.frames} />
          ) : (
            <span className="endgame-collage__initial">{tl.initial}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Cycles through a burst's frames as a tiny GIF. Single-frame bursts render as
 * a still; longer bursts use a setInterval to swap the `<img>.src`. Stagger by
 * a per-tile offset so the tiles don't all flip on the exact same beat.
 */
function BurstImage({ frames }: { frames: HighlightBurst }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (frames.length <= 1) return;
    // Random per-tile phase so the collage doesn't strobe in unison.
    const offset = Math.floor(Math.random() * BURST_PLAY_INTERVAL_MS);
    let cancel = false;
    const start = window.setTimeout(() => {
      if (cancel) return;
      const id = window.setInterval(() => {
        setI((j) => (j + 1) % frames.length);
      }, BURST_PLAY_INTERVAL_MS);
      // Stash on closure for cleanup
      cleanup = () => window.clearInterval(id);
    }, offset);
    let cleanup = () => window.clearTimeout(start);
    return () => {
      cancel = true;
      cleanup();
    };
  }, [frames.length]);
  return <img className="endgame-collage__img" src={frames[i] ?? frames[0]} alt="" />;
}

function SummaryPanel({
  t,
  lang,
  survivors,
  eliminated,
  viewerEntry,
  isPlayer,
  youLived,
  youName,
  gameEnded,
  onHome,
  onClose
}: {
  t: Dict;
  lang: Lang;
  survivors: RevealEntry[];
  eliminated: RevealEntry[];
  viewerEntry: RevealEntry | null;
  isPlayer: boolean;
  youLived: boolean;
  youName: string;
  gameEnded: GameEnded;
  onHome: () => void;
  onClose: () => void;
}) {
  const total = survivors.length + eliminated.length;
  const allPlayers = useMemo(() => [...survivors, ...eliminated], [survivors, eliminated]);

  // Pick the viewer's "best" burst across all award kinds — order picks
  // mouth → blink → shake (matching Awards prominence). For OB the
  // viewerEntry is null → button stays disabled.
  const myBurst = useMemo<HighlightBurst | null>(() => {
    const h = viewerEntry?.highlights;
    return h?.mouth?.[0] ?? h?.blink?.[0] ?? h?.shake?.[0] ?? null;
  }, [viewerEntry]);

  const [savingMine, setSavingMine] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  const [savedKind, setSavedKind] = useState<null | "mine" | "group">(null);
  const flashSaved = useCallback((kind: "mine" | "group") => {
    setSavedKind(kind);
    window.setTimeout(() => setSavedKind(null), 1600);
  }, []);

  const fileBase = useCallback(() => {
    const safe = (youName || "guest").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 24) || "guest";
    return `nocturne-zoo-${safe}-${formatDateSlug()}`;
  }, [youName]);

  const handleSaveMine = useCallback(async () => {
    if (!myBurst || myBurst.length < 1 || savingMine) return;
    setSavingMine(true);
    try {
      const blob = myBurst.length >= 2 && typeof Worker !== "undefined"
        ? await encodeBurstAsGif(myBurst, { frameDelayMs: 110, loops: 3 })
        : await dataUrlToBlob(myBurst[0]);
      if (!blob) return;
      const ext = blob.type.includes("gif") ? "gif" : (blob.type.includes("png") ? "png" : "jpg");
      const text = lang === "zh" ? "我的瞬间" : "My moment";
      await shareOrDownload(blob, `${fileBase()}-mine.${ext}`, blob.type, text, text);
      flashSaved("mine");
    } finally {
      setSavingMine(false);
    }
  }, [myBurst, savingMine, fileBase, lang, flashSaved]);

  const handleSaveGroup = useCallback(async () => {
    if (savingGroup) return;
    setSavingGroup(true);
    try {
      const blob = await encodeGroupPhotoAsGif(allPlayers);
      if (!blob) return;
      const text = lang === "zh" ? "全员合影" : "Class photo";
      await shareOrDownload(blob, `${fileBase()}-group.gif`, "image/gif", text, text);
      flashSaved("group");
    } finally {
      setSavingGroup(false);
    }
  }, [allPlayers, savingGroup, fileBase, lang, flashSaved]);

  return (
    <div className={"endgame-card endgame-card--summary" + (youLived ? " endgame-card--alive" : "")}>
      <div className="endgame-eyebrow">{t.endGameTitle}</div>
      {isPlayer && viewerEntry ? (
        <h1 id="endgameTitle" className="endgame-headline">
          {youLived ? t.endGameAlive : t.endGameDead}
        </h1>
      ) : (
        <h1 id="endgameTitle" className="endgame-headline">
          {t.endGameSurvivorCount(survivors.length, total)}
        </h1>
      )}
      <p className="endgame-sub muted">
        {isPlayer && viewerEntry
          ? (youLived ? t.endGameAliveSub : t.endGameDeadSub)
          : ""}
      </p>

      {/* Group photo — class-photo collage of every player's face. With 20
          slots this becomes the visual anchor of the summary screen. */}
      <GroupPhoto players={allPlayers} youName={youName} lang={lang} />

      {gameEnded.awards ? (
        <Awards awards={gameEnded.awards} players={allPlayers} youName={youName} t={t} />
      ) : null}

      {/* Animal-team standings: which species had the most escapers + which
          species took home the most podium awards. Aggregates over the same
          `reveal` payload so it stays in sync with the rest of the screen. */}
      <TeamStandings
        players={allPlayers}
        survivors={survivors}
        awards={gameEnded.awards ?? null}
        lang={lang}
        t={t}
      />

      {isPlayer && viewerEntry?.faceCounts ? (
        <PlayerStats counts={viewerEntry.faceCounts} t={t} />
      ) : null}

      {/* Compact roster — single readable list with status pill, animal,
          and hearts. Replaces the old two-column survivors / eliminated
          split which was unreadable at 20 players. */}
      <ClassRoster
        players={allPlayers}
        youName={youName}
        lang={lang}
        t={t}
      />

      <div className="endgame-actions endgame-actions--summary">
        <button
          type="button"
          className={"ghost" + (savingMine ? " is-busy" : "")}
          onClick={handleSaveMine}
          disabled={!myBurst || savingMine}
          title={myBurst
            ? (lang === "zh" ? "导出我自己的瞬间 GIF" : "Save my moment as a GIF")
            : (lang === "zh" ? "本局没记录到你的高亮瞬间" : "No highlight burst captured for you this round")}
        >
          {savedKind === "mine"
            ? (lang === "zh" ? "已保存 ✓" : "Saved ✓")
            : (lang === "zh" ? "保存我的 GIF" : "Save my GIF")}
        </button>
        <button
          type="button"
          className={"ghost" + (savingGroup ? " is-busy" : "")}
          onClick={handleSaveGroup}
          disabled={savingGroup || allPlayers.length === 0}
          title={lang === "zh" ? "导出全员合影 GIF" : "Save the group photo as a GIF"}
        >
          {savedKind === "group"
            ? (lang === "zh" ? "已保存 ✓" : "Saved ✓")
            : (lang === "zh" ? "保存合影 GIF" : "Save group GIF")}
        </button>
        <button className="primary" onClick={onHome}>
          {t.endGameBackHome}
        </button>
        <button className="ghost" onClick={onClose}>
          {t.endGameClose}
        </button>
      </div>
    </div>
  );
}

/**
 * Group photo collage — every player rendered in a compact 5-column grid
 * with cycling burst frames so the whole roster feels alive. Falls back to
 * the player's last live camera frame, then their static avatar, then a
 * letter tile when nothing is available.
 */
function GroupPhoto({
  players,
  youName,
  lang
}: {
  players: RevealEntry[];
  youName: string;
  lang: "en" | "zh";
}) {
  const [frameIdx, setFrameIdx] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setFrameIdx((i) => (i + 1) % 600), 220);
    return () => window.clearInterval(id);
  }, []);
  const cells = useMemo(
    () =>
      players.map((p) => {
        const h = p.highlights;
        const burst = h?.mouth?.[0] ?? h?.blink?.[0] ?? h?.shake?.[0] ?? null;
        // Fallback chain mirrors `collageTiles` — prefer a real multi-frame
        // highlight burst, fall back to the server's rolling 3-frame
        // camera buffer (so every player gets a GIF tile), then a single
        // still, finally the initials letter rendered by the empty case.
        const fallbackArr = (p.fallbackBurst ?? []).filter(
          (s) => typeof s === "string" && s.length > 0
        );
        const frames: string[] =
          burst && burst.length > 0
            ? burst
            : fallbackArr.length >= 2
              ? fallbackArr
              : p.lastFrame
                ? [p.lastFrame]
                : fallbackArr.length === 1
                  ? fallbackArr
                  : p.avatarUrl
                    ? [p.avatarUrl]
                    : [];
        return {
          id: p.id,
          name: p.name,
          frames,
          isYou: !!youName && p.name === youName,
          alive: p.alive !== false
        };
      }),
    [players, youName]
  );
  if (cells.length === 0) return null;
  return (
    <div className="endgame-group" aria-label="Class photo">
      <div className="endgame-section-label endgame-group__head">
        {lang === "zh" ? "全员合影" : "Class photo"}
        <span className="muted endgame-group__count"> · {cells.length}</span>
      </div>
      <div className="endgame-group__grid">
        {cells.map((c) => (
          <div
            key={c.id}
            className={
              "endgame-group__cell" +
              (c.isYou ? " is-you" : "") +
              (c.alive ? "" : " is-dead")
            }
            title={c.name}
          >
            {c.frames.length > 0 ? (
              <img
                src={c.frames[frameIdx % c.frames.length] ?? c.frames[0]}
                alt={c.name}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className="endgame-group__initial" aria-hidden>
                {c.name.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="endgame-group__name" title={c.name}>{c.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Single-list roster. Replaces the survivors-vs-eliminated 2-column grid
 * that overflowed at 20 players. Sorted: alive first, then by name; the
 * viewer's row is highlighted so they can find themselves at a glance.
 */
function ClassRoster({
  players,
  youName,
  lang,
  t
}: {
  players: RevealEntry[];
  youName: string;
  lang: "en" | "zh";
  t: Dict;
}) {
  const sorted = useMemo(
    () =>
      [...players].sort((a, b) => {
        const aAlive = a.alive !== false ? 1 : 0;
        const bAlive = b.alive !== false ? 1 : 0;
        if (aAlive !== bAlive) return bAlive - aAlive;
        return a.name.localeCompare(b.name);
      }),
    [players]
  );
  const aliveCount = sorted.filter((p) => p.alive !== false).length;
  const deadCount = sorted.length - aliveCount;
  return (
    <div className="endgame-roster" aria-label="Roster">
      <div className="endgame-roster__head">
        <span className="endgame-section-label">
          {lang === "zh" ? "全员排行榜" : "Class roster"}
        </span>
        <span className="muted endgame-roster__counts">
          ✓ {aliveCount} · ✕ {deadCount}
        </span>
      </div>
      <ul className="endgame-roster__list">
        {sorted.map((p) => (
          <EndGameRow
            key={p.id}
            player={p}
            youName={youName}
            lang={lang}
            alive={p.alive !== false}
          />
        ))}
      </ul>
      {/* `t` is referenced here only via the labels above; keep the prop
          so future per-row strings can use it without re-threading. */}
      <span hidden>{t.endGameTitle}</span>
    </div>
  );
}

function PlayerStats({ counts, t }: { counts: FaceCounts; t: Dict }) {
  const items = [
    { icon: "😮", label: t.endGameStatMouth, value: counts.mouthOpens || 0 },
    { icon: "🌀", label: t.endGameStatShake, value: counts.headShakes || 0 },
    { icon: "👁️", label: t.endGameStatBlink, value: counts.blinks || 0 }
  ];
  return (
    <div className="endgame-stats" aria-label="Your stats this round">
      <div className="endgame-section-label endgame-stats__head">{t.endGameStatsHead}</div>
      <div className="endgame-stats__row">
        {items.map((it) => (
          <div key={it.label} className="endgame-stat">
            <div className="endgame-stat__icon" aria-hidden>{it.icon}</div>
            <div className="endgame-stat__value">{it.value}</div>
            <div className="endgame-stat__label">{it.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Awards({
  awards,
  players,
  youName,
  t
}: {
  awards: NonNullable<GameEnded["awards"]>;
  players: RevealEntry[];
  youName: string;
  t: Dict;
}) {
  type AwardKindKey = AwardKey;
  const items: Array<{
    key: AwardKindKey;
    medal: string;
    title: string;
    sub: string;
    podium: PodiumEntry[];
    goldWinner: GameEndedAward | null;
  }> = [
    {
      key: "mouth",
      medal: "🥇",
      title: t.awardMouthTitle,
      sub: t.awardMouthSub,
      podium: topPodium(players, "mouth"),
      goldWinner: awards.mouthOpens
    },
    {
      key: "shake",
      medal: "🥈",
      title: t.awardShakeTitle,
      sub: t.awardShakeSub,
      podium: topPodium(players, "shake"),
      goldWinner: awards.headShakes
    },
    {
      key: "blink",
      medal: "🥉",
      title: t.awardBlinkTitle,
      sub: t.awardBlinkSub,
      podium: topPodium(players, "blink"),
      goldWinner: awards.blinks
    }
  ];
  if (items.every((i) => i.podium.length === 0 && !i.goldWinner)) return null;
  return (
    <div className="endgame-awards" aria-label="Awards">
      <div className="endgame-section-label endgame-awards__head">{t.endGameAwardsHead}</div>
      <div className="endgame-awards__cards">
        {items.map((it) => {
          // Gold winner drives the portrait + "is-self" highlight even when
          // the viewer is silver / bronze — the card's hero face is always
          // the #1 player so the eye lands on the leaderboard's top.
          const goldEntry = it.podium[0] ?? null;
          const goldPlayer = goldEntry
            ? players.find((p) => p.id === goldEntry.id) ?? null
            : null;
          const burst = goldPlayer?.highlights?.[it.key]?.[0] ?? null;
          const portrait =
            burst && burst.length > 0
              ? burst[0]
              : goldPlayer?.lastFrame ?? goldPlayer?.avatarUrl ?? null;
          const isSelfOnPodium =
            !!youName && it.podium.some((row) => row.name === youName);
          return (
            <div
              key={it.key}
              className={
                "endgame-award-card" +
                (it.podium.length > 0 ? " has-winner" : "") +
                (isSelfOnPodium ? " is-self" : "")
              }
            >
              <div className="endgame-award-card__medal" aria-hidden>{it.medal}</div>
              <div className="endgame-award-card__portrait">
                {portrait ? (
                  <img src={portrait} alt={goldEntry?.name ?? ""} loading="lazy" />
                ) : (
                  <span className="endgame-award-card__initial" aria-hidden>
                    {goldEntry?.name?.charAt(0).toUpperCase() ?? "—"}
                  </span>
                )}
              </div>
              <div className="endgame-award-card__title">{it.title}</div>
              <div className="endgame-award-card__sub">{it.sub}</div>
              {/* Top-3 leaderboard for this award.  Each row gets its own
                  medal chip + name + count; the viewer's row gets the
                  "is-self" highlight so they can find themselves at a
                  glance. Falls back to the muted "—" placeholder when
                  no one earned this award this round. */}
              <ol className="endgame-award-card__podium" aria-label={it.title}>
                {it.podium.length > 0 ? (
                  it.podium.map((row, idx) => {
                    const isYouRow = !!youName && row.name === youName;
                    return (
                      <li
                        key={row.id}
                        className={
                          "endgame-award-card__podium-row" +
                          (idx === 0 ? " is-gold" : idx === 1 ? " is-silver" : " is-bronze") +
                          (isYouRow ? " is-self" : "")
                        }
                      >
                        <span
                          className="endgame-award-card__podium-medal"
                          aria-hidden
                        >
                          {PODIUM_MEDALS[idx] ?? "🏅"}
                        </span>
                        <span className="endgame-award-card__name">{row.name}</span>
                        <span className="endgame-award-card__count">×{row.count}</span>
                      </li>
                    );
                  })
                ) : (
                  <li className="muted endgame-award-card__none">{t.endGameAwardNone}</li>
                )}
              </ol>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Animal-team standings (escape & decoration leaderboards)            */
/* ------------------------------------------------------------------ */

const TEAM_ANIMAL_ORDER: AnimalCode[] = [Animals.LION, Animals.OWL, Animals.GIRAFFE];
const TEAM_ANIMAL_COLORS: Record<AnimalCode, string> = {
  [Animals.LION]: "#f0b14a",
  [Animals.OWL]: "#7d6cff",
  [Animals.GIRAFFE]: "#3fbf8a"
};

interface TeamRow {
  animal: AnimalCode;
  /** Numerator the panel is ranking by — escapers OR awards-won. */
  count: number;
  /** Denominator for context: total members of this team OR total trophies. */
  total: number;
  /** Tie-break for stable sorting when two teams have the same count. */
  tieBreak: number;
}

/**
 * Two-panel block summarising performance by animal team:
 *   - Best escape team   (most survivors per species)
 *   - Most decorated team (most podium awards collected by a species)
 *
 * Both panels share the same TeamLeaderboard layout (rank chip + emoji + bar +
 * score) so the player can scan them at a glance. We deliberately don't add a
 * 4th "ranking" stage to the ceremony script — these summary cards live on
 * the Summary panel instead, where they sit naturally next to the per-player
 * Awards block.
 */
function TeamStandings({
  players,
  survivors,
  awards,
  lang,
  t
}: {
  players: RevealEntry[];
  survivors: RevealEntry[];
  awards: GameEnded["awards"] | null;
  lang: Lang;
  t: Dict;
}) {
  const escapeRows = useMemo<TeamRow[]>(() => {
    const totals: Record<AnimalCode, number> = {
      [Animals.LION]: 0,
      [Animals.OWL]: 0,
      [Animals.GIRAFFE]: 0
    };
    const escaped: Record<AnimalCode, number> = {
      [Animals.LION]: 0,
      [Animals.OWL]: 0,
      [Animals.GIRAFFE]: 0
    };
    for (const p of players) {
      if (!p.animal) continue;
      const a = p.animal as AnimalCode;
      if (!(a in totals)) continue;
      totals[a] += 1;
    }
    for (const p of survivors) {
      if (!p.animal) continue;
      const a = p.animal as AnimalCode;
      if (!(a in escaped)) continue;
      escaped[a] += 1;
    }
    return TEAM_ANIMAL_ORDER.map((animal, idx) => ({
      animal,
      count: escaped[animal],
      total: totals[animal],
      tieBreak: idx
    }));
  }, [players, survivors]);

  const awardRows = useMemo<TeamRow[]>(() => {
    const awardCount: Record<AnimalCode, number> = {
      [Animals.LION]: 0,
      [Animals.OWL]: 0,
      [Animals.GIRAFFE]: 0
    };
    let trophyTotal = 0;
    if (awards) {
      // The 3 podium awards (mouth/shake/blink); a winner with no animal
      // still counts towards the trophy total but doesn't credit any team.
      for (const w of [awards.mouthOpens, awards.headShakes, awards.blinks]) {
        if (!w) continue;
        trophyTotal += 1;
        const winner = players.find((p) => p.id === w.id);
        const animal = winner?.animal as AnimalCode | undefined;
        if (animal && animal in awardCount) {
          awardCount[animal] += 1;
        }
      }
    }
    return TEAM_ANIMAL_ORDER.map((animal, idx) => ({
      animal,
      count: awardCount[animal],
      total: trophyTotal,
      tieBreak: idx
    }));
  }, [awards, players]);

  const escapeTotal = escapeRows.reduce((acc, r) => acc + r.count, 0);
  const awardsTotal = awardRows.reduce((acc, r) => acc + r.count, 0);

  // If neither board has any signal we hide the section entirely so the
  // summary doesn't get padded with two empty cards.
  if (escapeTotal === 0 && awardsTotal === 0 && (awardRows[0]?.total ?? 0) === 0) {
    return null;
  }

  return (
    <div className="endgame-teams" aria-label={t.endGameTeamHead}>
      <div className="endgame-section-label endgame-teams__head">{t.endGameTeamHead}</div>
      <div className="endgame-teams__cards">
        <TeamLeaderboard
          rows={escapeRows}
          title={t.endGameTeamEscapeTitle}
          sub={t.endGameTeamEscapeSub}
          emptyMsg={t.endGameTeamNoEscape}
          rowSuffix={(r) => t.endGameTeamEscapeRow(r.count, r.total)}
          totalForBar={Math.max(...escapeRows.map((r) => r.count), 1)}
          lang={lang}
          isEmpty={escapeTotal === 0}
        />
        <TeamLeaderboard
          rows={awardRows}
          title={t.endGameTeamAwardsTitle}
          sub={t.endGameTeamAwardsSub}
          emptyMsg={t.endGameTeamNoAwards}
          rowSuffix={(r) =>
            t.endGameTeamAwardsRow(r.count, Math.max(r.total, awardRows[0]?.total ?? 0))
          }
          totalForBar={Math.max(...awardRows.map((r) => r.count), 1)}
          lang={lang}
          isEmpty={awardsTotal === 0}
        />
      </div>
    </div>
  );
}

function TeamLeaderboard({
  rows,
  title,
  sub,
  emptyMsg,
  rowSuffix,
  totalForBar,
  lang,
  isEmpty
}: {
  rows: TeamRow[];
  title: string;
  sub: string;
  emptyMsg: string;
  rowSuffix: (r: TeamRow) => string;
  totalForBar: number;
  lang: Lang;
  isEmpty: boolean;
}) {
  const sorted = useMemo(() => {
    const r = rows.slice();
    r.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.tieBreak - b.tieBreak;
    });
    return r;
  }, [rows]);
  return (
    <div className={"endgame-team-card" + (isEmpty ? " is-empty" : "")}>
      <div className="endgame-team-card__title">{title}</div>
      <div className="endgame-team-card__sub muted">{sub}</div>
      {isEmpty ? (
        <div className="endgame-team-card__empty muted">{emptyMsg}</div>
      ) : (
        <ol className="endgame-team-card__list">
          {sorted.map((row, idx) => {
            const label = animalLocalized[lang][row.animal] ?? row.animal;
            const pct = (row.count / totalForBar) * 100;
            const isLeader = idx === 0 && row.count > 0;
            return (
              <li
                key={row.animal}
                className={
                  "endgame-team-row" +
                  (isLeader ? " is-leader" : "") +
                  (row.count === 0 ? " is-zero" : "")
                }
              >
                <span className="endgame-team-row__rank" aria-hidden>
                  {isLeader ? "👑" : `#${idx + 1}`}
                </span>
                <span className="endgame-team-row__icon" aria-hidden>
                  {animalEmoji(row.animal)}
                </span>
                <span className="endgame-team-row__name">{label}</span>
                <span className="endgame-team-row__bar-wrap" aria-hidden>
                  <span
                    className="endgame-team-row__bar"
                    style={{
                      width: `${pct}%`,
                      background: TEAM_ANIMAL_COLORS[row.animal]
                    }}
                  />
                </span>
                <span className="endgame-team-row__suffix muted">
                  {rowSuffix(row)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function EndGameRow({
  player,
  youName,
  lang,
  alive
}: {
  player: RevealEntry;
  youName: string;
  lang: Lang;
  alive: boolean;
}) {
  const animalLabel = player.animal
    ? animalLocalized[lang][player.animal as AnimalCode] ?? player.animal
    : "—";
  const isYou = !!youName && player.name === youName;
  return (
    <li className={"endgame-row" + (isYou ? " is-self" : "") + (alive ? "" : " is-dead")}>
      <span className="endgame-row__mark" aria-hidden>
        {alive ? "✓" : "✕"}
      </span>
      <span className="endgame-row__name">
        {player.name}
        {isYou ? <span className="endgame-row__you" aria-hidden> ← you</span> : null}
      </span>
      <span className="endgame-row__animal">{animalLabel}</span>
      {typeof player.lives === "number" ? (
        <span className="endgame-row__lives" aria-label="lives">
          {alive ? "\u2665\uFE0E".repeat(Math.max(0, player.lives)) : "0"}
        </span>
      ) : null}
    </li>
  );
}
