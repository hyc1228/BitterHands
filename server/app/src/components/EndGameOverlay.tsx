import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { animalLocalized, dict } from "../i18n";
import { usePartyStore } from "../party/store";
import type {
  GameEnded,
  GameEndedAward,
  AnimalCode,
  Lang,
  FaceCounts,
  PlayerHighlights
} from "../party/protocol";
import type { dict as dictFn } from "../i18n";

type Dict = ReturnType<typeof dictFn>;
type RevealEntry = GameEnded["reveal"][number];
type AwardKey = "mouth" | "shake" | "blink";

interface Props {
  viewerRole?: "player" | "ob";
  homePath?: string;
}

/** One step in the ceremony script. Each takes ~5 s; user can skip with a button. */
type Stage =
  | { kind: "intro" }
  | { kind: "award"; key: AwardKey; phase: "reveal" | "winner" }
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
      if (s.kind === "intro") return { kind: "award", key: "mouth", phase: "reveal" };
      if (s.kind === "award" && s.phase === "reveal") return { kind: "award", key: s.key, phase: "winner" };
      if (s.kind === "award" && s.phase === "winner") {
        const idx = AWARD_KEYS.indexOf(s.key);
        const next = AWARD_KEYS[idx + 1];
        return next ? { kind: "award", key: next, phase: "reveal" } : { kind: "summary" };
      }
      return s;
    });
  }, []);

  // Auto-advance schedule. Different durations for each beat — winner sits longer.
  useEffect(() => {
    if (!gameEnded) return;
    if (stage.kind === "summary") return;
    const dur =
      stage.kind === "intro"
        ? 2400
        : stage.kind === "award" && stage.phase === "reveal"
          ? 3200
          : 4200; // winner phase — pause for applause
    const id = window.setTimeout(advance, dur);
    return () => window.clearTimeout(id);
  }, [stage, gameEnded, advance]);

  const realPlayers = useMemo(
    () => (gameEnded?.reveal ?? []).filter((p) => p.name.toLowerCase() !== "ob"),
    [gameEnded]
  );
  const survivors = useMemo(() => realPlayers.filter((p) => p.alive !== false), [realPlayers]);
  const eliminated = useMemo(() => realPlayers.filter((p) => p.alive === false), [realPlayers]);
  const viewerEntry = useMemo(
    () => (viewerRole === "ob" || !myName ? null : realPlayers.find((p) => p.name === myName) ?? null),
    [realPlayers, myName, viewerRole]
  );
  const isPlayer = viewerRole !== "ob";
  const youLived = isPlayer && viewerEntry ? viewerEntry.alive !== false : false;

  if (!gameEnded) return null;

  const handleHome = () => {
    clearGameEnded();
    nav(homePath ?? "/", { replace: true });
  };
  const handleSkip = () => setStage({ kind: "summary" });

  return (
    <div className="endgame-mask" role="dialog" aria-modal="true" aria-labelledby="endgameTitle">
      <div className="endgame-stage" key={stageKey(stage)}>
        {stage.kind === "intro" ? (
          <IntroPanel t={t} survivors={survivors.length} total={realPlayers.length} />
        ) : null}
        {stage.kind === "award" ? (
          <AwardPanel
            t={t}
            kind={stage.key}
            phase={stage.phase}
            award={awardFor(gameEnded, stage.key)}
            players={realPlayers}
            youName={myName}
            lang={lang}
          />
        ) : null}
        {stage.kind === "summary" ? (
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
        ) : null}
      </div>

      {stage.kind !== "summary" ? (
        <div className="endgame-skip">
          <button type="button" className="ghost" onClick={handleSkip}>
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
  return `award:${s.key}:${s.phase}`;
}

function awardFor(gameEnded: GameEnded, kind: AwardKey): GameEndedAward | null {
  const a = gameEnded.awards;
  if (!a) return null;
  if (kind === "mouth") return a.mouthOpens;
  if (kind === "shake") return a.headShakes;
  return a.blinks;
}

/* ------------------------------------------------------------------ */
/* Stage panels                                                       */
/* ------------------------------------------------------------------ */

function IntroPanel({ t, survivors, total }: { t: Dict; survivors: number; total: number }) {
  return (
    <div className="endgame-card endgame-intro">
      <div className="endgame-eyebrow">{t.endGameTitle}</div>
      <h1 id="endgameTitle" className="endgame-headline endgame-intro__head">
        {t.endGameCeremony}
      </h1>
      <p className="endgame-sub muted">{t.endGameCeremonySub(survivors, total)}</p>
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

function AwardPanel({
  t,
  kind,
  phase,
  award,
  players,
  youName,
  lang
}: {
  t: Dict;
  kind: AwardKey;
  phase: "reveal" | "winner";
  award: GameEndedAward | null;
  players: RevealEntry[];
  youName: string;
  lang: Lang;
}) {
  const meta = AWARD_META[kind];
  const titleStr = t[meta.titleKey] as string;
  const subStr = t[meta.subKey] as string;

  // Build collage: every player's stills for this kind (server already capped to 3).
  const tiles = useMemo(() => collageTiles(players, kind), [players, kind]);
  const winnerEntry = award ? players.find((p) => p.id === award.id) ?? null : null;
  const winnerAnimal = winnerEntry?.animal
    ? animalLocalized[lang][winnerEntry.animal as AnimalCode] ?? winnerEntry.animal
    : "—";

  const isYou = !!youName && award && award.name === youName;

  return (
    <div className={"endgame-card endgame-award-stage" + (phase === "winner" ? " is-winner" : "")}>
      <div className="endgame-eyebrow">{t.endGameAwardsHead}</div>
      <div className="endgame-award-stage__title">
        <span className="endgame-award-stage__medal" aria-hidden>{meta.medal}</span>
        <div>
          <h2 className="endgame-award-stage__name">{titleStr}</h2>
          <div className="endgame-award-stage__sub muted">{subStr}</div>
        </div>
      </div>

      <Collage tiles={tiles} fallbackEmoji={meta.emoji} />

      {phase === "winner" ? (
        award ? (
          <div className={"endgame-award-stage__winner" + (isYou ? " is-self" : "")}>
            <div className="endgame-award-stage__winner-line">
              <span className="endgame-award-stage__star" aria-hidden>★</span>
              <span className="endgame-award-stage__wname">{award.name}</span>
              {isYou ? <span className="endgame-award-stage__you" aria-hidden> · YOU</span> : null}
            </div>
            <div className="endgame-award-stage__wmeta">
              {winnerAnimal} · ×{award.count}
            </div>
          </div>
        ) : (
          <div className="muted endgame-award-stage__none">{t.endGameAwardNone}</div>
        )
      ) : (
        <div className="endgame-award-stage__teaser muted">{t.endGameAwardCounting}</div>
      )}
    </div>
  );
}

interface CollageTile {
  src: string | null;
  initial: string;
  isWinner: boolean;
}

function collageTiles(players: RevealEntry[], kind: AwardKey): CollageTile[] {
  // Pull every still each player has for this kind. If no stills at all, we
  // fall back to a "letter chip" so the panel isn't empty.
  const buckets: { player: RevealEntry; stills: string[] }[] = players.map((p) => {
    const hl: PlayerHighlights | undefined = p.highlights;
    const stills = (hl?.[kind] ?? []).slice(0, 3);
    return { player: p, stills };
  });
  const all: CollageTile[] = [];
  for (const b of buckets) {
    if (b.stills.length === 0) continue;
    for (const s of b.stills) {
      all.push({ src: s, initial: b.player.name.charAt(0).toUpperCase(), isWinner: false });
    }
  }
  if (all.length === 0) {
    // Letter chips for everyone so the screen still feels populated.
    return players.slice(0, 9).map((p) => ({
      src: null,
      initial: p.name.charAt(0).toUpperCase(),
      isWinner: false
    }));
  }
  // Cap to ~9 tiles so the layout doesn't blow up on a 10-player room.
  const capped = all.slice(0, 9);
  return capped;
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
          {tl.src ? (
            <img className="endgame-collage__img" src={tl.src} alt="" />
          ) : (
            <span className="endgame-collage__initial">{tl.initial}</span>
          )}
        </div>
      ))}
    </div>
  );
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
  return (
    <div className={"endgame-card" + (youLived ? " endgame-card--alive" : "")}>
      <div className="endgame-eyebrow">{t.endGameTitle}</div>
      {isPlayer && viewerEntry ? (
        <>
          <h1 id="endgameTitle" className="endgame-headline">
            {youLived ? t.endGameAlive : t.endGameDead}
          </h1>
          <p className="endgame-sub muted">
            {youLived ? t.endGameAliveSub : t.endGameDeadSub}
          </p>
        </>
      ) : (
        <h1 id="endgameTitle" className="endgame-headline">
          {t.endGameSurvivorCount(survivors.length, total)}
        </h1>
      )}

      {isPlayer && viewerEntry?.faceCounts ? (
        <PlayerStats counts={viewerEntry.faceCounts} t={t} />
      ) : null}

      {gameEnded.awards ? (
        <Awards awards={gameEnded.awards} youName={youName} t={t} />
      ) : null}

      <div className="endgame-grid">
        <section>
          <div className="endgame-section-label">{t.endGameSurvivorsHead}</div>
          {survivors.length === 0 ? (
            <div className="muted endgame-empty">—</div>
          ) : (
            <ul className="endgame-list">
              {survivors.map((p) => (
                <EndGameRow key={p.id} player={p} youName={youName} lang={lang} alive />
              ))}
            </ul>
          )}
        </section>
        {eliminated.length > 0 ? (
          <section>
            <div className="endgame-section-label">{t.endGameDeadHead}</div>
            <ul className="endgame-list">
              {eliminated.map((p) => (
                <EndGameRow key={p.id} player={p} youName={youName} lang={lang} alive={false} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <div className="endgame-actions">
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
  youName,
  t
}: {
  awards: NonNullable<GameEnded["awards"]>;
  youName: string;
  t: Dict;
}) {
  const items: Array<{ key: string; medal: string; title: string; sub: string; winner: GameEndedAward | null }> = [
    {
      key: "mouth",
      medal: "🥇",
      title: t.awardMouthTitle,
      sub: t.awardMouthSub,
      winner: awards.mouthOpens
    },
    {
      key: "shake",
      medal: "🥈",
      title: t.awardShakeTitle,
      sub: t.awardShakeSub,
      winner: awards.headShakes
    },
    {
      key: "blink",
      medal: "🥉",
      title: t.awardBlinkTitle,
      sub: t.awardBlinkSub,
      winner: awards.blinks
    }
  ];
  if (items.every((i) => !i.winner)) return null;
  return (
    <div className="endgame-awards" aria-label="Awards">
      <div className="endgame-section-label endgame-awards__head">{t.endGameAwardsHead}</div>
      <ul className="endgame-awards__list">
        {items.map((it) => {
          const isYou = !!youName && it.winner?.name === youName;
          return (
            <li
              key={it.key}
              className={
                "endgame-award" +
                (it.winner ? " has-winner" : "") +
                (isYou ? " is-self" : "")
              }
            >
              <span className="endgame-award__medal" aria-hidden>{it.medal}</span>
              <div className="endgame-award__col">
                <div className="endgame-award__title">{it.title}</div>
                <div className="endgame-award__sub">{it.sub}</div>
              </div>
              <div className="endgame-award__winner">
                {it.winner ? (
                  <>
                    <span className="endgame-award__name">{it.winner.name}</span>
                    <span className="endgame-award__count">×{it.winner.count}</span>
                  </>
                ) : (
                  <span className="muted endgame-award__none">{t.endGameAwardNone}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
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
