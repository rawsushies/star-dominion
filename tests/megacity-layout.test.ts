import { describe, expect, it } from 'vitest';
import { megacityLayout, skylineLayout, carAt, CELL, PLOT, ringOf, STREET_END } from '../src/ui/render/megacityLayout';
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

  it('raises the outer skyline beyond the walls, clear of the gate roads, thickening with the Citadel', () => {
    const towers = skylineLayout(140);
    expect(towers.length).toBe(140);
    const wall = 4 * CELL + 6;
    for (const t of towers) {
      expect(Math.hypot(t.x, t.z), 'outside the wall').toBeGreaterThan(wall + 8);
      expect(Math.min(Math.abs(t.x), Math.abs(t.z)), 'clear of the gate approaches').toBeGreaterThanOrEqual(12);
      expect(t.from).toBeGreaterThanOrEqual(1);
      expect(t.from).toBeLessThanOrEqual(19);
    }
    for (let a = 0; a < towers.length; a++) for (let b = a + 1; b < towers.length; b++) expect(Math.hypot(towers[a].x - towers[b].x, towers[a].z - towers[b].z)).toBeGreaterThanOrEqual(11);
    const standing = (lv: number) => towers.filter((t) => t.from <= lv).length;
    expect(standing(1)).toBeLessThan(standing(10));
    expect(standing(20)).toBe(140);
    expect(skylineLayout(140)).toEqual(towers); // deterministic
  });

  it('keeps street cars on the avenues and in their lanes, never through plots or the Citadel', () => {
    for (let i = 0; i < 110; i++) for (const time of [0, 3.3, 47, 600]) {
      const c = carAt(i, time);
      expect(Math.max(Math.abs(c.x), Math.abs(c.z))).toBeLessThanOrEqual(STREET_END + 2);
      expect(Math.max(Math.abs(c.x), Math.abs(c.z)), 'not inside the Citadel plaza').toBeGreaterThan(CELL - 3);
      for (const s of L.slots) {
        if (s.plot === CITADEL_PLOT) continue;
        expect(Math.abs(c.x - s.x) < PLOT / 2 && Math.abs(c.z - s.z) < PLOT / 2, `car ${i} on plot ${s.plot}`).toBe(false);
      }
    }
    // cars move
    const a = carAt(5, 0), b = carAt(5, 1);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(4);
  });
});
