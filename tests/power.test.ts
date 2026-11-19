import { describe, expect, it } from 'vitest';
import { newGame, runDays } from '../src/sim/engine';
import { civilisationPower, kardashevIndex, kardashevType, wattsForK, formatWatts } from '../src/sim/power';
import { eraRequirements } from '../src/sim/eras';
import { ERAS } from '../src/sim/data/eras';

describe('Kardashev index', () => {
  it('follows K = (log10(P) - 6) / 10 with conventional thresholds', () => {
    expect(kardashevIndex(1e16)).toBeCloseTo(1, 10);
    expect(kardashevIndex(1e26)).toBeCloseTo(2, 10);
    expect(kardashevIndex(1e36)).toBeCloseTo(3, 10);
    expect(kardashevIndex(2e13)).toBeCloseTo(0.73, 2); // Earth today, roughly
    expect(kardashevIndex(0)).toBe(0);
    expect(wattsForK(2)).toBeCloseTo(1e26, -20);
    expect(kardashevType(0.7).label).toBe('Sub-Type I');
    expect(kardashevType(1.2)).toEqual({ label: 'Type I', speculative: false });
    expect(kardashevType(3.5)).toEqual({ label: 'Type III', speculative: false });
    expect(kardashevType(4.1)).toEqual({ label: 'Type IV', speculative: true });
    expect(kardashevType(5)).toEqual({ label: 'Type V', speculative: true });
    expect(formatWatts(3.2e12)).toBe('3.2 TW');
  });

  it('measures a young realm from its real grid infrastructure', () => {
    const s = newGame({ seed: 3, galaxySize: 'small', aiCount: 2 });
    const e = s.empires[0];
    const p = civilisationPower(s, e);
    expect(p.sources.map((x) => x.label)).toEqual(['Planetary grid']);
    expect(p.k).toBeGreaterThan(0.55);
    expect(p.k).toBeLessThan(0.85);
    // More generator infrastructure means more power.
    const cap = s.planets[e.capitalPlanetId!].colony!;
    const before = p.watts;
    cap.buildings.power = (cap.buildings.power ?? 0) + 2;
    cap.pops += 10;
    runDays(s, 1);
    expect(civilisationPower(s, e).watts).toBeGreaterThan(before);
    // Energy technology raises the useful power of the same grid.
    const w0 = civilisationPower(s, e).watts;
    e.research.done.push('en_fusion');
    expect(civilisationPower(s, e).watts).toBeGreaterThan(w0 * 3);
  });

  it('reaches Type II only by harnessing a star', () => {
    const s = newGame({ seed: 4, galaxySize: 'small', aiCount: 2 });
    const e = s.empires[0];
    const sys = s.galaxy.systems[e.capitalSystemId!];
    sys.star = 'yellow';
    expect(civilisationPower(s, e).k).toBeLessThan(1);
    sys.megastructures.push({ id: 'dyson_swarm', ownerId: e.id, stage: 4, progress: 0, building: false });
    const k = civilisationPower(s, e).k;
    expect(k).toBeGreaterThan(1.9);
    expect(k).toBeLessThan(2.1);
    // A sector array across many stars is what makes Type III possible.
    s.galaxy.starsPerSystem = 2e8;
    sys.megastructures.push({ id: 'sector_array', ownerId: e.id, stage: 3, progress: 0, building: false });
    expect(civilisationPower(s, e).k).toBeGreaterThan(2.8);
  });

  it('keeps political eras separate but lets later eras require a minimum K', () => {
    const s = newGame({ seed: 5, galaxySize: 'small', aiCount: 2 });
    const e = s.empires[0];
    const req = eraRequirements(s, e, ERAS[2]).find((r) => r.label.startsWith('Kardashev'));
    expect(req).toBeDefined();
    expect(req!.done).toBe(false);
    expect(ERAS.every((era) => !/Type [IV]+/.test(era.epithet) || era.epithet.includes('speculative'))).toBe(true);
    runDays(s, 60);
    expect(e.stats.kardashev).toBeCloseTo(civilisationPower(s, e).k, 2);
    expect(e.stats.powerW).toBeGreaterThan(1e12);
  });
});
