import { Link, useLocation } from "react-router-dom";
import { dict } from "../i18n";
import { usePartyStore } from "../party/store";
import type { Lang } from "../party/protocol";

export default function Header() {
  const loc = useLocation();
  const lang = usePartyStore((s) => s.lang);
  const setLang = usePartyStore((s) => s.setLang);
  const conn = usePartyStore((s) => s.conn);
  const t = dict(lang);

  const isOb = loc.pathname.startsWith("/ob");
  const homeTo = isOb ? "/ob" : "/";
  // The language pill is meaningful only on the initial Join screen.
  // The user picks it once; the choice is persisted and propagated to all
  // subsequent screens (and the server) via the zustand store.
  // Hash-router paths look like "" or "/" on entry.
  const isInitial = loc.pathname === "/" || loc.pathname === "";

  function handleLangChange(next: Lang) {
    setLang(next);
    try {
      localStorage.setItem("nz.lang", next);
    } catch {
      /* ignore */
    }
  }

  return (
    <header className="app-header">
      <Link to={homeTo} className="title">
        <span className="star" aria-hidden />
        {isOb ? t.obTitle : t.appTitle}
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <ConnPill conn={conn} />
        {isInitial && !isOb ? (
          <div className="lang lang-pill" role="group" aria-label="Language">
            <button
              type="button"
              className={"seg" + (lang === "en" ? " active" : "")}
              onClick={() => handleLangChange("en")}
            >
              EN
            </button>
            <button
              type="button"
              className={"seg" + (lang === "zh" ? " active" : "")}
              onClick={() => handleLangChange("zh")}
            >
              中
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function ConnPill({ conn }: { conn: string }) {
  let label = "off";
  let cls = "bad";
  if (conn === "open") {
    label = "live";
    cls = "ok";
  } else if (conn === "connecting") {
    label = "...";
    cls = "";
  } else if (conn === "idle") {
    label = "idle";
    cls = "";
  }
  return (
    <span className="conn-pill">
      <span className={`conn-dot ${cls}`} />
      {label}
    </span>
  );
}
