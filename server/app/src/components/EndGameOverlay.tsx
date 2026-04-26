import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { animalLocalized, dict } from "../i18n";
import { usePartyStore } from "../party/store";
import type { GameEnded, AnimalCode, FaceCounts, GameEndedAward } from "../party/protocol";
import type { Lang } from "../party/protocol";
import type { dict as dictFn } from "../i18n";

type Dict = ReturnType<typeof dictFn>;

function PlayerStats({ counts, t }: { counts: FaceCounts; t: Dict }) {
  const items: Array<{ icon: string; label: string; value: number }> = [
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
  lang,
  t
}: {
  awards: NonNullable<GameEnded["awards"]>;
  youName: string;
  lang: Lang;
  t: Dict;
}) {
  void lang;
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
  // Hide the awards block entirely if no one scored on any axis (rare but
  // possible if everyone died very early and no FACE_COUNTS arrived).
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

interface Props {
  /** When omitted, treat as Player view (uses current `myName`). OB passes "ob". */
  viewerRole?: "player" | "ob";
  /** Where to navigate when the operator closes the overlay. Defaults to `/`. */
  homePath?: string;
}

/**
 * Full-screen settlement overlay shown when GAME_ENDED arrives.
 *
 * - Player view: BIG verdict (escaped / lost), then survivors / eliminated lists.
 * - OB view: same lists, no personal verdict (operator isn't a player).
 *
 * Closing/clicking "Back to start" clears `gameEnded` from the store and navigates home,
 * so a new round can begin without the overlay sticking around.
 */
export default function EndGameOverlay({ viewerRole = "player", homePath }: Props) {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);
  const nav = useNavigate();
  const gameEnded = usePartyStore((s) => s.gameEnded);
  const myName = usePartyStore((s) => s.myName);
  const clearGameEnded = usePartyStore((s) => s.clearGameEnded);

  const viewerEntry = useMemo(() => {
    if (viewerRole === "ob") return null;
    if (!gameEnded || !myName) return null;
    return gameEnded.reveal.find((p) => p.name === myName) ?? null;
  }, [gameEnded, myName, viewerRole]);

  const survivors = useMemo(() => {
    if (!gameEnded) return [];
    return gameEnded.reveal.filter((p) => p.alive !== false && p.name.toLowerCase() !== "ob");
  }, [gameEnded]);
  const eliminated = useMemo(() => {
    if (!gameEnded) return [];
    return gameEnded.reveal.filter((p) => p.alive === false && p.name.toLowerCase() !== "ob");
  }, [gameEnded]);

  if (!gameEnded) return null;

  const isPlayer = viewerRole !== "ob";
  const youLived = isPlayer && viewerEntry ? viewerEntry.alive !== false : false;
  const total = survivors.length + eliminated.length;

  function handleHome() {
    clearGameEnded();
    nav(homePath ?? "/", { replace: true });
  }

  return (
    <div className="endgame-mask" role="dialog" aria-modal="true" aria-labelledby="endgameTitle">
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

        {/* Per-player face-action stats — only shown to player view (skipped for OB). */}
        {isPlayer && viewerEntry?.faceCounts ? (
          <PlayerStats counts={viewerEntry.faceCounts} t={t} />
        ) : null}

        {/* Mario Party–style awards — primarily an OB highlight, but also shown to
            players because seeing "you won 'Loud Mouth Award'" is fun. */}
        {gameEnded.awards ? (
          <Awards awards={gameEnded.awards} youName={myName} lang={lang} t={t} />
        ) : null}

        <div className="endgame-grid">
          <section>
            <div className="endgame-section-label">{t.endGameSurvivorsHead}</div>
            {survivors.length === 0 ? (
              <div className="muted endgame-empty">—</div>
            ) : (
              <ul className="endgame-list">
                {survivors.map((p) => (
                  <EndGameRow key={p.id} player={p} youName={myName} lang={lang} alive />
                ))}
              </ul>
            )}
          </section>
          {eliminated.length > 0 ? (
            <section>
              <div className="endgame-section-label">{t.endGameDeadHead}</div>
              <ul className="endgame-list">
                {eliminated.map((p) => (
                  <EndGameRow key={p.id} player={p} youName={myName} lang={lang} alive={false} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="endgame-actions">
          <button className="primary" onClick={handleHome}>
            {t.endGameBackHome}
          </button>
          <button className="ghost" onClick={() => clearGameEnded()}>
            {t.endGameClose}
          </button>
        </div>
      </div>
    </div>
  );
}

function EndGameRow({
  player,
  youName,
  lang,
  alive
}: {
  player: GameEnded["reveal"][number];
  youName: string;
  lang: ReturnType<typeof usePartyStore.getState>["lang"];
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
