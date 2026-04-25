import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Build output goes into ../public so PartyKit (`--serve ./public`) can serve it.
// `emptyOutDir: false` so non-Vite files in `../public` (e.g. future static assets) are not wiped; prune stale `assets/index-*.js` after builds if needed.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: path.resolve(__dirname, "../public"),
    emptyOutDir: false,
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
