import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = fileURLToPath(new URL(".", import.meta.url));

const isVercel = Boolean(process.env.VERCEL);
// Vercel: `dist/`. Local PartyKit: `../public` (see server README).
const outDir = isVercel ? path.resolve(appDir, "dist") : path.resolve(appDir, "../public");

/** Dev-only: persist onboarding photos to `server/public/avatars/` and serve them at `/avatars/*`. */
function localAvatarPlugin(): Plugin {
  return {
    name: "nz-local-avatar",
    configureServer(server) {
      const avDir = path.resolve(appDir, "../public/avatars");
      fs.mkdirSync(avDir, { recursive: true });

      const mimeForExt = (ext: string) => {
        const e = ext.toLowerCase();
        if (e === "png") return "image/png";
        if (e === "webp") return "image/webp";
        return "image/jpeg";
      };

      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url || "";
        const q = rawUrl.indexOf("?");
        const pathOnly = q === -1 ? rawUrl : rawUrl.slice(0, q);

        if (pathOnly === "/__api/avatar" && req.method === "POST") {
          const chunks: Buffer[] = [];
          req.on("data", (c: Buffer) => chunks.push(c));
          req.on("end", () => {
            try {
              const text = Buffer.concat(chunks).toString("utf8");
              const body = JSON.parse(text) as { dataUrl?: string; roomId?: string };
              const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
              if (!dataUrl.startsWith("data:image/")) {
                res.statusCode = 400;
                res.end();
                return;
              }
              const m = dataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,([\s\S]+)$/i);
              if (!m) {
                res.statusCode = 400;
                res.end();
                return;
              }
              const b64 = m[2].replace(/\s/g, "");
              const buf = Buffer.from(b64, "base64");
              if (buf.length > 400_000) {
                res.statusCode = 413;
                res.end();
                return;
              }
              const kind = m[1].toLowerCase();
              const fileExt = kind === "png" ? "png" : kind === "webp" ? "webp" : "jpg";
              const room = String(body.roomId ?? "r")
                .replace(/[^a-zA-Z0-9_-]/g, "_")
                .slice(0, 48);
              const fname = `${room}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${fileExt}`;
              if (!/^[a-zA-Z0-9._-]+$/.test(fname)) {
                res.statusCode = 400;
                res.end();
                return;
              }
              const filePath = path.join(avDir, fname);
              if (!filePath.startsWith(avDir)) {
                res.statusCode = 400;
                res.end();
                return;
              }
              fs.writeFileSync(filePath, buf);
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ path: `/avatars/${fname}` }));
            } catch {
              res.statusCode = 500;
              res.end();
            }
          });
          req.on("error", () => {
            res.statusCode = 500;
            res.end();
          });
          return;
        }

        if (pathOnly.startsWith("/avatars/") && req.method === "GET") {
          const name = path.basename(pathOnly);
          if (!/^[a-zA-Z0-9._-]+\.(jpe?g|png|webp)$/.test(name)) {
            next();
            return;
          }
          const filePath = path.join(avDir, name);
          if (!filePath.startsWith(avDir) || !fs.existsSync(filePath)) {
            next();
            return;
          }
          res.setHeader("Content-Type", mimeForExt(path.extname(name).slice(1)));
          res.setHeader("Cache-Control", "private, max-age=300");
          res.end(fs.readFileSync(filePath));
          return;
        }
        next();
      });
    }
  };
}

/** Dev: serve `/main-scene/_iframe` from `app/public/main-scene/index.html` to mirror PartyKit `onFetch`. */
function mainSceneIframeDevPlugin(): Plugin {
  return {
    name: "nz-iframe-dev",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const u = req.url || "";
        const p = u.split("?")[0] ?? u;
        if (p === "/main-scene/_iframe" && (req.method === "GET" || req.method === "HEAD")) {
          const file = path.resolve(appDir, "public/main-scene/index.html");
          if (fs.existsSync(file)) {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache");
            res.end(req.method === "HEAD" ? null : fs.readFileSync(file));
            return;
          }
        }
        next();
      });
    }
  };
}

/**
 * Dev: serve `/voice/*` (Monitor PA WAV files) from `server/public/voice/`.
 *
 * In production they're hosted at the same origin as the SPA via PartyKit's static layer,
 * but during `npm run dev:client` Vite's publicDir is `app/public/` (which doesn't have
 * `voice/`), so without this middleware `<audio>.src = "/voice/..."` 404s back to the SPA
 * shell as `text/html` and never plays. Mobile browsers are especially picky about MIME
 * type, so we set `audio/wav` explicitly.
 */
function voiceAssetsDevPlugin(): Plugin {
  return {
    name: "nz-voice-dev",
    configureServer(server) {
      const voiceRoot = path.resolve(appDir, "../public/voice");
      const mimeFor = (ext: string): string => {
        const e = ext.toLowerCase();
        if (e === "mp3") return "audio/mpeg";
        if (e === "ogg" || e === "oga") return "audio/ogg";
        if (e === "m4a" || e === "aac") return "audio/mp4";
        return "audio/wav";
      };
      server.middlewares.use((req, res, next) => {
        const u = req.url || "";
        const p = u.split("?")[0] ?? u;
        if (!p.startsWith("/voice/")) return next();
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const name = path.basename(p);
        if (!/^[a-zA-Z0-9._-]+\.(wav|mp3|ogg|oga|m4a|aac)$/.test(name)) return next();
        const filePath = path.join(voiceRoot, name);
        if (!filePath.startsWith(voiceRoot) || !fs.existsSync(filePath)) return next();
        const ext = path.extname(name).slice(1);
        res.setHeader("Content-Type", mimeFor(ext));
        res.setHeader("Cache-Control", "public, max-age=300");
        res.setHeader("Accept-Ranges", "bytes");
        res.end(req.method === "HEAD" ? null : fs.readFileSync(filePath));
      });
    }
  };
}

/** `emptyOutDir` is false for PartyKit; drop legacy `nz-scene.*` left over from prior builds. */
function removeLegacyMainScenePlugin(): Plugin {
  return {
    name: "nz-rm-legacy-main-scene",
    closeBundle() {
      if (isVercel) return;
      for (const n of ["nz-scene.html", "nz-scene.document"]) {
        const p = path.join(outDir, n);
        if (fs.existsSync(p)) {
          try {
            fs.rmSync(p, { force: true });
          } catch {
            /* ignore */
          }
        }
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), localAvatarPlugin(), mainSceneIframeDevPlugin(), voiceAssetsDevPlugin(), removeLegacyMainScenePlugin()],
  base: "./",
  build: {
    outDir,
    // On Vercel, output is a clean `dist/`. For local PartyKit, keep non-Vite files under `../public` if any.
    emptyOutDir: isVercel,
    sourcemap: true,
    target: "es2018"
  },
  server: {
    host: true,
    // Vite dev server proxy so /party/* WS routes hit the running PartyKit dev server.
    proxy: {
      "/party": {
        target: "http://127.0.0.1:1999",
        ws: true,
        changeOrigin: true
      }
    }
  }
});
