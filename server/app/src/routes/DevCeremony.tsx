import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import EndGameOverlay from "../components/EndGameOverlay";
import { usePartyStore } from "../party/store";
import { Animals } from "../party/protocol";
import type {
  AnimalCode,
  GameEnded,
  GameEndedMedia,
  GameEndedRevealEntry
} from "../party/protocol";

/**
 * /#/dev/ceremony — local-only sandbox for the end-game ceremony.
 *
 * Mounts `EndGameOverlay` directly with a fully-formed mock `GameEnded` +
 * per-player `GameEndedMedia` payload pre-loaded into the Zustand store.
 * No PartyKit connection, no live game required.  This is the fastest
 * way to verify the ceremony actually renders end-to-end on a fresh
 * device — if the page is blank here, the bug is in the React tree, not
 * the WS protocol.  Switches let you flip viewer role (player / OB),
 * simulate the "metadata first, media trickling in" progressive render,
 * and exercise the empty-reveal fallback path.
 */
type Mode = "full" | "metadata-only" | "empty";

const PIXEL_DATAURL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQI12P4//8/AwAI/AL+XJ/PNgAAAABJRU5ErkJggg==";

const NAMES = ["Lion", "Owl", "Giraffe", "Tiger", "Wolf", "Hawk"];
const ANIMALS: AnimalCode[] = [Animals.LION, Animals.OWL, Animals.GIRAFFE];

function makeReveal(): GameEndedRevealEntry[] {
  return NAMES.map((name, i) => ({
    id: `dev_${i + 1}`,
    name: name + " " + (i + 1),
    animal: ANIMALS[i % ANIMALS.length],
    verdict:
      i % 3 === 0
        ? "Probably a Lion. Calm under pressure."
        : i % 3 === 1
        ? "An Owl. Reads the room before moving."
        : "A Giraffe. Hyper-alert, slow to commit.",
    alive: i !== 1 && i !== 4,
    lives: i === 1 || i === 4 ? 0 : 3 - (i % 3),
    violations: (i + 1) % 3,
    faceCounts: {
      mouthOpens: 4 + ((i * 3) % 7),
      headShakes: 2 + ((i * 5) % 6),
      blinks: 1 + ((i * 7) % 5)
    }
  }));
}

function makeAwards(reveal: GameEndedRevealEntry[]): NonNullable<GameEnded["awards"]> {
  const pick = (key: "mouthOpens" | "headShakes" | "blinks") => {
    let best = reveal[0];
    for (const p of reveal) {
      const v = p.faceCounts?.[key] ?? 0;
      const bv = best.faceCounts?.[key] ?? 0;
      if (v > bv) best = p;
    }
    return { id: best.id, name: best.name, count: best.faceCounts?.[key] ?? 0 };
  };
  return {
    mouthOpens: pick("mouthOpens"),
    headShakes: pick("headShakes"),
    blinks: pick("blinks")
  };
}

function makeMedia(reveal: GameEndedRevealEntry[]): GameEndedMedia[] {
  // We don't have real webcam frames in the dev sandbox; use the 1x1
  // pixel data URL everywhere so render paths that read from these
  // fields don't trip on `undefined`. The collage tiles will fall back
  // to letter avatars (which is the realistic worst-case + cheapest to
  // visually verify).
  return reveal.map((p) => ({
    playerId: p.id,
    highlights: {
      mouth: [[PIXEL_DATAURL, PIXEL_DATAURL]],
      shake: [[PIXEL_DATAURL]],
      blink: [[PIXEL_DATAURL, PIXEL_DATAURL, PIXEL_DATAURL]]
    },
    avatarUrl: null,
    lastFrame: PIXEL_DATAURL,
    fallbackBurst: [PIXEL_DATAURL, PIXEL_DATAURL, PIXEL_DATAURL]
  }));
}

export default function DevCeremony() {
  const [mode, setMode] = useState<Mode>("full");
  const [viewer, setViewer] = useState<"player" | "ob">("player");
  const [armed, setArmed] = useState(false);

  const reveal = useMemo(() => (mode === "empty" ? [] : makeReveal()), [mode]);
  const awards = useMemo(() => (reveal.length ? makeAwards(reveal) : undefined), [reveal]);

  const arm = useCallback(() => {
    const gameEnded: GameEnded = {
      endedAt: Date.now(),
      reveal,
      awards,
      owlGuesses: {}
    };
    // Drive the store the same way the real WS handlers do so the overlay
    // sees the same shape it would in production.
    usePartyStore.setState({
      gameEnded,
      gameEndedMedia: new Map(),
      myName: viewer === "ob" ? "ob" : reveal[0]?.name ?? "guest",
      lang: "en"
    });
    if (mode === "full") {
      // Stream the heavy media in immediately so the overlay merges
      // them into the first render. Mirrors the production wire.
      const media = makeMedia(reveal);
      usePartyStore.setState({
        gameEndedMedia: new Map(media.map((m) => [m.playerId, m]))
      });
    } else if (mode === "metadata-only") {
      // Leave gameEndedMedia empty — exercises the "metadata first,
      // tiles fall back to letters" path that hits the wire when a
      // GAME_ENDED arrives but the per-player media follow-ups are
      // delayed (or pruned).
    }
    setArmed(true);
  }, [reveal, awards, viewer, mode]);

  const disarm = useCallback(() => {
    usePartyStore.setState({
      gameEnded: null,
      gameEndedMedia: new Map()
    });
    setArmed(false);
  }, []);

  // Auto-disarm on unmount so navigating away doesn't leave a live
  // ceremony bleeding into the real Lobby/Main routes.
  useEffect(() => {
    return () => {
      usePartyStore.setState({ gameEnded: null, gameEndedMedia: new Map() });
    };
  }, []);

  return (
    <div style={{ padding: 24, color: "white" }}>
      <h2>Dev — Ceremony renderer</h2>
      <p style={{ opacity: 0.7, maxWidth: 640 }}>
        Mounts the end-game overlay with mock data, with no PartyKit
        connection. If this page renders the awards but the real game
        does not, the bug is in the WS protocol or server deploy.  If
        this page also fails, the bug is in the React tree.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "16px 0" }}>
        <label>
          mode:&nbsp;
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="full">full (reveal + media)</option>
            <option value="metadata-only">metadata-only (no media yet)</option>
            <option value="empty">empty reveal (fallback card)</option>
          </select>
        </label>
        <label>
          viewer:&nbsp;
          <select value={viewer} onChange={(e) => setViewer(e.target.value as "player" | "ob")}>
            <option value="player">player</option>
            <option value="ob">ob</option>
          </select>
        </label>
        <button type="button" onClick={arm} disabled={armed}>
          Arm ceremony
        </button>
        <button type="button" onClick={disarm} disabled={!armed}>
          Clear
        </button>
        <Link to="/" style={{ alignSelf: "center", color: "#9cf" }}>
          ← back home
        </Link>
      </div>

      {armed ? <EndGameOverlay viewerRole={viewer} homePath="/dev/ceremony" /> : null}
    </div>
  );
}
