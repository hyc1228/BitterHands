/**
 * Copy repo root `main scene/` into `server/app/public/main-scene/` for Vite (publicDir),
 * keeping the source `index.html` in place at `main-scene/index.html`. SPA mode is off in
 * `server/partykit.json`, so this is served directly with `text/html` and all relative
 * SVG / CSS references inside it resolve against `/main-scene/` automatically.
 * Does not modify any file under the source `main scene/` folder.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const src = path.join(repoRoot, "main scene");
const dest = path.join(here, "../app/public/main-scene");
const publicRoot = path.join(here, "../app/public");

if (!fs.existsSync(src)) {
  console.warn("[sync-main-scene] Skipped: source not found:", src);
  process.exit(0);
}
fs.mkdirSync(publicRoot, { recursive: true });
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });

// Drop legacy emit locations from prior approaches so PartyKit deploy doesn't include stale files.
for (const n of ["nz-scene.html", "nz-scene.document"]) {
  const p = path.join(publicRoot, n);
  if (fs.existsSync(p)) fs.rmSync(p, { force: true });
}
console.log("[sync-main-scene] Copied to", dest);
