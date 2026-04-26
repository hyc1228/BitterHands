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
  const [savedHint, setSavedHint] = useState(false);

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

  const winnerBurst: HighlightBurst | null = useMemo(() => {
    if (!award) return null;
    const winner = players.find((p) => p.id === award.id);
    const bursts = winner?.highlights?.[kind];
    return bursts && bursts.length > 0 ? bursts[0] : null;
  }, [players, award, kind]);
  // MediaRecorder + canvas.captureStream support gates the clip button.
  // iOS Safari 14.5+ supports both, but very old browsers won't.
  const canExportClip = typeof window !== "undefined"
    && typeof window.MediaRecorder !== "undefined"
    && typeof HTMLCanvasElement !== "undefined"
    && "captureStream" in HTMLCanvasElement.prototype
    && (winnerBurst?.length ?? 0) >= 2;

  const baseShareText = award?.name ? `${meta.medal} ${award.name}` : titleStr;
  const baseFileBase = useCallback(() => {
    const safeWinner = (award?.name ?? "winner")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .slice(0, 24) || "winner";
    return `nocturne-zoo-${kind}-${safeWinner}-${formatDateSlug()}`;
  }, [award, kind]);

  const flashSavedHint = useCallback(() => {
    setSavedHint(true);
    window.setTimeout(() => setSavedHint(false), 1600);
  }, []);

  const handleSave = useCallback(async () => {
    const blob = await composeAwardCardPng({
      medal: meta.medal,
      title: titleStr,
      sub: subStr,
      tiles,
      winnerName: award?.name ?? null,
      winnerCount: award?.count ?? null,
      winnerAnimal: winnerEntry ? winnerAnimal : null
    });
    if (!blob) return;
    await shareOrDownload(blob, `${baseFileBase()}.png`, "image/png", titleStr, baseShareText);
    flashSavedHint();
  }, [meta.medal, titleStr, subStr, tiles, award, winnerEntry, winnerAnimal, baseFileBase, baseShareText, flashSavedHint]);

  const handleSaveClip = useCallback(async () => {
    if (!winnerBurst) return;
    const blob = await composeAwardClipWebm(
      {
        medal: meta.medal,
        title: titleStr,
        winnerName: award?.name ?? null,
        winnerCount: award?.count ?? null,
        winnerAnimal: winnerEntry ? winnerAnimal : null
      },
      winnerBurst
    );
    if (!blob) {
      // Encoder failure — fall back to the static PNG so the user still gets
      // something. Better than a silent no-op.
      await handleSave();
      return;
    }
    const ext = blob.type.includes("webm") ? "webm" : "mp4";
    await shareOrDownload(blob, `${baseFileBase()}.${ext}`, blob.type || "video/webm", titleStr, baseShareText);
    flashSavedHint();
  }, [winnerBurst, meta.medal, titleStr, award, winnerEntry, winnerAnimal, baseFileBase, baseShareText, flashSavedHint, handleSave]);

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
        <button
          type="button"
          className="ghost"
          onClick={(e) => { e.stopPropagation(); handleSave(); }}
          disabled={phase !== "reveal"}
        >
          {savedHint ? t.endGameSaved : t.endGameSave}
        </button>
        {canExportClip ? (
          <button
            type="button"
            className="ghost"
            onClick={(e) => { e.stopPropagation(); handleSaveClip(); }}
            disabled={phase !== "reveal"}
            title={t.endGameSaveClipHint}
          >
            {t.endGameSaveClip}
          </button>
        ) : null}
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
 * Render the winner's highlight burst as a short looping video clip
 * (`video/webm`, ~2 s). Each frame draws a card layout (medal / title at
 * top, current burst frame in the middle, winner block at the bottom),
 * then captures the canvas via MediaRecorder for sharing/download.
 *
 * Returns null if MediaRecorder isn't available or the burst is too short
 * to be a useful clip.
 */
