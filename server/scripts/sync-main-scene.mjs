/**
 * Copy repo root `main scene/` into `server/app/public/main-scene/` for Vite (publicDir), and
 * emit a root-level `nz-scene.html` (with `<base href="/main-scene/">`) for the iframe.
 * PartyKit maps *any* `main-scene/*.html` request to the SPA; only non-.html and root HTML work.
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
/** Not `.html` — PartyKit SPA mode maps all `*.html` to the React shell before our handler runs. */
const nzName = "nz-scene.document";
const nzPath = path.join(publicRoot, nzName);

if (!fs.existsSync(src)) {
  console.warn("[sync-main-scene] Skipped: source not found:", src);
  process.exit(0);
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.mkdirSync(publicRoot, { recursive: true });
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });

const mainIdx = path.join(dest, "index.html");
if (!fs.existsSync(mainIdx)) {
  console.warn("[sync-main-scene] No index.html under main scene, skipped nz emit");
  process.exit(0);
}

const raw = fs.readFileSync(mainIdx, "utf8");
// Resolve relative `href="…"` in the scene against `/main-scene/`.
const withBase = raw.replace(
  /(<meta\s+charset="UTF-8"\s*\/>)/i,
  `$1\n    <base href="/main-scene/" />`
);
fs.writeFileSync(nzPath, withBase, "utf8");

fs.rmSync(mainIdx, { force: true });
const legacyHtml = path.join(publicRoot, "nz-scene.html");
if (fs.existsSync(legacyHtml)) fs.rmSync(legacyHtml, { force: true });
// Legacy names from prior builds
for (const n of ["zoo-scene.html"]) {
  const p = path.join(dest, n);
  if (fs.existsSync(p)) fs.rmSync(p, { force: true });
}
console.log("[sync-main-scene] Copied to", dest, "+", path.relative(path.join(here, ".."), nzPath));