import type { PropsWithChildren } from "react";
import { useLocation } from "react-router-dom";
import Header from "./Header";
import LangDock from "./LangDock";
import RecBadge from "./RecBadge";

export default function Layout({ children }: PropsWithChildren) {
  const loc = useLocation();
  const isOb = loc.pathname.startsWith("/ob");
  const isMainScene = loc.pathname.startsWith("/main-scene");
  const showRec =
    !isMainScene && (isOb || loc.pathname.startsWith("/game") || loc.pathname.startsWith("/onboard"));
  if (isMainScene) {
    return <div className="app-shell app-shell--main-scene">{children}</div>;
  }
  return (
    <div className={"app-shell" + (isOb ? " ob-shell" : "")}>
      <Header />
      {showRec ? <RecBadge /> : null}
      <main className="app-main">{children}</main>
      <LangDock />
    </div>
  );
}
