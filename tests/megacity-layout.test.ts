import { describe, expect, it } from 'vitest';
import { megacityLayout, CELL, PLOT, ringOf } from '../src/ui/render/megacityLayout';
import { MEGA_TIERS, megaModelFor } from '../src/ui/render/capitalMegacity';
import { PLOT_ORDER } from '../src/sim/capital';
import { CAPITAL_BUILDINGS, CITADEL_PLOT, PLOT_COLS, PLOT_ROWS } from '../src/sim/data/capital';

describe('megacity layout', () => {
  const L = megacityLayout();
  it('places every one of the 24 plots exactly once, the Citadel at the centre', () => {
    expect(L.slots.map((s) => s.plot).sort((a, b) => a - b)).toEqual(Array.from({ length: PLOT_COLS * PLOT_ROWS }, (_, i) => i));
    const c = L.slots.find((s) => s.plot === CITADEL_PLOT)!;
    expect([c.x, c.z]).toEqual([0, 0]);
  });

  it('keeps unlock order moving outward: ring 1 plots open before ring 2 plots', () => {
    const rank = new Map(PLOT_ORDER.map((p, i) => [p, i]));
    const r1 = L.slots.filter((s) => s.ring === 1 && s.plot !== CITADEL_PLOT).map((s) => rank.get(s.plot)!);
    const r2 = L.slots.filter((s) => s.ring === 2).map((s) => rank.get(s.plot)!);
    expect(Math.max(...r1)).toBeLessThan(Math.min(...r2));
    expect(r1.length).toBe(12);
  });

  it('never puts two plots, or a plot and a district block, in the same cell', () => {
    const cells = [...L.slots.filter((s) => s.plot !== CITADEL_PLOT).map((s) => `${s.x},${s.z}`), ...L.districts.map((d) => `${d.x},${d.z}`)];
    expect(new Set(cells).size).toBe(cells.length);
    for (const s of L.slots) if (s.plot !== CITADEL_PLOT) expect(Math.max(Math.abs(s.x), Math.abs(s.z))).toBeGreaterThan(CELL); // outside the Citadel block
  });

  it('runs highways on avenues, never over a plot', () => {
    for (const h of L.highways) {
      for (const s of L.slots) {
        if (s.plot === CITADEL_PLOT) continue;
        const inside = Math.abs(h.x - s.x) < PLOT / 2 && Math.abs(h.z - s.z) < PLOT / 2;
        expect(inside, `highway at ${h.x},${h.z} over plot ${s.plot}`).toBe(false);
      }
    }
  });

  it('rings are measured from the central block', () => {
    expect(ringOf(3, 3)).toBe(0);
    expect(ringOf(2, 4)).toBe(1);
    expect(ringOf(0, 7)).toBe(3);
  });

  it('every capital building has a megacity model for every level', () => {
    for (const b of CAPITAL_BUILDINGS) {
      expect(MEGA_TIERS[b.id], b.id).toBeTruthy();
      for (let lv = 1; lv <= b.maxLevel; lv++) expect(megaModelFor(b.id, lv)).not.toBeNull();
    }
    expect(megaModelFor('citadel', 1)!.model).toBe('citadel_t1');
    expect(megaModelFor('citadel', 30)!.model).toBe('citadel_t4');
  });
});
