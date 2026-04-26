import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import CameraFrameUploader from "../components/CameraFrameUploader";
import EndGameOverlay from "../components/EndGameOverlay";
import { getMainSceneFrameSrc } from "../constants";
import { useMainSceneIframeBridge } from "../hooks/useMainSceneIframeBridge";
import { postToMainSceneFrame, postItemInboxToFrame, postMainSceneNetToFrame, postMonitorStateToFrame } from "../mainSync/postToMainSceneFrame";
import { usePartyStore } from "../party/store";

/**
 * Full-screen main scene: loads `main scene/index.html` and pushes onboarding state via
 * MainSync (`postMessage` NZ_PLAYER_SYNC) so the prototype uses the same role + rules.
 * NZ_ROOM_PLAYERS mirrors the PartyKit room so other human players replace demo NPCs.
 */
export default function MainScene() {
  const nav = useNavigate();
  const conn = usePartyStore((s) => s.conn);
  const rulesCard = usePartyStore((s) => s.rulesCard);
  const myName = usePartyStore((s) => s.myName);
  const myAnimal = usePartyStore((s) => s.myAnimal);
  const lang = usePartyStore((s) => s.lang);
  const snapshot = usePartyStore((s) => s.snapshot);
  const selfPlayerId = usePartyStore(
    (s) => s.snapshot?.players.find((p) => p.name === s.myName)?.id ?? ""
  );

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  useMainSceneIframeBridge();

  useEffect(() => {
    if (conn === "idle" || (conn === "closed" && !rulesCard)) {
      nav("/", { replace: true });
    }
  }, [conn, rulesCard, nav]);

  const src = useMemo(() => getMainSceneFrameSrc(), []);

  const pushToIframe = useCallback(() => {
    postToMainSceneFrame(iframeRef.current?.contentWindow, {
      myName,
      myAnimal,
      rulesCard,
      lang,
      snapshot,
      spectator: false,
      selfPlayerId,
      mainScenePeers: usePartyStore.getState().mainScenePeers
    });
  }, [myName, myAnimal, rulesCard, lang, snapshot, selfPlayerId]);

  useEffect(() => {
    pushToIframe();
  }, [pushToIframe]);

  useEffect(() => {
    if (conn !== "open") return;
    const t = window.setInterval(() => {
      const s = usePartyStore.getState();
      const sid = s.snapshot?.players.find((p) => p.name === s.myName)?.id ?? "";
      const w = iframeRef.current?.contentWindow;
      postMainSceneNetToFrame(w, sid, s.mainScenePeers);
      postMonitorStateToFrame(w, s.monitorState);
      const inbox = s.drainMainSceneItemInbox();
      postItemInboxToFrame(w, inbox);
    }, 100);
    return () => clearInterval(t);
  }, [conn]);

  return (
    <>
      <iframe
        ref={iframeRef}
        className="main-scene-iframe"
        title="Nocturne Zoo main scene"
        src={src}
        onLoad={pushToIframe}
        allow="camera; microphone"
      />
      {/* Off-screen uploader keeps OB's face wall live during the actual game.
          Mounting here (not inside the iframe) sidesteps the iframe's permission
          quirks and reuses the React-side store/WS we already have open. */}
      <CameraFrameUploader />
      {/* Settlement overlay (escaped / lost). Renders only when GAME_ENDED arrived. */}
      <EndGameOverlay viewerRole="player" homePath="/" />
    </>
  );
}
