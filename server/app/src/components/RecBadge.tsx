import { useEffect, useState } from "react";

export default function RecBadge() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const d = new Date(now);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return (
    <>
      <div className="rec-badge">
        <span className="dot" />
        REC
      </div>
      <div className="timer-badge" aria-hidden>
        {hh}:{mm}
      </div>
    </>
  );
}
