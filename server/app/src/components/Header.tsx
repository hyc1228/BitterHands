import { Link, useLocation } from "react-router-dom";
import { dict } from "../i18n";
import { usePartyStore } from "../party/store";

export default function Header() {
  const loc = useLocation();
  const lang = usePartyStore((s) => s.lang);
  const conn = usePartyStore((s) => s.conn);
  const t = dict(lang);

  const isOb = loc.pathname.startsWith("/ob");
  const homeTo = isOb ? "/ob" : "/";

  return (
    <header className="app-header">
      <Link to={homeTo} className="title">
        <span className="star" aria-hidden />
        {isOb ? t.obTitle : t.appTitle}
      </Link>
      <div className="app-header__tools">
        <ConnPill conn={conn} />
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
