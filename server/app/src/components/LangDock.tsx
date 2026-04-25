import { dict } from "../i18n";
import { usePartyStore } from "../party/store";
import type { Lang } from "../party/protocol";

/**
 * Fixed bottom-right language toggle (all screens). Persisted via store + `nz.lang`.
 */
export default function LangDock() {
  const lang = usePartyStore((s) => s.lang);
  const setLang = usePartyStore((s) => s.setLang);
  const t = dict(lang);

  function handleLangChange(next: Lang) {
    setLang(next);
    try {
      localStorage.setItem("nz.lang", next);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="lang-dock" role="group" aria-label={t.langAria}>
      <div className="lang-dock__inner" role="presentation">
        <button
          type="button"
          className={"lang-dock__seg" + (lang === "en" ? " is-active" : "")}
          onClick={() => handleLangChange("en")}
          aria-pressed={lang === "en"}
        >
          EN
        </button>
        <button
          type="button"
          className={"lang-dock__seg" + (lang === "zh" ? " is-active" : "")}
          onClick={() => handleLangChange("zh")}
          aria-pressed={lang === "zh"}
        >
          中文
        </button>
      </div>
    </div>
  );
}
