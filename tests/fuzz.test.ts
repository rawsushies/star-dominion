// Robustness: a player pressing anything, in any order, with stale or nonsense targets, must never
// crash the game or corrupt the state. Random commands (ids drawn from the live state, some out of
// range) are issued every month while the simulation runs; invariants are checked each month.
// scripts/audit.ts runs the same thing much longer across galaxy sizes and difficulties.
import { describe, expect, it } from 'vitest';
import { newGame, step } from '../src/sim/engine';
import { execute } from '../src/sim/commands';
import { serialize, deserialize, fingerprint } from '../src/sim/save';
import { randomCommand, invariants, problems, seedFuzz } from './fixtures/fuzz';
import { declareWar, makePeace, reconcileDiplomacy, signTreaty } from '../src/sim/diplomacy';

describe('fuzzing the command layer', () => {
  it('random player commands for 4 years never throw and keep the state consistent', () => {
    problems.clear();
    seedFuzz(777);
    let g = newGame({ seed: 4242, galaxySize: 'small', aiCount: 3, difficulty: 'hard', prologue: true });
    const thrown: string[] = [];
    for (let m = 0; m < 48 && g.empires[g.playerId].alive; m++) {
      for (let k = 0; k < 30; k++) {
        const cmd = randomCommand(g);
        try {
          const r = execute(g, g.playerId, cmd);
          if (!r.ok) expect(r.message, `${cmd.type} failed without a message`).toBeTruthy();
        } catch (err) { thrown.push(`${cmd.type}: ${(err as Error).message} ${JSON.stringify(cmd)}`); }
      }
      for (let d = 0; d < 30; d++) { step(g); g.gameOver = null; }
      invariants(g, `month ${m}`);
      if (m % 24 === 23) {
        const back = deserialize(serialize(g));
        expect(fingerprint(back)).toBe(fingerprint(g));
        g = back;
      }
    }
    expect(thrown).toEqual([]);
    expect([...problems.entries()].map(([k, v]) => `${k}: ${v.first}`)).toEqual([]);
  }, 120_000);

  it('orders to systems that do not exist are refused, not crashes', () => {
    const g = newGame({ seed: 7, galaxySize: 'small', aiCount: 2 });
    const f = Object.values(g.fleets).find((x) => x.ownerId === g.playerId)!;
    for (const target of [-2, -1, 1e9, 0.5, NaN]) {
      expect(execute(g, g.playerId, { type: 'moveFleet', fleetId: f.id, target }).ok).toBe(false);
      expect(execute(g, g.playerId, { type: 'fleetOrder', fleetId: f.id, order: { type: 'patrol', a: target, b: f.systemId === 0 ? 1 : 0, leg: 0 } }).ok).toBe(false);
      expect(execute(g, g.playerId, { type: 'fleetOrder', fleetId: f.id, order: { type: 'blockade', systemId: target } }).ok).toBe(false);
    }
    for (let d = 0; d < 60; d++) step(g);
  });
});

describe('the diplomatic web stays consistent', () => {
  it('no realm can negotiate with itself', () => {
    const g = newGame({ seed: 9, galaxySize: 'small', aiCount: 2 });
    expect(execute(g, g.playerId, { type: 'propose', to: g.playerId, give: [], receive: [{ kind: 'treaty', treaty: 'alliance' }] }).ok).toBe(false);
    signTreaty(g, 1, 1, 'alliance');
    expect(g.treaties.some((t) => t.a === t.b)).toBe(false);
  });

  it('an ally of both sides stays out of the war instead of fighting its own ally', () => {
    const g = newGame({ seed: 11, galaxySize: 'small', aiCount: 3 });
    const [a, b, c] = [1, 2, 3];
    signTreaty(g, a, c, 'alliance');
    signTreaty(g, b, c, 'alliance');
    for (const id of [a, b, c]) g.empires[id].stock.influence = 500;
    g.truces = [];
    const war = declareWar(g, a, b)!;
    expect(war).toBeTruthy();
    expect(war.attackers).not.toContain(c);
    for (const t of g.treaties) expect(war.attackers.includes(t.a) && war.defenders.includes(t.b) || war.attackers.includes(t.b) && war.defenders.includes(t.a)).toBe(false);
  });

  it('a realm made vassal in one war leaves its other wars against the overlord', () => {
    const g = newGame({ seed: 12, galaxySize: 'small', aiCount: 3 });
    const [a, b, c] = [1, 2, 3];
    for (const id of [a, b, c]) g.empires[id].stock.influence = 500;
    g.truces = [];
    const w1 = { id: 991, attackers: [a], defenders: [b], startTick: 0, score: 80, name: 'First War' };
    const w2 = { id: 992, attackers: [c, b], defenders: [a], startTick: 0, score: 0, name: 'Second War' };
    g.wars.push(w1, w2);
    makePeace(g, w1, 'vassalize', 'attackers');
    expect(g.treaties.some((t) => t.type === 'vassal' && t.a === a && t.b === b)).toBe(true);
    expect(g.wars).toContain(w2);
    expect(w2.attackers).toEqual([c]);
    for (const w of g.wars) expect(w.attackers.includes(b) && w.defenders.includes(a)).toBe(false);
  });

  it('the monthly pass removes pacts across a battle line and offers to fallen realms', () => {
    const g = newGame({ seed: 13, galaxySize: 'small', aiCount: 3 });
    g.treaties.push({ type: 'trade', a: 1, b: 2, since: 0 }, { type: 'nap', a: 2, b: 2, since: 0 });
    g.wars.push({ id: 999, attackers: [1], defenders: [2], startTick: 0, score: 0, name: 'Test War' });
    g.empires[3].alive = false;
    g.proposals.push({ id: 998, from: 3, to: 1, give: [], receive: [], tick: g.tick, kind: 'deal' });
    reconcileDiplomacy(g);
    expect(g.treaties.filter((t) => (t.a === 1 && t.b === 2) || t.a === t.b)).toEqual([]);
    expect(g.proposals.some((p) => p.id === 998)).toBe(false);
  });
});
