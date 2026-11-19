import { describe, expect, it } from 'vitest';
import { newGame, runDays, getLedger } from '../src/sim/engine';
import { execute } from '../src/sim/commands';
import { serialize, deserialize, fingerprint } from '../src/sim/save';
import { DESIGNATION_COST } from '../src/sim/data/designations';
import type { GameState, Planet } from '../src/sim/types';

/** A second, settled player world with mining districts. */
function province(s: GameState): Planet {
  const me = s.empires[s.playerId];
  const cap = s.planets[me.capitalPlanetId!];
  const p = s.planets.find((x) => !x.colony && x.type !== 'gas_giant' && x.id !== cap.id)!;
  p.colony = JSON.parse(JSON.stringify(cap.colony));
  p.colony!.buildings = { mining: 4, agri: 1, residential: 2 };
  p.colony!.pops = 8; p.colony!.queue = []; p.colony!.shipQueue = [];
  s.galaxy.systems[p.systemId].owner = me.id;
  me.stock.influence = 500;
  return p;
}
const minerals = (s: GameState, p: Planet) => getLedger(s, s.empires[s.playerId], true).planets[p.id].production.minerals ?? 0;
const food = (s: GameState, p: Planet) => getLedger(s, s.empires[s.playerId], true).planets[p.id].production.food ?? 0;

describe('planet designations', () => {
  it('a mining designation raises minerals, costs other output, and is validated', () => {
    const s = newGame({ seed: 61 });
    const me = s.empires[s.playerId];
    const p = province(s);
    const m0 = minerals(s, p), f0 = food(s, p);
    expect(execute(s, me.id, { type: 'setDesignation', planetId: me.capitalPlanetId!, designation: 'mining' }).ok).toBe(false);
    const inf = me.stock.influence;
    expect(execute(s, me.id, { type: 'setDesignation', planetId: p.id, designation: 'mining' }).ok).toBe(true);
    expect(me.stock.influence).toBe(inf - DESIGNATION_COST);
    expect(minerals(s, p)).toBeGreaterThan(m0 * 1.25);
    expect(food(s, p)).toBeLessThan(f0 + 1e-9);
    // cooldown, and other realms cannot touch it
    expect(execute(s, me.id, { type: 'setDesignation', planetId: p.id, designation: 'agrarian' }).ok).toBe(false);
    const other = s.empires.find((e) => e.kind === 'major' && e.id !== me.id)!;
    expect(execute(s, other.id, { type: 'setDesignation', planetId: p.id, designation: 'agrarian' }).ok).toBe(false);
    runDays(s, 361);
    expect(execute(s, me.id, { type: 'setDesignation', planetId: p.id, designation: 'agrarian' }).ok).toBe(true);
  });

  it('designations survive save and load, and AI realms designate their provinces', () => {
    const s = newGame({ seed: 62 });
    const p = province(s);
    execute(s, s.playerId, { type: 'setDesignation', planetId: p.id, designation: 'fortress' });
    const b = deserialize(serialize(s));
    expect(b.planets[p.id].colony!.designation).toBe('fortress');
    expect(fingerprint(b)).toBe(fingerprint(s));
    const g = newGame({ seed: 63 });
    runDays(g, 360 * 6);
    const designated = g.planets.filter((x) => x.colony && !g.empires[x.colony.ownerId].isPlayer && x.colony.designation);
    expect(designated.length).toBeGreaterThan(0);
  });
});
