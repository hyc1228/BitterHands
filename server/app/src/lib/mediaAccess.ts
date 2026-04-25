/**
 * Browsers only expose getUserMedia in a secure context: HTTPS, localhost, 127.0.0.1, etc.
 * Plain `http://<LAN-IP>` is not a secure context → `navigator.mediaDevices` is often undefined
 * (mobile Safari, Chrome, WeChat in-app browser).
 */
export type GetUserMediaBlockReason = "insecure" | "no_api";

export function getGetUserMediaBlockReason(): GetUserMediaBlockReason | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "no_api";
  const md = navigator.mediaDevices;
  if (md && typeof md.getUserMedia === "function") return null;
  if (typeof window.isSecureContext === "boolean" && !window.isSecureContext) return "insecure";
  return "no_api";
}