async function composeAwardClipWebm(
  opts: {
    medal: string;
    title: string;
    winnerName: string | null;
    winnerCount: number | null;
    winnerAnimal: string | null;
  },
  frames: HighlightBurst
): Promise<Blob | null> {
  if (!frames || frames.length < 2) return null;
  if (typeof MediaRecorder === "undefined") return null;
  const W = 480;
  const H = 720;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const imgs = await Promise.all(
    frames.map((src) =>
      loadImage(src).catch(() => null)
    )
  );
  const validImgs = imgs.filter((x): x is HTMLImageElement => !!x);
  if (validImgs.length < 2) return null;

  const captureCtx = canvas as HTMLCanvasElement & { captureStream?: (fps: number) => MediaStream };
  if (typeof captureCtx.captureStream !== "function") return null;
  const stream = captureCtx.captureStream(30);
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4"
  ];
  let mime = "";
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) { mime = c; break; }
  }
  let rec: MediaRecorder;
  try {
    rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  } catch {
    return null;
  }
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  return new Promise<Blob | null>((resolve) => {
    let stopped = false;
    const finish = () => {
      if (stopped) return;
      stopped = true;
      try { rec.stop(); } catch { /* ignore */ }
    };
    rec.onstop = () => {
      const out = new Blob(chunks, { type: rec.mimeType || mime || "video/webm" });
      resolve(out.size > 0 ? out : null);
    };
    // Hard timeout so a stuck encoder never traps the UI.
    const timeout = window.setTimeout(finish, 8000);

    rec.start();

    const FRAME_MS = 110;          // ≈ 9 fps, matches the in-page playback rate
    const LOOPS = 3;
    const totalFrames = validImgs.length * LOOPS;
    let i = 0;

    function drawOnce() {
      drawClipFrame(ctx!, W, H, opts, validImgs[i % validImgs.length]!);
      i++;
      if (i >= totalFrames) {
        // Hold the last frame briefly so the video doesn't end mid-motion.
        window.setTimeout(() => {
          window.clearTimeout(timeout);
          finish();
        }, 220);
        return;
      }
      window.setTimeout(drawOnce, FRAME_MS);
    }
    drawOnce();
  });
}

function drawClipFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  opts: {
    medal: string;
    title: string;
    winnerName: string | null;
    winnerCount: number | null;
    winnerAnimal: string | null;
  },
  img: HTMLImageElement
): void {
  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#1a1314");
  bg.addColorStop(1, "#070707");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // Spotlight halo behind the medal
  const sp = ctx.createRadialGradient(W / 2, 90, 0, W / 2, 90, W * 0.55);
  sp.addColorStop(0, "rgba(255, 220, 90, 0.32)");
  sp.addColorStop(1, "rgba(255, 220, 90, 0)");
  ctx.fillStyle = sp;
  ctx.fillRect(0, 0, W, H);

  // Medal + title
  ctx.fillStyle = "#f2efe9";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = "60px serif";
  ctx.fillText(opts.medal, W / 2, 80);
  ctx.font = "600 22px Helvetica, Arial, sans-serif";
  ctx.fillText(opts.title.toUpperCase(), W / 2, 118);

  // Burst frame in the middle
  const FX = 30;
  const FY = 140;
  const FW = W - 60;
  const FH = 360;
  ctx.fillStyle = "#000";
  roundedRect(ctx, FX, FY, FW, FH, 14);
  ctx.fill();
  ctx.save();
  roundedRect(ctx, FX, FY, FW, FH, 14);
  ctx.clip();
  // Cover-fit the image into the slot
  const ar = img.naturalWidth / Math.max(1, img.naturalHeight);
  const slotAr = FW / FH;
  let dw = FW, dh = FH, dx = FX, dy = FY;
  if (ar > slotAr) {
    dh = FH;
    dw = FH * ar;
    dx = FX - (dw - FW) / 2;
  } else {
    dw = FW;
    dh = FW / ar;
    dy = FY - (dh - FH) / 2;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255, 220, 90, 0.7)";
  roundedRect(ctx, FX, FY, FW, FH, 14);
  ctx.stroke();

  // Winner band
  const WY = FY + FH + 26;
  ctx.fillStyle = "rgba(255, 220, 90, 0.10)";
  roundedRect(ctx, 30, WY, W - 60, 110, 16);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255, 220, 90, 0.85)";
  roundedRect(ctx, 30, WY, W - 60, 110, 16);
  ctx.stroke();
  ctx.fillStyle = "#f2efe9";
  ctx.font = "600 30px Helvetica, Arial, sans-serif";
  ctx.fillText(`★  ${opts.winnerName ?? "—"}`, W / 2, WY + 50);
  ctx.fillStyle = "rgba(242, 239, 233, 0.7)";
  ctx.font = "16px Helvetica, Arial, sans-serif";
  const meta = [opts.winnerAnimal, opts.winnerCount != null ? `×${opts.winnerCount}` : null]
    .filter(Boolean)
    .join("  ·  ");
  ctx.fillText(meta || "—", W / 2, WY + 80);

  // Footer wordmark
  ctx.fillStyle = "rgba(242, 239, 233, 0.55)";
  ctx.font = "11px Helvetica, Arial, sans-serif";
  ctx.fillText("NOCTURNE ZOO · NIGHT SHIFT", W / 2, H - 24);
}

