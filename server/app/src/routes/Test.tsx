import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DEFAULT_ROOM_ID } from "../constants";
import { ClientMessageTypes } from "../party/protocol";
import { usePartyStore } from "../party/store";

/**
 * /test — bypass character creation and drop straight into the live scene.
 *
 * Flow on mount:
 *   1. JOIN with a random "T_xxxx" name
 *   2. SUBMIT_PHOTO with a 1x1 transparent PNG (server runs its photo-indexing
 *      stub on whatever bytes arrive, so this is enough for an animal assignment)
 *   3. SUBMIT_ANSWERS with random A/B/C across the 3 quiz IDs
 *   4. Wait for PRIVATE_RULES_CARD → server has now decided your role
 *   5. READY (lobby)
 *   6. Show a [Start now] button. Clicking it sends TEST_FORCE_START which
 *      bypasses the OB-only START gate and starts the round for everyone in
 *      the room. While the panel is open, additional /test tabs can join the
 *      same room for ad-hoc multiplayer testing.
 *
 * After the game starts, MainScene mounts an "End now" overlay (gated by the
 * `nz.testMode` sessionStorage key set here) so testers can jump to the award
 * ceremony without waiting the full timer.
 */
const TEST_QUIZ_IDS = ["qz_01", "qz_02", "qz_03"];
// Tiny transparent PNG. Server only needs `data:image/...;base64,` shape.
const DUMMY_PHOTO_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQI12P4//8/AwAI/AL+XJ/PNgAAAABJRU5ErkJggg==";

type TestStage =
  | "connecting"
  | "submitting-photo"
  | "submitting-answers"
  | "ready"
  | "starting"
  | "started";

function randomChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomTestName(): string {
  const seed = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `T_${seed}`;
}

export default function Test() {
  const nav = useNavigate();
  const conn = usePartyStore((s) => s.conn);
  const myName = usePartyStore((s) => s.myName);
  const send = usePartyStore((s) => s.send);
  const lang = usePartyStore((s) => s.lang);
  const rulesCard = usePartyStore((s) => s.rulesCard);
  const snapshot = usePartyStore((s) => s.snapshot);

  const [stage, setStage] = useState<TestStage>("connecting");
  const [error, setError] = useState<string | null>(null);
  const sentPhoto = useRef(false);
  const sentAnswers = useRef(false);
  const sentReady = useRef(false);

  const room = (() => {
    try {
      return localStorage.getItem("nz.roomId") || DEFAULT_ROOM_ID;
    } catch {
      return DEFAULT_ROOM_ID;
    }
  })();

  // Flag MainScene's "End now" overlay (the same hook used to show test-only UI).
  useEffect(() => {
    try { sessionStorage.setItem("nz.testMode", "1"); } catch { /* ignore */ }
  }, []);

  // Connect (or reuse open conn) with a random T_ name.
  useEffect(() => {
    const s = usePartyStore.getState();
    if (s.conn === "open" && s.myName) return;
    const name = s.myName && s.myName.startsWith("T_") ? s.myName : randomTestName();
    s.setName(name);
    s.connect({ roomId: room, name, lang, mode: "player" }).catch((err) =>
      setError(String(err?.message || err))
    );
  }, [lang, room]);

  // Step 1 → 2: photo as soon as ws is open.
  useEffect(() => {
    if (conn !== "open") return;
    if (sentPhoto.current) return;
    if (send(ClientMessageTypes.SUBMIT_PHOTO, { photoBase64: DUMMY_PHOTO_DATA_URL })) {
      sentPhoto.current = true;
      setStage("submitting-photo");
    }
  }, [conn, send]);

  // Step 2 → 3: answers (random A/B/C across the 3 known quiz IDs).
  useEffect(() => {
    if (conn !== "open") return;
    if (!sentPhoto.current || sentAnswers.current) return;
    const answers: Record<string, string> = {};
    for (const id of TEST_QUIZ_IDS) answers[id] = randomChoice(["A", "B", "C"] as const);
    if (send(ClientMessageTypes.SUBMIT_ANSWERS, { answers, lang })) {
      sentAnswers.current = true;
      setStage("submitting-answers");
    }
  }, [conn, send, lang]);

  // Step 3 → 4: server replied with our rules card → READY → ready stage.
  useEffect(() => {
    if (!rulesCard) return;
    if (sentReady.current) return;
    if (send(ClientMessageTypes.READY)) {
      sentReady.current = true;
      setStage("ready");
    }
  }, [rulesCard, send]);

  // When the round actually starts (server flipped `started`), jump to the scene.
  useEffect(() => {
    if (snapshot?.started) {
      setStage("started");
      nav("/main-scene", { replace: true });
    }
  }, [snapshot?.started, nav]);

  function handleStart() {
    if (stage !== "ready") return;
    if (send(ClientMessageTypes.TEST_FORCE_START)) {
      setStage("starting");
    }
  }

  const players = snapshot?.players ?? [];
  const ready = players.filter((p) => p.ready).length;

  return (
    <div className="test-wrap">
      <div className="card test-card">
        <div className="test-tag">TEST MODE</div>
        <h1 className="section-title test-title">Skip onboarding</h1>
        <p className="muted test-sub">
          {myName ? <>You are <strong>{myName}</strong> · </> : null}
          Room <code>{room}</code>
        </p>

        <ol className="test-steps">
          <li className={stage === "connecting" ? "is-active" : "is-done"}>Connecting</li>
          <li
            className={
              stage === "submitting-photo"
                ? "is-active"
                : sentPhoto.current
                  ? "is-done"
                  : ""
            }
          >
            Photo (dummy)
          </li>
          <li
            className={
              stage === "submitting-answers"
                ? "is-active"
                : sentAnswers.current && rulesCard
                  ? "is-done"
                  : sentAnswers.current
                    ? "is-active"
                    : ""
            }
          >
            Quiz (random) → role
          </li>
          <li className={stage === "ready" ? "is-active" : sentReady.current ? "is-done" : ""}>
            Ready
          </li>
          <li className={stage === "starting" || stage === "started" ? "is-active" : ""}>
            In game
          </li>
        </ol>

        {rulesCard ? (
          <div className="test-role">
            Animal: <strong>{rulesCard.animal ?? "?"}</strong> · {rulesCard.rule}
          </div>
        ) : null}

        <div className="test-foot">
          <span className="muted">{ready} ready in room</span>
          <button
            className="primary"
            onClick={handleStart}
            disabled={stage !== "ready"}
          >
            {stage === "starting" || stage === "started"
              ? "Starting…"
              : stage === "ready"
                ? "Start now"
                : "Preparing…"}
          </button>
        </div>

        {error ? <div className="test-error">⚠ {error}</div> : null}

        <p className="muted test-tip">
          Open another <code>/test</code> tab in this browser to add a second
          player to the same room before pressing Start.
        </p>
      </div>
    </div>
  );
}
