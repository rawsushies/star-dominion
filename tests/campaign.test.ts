import { describe, expect, it } from 'vitest';
import { newGame, runDays, updateStats } from '../src/sim/engine';
import { deserialize, serialize, fingerprint } from '../src/sim/save';
import { execute } from '../src/sim/commands';
import { empireMods } from '../src/sim/modifiers';
import { AI_PRESETS, aiPreset, estimatePower, planOf } from '../src/sim/strategy';
import { victoryMonthly, victoryStatus, DOMINATION } from '../src/sim/victory';
import { ambitionsMonthly, AMBITIONS } from '../src/sim/ambitions';
import { raiseStage, chainsMonthly } from '../src/sim/chains';
import { signTreaty } from '../src/sim/diplomacy';
import { setSystemOwner } from '../src/sim/territory';
import type { GameState } from '../src/sim/types';

const rivals = (s: GameState) => s.empires.filter((e) => e.kind === 'major' && !e.isPlayer);

describe('difficulty', () => {
  it('never changes what an AI realm is given, only how it plays', () => {
    const mods = (d: GameState['settings']['difficulty']) => { const s = newGame({ seed: 5, difficulty: d }); return empireMods(s, rivals(s)[0]); };
    expect(mods('relaxed')).toEqual(mods('standard'));
    expect(mods('hard')).toEqual(mods('standard'));
  });

  it('presets differ in skill and the player-proxy realm always plays at standard', () => {
    expect(AI_PRESETS.hard.turnDays).toBeLessThan(AI_PRESETS.relaxed.turnDays);
    expect(AI_PRESETS.hard.warRatio).toBeLessThan(AI_PRESETS.relaxed.warRatio);
    expect(AI_PRESETS.relaxed.betrayal).toBe(false);
    const s = newGame({ seed: 5, difficulty: 'hard' });
    expect(aiPreset(s, s.empires[s.playerId])).toBe(AI_PRESETS.standard);
    expect(aiPreset(s, rivals(s)[0])).toBe(AI_PRESETS.hard);
  });

  it('rivals judge strength through intelligence: no contact, no estimate', () => {
    const s = newGame({ seed: 6 });
    const far = rivals(s).find((r) => estimatePower(s, s.playerId, r.id) == null);
    if (far) expect(estimatePower(s, s.playerId, far.id)).toBeNull();
    expect(estimatePower(s, s.playerId, s.playerId)).toBe(s.empires[s.playerId].stats.militaryPower || 1);
  });

  it('AI realms adopt plans that survive a save round-trip', () => {
    const s = newGame({ seed: 7, difficulty: 'hard' });
    runDays(s, 360 * 6);
    for (const r of rivals(s)) if (r.alive) expect(['expand', 'develop', 'arm', 'war', 'recover', 'ascend']).toContain(planOf(r).goal);
    const back = deserialize(serialize(s));
    expect(fingerprint(back)).toBe(fingerprint(s));
    runDays(s, 120); runDays(back, 120);
    expect(fingerprint(back)).toBe(fingerprint(s));
  }, 60000);
});

describe('victory', () => {
  it('supremacy: every rival fallen or a vassal', () => {
    const s = newGame({ seed: 8 });
    const me = s.empires[s.playerId];
    expect(victoryStatus(s, me).achieved).toBeNull();
    for (const r of rivals(s)) signTreaty(s, me.id, r.id, 'vassal');
    expect(victoryStatus(s, me).achieved).toBe('supremacy');
    victoryMonthly(s);
    expect(s.gameOver).toMatchObject({ won: true, kind: 'supremacy' });
  });

  it('domination must be held for two years, and a rival who achieves it ends the reign', () => {
    const s = newGame({ seed: 9 });
    const rival = rivals(s)[0];
    // hand the rival most of the galaxy and its people
    for (const sys of s.galaxy.systems) if (sys.owner == null) setSystemOwner(s, sys.id, rival.id);
    for (const p of s.planets) if (p.colony && p.colony.ownerId === rival.id) p.colony.pops = 400;
    updateStats(s);
    victoryMonthly(s);
    expect(rival.dominationSince).toBe(s.tick);
    expect(s.gameOver).toBeNull();
    s.tick += DOMINATION.holdMonths * 30;
    updateStats(s);
    victoryMonthly(s);
    expect(s.gameOver).toMatchObject({ won: false, kind: 'domination', winner: rival.id });
  });
});

describe('ambitions', () => {
  it('pay their reward once when met', () => {
    const s = newGame({ seed: 10 });
    const me = s.empires[s.playerId];
    const chart = AMBITIONS.find((a) => a.id === 'chart')!;
    me.explored = s.galaxy.systems.slice(0, 12).map((x) => x.id);
    const before = me.stock.influence;
    ambitionsMonthly(s);
    expect(me.ambitions).toContain('chart');
    const after = me.stock.influence;
    expect(after - before).toBeGreaterThanOrEqual(chart.reward.stock!.influence);
    ambitionsMonthly(s);
    expect(me.stock.influence).toBe(after);
  });
});

describe('event chains', () => {
  it('an answer schedules the next stage, which comes back before the council', () => {
    const s = newGame({ seed: 11 });
    const me = s.empires[s.playerId];
    me.stock.credits = 2000;
    raiseStage(s, me, 'guild_charter', null);
    const p = me.petitions!.find((x) => x.def === 'guild_charter')!;
    const credits = me.stock.credits;
    expect(execute(s, me.id, { type: 'resolvePetition', petitionId: p.id, option: 0 }).ok).toBe(true);
    expect(me.stock.credits).toBeGreaterThan(credits);
    expect(me.pendingChains).toEqual([{ def: 'guild_due', at: s.tick + 720, planetId: null }]);
    s.tick += 720;
    chainsMonthly(s);
    expect(me.petitions!.some((x) => x.def === 'guild_due')).toBe(true);
    expect(me.pendingChains).toEqual([]);
  });

  it('a stage about a world that has been lost is dropped', () => {
    const s = newGame({ seed: 12 });
    const me = s.empires[s.playerId];
    const other = s.planets.find((p) => p.colony && p.colony.ownerId !== me.id)!;
    raiseStage(s, me, 'separatists', other.id);
    expect(me.petitions!.some((x) => x.def === 'separatists')).toBe(false);
  });
});
