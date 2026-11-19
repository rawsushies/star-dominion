import { describe, expect, it } from 'vitest';
import { dioramaLayout, TERRACES, CANAL, AVENUES, PLOT_RADIUS, terraceEdge, groundHeight, memorialAngle } from '../src/ui/render/dioramaLayout';
import { PLOT_COLS, PLOT_ROWS, CITADEL_PLOT } from '../src/sim/data/capital';
import { PLOT_ORDER } from '../src/sim/capital';

describe('diorama capital layout', () => {
  const slots = dioramaLayout();
  it('places every simulation plot exactly once, with the Citadel at the centre', () => {
    expect(slots.map((s) => s.plot).sort((a, b) => a - b)).toEqual(Array.from({ length: PLOT_COLS * PLOT_ROWS }, (_, i) => i));
    const c = slots.find((s) => s.plot === CITADEL_PLOT)!;
    expect([c.x, c.z, c.terrace]).toEqual([0, 0, 0]);
  });
  it('plots unlock outward: unlock order never moves to a higher terrace', () => {
    const terr = PLOT_ORDER.map((p) => slots.find((s) => s.plot === p)!.terrace);
    for (let i = 1; i < terr.length; i++) expect(terr[i]).toBeGreaterThanOrEqual(terr[i - 1]);
  });
  it('every plot pad lies wholly on its terrace, off the avenues, the canal and the other pads', () => {
    for (const s of slots.filter((x) => x.terrace > 0)) {
      const t = TERRACES[s.terrace], inner = TERRACES[s.terrace - 1];
      for (let k = 0; k < 32; k++) {
        const a = (k / 32) * Math.PI * 2;
        const x = s.x + Math.cos(a) * PLOT_RADIUS, z = s.z + Math.sin(a) * PLOT_RADIUS;
        const r = Math.hypot(x, z), ang = Math.atan2(z, x);
        expect(r).toBeLessThan(terraceEdge(t, ang));
        expect(r).toBeGreaterThan(terraceEdge(inner, ang));
        expect(groundHeight(x, z)).toBe(t.height);
      }
      if (s.terrace === 3) expect(s.radius - PLOT_RADIUS).toBeGreaterThan(CANAL.radius + CANAL.width / 2);
      for (const av of AVENUES) {
        const d = Math.abs(Math.sin(s.angle - av)) * s.radius; // distance from the avenue line
        expect(Math.cos(s.angle - av) < 0 || d > PLOT_RADIUS + 1).toBe(true);
      }
    }
    for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
      expect(Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z)).toBeGreaterThan(PLOT_RADIUS * 2);
    }
  });
  it('is deterministic and leaves one upper-terrace place for the memorial', () => {
    expect(dioramaLayout()).toEqual(slots);
    const upper = slots.filter((s) => s.terrace === 1).map((s) => s.angle);
    expect(upper).toHaveLength(7);
    expect(upper.some((a) => Math.abs(a - memorialAngle()) < 1e-9)).toBe(false);
  });
});
