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

/** `emptyOutDir` is false for PartyKit; drop stray `*.html` from `public/main-scene` (see sync-main-scene.mjs). */
function removeMainSceneStrayHtmlPlugin(): Plugin {
  return {
    name: "nz-rm-main-scene-stray-html",
    closeBundle() {
      if (isVercel) return;
      const d = path.join(outDir, "main-scene");
      if (fs.existsSync(d)) {
        for (const f of fs.readdirSync(d)) {
          if (f.toLowerCase().endsWith(".html")) {
            try {
              fs.rmSync(path.join(d, f), { force: true });
            } catch {
              /* ignore */
            }
          }
        }
      }
      const legacy = path.join(outDir, "nz-scene.html");
      if (fs.existsSync(legacy)) fs.rmSync(legacy, { force: true });
    }
  };
}

export default defineConfig({
  plugins: [react(), localAvatarPlugin(), removeMainSceneStrayHtmlPlugin()],
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
