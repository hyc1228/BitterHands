/**
 * Tiny client-side gate for the `/ob` route.
 *
 * Why client-side only: PartyKit doesn't have user accounts, and OB connections are just
 * normal WebSockets that simply skip the JOIN message. The "secret" is just to keep casual
 * visitors away — there's no real adversary here. If someone really wants to be OB they can
 * read the bundle and find the key. That's fine for the use case (operator at a hosted
 * event keeps the URL + key to themselves).
 *
 * The expected key is read from `import.meta.env.VITE_OB_KEY` (set in `.env.production`),
 * with a hardcoded fallback so dev builds don't lock the operator out by mistake.
 *
 * Authorization is sticky in `localStorage` once granted, so the operator only types it
 * once per device.
 */

const STORAGE_KEY = "nz.obKey";
const FALLBACK_KEY = "Hackathon";

export function expectedObKey(): string {
  const env = import.meta.env.VITE_OB_KEY?.trim();
  return env && env.length > 0 ? env : FALLBACK_KEY;
}

/** Case-insensitive comparison so "hackathon" / "HACKATHON" / "Hackathon" all unlock. */
function keyEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function readStoredObKey(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function writeStoredObKey(v: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, v);
  } catch {
    /* ignore — running in a private window or storage disabled */
  }
}

export function clearStoredObKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** True iff the user-supplied (or earlier-saved) key matches expected key, case-insensitively. */
export function isObKeyMatch(input: string | null | undefined): boolean {
  return keyEquals(input, expectedObKey());
}

/** True iff `?key=…` (or any earlier saved key) matches the expected operator key. */
export function isObAuthorized(): boolean {
  const expect = expectedObKey();
  if (!expect) return true;
  const stored = readStoredObKey();
  if (keyEquals(stored, expect)) return true;
  // One-shot URL grant: a hash like `#/ob?key=…` will set the cookie and clean up the URL.
  try {
    const hash = window.location.hash || "";
    const q = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    if (q) {
      const params = new URLSearchParams(q);
      const fromUrl = params.get("key");
      if (keyEquals(fromUrl, expect)) {
        writeStoredObKey(fromUrl as string);
        // Drop the `?key=…` from the URL so it doesn't sit in history / get screenshotted.
        params.delete("key");
        const rest = params.toString();
        const next = "/ob" + (rest ? `?${rest}` : "");
        window.history.replaceState(null, "", `#${next}`);
        return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}
