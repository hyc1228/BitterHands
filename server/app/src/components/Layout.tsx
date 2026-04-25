import type { PropsWithChildren } from "react";
import { useLocation } from "react-router-dom";
import Header from "./Header";
import LangDock from "./LangDock";
import RecBadge from "./RecBadge";

export default function Layout({ children }: PropsWithChildren) {
  const loc = useLocation();
  const isOb = loc.pathname.startsWith("/ob");
  const isMainScene = loc.pathname.startsWith("/main-scene");
  // REC/timer: OB only (not /game, not /onboard).
  const showRec = !isMainScene && isOb;
  if (isMainScene) {
    return <div className="app-shell app-shell--main-scene">{children}</div>;
  }
  const isOnboard = loc.pathname.startsWith("/onboard");
  const isGame = loc.pathname.startsWith("/game");
  return (
    <div
      className={
        "app-shell" +
        (isOb ? " ob-shell" : "") +
        (isOnboard ? " app-shell--onboard" : "") +
        (isGame ? " app-shell--game" : "")
      }
    >
      <Header />
      {showRec ? <RecBadge /> : null}
      <main className="app-main">{children}</main>
      <LangDock />
    </div>
  );
}
