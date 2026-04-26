import { useCallback, useEffect, useRef } from "react";
import { ClientMessageTypes } from "../party/protocol";
import {
  NZ_MSG_OUT,
  NZ_MSG_OUT_ITEM,
  NZ_MSG_OUT_VIOLATION,
  NZ_MSG_OUT_FACE_COUNTS,
  NZ_MSG_OUT_HIGHLIGHT,
  NZ_MSG_SOURCE
} from "../mainSync/protocol";
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

  const onFaceCounts = useCallback(
    (payload: { mouthOpens?: number; headShakes?: number; blinks?: number }) => {
      if (!started) return;
      send(ClientMessageTypes.FACE_COUNTS, {
        mouthOpens: Math.max(0, Math.floor(Number(payload.mouthOpens) || 0)),
        headShakes: Math.max(0, Math.floor(Number(payload.headShakes) || 0)),
        blinks: Math.max(0, Math.floor(Number(payload.blinks) || 0))
      });
    },
    [send, started]
  );

  const onHighlight = useCallback(
    (payload: { kind?: string; frames?: string[]; dataUrl?: string }) => {
      if (!started) return;
      const kind = payload?.kind;
      if (kind !== "mouth" && kind !== "shake" && kind !== "blink") return;
      // New burst payload: an array of JPEG dataURLs forming a short loop.
      // Old shape (single `dataUrl`) is still accepted as a 1-frame burst.
      const rawFrames = Array.isArray(payload?.frames) ? payload.frames : null;
      const frames =
        rawFrames && rawFrames.length > 0
          ? rawFrames
          : payload?.dataUrl
            ? [payload.dataUrl]
            : [];
      const cleaned = frames.filter(
        (f): f is string => typeof f === "string" && f.startsWith("data:image/")
      );
      if (cleaned.length === 0) return;
      send(ClientMessageTypes.HIGHLIGHT, { kind, frames: cleaned });
    },
    [send, started]
  );

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
      } else if (d.type === NZ_MSG_OUT_FACE_COUNTS) {
        onFaceCounts(d.payload as Record<string, number>);
      } else if (d.type === NZ_MSG_OUT_HIGHLIGHT) {
        onHighlight(d.payload as Record<string, string>);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onOut, onItemOut, onViolation, onFaceCounts, onHighlight]);
}
