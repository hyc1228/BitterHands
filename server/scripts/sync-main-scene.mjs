/**
 * Copy repo root `main scene/` into `server/app/public/main-scene/` for Vite (publicDir).
 * Does not modify any file under the source folder.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const src = path.join(repoRoot, "main scene");
const dest = path.join(here, "../app/public/main-scene");

if (!fs.existsSync(src)) {
  console.warn("[sync-main-scene] Skipped: source not found:", src);
  process.exit(0);
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
// PartyKit (and similar hosts) map every `.../index.html` to the SPA shell; use a distinct
// filename so /main-scene/* serves the real prototype HTML instead of the React app.
const idx = path.join(dest, "index.html");
const zoop = path.join(dest, "zoo-scene.html");
if (fs.existsSync(idx)) {
  fs.renameSync(idx, zoop);
}
console.log("[sync-main-scene] Copied to", dest);
