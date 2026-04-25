import type { PublicPlayer } from "../party/protocol";

function hashU32(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** Permutation of 0..n-1, stable for the same `seed` string. */
function shuffledOrder(seed: string, n: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const r = hashU32(`${seed}|${i}`) % (i + 1);
    [idx[i], idx[r]] = [idx[r], idx[i]];
  }
  return idx;
}

/**
 * Picks up to `k` real players (excludes the OB connection named "ob") in a
 * deterministic pseudo-random order for the current room + roster.
 */
export function pickObSpotlight(players: PublicPlayer[], k: number, roomId: string): PublicPlayer[] {
  const list = players.filter((p) => p.name.toLowerCase() !== "ob");
  if (list.length === 0) return [];
  if (k <= 0) return [];
  if (list.length <= k) return list;
  const sorted = [...list].sort((a, b) => a.id.localeCompare(b.id));
  const seed = `${roomId}:${sorted.map((p) => p.id).join(",")}`;
  const order = shuffledOrder(seed, sorted.length);
  return order.slice(0, k).map((i) => sorted[i]);
}
