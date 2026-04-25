import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import CameraCircle, { type CameraCircleHandle } from "../components/CameraCircle";
import PermissionGate from "../components/PermissionGate";
import { dict, animalLocalized } from "../i18n";
import { ClientMessageTypes } from "../party/protocol";
import { usePartyStore } from "../party/store";

type Step = "permission" | "photo" | "quiz" | "analyzing" | "reveal";

export default function Onboard() {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);
  const nav = useNavigate();
  const myName = usePartyStore((s) => s.myName);
  const conn = usePartyStore((s) => s.conn);
  const connect = usePartyStore((s) => s.connect);
  const send = usePartyStore((s) => s.send);
  const rulesCard = usePartyStore((s) => s.rulesCard);

  const [step, setStep] = useState<Step>("permission");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [shotDataUrl, setShotDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qIdx, setQIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const camRef = useRef<CameraCircleHandle>(null);

  const room = (() => {
    try {
      return localStorage.getItem("nz.roomId") || "test-room";
    } catch {
      return "test-room";
    }
  })();

  // Connect on mount if needed.
  useEffect(() => {
    if (conn === "open" || conn === "connecting") return;
    if (!myName) {
      nav("/", { replace: true });
      return;
    }
    connect({ roomId: room, name: myName, lang, mode: "player" }).catch((err) =>
      setError(String(err?.message || err))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When reveal arrives, advance to reveal step.
  useEffect(() => {
    if (step === "analyzing" && rulesCard) {
      setStep("reveal");
    }
  }, [rulesCard, step]);

  // Cleanup camera on unmount.
  useEffect(() => {
    return () => {
      if (stream) {
        for (const tr of stream.getTracks()) tr.stop();
      }
    };
  }, [stream]);

  const questions = t.questions;
  const currentQuestion = useMemo(() => questions[qIdx], [questions, qIdx]);

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

  function handleSubmitProfile() {
    if (!shotDataUrl) return;
    send(ClientMessageTypes.SUBMIT_PHOTO, { photoBase64: shotDataUrl });
    setStep("quiz");
    // Stop camera once profile is submitted to free the device.
    if (stream) {
      for (const tr of stream.getTracks()) tr.stop();
      setStream(null);
    }
  }

  function handleAnswer(letter: "A" | "B" | "C") {
    if (!currentQuestion) return;
    const next = { ...answers, [currentQuestion.id]: letter };
    setAnswers(next);
    if (qIdx + 1 >= questions.length) {
      send(ClientMessageTypes.SUBMIT_ANSWERS, { answers: next, lang });
      setStep("analyzing");
    } else {
      setQIdx(qIdx + 1);
    }
  }

  function goToGame() {
    nav("/game", { replace: true });
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
          step={qIdx + 1}
          total={questions.length}
          question={currentQuestion}
          onAnswer={handleAnswer}
        />
      ) : null}

      {step === "analyzing" ? (
        <div className="card stack" style={{ textAlign: "center" }}>
          <div className="section-title">{t.analyzing}</div>
          <div className="muted" style={{ fontFamily: "var(--nz-font-serif)", fontStyle: "italic" }}>
            …
          </div>
        </div>
      ) : null}

      {step === "reveal" && rulesCard ? (
        <RevealStep
          emoji={rulesCard.emoji}
          animalName={animalLocalized[lang][rulesCard.animal || ""] || rulesCard.animal || "?"}
          verdict={rulesCard.verdict}
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
      <span className="quiz-step">
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
  onContinue
}: {
  emoji: string;
  animalName: string;
  verdict: string | null;
  onContinue: () => void;
}) {
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);
  return (
    <div className="card reveal-card">
      <div className="emoji-big" aria-hidden>
        {emoji}
      </div>
      <h2 className="section-title" style={{ letterSpacing: "0.18em" }}>
        {t.revealHeader(emoji, animalName)}
      </h2>
      <div className="verdict">{verdict || t.revealVerdictDefault}</div>
      <button className="primary" onClick={onContinue}>
        {t.goToGame}
      </button>
    </div>
  );
}
