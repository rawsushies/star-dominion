import { describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/engine';
import { execute } from '../src/sim/commands';
import { declareWar } from '../src/sim/diplomacy';
import { planOf } from '../src/sim/strategy';
import { sendLetter } from '../src/sim/envoys';
import type { GameState } from '../src/sim/types';

const rivals = (g: GameState) => g.empires.filter((e) => e.kind === 'major' && !e.isPlayer && e.alive);

describe('rivals that behave like players', () => {
  it('write to the player in their own voice, without repeating themselves', () => {
    const g = newGame({ seed: 61, galaxySize: 'small', aiCount: 2 });
    const [a] = rivals(g);
    a.personality.aggression = 0.9;
    expect(sendLetter(g, a, 'greeting', undefined, 1e9)).toBe(true);
    expect(sendLetter(g, a, 'greeting', undefined, 1e9)).toBe(false);
    const ev = g.events.filter((e) => e.kind === 'envoy');
    expect(ev).toHaveLength(1);
    expect(ev[0].text).toContain(a.name);
    expect(ev[0].text).not.toMatch(/\{|undefined/);
  });

  it('a refused ultimatum is remembered and the realm arms against the player', () => {
    const g = newGame({ seed: 62, galaxySize: 'small', aiCount: 2 });
    const [a] = rivals(g);
    g.proposals.push({ id: 999, from: a.id, to: g.playerId, give: [], receive: [{ kind: 'credits', amount: 200 }], tick: g.tick, kind: 'deal', demand: true });
    const before = JSON.stringify(g.opinions[`${a.id}>${g.playerId}`] ?? []);
    expect(execute(g, g.playerId, { type: 'respondProposal', id: 999, accept: false }).ok).toBe(true);
    expect(JSON.stringify(g.opinions[`${a.id}>${g.playerId}`])).not.toBe(before);
    expect(planOf(a)).toMatchObject({ goal: 'arm', target: g.playerId });
    expect(g.events.some((e) => e.kind === 'envoy' && e.title.includes(a.ruler))).toBe(true);
  });

  it('a call to arms the player accepts pays them and puts them in the war', () => {
    const g = newGame({ seed: 63, galaxySize: 'small', aiCount: 3 });
    const [a, b] = rivals(g);
    a.stock.influence = 200;
    const w = declareWar(g, a.id, b.id)!;
    g.proposals.push({ id: 998, from: a.id, to: g.playerId, give: [{ kind: 'credits', amount: 120 }], receive: [], tick: g.tick, kind: 'deal', joinWar: w.id });
    const credits = g.empires[g.playerId].stock.credits;
    expect(execute(g, g.playerId, { type: 'respondProposal', id: 998, accept: true }).ok).toBe(true);
    expect(w.attackers).toContain(g.playerId);
    expect(g.empires[g.playerId].stock.credits).toBe(credits + 120);
  });
});
