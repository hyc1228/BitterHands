import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { animalLocalized, dict } from "../i18n";
import { usePartyStore } from "../party/store";
import type { GameEnded, AnimalCode } from "../party/protocol";

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
          {alive ? "♥".repeat(Math.max(0, player.lives)) : "0"}
        </span>
      ) : null}
    </li>
  );
}
