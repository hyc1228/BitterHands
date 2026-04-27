#!/usr/bin/env node
/**
 * Build & package the SPA for itch.io HTML5 hosting.
 *
 * itch.io serves the uploaded zip from a path-segmented CDN
 * (e.g. `https://html.itch.zone/html/<id>/...`), running the
 * game inside an iframe. PartyKit (the WebSocket multiplayer
 * server) stays at the canonical host — only the SPA shell +
 * static assets ship in the zip.
 *
 * What this script does:
 *  1. Spawns Vite with two extra env vars so the bundle is
 *     itch-aware:
 *       - `VITE_PARTYKIT_HOST`     → absolute WS host (already in
 *                                    `.env.production`, but we
 *                                    re-pin it here so a missing
 *                                    file doesn't silently produce
 *                                    a same-origin build).
 *       - `VITE_MAIN_SCENE_PATH`   → `main-scene/index.html` (skips
 *                                    the synthetic `_iframe`
 *                                    rewrite that only PartyKit's
 *                                    `onFetch` understands).
 *  2. Stages `server/public/` → `server/itch-build/` and prunes
 *     paths that are runtime-only on PartyKit:
 *       - `voice/`    (rewritten by `resolveAudioUrl()` cross-origin)
 *       - `avatars/`  (in-memory, served via `/party/.../__nz_avatar`)
 *       - `*.map`     (source maps; not useful on itch + bigger zip)
 *  3. Zips the staged dir as `nocturne-zoo-itch.zip` at repo root,
 *     with `index.html` at the zip root (itch requirement).
 *
 * Re-run any time after gameplay changes:
 *     npm --prefix server/app run build:itch
 *     # → ./nocturne-zoo-itch.zip
 *
 * Then on itch.io: New project → Kind: HTML → upload the zip →
 * Embed options → "Click to launch in fullscreen" (camera+mic
 * permission requires a top-level browsing context, see
 * docs/deploy-itch.md).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");
const APP_DIR = path.resolve(REPO_ROOT, "server/app");
const PUBLIC_DIR = path.resolve(REPO_ROOT, "server/public");
const STAGE_DIR = path.resolve(REPO_ROOT, "server/itch-build");
const OUT_ZIP = path.resolve(REPO_ROOT, "nocturne-zoo-itch.zip");

/** Default partykit host — overridable via env so private deploys can re-use the script. */
const PARTYKIT_HOST =
  process.env.VITE_PARTYKIT_HOST?.trim() || "nocturne-zoo.hyc1228.partykit.dev";

