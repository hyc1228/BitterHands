/**
 * Copy two repo-root assets into `server/app/public/` for Vite (publicDir):
 *
 *   1. `main scene/`  → `app/public/main-scene/` — the iframe prototype + SVGs
 *   2. `resource/`    → `app/public/resource/`   — short SFX (alarm, health gain/loss).
 *
 * The main scene HTML references SFX with `../resource/<file>`, which resolves to `/resource/`
 * relative to the iframe's URL — so both directories must be served from the SPA origin.
 *
 * Source-of-truth files in the repo root are NOT modified.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const publicRoot = path.join(here, "../app/public");
fs.mkdirSync(publicRoot, { recursive: true });

function syncDir(srcRel, destRel) {
  const src = path.join(repoRoot, srcRel);
  const dest = path.join(publicRoot, destRel);
  if (!fs.existsSync(src)) {
    console.warn(`[sync] Skipped (source missing): ${srcRel}`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`[sync] ${srcRel} → app/public/${destRel}`);
}

syncDir("main scene", "main-scene");
syncDir("resource", "resource");

// Drop legacy emit locations from prior approaches so PartyKit deploy doesn't include stale files.
for (const n of ["nz-scene.html", "nz-scene.document"]) {
  const p = path.join(publicRoot, n);
  if (fs.existsSync(p)) fs.rmSync(p, { force: true });
}
