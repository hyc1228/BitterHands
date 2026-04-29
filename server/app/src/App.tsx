import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import EndGameOverlay from "./components/EndGameOverlay";
import Join from "./routes/Join";
import Onboard from "./routes/Onboard";
import Lobby from "./routes/Lobby";
import MainScene from "./routes/MainScene";
import Ob from "./routes/Ob";
import Test from "./routes/Test";
import DevCeremony from "./routes/DevCeremony";
import { usePartyStore } from "./party/store";

export default function App() {
  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Join />} />
          <Route path="/onboard" element={<Onboard />} />
          <Route path="/lobby" element={<Lobby />} />
          <Route path="/main-scene" element={<MainScene />} />
          <Route path="/ob" element={<Ob />} />
          <Route path="/test" element={<Test />} />
          {/* Local-only ceremony sandbox; renders EndGameOverlay against
              mock data so the renderer can be verified without a live
              PartyKit room. See routes/DevCeremony.tsx for details. */}
          <Route path="/dev/ceremony" element={<DevCeremony />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {/* Global ceremony host.  Mounted at the App level (outside every
            route) so the awards screen renders the moment GAME_ENDED
            arrives, no matter which route the user happens to be on:
            main-scene, lobby, OB, or even back on the splash.  The
            previous setup mounted EndGameOverlay inside individual
            routes, which is why a mid-route navigation (or any route
            unmount race during the snapshot transition) could leave
            the user staring at "just a black background".  Now there's
            exactly one always-mounted instance. */}
        <GlobalCeremony />
      </Layout>
    </HashRouter>
  );
}

/**
 * Picks a viewer role + a "back home" path from the current route /
 * party-store mode and mounts the single global EndGameOverlay.  The
 * dev sandbox at `/dev/ceremony` ALSO populates the same store (it
 * just calls `setState`) so this single mount covers it too.
 */
function GlobalCeremony() {
  const location = useLocation();
  const mode = usePartyStore((s) => s.mode);

  // Decide viewer role.  Explicit OB route always wins; otherwise fall
  // back to the store's mode (set when the user lands on /ob via the
  // lobby's "Spectate as OB" path).  Players see the player-side
  // ceremony, which includes their personal stats + viewer-specific
  // headlines.
  const onObRoute = location.pathname === "/ob";
  const viewerRole = onObRoute || mode === "ob" ? "ob" : "player";

  // "Back home" target.  OB returns to OB so they don't lose the room
  // code.  /test loops back to /test for fast playtest cycles.
  // Everything else falls back to the splash so a regular player ends
  // up where they originally joined from.
  let homePath = "/";
  if (onObRoute || mode === "ob") homePath = "/ob";
  else if (location.pathname === "/test") homePath = "/test";
  else if (location.pathname.startsWith("/dev/")) homePath = location.pathname;

  return <EndGameOverlay viewerRole={viewerRole} homePath={homePath} />;
}
