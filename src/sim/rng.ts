// Deterministic, serialisable PRNG (mulberry32). The whole simulation draws
// randomness from a single stream stored in GameState.rng so that a given
// seed + command sequence always reproduces the same game.

export interface RngState { s: number }

export function makeRng(seed: number): RngState {
  return { s: (seed >>> 0) || 0x9e3779b9 };
}

export function next(r: RngState): number {
  let t = (r.s = (r.s + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function range(r: RngState, lo: number, hi: number): number {
  return lo + (hi - lo) * next(r);
}

export function int(r: RngState, lo: number, hiInclusive: number): number {
  return lo + Math.floor(next(r) * (hiInclusive - lo + 1));
}

export function chance(r: RngState, p: number): boolean {
  return next(r) < p;
}

export function pick<T>(r: RngState, arr: readonly T[]): T {
  return arr[Math.floor(next(r) * arr.length)];
}

export function weighted<T>(r: RngState, items: readonly T[], weight: (t: T) => number): T | undefined {
  let total = 0;
  for (const it of items) total += Math.max(0, weight(it));
  if (total <= 0) return undefined;
  let roll = next(r) * total;
  for (const it of items) {
    roll -= Math.max(0, weight(it));
    if (roll <= 0) return it;
  }
  return items[items.length - 1];
}

export function shuffle<T>(r: RngState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next(r) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Stateless hash noise, used for visual-only variation that must not touch the sim RNG. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
