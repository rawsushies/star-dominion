import { describe, expect, it } from 'vitest';
import { newGame, runDays } from '../src/sim/engine';
import { execute } from '../src/sim/commands';
import { MEGA_BY_ID } from '../src/sim/data/megastructures';
import { megaInstalment } from '../src/sim/construction';
import { futureStudyCost } from '../src/sim/research';
import { TECHS } from '../src/sim/data/techs';
import { empireMods, mod } from '../src/sim/modifiers';

describe('megastructures and late-game progression', () => {
  it('stages are paid in daily instalments and pause when the treasury runs dry', () => {
    const s = newGame({ seed: 91 });
    const e = s.empires[s.playerId];
    const def = MEGA_BY_ID.continuum_engine;
    e.research.done.push(def.tech, ...TECHS.map((t) => t.id));
    // the full stage cost is far above storage, yet a month of instalments starts it
    const month = Object.fromEntries(Object.entries(megaInstalment(def)).map(([k, v]) => [k, v * 30 + 1]));
    Object.assign(e.stock, month);
    const sys = s.galaxy.systems[e.capitalSystemId!];
    expect(execute(s, e.id, { type: 'startMegastructure', systemId: sys.id, mega: def.id }).ok).toBe(true);
    runDays(s, 20);
    const m = sys.megastructures.find((x) => x.id === def.id)!;
    expect(m.progress).toBeGreaterThan(10);
    for (const k of Object.keys(def.stageCost)) (e.stock as Record<string, number>)[k] = 0;
    const p = m.progress;
    runDays(s, 10);
    expect(m.progress).toBeLessThanOrEqual(p + 1); // waiting for funds
  });

  it('a finished tech tree turns research into future studies that keep raising output', () => {
    const s = newGame({ seed: 92 });
    const e = s.empires[s.playerId];
    e.research.done = TECHS.map((t) => t.id);
    e.research.current = null; e.research.queue = [];
    e.research.progress = futureStudyCost(0) - 1;
    const before = mod(empireMods(s, e), 'output.alloys');
    runDays(s, 60);
    expect(e.research.future ?? 0).toBeGreaterThanOrEqual(1);
    expect(mod(empireMods(s, e), 'output.alloys')).toBeGreaterThan(before);
    expect(futureStudyCost(4)).toBeGreaterThan(futureStudyCost(0));
  });
});
