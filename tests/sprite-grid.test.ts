import { describe, expect, it } from 'vitest';

import { celRect } from '../src/engine/layers/bg-sprite';

describe('celRect', () => {
  const W = 1536;
  const H = 2752;

  it('Format A tiles the sheet edge to edge', () => {
    // trim 0 → cels butt up against each other and cover the whole bitmap.
    const first = celRect(W, H, 4, 4, 0, 0);
    expect(first).toEqual({ sx: 0, sy: 0, sw: 384, sh: 688 });

    const last = celRect(W, H, 4, 4, 15, 0);
    expect(last.sx + last.sw).toBe(W);
    expect(last.sy + last.sh).toBe(H);
  });

  it('walks cels left to right, then top to bottom', () => {
    expect(celRect(W, H, 4, 4, 1, 0).sx).toBe(384);
    expect(celRect(W, H, 4, 4, 1, 0).sy).toBe(0);
    // index 4 wraps onto the second row
    expect(celRect(W, H, 4, 4, 4, 0).sx).toBe(0);
    expect(celRect(W, H, 4, 4, 4, 0).sy).toBe(688);
  });

  it('Format B insets every cel symmetrically', () => {
    const r = celRect(W, H, 4, 4, 0, 0.06);
    expect(r.sx).toBeCloseTo(384 * 0.06);
    expect(r.sy).toBeCloseTo(688 * 0.06);
    expect(r.sw).toBeCloseTo(384 * 0.88);
    expect(r.sh).toBeCloseTo(688 * 0.88);
  });

  it('Format B keeps every cel inside its even-division cell', () => {
    // The whole point: no cel may reach into its neighbour, which is what
    // produced the sliver of the adjacent frame along the top edge.
    for (let i = 0; i < 16; i++) {
      const plain = celRect(W, H, 4, 4, i, 0);
      const trimmed = celRect(W, H, 4, 4, i, 0.06);
      expect(trimmed.sx).toBeGreaterThan(plain.sx);
      expect(trimmed.sy).toBeGreaterThan(plain.sy);
      expect(trimmed.sx + trimmed.sw).toBeLessThan(plain.sx + plain.sw);
      expect(trimmed.sy + trimmed.sh).toBeLessThan(plain.sy + plain.sh);
    }
  });

  it('handles a non-square grid (the 2x4 Liberdade sheet)', () => {
    const r = celRect(W, H, 2, 4, 3, 0);
    expect(r).toEqual({ sx: 768, sy: 688, sw: 768, sh: 688 });
  });

  it('never collapses a cel to zero even at maximum trim', () => {
    const r = celRect(8, 8, 4, 4, 0, 0.5);
    expect(r.sw).toBeGreaterThanOrEqual(1);
    expect(r.sh).toBeGreaterThanOrEqual(1);
  });
});
