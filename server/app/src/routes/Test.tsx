import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { readStoredRoomId } from "../constants";
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
 * Mobile resilience:
 *   - Mobile browsers (especially iOS Safari) suspend WebSockets when the tab
 *     loses focus or the device sleeps. The connection silently flips to
 *     CLOSED but the user sees a still-rendered "Start now" button. Clicking
 *     it would no-op because `send` returns false. We now:
 *       a) Auto-reconnect whenever the store's `conn` flips to closed/error
 *          while we're on /test, replaying photo/answers/ready as needed.
 *       b) On click, if the socket isn't open, kick a reconnect immediately
 *          and surface a visible error so the user knows we're retrying.
 *       c) If TEST_FORCE_START doesn't produce a started snapshot within a
 *          few seconds, we resend instead of leaving the button stuck on
 *          "Starting…" forever.
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
  // Stable T_xxx name across reconnects so the server's `players` map sees
  // the same logical player even if the WS bounces while the tab is in the
  // background.
  const stableNameRef = useRef<string | null>(null);
  // Last time we sent TEST_FORCE_START — used by the watchdog effect below
  // to retry if the snapshot doesn't flip to `started`.
  const lastStartSentAt = useRef<number>(0);

  const room = readStoredRoomId("nz.roomId");

  // Flag MainScene's "End now" overlay (the same hook used to show test-only UI).
  useEffect(() => {
    try { sessionStorage.setItem("nz.testMode", "1"); } catch { /* ignore */ }
  }, []);

  // Connect (or reconnect) whenever we don't have an open socket. Re-runs on
  // every `conn` transition, which is critical for mobile: when iOS Safari
  // backgrounds the tab the socket flips to "closed" and we'd otherwise be
  // stuck. Resetting the sentXxx refs lets the photo/answers/ready chain
  // replay automatically against the freshly-joined player slot.
  useEffect(() => {
    if (conn === "open" || conn === "connecting") return;
    const s = usePartyStore.getState();
    // Pick a stable T_ name for the lifetime of this /test session; only fall
    // back to the existing store name if it's already a T_ slot (i.e. this
    // is a refresh on /test, not a transition from /lobby with a Visitor name).
    let name = stableNameRef.current;
    if (!name) {
      name = s.myName && s.myName.startsWith("T_") ? s.myName : randomTestName();
      stableNameRef.current = name;
    }
    // Replay the setup chain after a reconnect — server lost our previous
    // photo/answer/ready state when the socket dropped.
    sentPhoto.current = false;
    sentAnswers.current = false;
    sentReady.current = false;
    setStage("connecting");
    s.setName(name);
    s.connect({ roomId: room, name, lang, mode: "player" }).catch((err) =>
      setError(String(err?.message || err))
    );
  }, [conn, lang, room]);

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
    if (conn !== "open") return;
    if (!rulesCard) return;
    if (sentReady.current) return;
    if (send(ClientMessageTypes.READY)) {
      sentReady.current = true;
      setStage("ready");
    }
  }, [conn, rulesCard, send]);

  // When the round actually starts (server flipped `started`), jump to the scene.
  useEffect(() => {
    if (snapshot?.started) {
      setStage("started");
      nav("/main-scene", { replace: true });
    }
  }, [snapshot?.started, nav]);

  // Watchdog: if we've sent TEST_FORCE_START but the server hasn't echoed a
  // started snapshot within ~2.5s, the message likely never made it (Safari
  // queued it on a half-closed socket). Re-send so the user doesn't have to
  // tap again.
  useEffect(() => {
    if (stage !== "starting") return;
    const t = window.setTimeout(() => {
      if (usePartyStore.getState().snapshot?.started) return;
      if (conn !== "open") {
        setError("Lost connection. Reconnecting…");
        setStage("ready");
        return;
      }
      if (send(ClientMessageTypes.TEST_FORCE_START)) {
        lastStartSentAt.current = Date.now();
      }
    }, 2500);
    return () => window.clearTimeout(t);
  }, [stage, conn, send]);

  const handleStart = useCallback(() => {
    setError(null);
    // If the socket is closed/connecting, the auto-reconnect effect above is
    // already replaying photo/answers/ready. Surface a clear inline message
    // so the user understands the click was received but we have to wait.
    if (conn !== "open") {
      setError("Reconnecting… try again in a moment.");
      return;
    }
    if (!sentReady.current) {
      // Stuck somewhere in the setup chain. Retry whatever's missing.
      setError("Setup not finished — retrying.");
      return;
    }
    if (send(ClientMessageTypes.TEST_FORCE_START)) {
      lastStartSentAt.current = Date.now();
      setStage("starting");
    } else {
      // ws.send threw / socket flipped between the React render and the tap.
      setError("Lost connection. Reconnecting…");
    }
  }, [conn, send]);

  const players = snapshot?.players ?? [];
  const ready = players.filter((p) => p.ready).length;

  // Allow tapping while "starting" too — the watchdog re-sends, but the user
  // may want to force a manual retry. Only fully disable while we're already
  // navigating (`started`) or before the setup chain has finished.
  const startBtnDisabled =
    stage === "started" || (stage !== "ready" && stage !== "starting");

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
            disabled={startBtnDisabled}
          >
            {stage === "started"
              ? "Starting…"
              : stage === "starting"
                ? "Starting… (tap to retry)"
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
