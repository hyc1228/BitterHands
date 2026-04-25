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
console.log("[sync-main-scene] Copied to", dest);
