import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import CameraCircle, { type CameraCircleHandle } from "../components/CameraCircle";
import ExpressionGate from "../components/ExpressionGate";
import PermissionGate from "../components/PermissionGate";
import { DEFAULT_ROOM_ID } from "../constants";
import { getRandomQuestions } from "../data/quizLibrary";
import { dict, animalLocalized } from "../i18n";
import { ClientMessageTypes, type Lang } from "../party/protocol";
import { usePartyStore } from "../party/store";

type Step = "permission" | "photo" | "quiz" | "analyzing" | "reveal";

export default function Onboard() {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);
  const nav = useNavigate();
  const myName = usePartyStore((s) => s.myName);
  const send = usePartyStore((s) => s.send);
  const clearOnboardingAssignment = usePartyStore((s) => s.clearOnboardingAssignment);
  const clearConnectError = usePartyStore((s) => s.clearConnectError);
  const connectError = usePartyStore((s) => s.connectError);
  const rulesCard = usePartyStore((s) => s.rulesCard);

  const [step, setStep] = useState<Step>("permission");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [shotDataUrl, setShotDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qIdx, setQIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [analyzingSlow, setAnalyzingSlow] = useState(false);
  const camRef = useRef<CameraCircleHandle>(null);
  const lastAnswersPayload = useRef<{ answers: Record<string, string>; lang: Lang } | null>(null);
  const autoRetried = useRef(false);
  const finalSubmitBusy = useRef(false);

  const room = (() => {
    try {
      return localStorage.getItem("nz.roomId") || DEFAULT_ROOM_ID;
    } catch {
      return DEFAULT_ROOM_ID;
    }
  })();

  // Drop stale rules card from a previous visit so "Analyzing" can complete.
  useEffect(() => {
    clearOnboardingAssignment();
  }, [clearOnboardingAssignment]);

  // Connect on mount if needed.
  useEffect(() => {
    const s = usePartyStore.getState();
    if (s.conn === "open" || s.conn === "connecting") return;
    if (!myName) {
      nav("/", { replace: true });
      return;
    }
    s.connect({ roomId: room, name: myName, lang, mode: "player" }).catch((err) =>
      setError(String(err?.message || err))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (connectError !== "room_full") return;
    clearConnectError();
    nav("/", { replace: true, state: { joinError: t.roomFull } });
  }, [connectError, clearConnectError, nav, t.roomFull]);

  // When reveal arrives, advance to reveal step.
  useEffect(() => {
    if (step === "analyzing" && rulesCard) {
      setAnalyzingSlow(false);
      setStep("reveal");
    }
  }, [rulesCard, step]);

  // If answers are in-flight, auto-resubmit once; surface slow state + manual retry.
  useEffect(() => {
    if (step !== "analyzing") {
      autoRetried.current = false;
      setAnalyzingSlow(false);
      return;
    }
    const tSlow = window.setTimeout(() => setAnalyzingSlow(true), 8000);
    const tRetry = window.setTimeout(() => {
      if (usePartyStore.getState().rulesCard) return;
      if (autoRetried.current) return;
      if (usePartyStore.getState().ws?.readyState !== WebSocket.OPEN) return;
      const p = lastAnswersPayload.current;
      if (!p) return;
      if (send(ClientMessageTypes.SUBMIT_ANSWERS, { answers: p.answers, lang: p.lang })) {
        autoRetried.current = true;
      }
    }, 4000);
    return () => {
      window.clearTimeout(tSlow);
      window.clearTimeout(tRetry);
    };
  }, [step, send]);

  // Cleanup camera on unmount.
  useEffect(() => {
    return () => {
      if (stream) {
        for (const tr of stream.getTracks()) tr.stop();
      }
    };
  }, [stream]);

  const questions = useMemo(() => getRandomQuestions(lang, 3), [lang]);
  const currentQuestion = useMemo(() => questions[qIdx], [questions, qIdx]);

  useEffect(() => {
    setQIdx(0);
    setAnswers({});
  }, [lang]);

  function handlePermissionAccept(s: MediaStream | null) {
    setStream(s);
    setStep("photo");
  }

  function handleSnap() {
    const url = camRef.current?.snapshot(0.85) ?? null;
    if (!url) {
      setError("snapshot failed");
      return;
    }
    setShotDataUrl(url);
  }

  function handleRetake() {
    setShotDataUrl(null);
  }

  async function handleSubmitProfile() {
    if (!shotDataUrl) return;
    setError(null);
    let savedPath: string | null = null;
    try {
      const r = await fetch("/__api/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl: shotDataUrl, roomId: room })
      });
      if (r.ok) {
        const j = (await r.json()) as { path?: string };
        if (typeof j.path === "string" && j.path.startsWith("/avatars/")) {
          savedPath = j.path;
        }
      }
    } catch {
      /* Vite `__api` is dev-only; production falls back to WS base64. */
    }
    const sent = savedPath
      ? usePartyStore.getState().send(ClientMessageTypes.SUBMIT_PHOTO, { avatarPublicPath: savedPath })
      : usePartyStore
          .getState()
          .send(ClientMessageTypes.SUBMIT_PHOTO, { photoBase64: shotDataUrl });
    if (!sent) {
      setError("Not connected. Go back and rejoin the room.");
      return;
    }
    setStep("quiz");
    // Stop camera once profile is submitted to free the device.
    if (stream) {
      for (const tr of stream.getTracks()) tr.stop();
      setStream(null);
    }
  }

  /**
   * `conn` can be "open" while the socket is already dead (HMR / background tab) — always use
   * `WebSocket.OPEN` and reconnect before the final `SUBMIT_ANSWERS`.
   */
  async function ensureSocketThenSubmitFinal(next: Record<string, string>) {
    if (finalSubmitBusy.current) return;
    finalSubmitBusy.current = true;
    setError(null);
    try {
      let st = usePartyStore.getState();
      if (st.ws?.readyState !== WebSocket.OPEN) {
        try {
          await st.connect({ roomId: room, name: st.myName, lang: st.lang, mode: "player" });
        } catch {
          setError("Could not connect. Check network and try again.");
          return;
        }
        st = usePartyStore.getState();
      }
      if (st.ws?.readyState !== WebSocket.OPEN) {
        setError("Not connected. Check network and try again.");
        return;
      }
      st.clearOnboardingAssignment();
      lastAnswersPayload.current = { answers: next, lang: st.lang };
      autoRetried.current = false;
      const ok = st.send(ClientMessageTypes.SUBMIT_ANSWERS, { answers: next, lang: st.lang });
      if (!ok) {
        setError("Could not send answers. Try the button below or rejoin the room.");
        return;
      }
      setStep("analyzing");
    } finally {
      finalSubmitBusy.current = false;
    }
  }

  function handleAnswer(letter: "A" | "B" | "C") {
    if (!currentQuestion) return;
    const next = { ...answers, [currentQuestion.id]: letter };
    setAnswers(next);
    if (qIdx + 1 >= questions.length) {
      void ensureSocketThenSubmitFinal(next);
    } else {
      setQIdx(qIdx + 1);
    }
  }

  function handleRetrySubmit() {
    const p = lastAnswersPayload.current;
    if (!p) return;
    void (async () => {
      setError(null);
      let st = usePartyStore.getState();
      if (st.ws?.readyState !== WebSocket.OPEN) {
        try {
          await st.connect({ roomId: room, name: st.myName, lang: st.lang, mode: "player" });
        } catch {
          setError("Not connected.");
          return;
        }
        st = usePartyStore.getState();
      }
      if (!st.send(ClientMessageTypes.SUBMIT_ANSWERS, { answers: p.answers, lang: p.lang })) {
        setError("Send failed.");
      }
    })();
  }

  function goToGame() {
    nav("/main-scene", { replace: true });
  }

  return (
    <div className="onboard-wrap">
      {step === "permission" ? (
        <PermissionGate
          open
          onAccept={handlePermissionAccept}
          onCancel={() => nav("/", { replace: true })}
        />
      ) : null}

      {step === "photo" ? (
        <PhotoStep
          stream={stream}
          shotDataUrl={shotDataUrl}
          onSnap={handleSnap}
          onRetake={handleRetake}
          onSubmit={handleSubmitProfile}
          camRef={camRef}
        />
      ) : null}

      {step === "quiz" && currentQuestion ? (
        <QuizStep
          key={qIdx}
          step={qIdx + 1}
          total={questions.length}
          question={currentQuestion}
          onAnswer={handleAnswer}
        />
      ) : null}

      {step === "analyzing" ? (
        <div className="card analyzing-wrap">
          <span className="nz-sparks" aria-hidden="true">
            <i /><i /><i /><i /><i /><i /><i /><i />
          </span>
          <div className="analyzing-scan" aria-hidden="true">
            <span className="analyzing-scan-core" />
          </div>
          <div className="section-title">{t.analyzing}</div>
          <div className="analyzing-dots muted" aria-hidden="true">
            <span>·</span>
            <span>·</span>
            <span>·</span>
          </div>
          {analyzingSlow ? (
            <div className="stack" style={{ marginTop: 14, gap: 10 }}>
              <p className="muted" style={{ fontSize: 14, margin: 0 }}>
                {t.analyzingSlow}
              </p>
              <button type="button" className="primary" onClick={handleRetrySubmit}>
                {t.retrySubmit}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === "reveal" && rulesCard ? (
        <RevealStep
          emoji={rulesCard.emoji}
          animalName={animalLocalized[lang][rulesCard.animal || ""] || rulesCard.animal || "?"}
          verdict={rulesCard.verdict}
          similarityPercent={rulesCard.similarityPercent}
          looksRoast={rulesCard.looksRoast}
          onContinue={goToGame}
        />
      ) : null}

      {error ? <div style={{ color: "#ff9a8a" }}>{error}</div> : null}
    </div>
  );
}

function PhotoStep({
  stream,
  shotDataUrl,
  onSnap,
  onRetake,
  onSubmit,
  camRef
}: {
  stream: MediaStream | null;
  shotDataUrl: string | null;
  onSnap: () => void;
  onRetake: () => void;
  onSubmit: () => void;
  camRef: React.RefObject<CameraCircleHandle>;
}) {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);
  return (
    <>
      <h1 className="section-title" style={{ textAlign: "center" }}>
        {t.profileTitle}
      </h1>
      <CameraCircle ref={camRef} stream={stream} shotDataUrl={shotDataUrl} />
      <div className="cam-hint">{t.profileHint}</div>
      <div className="profile-controls" style={{ marginTop: 18 }}>
        <div className="row">
          {shotDataUrl ? (
            <button onClick={onRetake}>{t.retake}</button>
          ) : (
            <button onClick={onSnap}>{t.takePhoto}</button>
          )}
          <button className="primary" onClick={onSubmit} disabled={!shotDataUrl}>
            {t.submitProfile}
          </button>
        </div>
      </div>
    </>
  );
}

function QuizStep({
  step,
  total,
  question,
  onAnswer
}: {
  step: number;
  total: number;
  question: { text: string; A: string; B: string; C: string };
  onAnswer: (letter: "A" | "B" | "C") => void;
}) {
  return (
    <div className="quiz-wrap">
      <div className="quiz-progress" role="presentation" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => {
          const cls =
            i + 1 < step ? "dot is-done" : i + 1 === step ? "dot is-current" : "dot";
          return <span key={i} className={cls} />;
        })}
      </div>
      <span className="quiz-step" aria-label={`Question ${step} of ${total}`}>
        {step} / {total}
      </span>
      <div className="quiz-text">{question.text}</div>
      <div className="quiz-options">
        {(["A", "B", "C"] as const).map((letter) => (
          <button key={letter} onClick={() => onAnswer(letter)}>
            <span className="opt-letter">{letter}</span>
            <span className="opt-text">{question[letter]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RevealStep({
  emoji,
  animalName,
  verdict,
  similarityPercent,
  looksRoast,
  onContinue
}: {
  emoji: string;
  animalName: string;
  verdict: string | null;
  similarityPercent: number;
  looksRoast: string;
  onContinue: () => void;
}) {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);
  const [gatePassed, setGatePassed] = useState(false);
  return (
    <div className="card reveal-card">
      <div className="emoji-big" aria-hidden>
        {emoji}
      </div>
      <h2 className="section-title" style={{ letterSpacing: "0.18em" }}>
        {t.revealHeader(emoji, animalName)}
      </h2>
      <div className="verdict">{verdict || t.revealVerdictDefault}</div>
      {similarityPercent > 0 ? (
        <p className="reveal-similarity" role="status">
          {t.revealSimilarity(animalName, similarityPercent)}
        </p>
      ) : null}
      {looksRoast ? (
        <>
          <div className="reveal-roast-label">{t.revealRoastLabel}</div>
          <p className="reveal-roast">{looksRoast}</p>
        </>
      ) : null}
      <ExpressionGate onPassed={setGatePassed} />
      <button
        className="primary reveal-enter"
        onClick={onContinue}
        disabled={!gatePassed}
        aria-disabled={!gatePassed}
      >
        {t.goToGame}
      </button>
      {!gatePassed ? (
        <div className="muted reveal-locked-hint">{t.gateLocked}</div>
      ) : null}
    </div>
  );
}
