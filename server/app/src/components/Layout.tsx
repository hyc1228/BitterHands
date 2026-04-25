import type { PropsWithChildren } from "react";
import { useLocation } from "react-router-dom";
import Header from "./Header";
import LangDock from "./LangDock";

export default function Layout({ children }: PropsWithChildren) {
  const loc = useLocation();
  const isOb = loc.pathname.startsWith("/ob");
  const isMainScene = loc.pathname.startsWith("/main-scene");
  if (isMainScene) {
    // Keep LangDock floating over the iframe so players can switch language mid-game.
    // The dock writes to the store; MainScene.tsx's existing `pushToIframe` effect picks
    // up the new `lang` and forwards it via NZ_PLAYER_SYNC to the iframe's setLang().
    return (
      <div className="app-shell app-shell--main-scene">
        {children}
        <LangDock />
      </div>
    );
  }
  const isOnboard = loc.pathname.startsWith("/onboard");
  const isGame = loc.pathname.startsWith("/game");
  // The REC dot + clock that used to live on `/ob` was removed: the in-game scene already
  // shows them in its own HUD, so a duplicate at the SPA shell level is just visual noise.
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
      <main className="app-main">{children}</main>
      <LangDock />
    </div>
  );
}
