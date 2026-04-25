import type { PropsWithChildren } from "react";
import { useLocation } from "react-router-dom";
import Header from "./Header";
import RecBadge from "./RecBadge";

export default function Layout({ children }: PropsWithChildren) {
  const loc = useLocation();
  const isOb = loc.pathname.startsWith("/ob");
  const showRec = isOb || loc.pathname.startsWith("/game") || loc.pathname.startsWith("/onboard");
  return (
    <div className={"app-shell" + (isOb ? " ob-shell" : "")}>
      <Header />
      {showRec ? <RecBadge /> : null}
      <main className="app-main">{children}</main>
    </div>
  );
}
