import { useCallback, useEffect, useRef } from "react";
import { ClientMessageTypes } from "../party/protocol";
import { NZ_MSG_OUT, NZ_MSG_OUT_ITEM, NZ_MSG_OUT_VIOLATION, NZ_MSG_SOURCE } from "../mainSync/protocol";
import { usePartyStore } from "../party/store";

const THROTTLE_MS = 70;

/**
 * Forwards throttled `NZ_OUT_MAIN_SCENE` from the main-scene iframe to PartyKit
 * as `MAIN_SCENE_STATE` (only when the room game has `started` on the client),
 * and `NZ_OUT_ITEM_PICKUP` as `MAIN_SCENE_ITEM_PICKUP` (no throttle, idempotent on server).
 */
export function useMainSceneIframeBridge() {
  const send = usePartyStore((s) => s.send);
  const started = usePartyStore((s) => s.snapshot?.started);
  const last = useRef(0);

  const onOut = useCallback(
    (payload: Record<string, unknown>) => {
      if (!started) return;
      const now = Date.now();
      if (now - last.current < THROTTLE_MS) return;
      last.current = now;
      send(ClientMessageTypes.MAIN_SCENE_STATE, payload);
    },
    [send, started]
  );

  const onItemOut = useCallback(
    (itemId: string) => {
      if (!started || !itemId) return;
      send(ClientMessageTypes.MAIN_SCENE_ITEM_PICKUP, { itemId });
    },
    [send, started]
  );

  const onViolation = useCallback(() => {
    if (!started) return;
    send(ClientMessageTypes.VIOLATION, {});
  }, [send, started]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const d = ev.data;
      if (!d || d.source !== NZ_MSG_SOURCE || !d.payload) return;
      if (d.type === NZ_MSG_OUT) {
        onOut(d.payload as Record<string, unknown>);
      } else if (d.type === NZ_MSG_OUT_ITEM) {
        onItemOut(String((d.payload as { itemId: string }).itemId || ""));
      } else if (d.type === NZ_MSG_OUT_VIOLATION) {
        onViolation();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onOut, onItemOut, onViolation]);
}
