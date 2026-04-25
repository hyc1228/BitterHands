import { useCallback, useEffect, useRef, useState } from "react";
import { dict } from "../i18n";
import { getGetUserMediaBlockReason } from "../lib/mediaAccess";
import { usePartyStore } from "../party/store";

interface Options {
  video?: MediaTrackConstraints | boolean;
  audio?: MediaTrackConstraints | boolean;
}

interface Result {
  stream: MediaStream | null;
  error: string | null;
  starting: boolean;
  start: () => Promise<MediaStream | null>;
  stop: () => void;
}

/**
 * Lifecycle wrapper around getUserMedia. Tracks are stopped on unmount.
 */
export function useCameraStream(opts: Options = { video: true, audio: false }): Result {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const stop = useCallback(() => {
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
    }
    setStream(null);
  }, [stream]);

  const start = useCallback(async () => {
    if (stream) return stream;
    setStarting(true);
    setError(null);
    try {
      const block = getGetUserMediaBlockReason();
      if (block) {
        const t = dict(usePartyStore.getState().lang);
        setError(block === "insecure" ? t.permInsecureContext : t.permMediaUnavailable);
        return null;
      }
      const s = await navigator.mediaDevices.getUserMedia(optsRef.current);
      setStream(s);
      return s;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    } finally {
      setStarting(false);
    }
  }, [stream]);

  useEffect(() => {
    return () => {
      if (stream) {
        for (const t of stream.getTracks()) t.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { stream, error, starting, start, stop };
}