function formatDateSlug(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
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

function collageTiles(
  players: RevealEntry[],
  kind: AwardKey,
  winnerId: string | null
): CollageTile[] {
  // Each tile = one burst (so a single player can contribute up to 3 tiles).
  const buckets: { player: RevealEntry; bursts: HighlightBurst[] }[] = players.map((p) => {
    const hl: PlayerHighlights | undefined = p.highlights;
    const bursts = (hl?.[kind] ?? []).slice(0, 3);
    return { player: p, bursts };
  });
  const all: CollageTile[] = [];
  for (const b of buckets) {
    if (b.bursts.length === 0) continue;
    for (const burst of b.bursts) {
      all.push({
        frames: burst,
        initial: b.player.name.charAt(0).toUpperCase(),
        isWinner: !!winnerId && b.player.id === winnerId
      });
    }
  }
  if (all.length === 0) {
    return players.slice(0, 9).map((p) => ({
      frames: [],
      initial: p.name.charAt(0).toUpperCase(),
      isWinner: !!winnerId && p.id === winnerId
    }));
  }
  // Sort winner tiles to the front so they read first (and we keep them when
  // capping to 9).
  all.sort((a, b) => Number(b.isWinner) - Number(a.isWinner));
  return all.slice(0, 9);
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

/* ------------------------------------------------------------------ */
/* Save card (Canvas-composed PNG, no extra dep)                       */
/* ------------------------------------------------------------------ */

interface SaveOpts {
  medal: string;
  title: string;
  sub: string;
  tiles: CollageTile[];
  winnerName: string | null;
  winnerCount: number | null;
  winnerAnimal: string | null;
}

async function composeAwardCardPng(opts: SaveOpts): Promise<Blob | null> {
  const W = 720;
  const H = 920;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Background — same noir gradient as the live card.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#1a1314");
  bg.addColorStop(1, "#070707");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Top spotlight
  const sp = ctx.createRadialGradient(W / 2, H * 0.18, 0, W / 2, H * 0.18, W * 0.55);
  sp.addColorStop(0, "rgba(214, 64, 46, 0.36)");
  sp.addColorStop(1, "rgba(214, 64, 46, 0)");
  ctx.fillStyle = sp;
  ctx.fillRect(0, 0, W, H);

  // Medal + title
  ctx.fillStyle = "#f2efe9";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = "92px serif";
  ctx.fillText(opts.medal, W / 2, 130);
  ctx.font = "600 30px Helvetica, Arial, sans-serif";
  ctx.fillText(opts.title.toUpperCase(), W / 2, 190);
  ctx.fillStyle = "rgba(242, 239, 233, 0.62)";
  ctx.font = "16px Helvetica, Arial, sans-serif";
  ctx.fillText(opts.sub, W / 2, 218);

  // Collage 3×3 (or whatever fits)
  const COLS = 3;
  const ROWS = 3;
  const PAD = 60;
  const GAP = 18;
  const gridTop = 250;
  const cellW = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
  const cellH = cellW;
  const visible = opts.tiles.slice(0, COLS * ROWS);
  await Promise.all(
    visible.map(async (tile, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = PAD + col * (cellW + GAP);
      const y = gridTop + row * (cellH + GAP);
      // Slight per-tile rotation for polaroid feel.
      const rot = ((i * 7) % 5) * 0.018 - 0.04;
      ctx.save();
      ctx.translate(x + cellW / 2, y + cellH / 2);
      ctx.rotate(rot);
      ctx.translate(-cellW / 2, -cellH / 2);
      ctx.fillStyle = "#000";
      roundedRect(ctx, 0, 0, cellW, cellH, 12);
      ctx.fill();
      const src = tile.frames[0] ?? null;
      if (src) {
        try {
          const img = await loadImage(src);
          ctx.save();
          roundedRect(ctx, 0, 0, cellW, cellH, 12);
          ctx.clip();
          ctx.drawImage(img, 0, 0, cellW, cellH);
          ctx.restore();
        } catch (e) { /* ignore single tile failure */ }
      } else {
        ctx.fillStyle = "rgba(214, 64, 46, 0.32)";
        ctx.fillRect(0, 0, cellW, cellH);
        ctx.fillStyle = "#f2efe9";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "600 64px Helvetica, Arial, sans-serif";
        ctx.fillText(tile.initial, cellW / 2, cellH / 2);
      }
      // Winner border in gold
      if (tile.isWinner) {
        ctx.lineWidth = 5;
        ctx.strokeStyle = "rgba(255, 220, 90, 0.95)";
        roundedRect(ctx, 2, 2, cellW - 4, cellH - 4, 12);
        ctx.stroke();
      } else {
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(242, 239, 233, 0.55)";
        roundedRect(ctx, 1, 1, cellW - 2, cellH - 2, 12);
        ctx.stroke();
      }
      ctx.restore();
    })
  );

  // Winner block
  const winnerY = gridTop + ROWS * cellH + ROWS * GAP + 18;
  if (opts.winnerName) {
    // gold framed band
    ctx.fillStyle = "rgba(255, 220, 90, 0.10)";
    roundedRect(ctx, PAD, winnerY, W - PAD * 2, 110, 16);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255, 220, 90, 0.85)";
    roundedRect(ctx, PAD, winnerY, W - PAD * 2, 110, 16);
    ctx.stroke();
    ctx.fillStyle = "#f2efe9";
    ctx.textAlign = "center";
    ctx.font = "600 36px Helvetica, Arial, sans-serif";
    ctx.fillText(`★  ${opts.winnerName}`, W / 2, winnerY + 50);
    ctx.fillStyle = "rgba(242, 239, 233, 0.7)";
    ctx.font = "18px Helvetica, Arial, sans-serif";
    const meta = [opts.winnerAnimal, opts.winnerCount != null ? `×${opts.winnerCount}` : null]
      .filter(Boolean)
      .join("  ·  ");
    ctx.fillText(meta || "—", W / 2, winnerY + 84);
  } else {
    ctx.fillStyle = "rgba(242, 239, 233, 0.5)";
    ctx.font = "18px Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("—", W / 2, winnerY + 60);
  }

  // Footer wordmark
  ctx.fillStyle = "rgba(242, 239, 233, 0.55)";
  ctx.font = "12px Helvetica, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("NOCTURNE ZOO · NIGHT SHIFT", W / 2, H - 28);

  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png", 0.92);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
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
