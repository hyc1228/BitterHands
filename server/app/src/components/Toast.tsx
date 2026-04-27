import { useEffect } from "react";
import { usePartyStore } from "../party/store";
import { dict } from "../i18n";

/**
 * Tiny global toast bound to the store's `toast` field. Render it once
 * inside any route that wants to surface store-driven non-fatal alerts
 * (Lobby + Ob currently). Auto-dismisses after `durationMs`.
 *
 * The store also accepts a few special-prefix messages so server-driven
 * errors can render with the viewer's current language without server
 * having to know what locale to send:
 *   - "still-setting-up"           → generic version
 *   - "still-setting-up:Alice,Bob" → with the waiting names
 *   - "not-host"                   → only the host can start the game
 * Anything else is rendered verbatim.
 */
export default function Toast({ durationMs = 4200 }: { durationMs?: number }) {
  const toast = usePartyStore((s) => s.toast);
  const clearToast = usePartyStore((s) => s.clearToast);
  const lang = usePartyStore((s) => s.lang);
  const t = dict(lang);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => clearToast(), durationMs);
    return () => window.clearTimeout(id);
  }, [toast, clearToast, durationMs]);

  if (!toast) return null;

  let body: string = toast;
  if (toast.startsWith("still-setting-up")) {
    const names = toast.includes(":") ? toast.split(":")[1] : "";
    if (lang === "zh") {
      body = names
        ? `${names} 还在创建角色 — 等所有人就绪后再开始`
        : "还有玩家在创建角色 — 等所有人就绪后再开始";
    } else {
      body = names
        ? `${names} hasn't created a profile yet — wait until everyone's ready`
        : "Some players are still creating profiles — wait until everyone's ready";
    }
  } else if (toast === "not-host") {
    body = lang === "zh" ? "只有房主可以开始游戏" : "Only the host can start the game";
  }
  // Suppress lint: t is unused after the prefix rewrites; intentional —
  // future i18n-keyed toasts will pick it back up.
  void t;

  return (
    <div
      className="nz-toast"
      role="status"
      aria-live="polite"
      onClick={() => clearToast()}
    >
      <span className="nz-toast__msg">{body}</span>
      <button type="button" className="nz-toast__close" aria-label="dismiss">×</button>
    </div>
  );
}
