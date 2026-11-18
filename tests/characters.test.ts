import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { newGame, runDays, getLedger } from '../src/sim/engine';
import { deserialize, serialize } from '../src/sim/save';
import { execute } from '../src/sim/commands';
import { empireMods, mod } from '../src/sim/modifiers';
import { createFleet } from '../src/sim/fleets';
import {
  charactersOf, createCharacter, leaderOfLostFleet, fleetLeaderBonus, governorBonus, effectiveness, rosterLimit,
} from '../src/sim/characters';
import { declareWar, makePeace } from '../src/sim/diplomacy';
import type { GameState } from '../src/sim/types';

const majors = (s: GameState) => s.empires.filter((e) => e.kind === 'major');

describe('characters', () => {
  it('every major realm starts with an admiral, a scientist and a chancellor in post', () => {
    const s = newGame({ seed: 11 });
    for (const e of majors(s)) {
      const cs = charactersOf(s, e.id);
      expect(cs.some((c) => c.role === 'admiral' && c.assignment?.kind === 'fleet')).toBe(true);
      expect(e.council!.archscholar).not.toBeNull();
      expect(e.council!.chancellor).not.toBeNull();
      expect(s.characters.filter((c) => c.ownerId === e.id && c.status === 'candidate').length).toBeGreaterThan(0);
    }
  });

  it('migrates legacy admirals from the v1 save into characters', () => {
    const raw = JSON.parse(gunzipSync(readFileSync('tests/fixtures/save-v1-small.json.gz')).toString('utf8'));
    expect(Array.isArray(raw.admirals)).toBe(true);
    const s = deserialize(JSON.stringify(raw));
    expect((s as unknown as { admirals?: unknown }).admirals).toBeUndefined();
    const legacy = raw.admirals as { id: number; alive: boolean; fleetId: number | null }[];
    for (const a of legacy) {
      const c = s.characters.find((x) => x.id === a.id)!;
      expect(c.role).toBe('admiral');
      expect(c.status).toBe(a.alive ? 'active' : 'dead');
    }
    for (const e of s.empires) { expect(e.council).toBeDefined(); expect(e.armory).toBeDefined(); }
    runDays(s, 60);
    expect(deserialize(serialize(s)).characters.length).toBe(s.characters.length);
  });

  it('recruits, assigns, trains and dismisses through validated commands', () => {
    const s = newGame({ seed: 12 });
    const me = s.empires[s.playerId];
    me.stock.credits = 5000; me.stock.influence = 500;
    const cand = s.characters.find((c) => c.ownerId === me.id && c.status === 'candidate')!;
    expect(execute(s, me.id, { type: 'recruitCharacter', charId: cand.id }).ok).toBe(true);
    expect(cand.status).toBe('active');
    // a second recruit of the same person fails
    expect(execute(s, me.id, { type: 'recruitCharacter', charId: cand.id }).ok).toBe(false);
    // invalid post is refused
    const gov = createCharacter(s, me.id, 'governor', { level: 5 });
    expect(execute(s, me.id, { type: 'assignCharacter', charId: gov.id, assignment: { kind: 'council', seat: 'archscholar' } }).ok).toBe(false);
    const sector = s.galaxy.systems[me.capitalSystemId!].sector!;
    expect(execute(s, me.id, { type: 'assignCharacter', charId: gov.id, assignment: { kind: 'province', sectorId: sector } }).ok).toBe(true);
    expect(governorBonus(s, me.id, sector).output).toBeGreaterThan(0);
    // skills
    expect(gov.skillPoints).toBe(4);
    const r = execute(s, me.id, { type: 'learnSkill', charId: gov.id, skill: 'adm_gunnery' });
    expect(r.ok).toBe(false);
    const govSkill = 'gov_admin';
    expect(execute(s, me.id, { type: 'learnSkill', charId: gov.id, skill: govSkill }).ok).toBe(true);
    expect(gov.skillPoints).toBe(3);
    // another realm cannot command my people
    const other = majors(s).find((e) => e.id !== me.id)!;
    expect(execute(s, other.id, { type: 'dismissCharacter', charId: gov.id }).ok).toBe(false);
    expect(execute(s, me.id, { type: 'dismissCharacter', charId: gov.id }).ok).toBe(true);
    expect(gov.assignment).toBeNull();
  });

  it('enforces the roster limit', () => {
    const s = newGame({ seed: 13 });
    const me = s.empires[s.playerId];
    me.stock.credits = 1e6; me.stock.influence = 1e5;
    while (charactersOf(s, me.id).length < rosterLimit(s, me)) createCharacter(s, me.id, 'scientist');
    const cand = createCharacter(s, me.id, 'admiral', { status: 'candidate' });
    const r = execute(s, me.id, { type: 'recruitCharacter', charId: cand.id });
    expect(r.ok).toBe(false);
  });

  it('council seats feed empire modifiers and leaders feed fleet stats', () => {
    const s = newGame({ seed: 14 });
    const me = s.empires[s.playerId];
    const before = mod(empireMods(s, me), 'navalCap');
    const adm = createCharacter(s, me.id, 'admiral', { level: 8 });
    expect(execute(s, me.id, { type: 'assignCharacter', charId: adm.id, assignment: { kind: 'council', seat: 'marshal' } }).ok).toBe(true);
    expect(mod(empireMods(s, me), 'navalCap')).toBeGreaterThan(before);
    // loyalty drives effectiveness, and the cache notices
    const k1 = mod(empireMods(s, me), 'navalCap');
    adm.loyalty = 0;
    expect(effectiveness(adm)).toBeCloseTo(0.6);
    expect(mod(empireMods(s, me), 'navalCap')).toBeLessThan(k1);
    const f = Object.values(s.fleets).find((x) => x.ownerId === me.id && x.admiralId != null)!;
    expect(fleetLeaderBonus(s, f).dmg).toBeGreaterThan(0);
  });

  it('salaries appear in the ledger', () => {
    const s = newGame({ seed: 15 });
    const L = getLedger(s, s.empires[s.playerId]);
    expect(L.lines.some((l) => l.label === 'Officer and court salaries' && l.amount < 0)).toBe(true);
  });

  it('captures a fleet leader, then pardon, ransom, recruit and peace exchange all work', () => {
    const s = newGame({ seed: 16 });
    const [a, b] = majors(s);
    a.stock.credits = 5000; a.stock.influence = 500; b.stock.credits = 5000;
    // force captures by rolling until each outcome is a capture
    const capture = () => {
      for (let tries = 0; tries < 200; tries++) {
        const f = createFleet(s, b.id, b.capitalSystemId!, ['corvette'], 'Doomed');
        const c = createCharacter(s, b.id, 'admiral');
        execute(s, b.id, { type: 'assignCharacter', charId: c.id, assignment: { kind: 'fleet', fleetId: f.id } });
        leaderOfLostFleet(s, f, a.id);
        if (c.status === 'captive') return c;
      }
      throw new Error('never captured');
    };
    const p1 = capture();
    expect(p1.captorId).toBe(a.id);
    expect(p1.traits).toContain('disgraced');
    expect(execute(s, a.id, { type: 'captive', charId: p1.id, action: 'pardon' }).ok).toBe(true);
    expect(p1.status).toBe('active');

    const p2 = capture();
    const credits = a.stock.credits;
    expect(execute(s, a.id, { type: 'captive', charId: p2.id, action: 'ransom' }).ok).toBe(true);
    expect(a.stock.credits).toBeGreaterThan(credits);
    expect(p2.ownerId).toBe(b.id);

    const p3 = capture();
    s.tick += 360 * 3; // long captivity makes them more willing
    let joined = false;
    for (let i = 0; i < 30 && !joined; i++) {
      a.stock.influence = 500;
      execute(s, a.id, { type: 'captive', charId: p3.id, action: 'recruit' });
      joined = p3.ownerId === a.id;
    }
    expect(joined).toBe(true);
    expect(p3.status).toBe('active');

    // at war, ransom is refused; peace sends prisoners home
    s.truces = [];
    declareWar(s, a.id, b.id);
    const p4 = capture();
    expect(execute(s, a.id, { type: 'captive', charId: p4.id, action: 'ransom' }).ok).toBe(false);
    const war = s.wars.find((w) => w.attackers.includes(a.id) || w.defenders.includes(a.id))!;
    makePeace(s, war, 'status_quo', 'attackers');
    expect(p4.status).toBe('active');
    expect(p4.ownerId).toBe(b.id);
  });

  it('AI realms keep their posts filled and characters gain experience over years', () => {
    const s = newGame({ seed: 17 });
    runDays(s, 360 * 3);
    for (const e of majors(s).filter((x) => x.alive && !x.isPlayer)) {
      const cs = charactersOf(s, e.id);
      expect(cs.length).toBeGreaterThanOrEqual(2);
      const seated = Object.values(e.council ?? {}).filter((v) => v != null).length;
      expect(seated).toBeGreaterThanOrEqual(2);
      expect(cs.some((c) => c.level > 1 || c.xp > 0)).toBe(true);
    }
    // nobody holds an impossible post
    for (const c of s.characters.filter((x) => x.status === 'active' && x.assignment?.kind === 'fleet')) {
      const a = c.assignment as { fleetId: number };
      expect(s.fleets[a.fleetId]?.ownerId).toBe(c.ownerId);
    }
  });
});
