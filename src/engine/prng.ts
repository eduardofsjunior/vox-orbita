/**
 * Deterministic PRNG + hash utilities.
 *
 * Layers must be pure functions of (frame, config, features). Anything that
 * looks random (particle jitter, star positions) must come from these seeded
 * generators so preview and export produce identical pixels.
 */

/** mulberry32 — fast, good-enough 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash (lowbias32). Stable scalar "random" for an index. */
export function hash32(x: number): number {
  let h = x >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  h ^= h >>> 15;
  return h >>> 0;
}

/** hash32 mapped to [0, 1). */
export function hash01(x: number): number {
  return hash32(x) / 4294967296;
}

/** Combine two integers into one hash (for 2-D seeds like onset+particle). */
export function hash2(a: number, b: number): number {
  return hash32(Math.imul(hash32(a), 0x9e3779b9) ^ b);
}
