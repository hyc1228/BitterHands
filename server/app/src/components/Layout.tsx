import { useEffect, type PropsWithChildren } from "react";
import { useLocation } from "react-router-dom";
import Header from "./Header";
import LangDock from "./LangDock";
import { usePartyStore } from "../party/store";

export default function Layout({ children }: PropsWithChildren) {
  const loc = useLocation();
  const isOb = loc.pathname.startsWith("/ob");
  // Mirror the active UI language onto `<html lang>` so `:lang(zh)` CSS rules
  // (CJK letter-spacing reset, font-style normalisation, etc.) actually apply
  // — otherwise the page is permanently in Latin-tracking mode regardless of
  // the language toggle.
  const lang = usePartyStore((s) => s.lang);
  useEffect(() => {
    try {
      document.documentElement.lang = lang === "zh" ? "zh-Hans" : "en";
    } catch {
      /* SSR / sandboxed iframe edge cases — ignore */
    }
  }, [lang]);
  const isMainScene = loc.pathname.startsWith("/main-scene");
  // The `/` page (Join + splash visuals merged) is full-bleed — same treatment as main-scene,
  // so the grass tile + vignette can own the viewport without the app header / padding.
  const isSplash = loc.pathname === "/" || loc.pathname === "";
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
  if (isSplash) {
    // Splash is full-bleed (no header / no app-main padding) — let it own the viewport.
    return (
      <div className="app-shell app-shell--splash">
        {children}
        <LangDock />
      </div>
    );
  }
  const isOnboard = loc.pathname.startsWith("/onboard");
  // The REC dot + clock that used to live on `/ob` was removed: the in-game scene already
  // shows them in its own HUD, so a duplicate at the SPA shell level is just visual noise.
  // The full app-header (title + conn pill) is also dropped on `/ob` — the OB top-bar
  // already has all the operator controls, and a duplicate "OB Mode" title above just
  // pushes the camera wall + game map further down. The "live" indicator now lives
  // inline inside the OB top-bar (see Ob.tsx).
  return (
    <div
      className={
        "app-shell" +
        (isOb ? " ob-shell" : "") +
        (isOnboard ? " app-shell--onboard" : "")
      }
    >
      {!isOb ? <Header /> : null}
      <main className="app-main">{children}</main>
      <LangDock />
    </div>
  );
}
