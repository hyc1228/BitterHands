import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import GIF from "gif.js";
import gifWorkerUrl from "gif.js/dist/gif.worker.js?url";
import { animalLocalized, dict } from "../i18n";
import { usePartyStore } from "../party/store";
import type {
  GameEnded,
  GameEndedAward,
  AnimalCode,
  Lang,
  FaceCounts,
  HighlightBurst,
  PlayerHighlights
} from "../party/protocol";
import type { dict as dictFn } from "../i18n";

type Dict = ReturnType<typeof dictFn>;
type RevealEntry = GameEnded["reveal"][number];
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

  const stageClass =
    "endgame-stage" + (viewerRole === "ob" ? " endgame-stage--ob" : "");

  return (
    <div className="endgame-mask" role="dialog" aria-modal="true" aria-labelledby="endgameTitle">
      <div className={stageClass} key={stageKey(stage)}>
        {stage.kind === "intro" ? (
          <IntroPanel
            t={t}
            survivors={survivors.length}
            total={realPlayers.length}
            onNext={advance}
          />
        ) : null}
        {stage.kind === "award" ? (
          <AwardPanel
            t={t}
            kind={stage.key}
            award={awardFor(gameEnded, stage.key)}
            players={realPlayers}
            youName={myName}
            lang={lang}
            viewerRole={viewerRole}
            onNext={advance}
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

function AwardPanel({
  t,
  kind,
  award,
  players,
  youName,
  lang,
  viewerRole,
  onNext
}: {
  t: Dict;
  kind: AwardKey;
  award: GameEndedAward | null;
  players: RevealEntry[];
  youName: string;
  lang: Lang;
  viewerRole: "player" | "ob";
  onNext: () => void;
}) {
  const meta = AWARD_META[kind];
  const titleStr = t[meta.titleKey] as string;
  const subStr = t[meta.subKey] as string;

  // Each tile is a player's burst (short frame loop). Winner highlighted.
  const tiles = useMemo(
    () => collageTiles(players, kind, award?.id ?? null),
    [players, kind, award?.id]
  );
  const winnerEntry = award ? players.find((p) => p.id === award.id) ?? null : null;
  const winnerAnimal = winnerEntry?.animal
    ? animalLocalized[lang][winnerEntry.animal as AnimalCode] ?? winnerEntry.animal
    : "—";

  const isYou = !!youName && award && award.name === youName;
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Reveal cinematics: collage breathes for ~1s, then a 2.4s drumroll
  // (3 → 2 → 1 → ✦) overlays it, then the winner block stamps in with
  // a confetti burst. Resets each time `kind` changes (next award).
  const [phase, setPhase] = useState<AwardPhase>("collage");
  const [tick, setTick] = useState(3);
  useEffect(() => {
    setPhase("collage");
    setTick(3);
    const t1 = window.setTimeout(() => setPhase("countdown"), 1000);
    const t2 = window.setTimeout(() => setTick(2), 1000 + 700);
    const t3 = window.setTimeout(() => setTick(1), 1000 + 1400);
    const t4 = window.setTimeout(() => setPhase("reveal"), 1000 + 2100);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
    };
  }, [kind]);

  // Allow tap-anywhere to skip ahead in the cinematic — useful for impatient
  // players, while OB / spectators tend to let it play.
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
        award ? (
          <div className={"endgame-award-stage__winner" + (isYou ? " is-self" : "")}>
            <Confetti />
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
          disabled={phase !== "reveal"}
        >
          {t.endGameNext}
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
      const sources: string[] = burst && burst.length > 0
        ? burst
        : p.lastFrame
          ? [p.lastFrame]
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
    let primaryFrames: HighlightBurst | null = null;
    if (bursts.length > 0) {
      primaryFrames = bursts[0];
    } else if (p.lastFrame) {
      primaryFrames = [p.lastFrame];
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
        const frames =
          burst && burst.length > 0
            ? burst
            : p.lastFrame
              ? [p.lastFrame]
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
  type AwardKindKey = "mouth" | "shake" | "blink";
  const items: Array<{
    key: AwardKindKey;
    medal: string;
    title: string;
    sub: string;
    winner: GameEndedAward | null;
  }> = [
    { key: "mouth", medal: "🥇", title: t.awardMouthTitle, sub: t.awardMouthSub, winner: awards.mouthOpens },
    { key: "shake", medal: "🥈", title: t.awardShakeTitle, sub: t.awardShakeSub, winner: awards.headShakes },
    { key: "blink", medal: "🥉", title: t.awardBlinkTitle, sub: t.awardBlinkSub, winner: awards.blinks }
  ];
  if (items.every((i) => !i.winner)) return null;
  return (
    <div className="endgame-awards" aria-label="Awards">
      <div className="endgame-section-label endgame-awards__head">{t.endGameAwardsHead}</div>
      <div className="endgame-awards__cards">
        {items.map((it) => {
          const isYou = !!youName && it.winner?.name === youName;
          const winner = it.winner ? players.find((p) => p.id === it.winner!.id) : null;
          const burst = winner?.highlights?.[it.key]?.[0] ?? null;
          const portrait =
            burst && burst.length > 0
              ? burst[0]
              : winner?.lastFrame ?? winner?.avatarUrl ?? null;
          return (
            <div
              key={it.key}
              className={
                "endgame-award-card" +
                (it.winner ? " has-winner" : "") +
                (isYou ? " is-self" : "")
              }
            >
              <div className="endgame-award-card__medal" aria-hidden>{it.medal}</div>
              <div className="endgame-award-card__portrait">
                {portrait ? (
                  <img src={portrait} alt={it.winner?.name ?? ""} loading="lazy" />
                ) : (
                  <span className="endgame-award-card__initial" aria-hidden>
                    {it.winner?.name?.charAt(0).toUpperCase() ?? "—"}
                  </span>
                )}
              </div>
              <div className="endgame-award-card__title">{it.title}</div>
              <div className="endgame-award-card__sub">{it.sub}</div>
              <div className="endgame-award-card__winner">
                {it.winner ? (
                  <>
                    <span className="endgame-award-card__name">{it.winner.name}</span>
                    <span className="endgame-award-card__count">×{it.winner.count}</span>
                  </>
                ) : (
                  <span className="muted endgame-award-card__none">{t.endGameAwardNone}</span>
                )}
              </div>
            </div>
          );
        })}
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
