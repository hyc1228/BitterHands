#!/usr/bin/env node
/* eslint-disable no-console */
// End-to-end smoke test: connect as OB, spawn AI players, start the round,
// end it immediately, and verify GAME_ENDED + GAME_ENDED_MEDIA actually
// fire with the expected shape.  Validates the split-message protocol so
// we don't ship "ceremony shows nothing" again.
//
// Usage:
//   1. In another terminal, start the dev server:
//        cd server && npx partykit dev ./src/server.js --port 1999
//   2. Here:
//        node server/scripts/smoke-ceremony.mjs
//
// Requires Node 22+ (built-in `WebSocket` global, no `ws` install needed).

const URL =
  process.env.PARTYKIT_URL ||
  "ws://127.0.0.1:1999/parties/main/test-room-ceremony";
const AI_COUNT = Number(process.env.AI_COUNT || "6");

const events = {};
const mediaPayloads = [];
let gameEndedPayload = null;

if (typeof globalThis.WebSocket !== "function") {
  console.error(
    "Node WebSocket not available. Use Node >=22 (current: " + process.version + ")."
  );
  process.exit(2);
}
const ws = new globalThis.WebSocket(URL);

ws.addEventListener("open", () => {
  console.log("[ws] OPEN");
  // Real OB tabs don't call JOIN — they only listen + send OB-only commands.
  // Sending JOIN would create a player record that fails the ready-check on
  // START. We mirror the real OB flow exactly.
});

ws.addEventListener("message", (ev) => {
  let m;
  try { m = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString()); } catch { return; }
  if (m.type) events[m.type] = (events[m.type] || 0) + 1;
  if (m.type === "room_snapshot") {
    const snap = m.data;
    console.log(`[ws] room_snapshot players=${snap.players?.length} started=${snap.started}`);
  } else if (m.type === "game_started") {
    console.log("[ws] GAME_STARTED", m.data);
  } else if (m.type === "game_ended") {
    gameEndedPayload = m.data;
    console.log("[ws] GAME_ENDED received");
    console.log("       reveal.length =", m.data?.reveal?.length);
    console.log("       awards =", JSON.stringify(m.data?.awards));
    console.log("       payload bytes =", JSON.stringify(m.data).length);
  } else if (m.type === "game_ended_media") {
    mediaPayloads.push(m.data);
    const d = m.data;
    console.log(
      `[ws] GAME_ENDED_MEDIA pid=${d.playerId}`,
      `mouth=${d.highlights?.mouth?.length}`,
      `shake=${d.highlights?.shake?.length}`,
      `blink=${d.highlights?.blink?.length}`,
      `fallback=${d.fallbackBurst?.length}`,
      `bytes=${JSON.stringify(d).length}`
    );
  } else if (m.type === "error") {
    console.log("[ws] error:", m.error || m);
  }
});

ws.addEventListener("error", (e) => console.error("[ws] ERROR", e?.message || e));
ws.addEventListener("close", () => console.log("[ws] CLOSED"));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await wait(800);
  console.log(`\n=== spawn ${AI_COUNT} AI bots ===`);
  ws.send(JSON.stringify({ type: "ob_spawn_ai", count: AI_COUNT }));
  await wait(1000);

  console.log("\n=== START round ===");
  ws.send(JSON.stringify({ type: "start" }));
  await wait(2000);

  console.log("\n=== END round ===");
  ws.send(JSON.stringify({ type: "end" }));
  await wait(2500);

  console.log("\n========== SUMMARY ==========");
  console.log("events:", events);
  console.log("game_ended payload received:", !!gameEndedPayload);
  if (gameEndedPayload) {
    console.log("  reveal.length:", gameEndedPayload.reveal?.length);
    const sample = gameEndedPayload.reveal?.[0];
    if (sample) {
      console.log("  reveal[0] keys:", Object.keys(sample).sort().join(","));
      console.log("  reveal[0]:", JSON.stringify(sample));
    }
  }
  console.log("media broadcasts:", mediaPayloads.length);
  if (mediaPayloads[0]) {
    console.log("  media[0] keys:", Object.keys(mediaPayloads[0]).sort().join(","));
  }

  const ok =
    events.game_ended === 1 &&
    gameEndedPayload?.reveal?.length > 0 &&
    mediaPayloads.length === gameEndedPayload?.reveal?.length;
  console.log(ok ? "\nRESULT: PASS" : "\nRESULT: FAIL");

  ws.close();
  await wait(200);
  process.exit(ok ? 0 : 1);
})();
