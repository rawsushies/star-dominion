import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { newGame, runDays } from '../src/sim/engine';
import { deserialize, serialize, fingerprint } from '../src/sim/save';
import { execute } from '../src/sim/commands';
import { empireMods, mod } from '../src/sim/modifiers';
import { rosterLimit } from '../src/sim/characters';
import { capLevel, openPlots, plotOccupant, capitalCost, progressCapitals, sackCapital, citadelRequirements, PLOT_ORDER } from '../src/sim/capital';
import { CAPITAL_BY_ID, CITADEL_PLOT, plotsUnlocked } from '../src/sim/data/capital';
import type { Empire, GameState } from '../src/sim/types';

const rich = (e: Empire) => Object.assign(e.stock, { credits: 1e7, minerals: 1e7, alloys: 1e7, electronics: 1e7, rare: 1e7, energy: 1e7, influence: 1e5 });
const finish = (s: GameState) => { for (let i = 0; i < 2000 && s.empires[s.playerId].capital!.queue.length; i++) { s.tick++; progressCapitals(s); } };

describe('imperial capital', () => {
  it('starts with a level 1 Citadel on its plot', () => {
    const s = newGame({ seed: 31 });
    for (const e of s.empires.filter((x) => x.kind === 'major' || x.kind === 'minor')) {
      expect(capLevel(e, 'citadel')).toBe(1);
      expect(e.capital!.buildings.citadel.plot).toBe(CITADEL_PLOT);
    }
    expect(PLOT_ORDER[0]).toBe(CITADEL_PLOT);
    expect(openPlots(s.empires[0]).length).toBe(plotsUnlocked(1));
  });

  it('validates plots, prerequisites, the Citadel cap, cost and the queue', () => {
    const s = newGame({ seed: 32 });
    const me = s.empires[s.playerId];
    me.stock.credits = 0;
    expect(execute(s, me.id, { type: 'capitalBuild', building: 'treasury', plot: openPlots(me)[1] }).ok).toBe(false); // cost
    rich(me);
    expect(execute(s, me.id, { type: 'capitalBuild', building: 'treasury' }).ok).toBe(false); // no plot
    expect(execute(s, me.id, { type: 'capitalBuild', building: 'treasury', plot: CITADEL_PLOT }).ok).toBe(false); // taken
    const sealed = PLOT_ORDER[PLOT_ORDER.length - 1];
    expect(execute(s, me.id, { type: 'capitalBuild', building: 'treasury', plot: sealed }).ok).toBe(false); // not open
    expect(execute(s, me.id, { type: 'capitalBuild', building: 'military_academy', plot: openPlots(me)[1] }).ok).toBe(false); // citadel 5
    expect(execute(s, me.id, { type: 'capitalBuild', building: 'nonsense' }).ok).toBe(false);
    const credits = me.stock.credits;
    expect(execute(s, me.id, { type: 'capitalBuild', building: 'treasury', plot: openPlots(me)[1] }).ok).toBe(true);
    expect(me.stock.credits).toBe(credits - CAPITAL_BY_ID.treasury.cost.credits);
    expect(plotOccupant(me.capital!, openPlots(me)[1])).toBe('treasury');
    // treasury cannot exceed the Citadel: level 2 must wait
    expect(execute(s, me.id, { type: 'capitalBuild', building: 'treasury' }).ok).toBe(false);
    expect(execute(s, me.id, { type: 'capitalBuild', building: 'throne_hall', plot: openPlots(me)[2] }).ok).toBe(true);
    expect(execute(s, me.id, { type: 'capitalBuild', building: 'citadel' }).ok).toBe(false); // queue full (2)
    finish(s);
    expect(capLevel(me, 'treasury')).toBe(1);
    expect(capLevel(me, 'throne_hall')).toBe(1);
  });

  it('raises the Citadel through its requirements, opening plots, with rising cost', () => {
    const s = newGame({ seed: 33 });
    const me = s.empires[s.playerId];
    rich(me);
    // Citadel 2 has no requirements
    expect(execute(s, me.id, { type: 'capitalBuild', building: 'citadel' }).ok).toBe(true);
    finish(s);
    expect(capLevel(me, 'citadel')).toBe(2);
    expect(openPlots(me).length).toBe(plotsUnlocked(2));
    // Citadel 3 needs 2 levels elsewhere and throne hall 1
    expect(citadelRequirements(3)).toEqual({ otherLevels: 2, throneHall: 1 });
    expect(execute(s, me.id, { type: 'capitalBuild', building: 'citadel' }).ok).toBe(false);
    execute(s, me.id, { type: 'capitalBuild', building: 'throne_hall', plot: openPlots(me)[1] });
    execute(s, me.id, { type: 'capitalBuild', building: 'treasury', plot: openPlots(me)[2] });
    finish(s);
    expect(execute(s, me.id, { type: 'capitalBuild', building: 'citadel' }).ok).toBe(true);
    finish(s);
    expect(capLevel(me, 'citadel')).toBe(3);
    expect(capitalCost(CAPITAL_BY_ID.citadel, 30).credits).toBeGreaterThan(capitalCost(CAPITAL_BY_ID.citadel, 3).credits * 30);
  });

  it('a fully developed city reaches Citadel 30 and its effects reach the realm', () => {
    const s = newGame({ seed: 34 });
    const me = s.empires[s.playerId];
    const base = mod(empireMods(s, me), 'output.research');
    const roster0 = rosterLimit(s, me);
    for (let round = 0; round < 400 && capLevel(me, 'citadel') < 30; round++) {
      rich(me);
      if (execute(s, me.id, { type: 'capitalBuild', building: 'citadel' }).ok) { finish(s); continue; }
      // otherwise grow the lowest building that can grow
      const ids = Object.keys(CAPITAL_BY_ID).filter((id) => id !== 'citadel').sort((a, b) => capLevel(me, a) - capLevel(me, b));
      let built = false;
      for (const id of ids) {
        const plot = me.capital!.buildings[id] ? undefined : openPlots(me).find((p) => !plotOccupant(me.capital!, p));
        if (execute(s, me.id, { type: 'capitalBuild', building: id, plot }).ok) { built = true; break; }
      }
      finish(s);
      if (!built) break;
    }
    expect(capLevel(me, 'citadel')).toBe(30);
    expect(mod(empireMods(s, me), 'output.research')).toBeGreaterThan(base);
    expect(rosterLimit(s, me)).toBeGreaterThan(roster0);
  });

  it('cancelling refunds 75% and a captured capital is sacked', () => {
    const s = newGame({ seed: 35 });
    const me = s.empires[s.playerId];
    rich(me);
    const c0 = me.stock.credits;
    execute(s, me.id, { type: 'capitalBuild', building: 'treasury', plot: openPlots(me)[1] });
    expect(execute(s, me.id, { type: 'capitalCancel', index: 0 }).ok).toBe(true);
    expect(c0 - me.stock.credits).toBe(Math.ceil(CAPITAL_BY_ID.treasury.cost.credits * 0.25));
    expect(execute(s, me.id, { type: 'capitalCancel', index: 0 }).ok).toBe(false);
    execute(s, me.id, { type: 'capitalBuild', building: 'citadel' });
    finish(s);
    execute(s, me.id, { type: 'capitalBuild', building: 'treasury', plot: openPlots(me)[1] });
    finish(s);
    sackCapital(s, me, 'Raiders');
    expect(capLevel(me, 'citadel')).toBe(1);
    expect(capLevel(me, 'treasury')).toBe(0);
  });

  it('AI realms build up their capitals, and saves round-trip', () => {
    const s = newGame({ seed: 36 });
    runDays(s, 360 * 4);
    const ai = s.empires.filter((e) => e.kind === 'major' && e.alive && !e.isPlayer);
    const levels = ai.map((e) => Object.values(e.capital!.buildings).reduce((a, b) => a + b.level, 0));
    expect(Math.max(...levels)).toBeGreaterThan(4);
    const b = deserialize(serialize(s));
    expect(fingerprint(b)).toBe(fingerprint(s));
  });

  it('older saves gain a capital on load', () => {
    const s = deserialize(gunzipSync(readFileSync('tests/fixtures/save-v1-small.json.gz')).toString('utf8'));
    for (const e of s.empires.filter((x) => x.kind === 'major' || x.kind === 'minor')) expect(capLevel(e, 'citadel')).toBe(1);
    runDays(s, 60);
  });
});
