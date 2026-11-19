import { describe, expect, it } from 'vitest';
import { newGame, runDays } from '../src/sim/engine';
import { execute } from '../src/sim/commands';
import { serialize, deserialize, fingerprint } from '../src/sim/save';
import { createCharacter } from '../src/sim/characters';
import { espionageTick, networkBonus, COVERT } from '../src/sim/espionage';
import { intelLevel } from '../src/sim/diplomacy';
import type { GameState } from '../src/sim/types';

function setup(seed: number) {
  const s = newGame({ seed });
  const me = s.empires[s.playerId];
  Object.assign(me.stock, { credits: 5000, influence: 500 });
  const rival = s.empires.find((e) => e.kind === 'major' && e.id !== me.id)!;
  const spy = createCharacter(s, me.id, 'spymaster', { level: 8 });
  spy.attrs.cunning = 40; // a master: success is all but certain
  return { s, me, rival, spy };
}
const finish = (s: GameState, days: number) => espionageTick(s, days);

describe('espionage', () => {
  it('validates agent, target, planet and cost', () => {
    const { s, me, rival, spy } = setup(81);
    const sci = createCharacter(s, me.id, 'scientist', {});
    expect(execute(s, me.id, { type: 'launchCovert', targetId: rival.id, kind: 'gather_intel', agentId: sci.id, planetId: null }).ok).toBe(false);
    expect(execute(s, me.id, { type: 'launchCovert', targetId: me.id, kind: 'gather_intel', agentId: spy.id, planetId: null }).ok).toBe(false);
    expect(execute(s, me.id, { type: 'launchCovert', targetId: rival.id, kind: 'sabotage', agentId: spy.id, planetId: me.capitalPlanetId }).ok).toBe(false);
    const credits = me.stock.credits;
    expect(execute(s, me.id, { type: 'launchCovert', targetId: rival.id, kind: 'gather_intel', agentId: spy.id, planetId: null }).ok).toBe(true);
    expect(me.stock.credits).toBe(credits - COVERT.gather_intel.cost.credits);
    // one operation per agent
    expect(execute(s, me.id, { type: 'launchCovert', targetId: rival.id, kind: 'steal_tech', agentId: spy.id, planetId: null }).ok).toBe(false);
  });

  it('a successful network raises intel; sabotage and unrest hit the target world', () => {
    const { s, me, rival, spy } = setup(82);
    const before = intelLevel(s, me.id, rival.id);
    execute(s, me.id, { type: 'launchCovert', targetId: rival.id, kind: 'gather_intel', agentId: spy.id, planetId: null });
    finish(s, 60);
    expect(networkBonus(s, me.id, rival.id)).toBe(30);
    expect(intelLevel(s, me.id, rival.id)).toBeGreaterThan(before);
    const world = s.planets[rival.capitalPlanetId!];
    world.colony!.stability = 60;
    execute(s, me.id, { type: 'launchCovert', targetId: rival.id, kind: 'incite_unrest', agentId: spy.id, planetId: world.id });
    finish(s, 90);
    expect(world.colony!.stability).toBe(35);
    world.colony!.buildings.refinery = 2;
    execute(s, me.id, { type: 'launchCovert', targetId: rival.id, kind: 'sabotage', agentId: spy.id, planetId: world.id });
    finish(s, 120);
    expect(world.colony!.buildings.refinery ?? 0).toBeLessThan(2);
  });

  it('stealing technology advances research towards what the rival knows', () => {
    const { s, me, rival, spy } = setup(83);
    rival.research.done.push(...['ind_automated_mining'].filter((t) => !rival.research.done.includes(t)));
    me.research.done = me.research.done.filter((t) => t !== 'ind_automated_mining');
    me.research.current = null; me.research.progress = 0;
    expect(execute(s, me.id, { type: 'launchCovert', targetId: rival.id, kind: 'steal_tech', agentId: spy.id, planetId: null }).ok).toBe(true);
    finish(s, 150);
    expect(me.research.progress).toBeGreaterThan(0);
  });

  it('a hopeless agent is caught; the victim remembers; AI spymasters operate; saves round-trip', () => {
    const { s, me, rival, spy } = setup(84);
    spy.attrs.cunning = -60; spy.level = 1; // certain failure
    let caught = false;
    for (let i = 0; i < 12 && !caught; i++) {
      if (spy.status !== 'active') break;
      execute(s, me.id, { type: 'launchCovert', targetId: rival.id, kind: 'gather_intel', agentId: spy.id, planetId: null });
      finish(s, 60);
      caught = (spy.status as string) === 'captive';
    }
    expect(caught).toBe(true);
    expect(spy.captorId).toBe(rival.id);
    expect(Object.values(s.opinions).flat().some((m) => m.label === 'Caught spying on us')).toBe(true);
    const g = newGame({ seed: 85 });
    for (const e of g.empires.filter((x) => x.kind === 'major' && !x.isPlayer)) { createCharacter(g, e.id, 'spymaster', { level: 3 }); e.stock.credits = 2000; }
    runDays(g, 360 * 2);
    const launched = (g.covert ?? []).length + g.characters.filter((c) => c.role === 'spymaster' && c.bio.some((b) => /against the/.test(b.text))).length;
    expect(launched).toBeGreaterThan(0);
    const b = deserialize(serialize(g));
    expect(fingerprint(b)).toBe(fingerprint(g));
  });
});