function log(step, msg) {
  process.stdout.write(`\x1b[36m[itch:${step}]\x1b[0m ${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`\x1b[31m[itch:fail]\x1b[0m ${msg}\n`);
  process.exit(1);
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyTree(src, dst, skip = () => false) {
  const stat = fs.statSync(src);
  if (skip(src)) return;
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyTree(path.join(src, name), path.join(dst, name), skip);
    }
    return;
  }
  fs.copyFileSync(src, dst);
}

// 1. Build the SPA with itch-aware env.  We pin `VITE_PARTYKIT_HOST`
//    + `VITE_MAIN_SCENE_PATH` for this run only; the parent shell's
//    `.env.production` still wins for other build scripts.
log("build", `vite build (host=${PARTYKIT_HOST}, mainScene=index.html)`);
const buildResult = spawnSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "build"],
  {
    cwd: APP_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_PARTYKIT_HOST: PARTYKIT_HOST,
      VITE_MAIN_SCENE_PATH: "main-scene/index.html"
    }
  }
);
if (buildResult.status !== 0) {
  fail(`vite build exited with code ${buildResult.status ?? "unknown"}`);
}
if (!fs.existsSync(path.join(PUBLIC_DIR, "index.html"))) {
  fail(`expected ${PUBLIC_DIR}/index.html after build — bundle missing?`);
}

// 2. Stage public/ → itch-build/ minus runtime-only paths and source maps.
//    Vite is configured with `emptyOutDir: false` (PartyKit needs to keep
//    non-Vite files in `public/`), which means previous builds leave
//    stale `assets/index-<oldhash>.js` etc. in place.  We resolve which
//    assets the *new* `index.html` actually references and prune the
//    rest before zipping — keeps the upload tight.
log("stage", `${PUBLIC_DIR} → ${STAGE_DIR}`);
rmrf(STAGE_DIR);
const SKIP_TOP_LEVEL = new Set(["voice", "avatars"]);
const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
const referencedAssets = new Set(
  Array.from(indexHtml.matchAll(/(?:src|href)\s*=\s*["']\.\/assets\/([^"']+)["']/g),
    (m) => m[1])
);
// `gif.worker-*.js` is loaded at runtime by gif.js (created via
// `new Worker(URL)` from the bundled JS, not the HTML), so the HTML
// scan won't see it.  Whitelist any `gif.worker-*.js` we find.
log("stage", `index.html references ${referencedAssets.size} assets; whitelisting gif.worker-*`);
copyTree(PUBLIC_DIR, STAGE_DIR, (abs) => {
  const rel = path.relative(PUBLIC_DIR, abs);
  if (rel === "") return false;
  const top = rel.split(path.sep)[0];
  if (SKIP_TOP_LEVEL.has(top)) return true;
  if (abs.endsWith(".map")) return true;
  if (top === "assets" && rel !== "assets") {
    const file = path.basename(rel);
    if (file.startsWith("gif.worker-")) return false;
    if (!referencedAssets.has(file)) return true;
  }
  return false;
});

// 3. Zip the staged directory contents (NOT the dir itself) so
//    `index.html` sits at the root of the archive — itch refuses
//    zips that nest the entry under a folder.
log("zip", `→ ${path.relative(REPO_ROOT, OUT_ZIP)}`);
rmrf(OUT_ZIP);
const zipResult = spawnSync(
  "zip",
  ["-r", "-q", OUT_ZIP, "."],
  { cwd: STAGE_DIR, stdio: "inherit" }
);
if (zipResult.status !== 0) {
  fail(
    "`zip` failed. On macOS / Linux this command is built-in; on Windows " +
      "install 7-Zip and run `7z a nocturne-zoo-itch.zip ./*` from the " +
      "stage dir manually, or run this script from WSL."
  );
}

// 4. Sanity-check the zip — index.html must be at the archive root.
const listResult = spawnSync("unzip", ["-l", OUT_ZIP], { encoding: "utf8" });
if (listResult.status === 0) {
  const lines = listResult.stdout.split(/\r?\n/);
  const hasRootIndex = lines.some((l) => /\bindex\.html$/.test(l) && !/\//.test(l.split(/\s+/).slice(-1)[0]));
  if (!hasRootIndex) {
    fail("index.html is not at the zip root — itch will reject this archive.");
  }
}

const sizeMb = (fs.statSync(OUT_ZIP).size / (1024 * 1024)).toFixed(2);
log("ok", `nocturne-zoo-itch.zip ready (${sizeMb} MB)`);
log("ok", `upload to itch → enable "Click to launch in fullscreen" for camera permission.`);

// 5. Optional: push to itch.io via butler (the official itch CLI).
//    Triggered by `npm run deploy:itch` (which sets ITCH_DEPLOY=1).
//    Skipped for plain `npm run build:itch` so the zip can be inspected
//    locally first.  Configure target with ITCH_TARGET (default below).
if (process.env.ITCH_DEPLOY === "1") {
  const ITCH_TARGET = process.env.ITCH_TARGET?.trim() || "huyuchen/nocturne-zoo:html5";
  // Tag this upload with a git-short-sha + ISO date so itch.io's "Devlog"
  // / changelog isn't a wall of `v1, v2, v3`.  Falls through to butler's
  // own auto-numbering if git isn't available for any reason.
  let userVersion = process.env.ITCH_USERVERSION?.trim() || "";
  if (!userVersion) {
    const sha = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" });
    if (sha.status === 0 && sha.stdout) {
      const stamp = new Date().toISOString().slice(0, 10);
      userVersion = `${stamp}-${sha.stdout.trim()}`;
    }
  }
  const pushArgs = ["push", OUT_ZIP, ITCH_TARGET];
  if (userVersion) pushArgs.push("--userversion", userVersion);
  log("push", `butler push → ${ITCH_TARGET}${userVersion ? ` (v=${userVersion})` : ""}`);
  const pushResult = spawnSync("butler", pushArgs, { stdio: "inherit" });
  if (pushResult.status !== 0) {
    fail(
      "`butler push` failed. Common causes:\n" +
        "  • Not logged in:  run `butler login` once (opens browser).\n" +
        `  • Project doesn't exist yet: create https://itch.io/game/new\n` +
        `    with the URL slug \`${ITCH_TARGET.split(":")[0].split("/")[1]}\`,\n` +
        "    set Kind=HTML, then re-run.\n" +
        "  • Wrong target: override with ITCH_TARGET=user/game:channel."
    );
  }
  log("ok", `pushed to itch.io — see https://${ITCH_TARGET.split("/")[0]}.itch.io/${ITCH_TARGET.split("/")[1].split(":")[0]}`);
}
