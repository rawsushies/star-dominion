import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { newGame, runDays, getLedger } from '../src/sim/engine';
import { deserialize, serialize, fingerprint } from '../src/sim/save';
import { execute } from '../src/sim/commands';
import { empireMods, mod } from '../src/sim/modifiers';
import { createCharacter } from '../src/sim/characters';
import { decreeStrength, governanceMonthly, defaultOption, inRevolt } from '../src/sim/governance';
import { DECREE_BY_ID, PETITIONS } from '../src/sim/data/governance';
import type { GameState } from '../src/sim/types';

const majors = (s: GameState) => s.empires.filter((e) => e.kind === 'major');

describe('governance', () => {
  it('every sovereign realm is founded with great houses', () => {
    const s = newGame({ seed: 21 });
    for (const e of s.empires.filter((x) => x.kind === 'major' || x.kind === 'minor')) {
      expect(e.houses!.length).toBe(e.kind === 'major' ? 3 : 2);
      expect(e.decrees).toEqual([]);
      for (const h of e.houses!) expect(h.provinces.length).toBe(1);
    }
    expect(s.empires.find((e) => e.kind === 'raiders')!.houses).toBeUndefined();
  });

  it('decrees are validated, cost influence, apply scaled modifiers, then lapse with a cooldown', () => {
    const s = newGame({ seed: 22 });
    const me = s.empires[s.playerId];
    me.stock.influence = 0;
    expect(execute(s, me.id, { type: 'issueDecree', decree: 'research_grant' }).ok).toBe(false);
    me.stock.influence = 500; me.stock.credits = 5000;
    expect(execute(s, me.id, { type: 'issueDecree', decree: 'war_footing' }).ok).toBe(false); // not at war
    expect(execute(s, me.id, { type: 'issueDecree', decree: 'nonsense' }).ok).toBe(false);
    const before = mod(empireMods(s, me), 'output.research');
    expect(execute(s, me.id, { type: 'issueDecree', decree: 'research_grant' }).ok).toBe(true);
    expect(me.stock.influence).toBe(470);
    const gain = mod(empireMods(s, me), 'output.research') - before;
    const str = me.decrees![0].strength;
    expect(str).toBeCloseTo(decreeStrength(s, me, DECREE_BY_ID.research_grant));
    expect(gain).toBeCloseTo(0.15 * str);
    expect(str).toBeGreaterThan(1); // the founding archscholar presides
    // a vacant seat weakens the decree
    me.council!.archscholar = null;
    expect(decreeStrength(s, me, DECREE_BY_ID.research_grant)).toBe(0.8);
    // duplicates and the cap
    expect(execute(s, me.id, { type: 'issueDecree', decree: 'research_grant' }).ok).toBe(false);
    expect(execute(s, me.id, { type: 'issueDecree', decree: 'festival' }).ok).toBe(true);
    expect(execute(s, me.id, { type: 'issueDecree', decree: 'census' }).ok).toBe(true);
    expect(execute(s, me.id, { type: 'issueDecree', decree: 'trade_charter' }).ok).toBe(false);
    // lapse
    runDays(s, 400);
    expect(me.decrees!.some((d) => d.id === 'research_grant')).toBe(false);
    expect(me.decreeCooldowns!.research_grant).toBeGreaterThan(s.tick);
    expect(execute(s, me.id, { type: 'issueDecree', decree: 'research_grant' }).ok).toBe(false);
  });

  it('a levy angers houses that want low taxes', () => {
    const s = newGame({ seed: 23 });
    const me = s.empires[s.playerId];
    me.stock.influence = 500;
    me.houses![0].ambition = 'low_taxes';
    const l0 = me.houses![0].loyalty;
    execute(s, me.id, { type: 'issueDecree', decree: 'tax_levy' });
    expect(me.houses![0].loyalty).toBe(l0 - 20);
  });

  it('house loyalty feeds stability; aggrieved houses revolt; suppression and grants work', () => {
    const s = newGame({ seed: 24 });
    const me = s.empires[s.playerId];
    const h = me.houses![0];
    h.power = 80;
    h.loyalty = 90;
    const high = getLedger(s, me);
    void high;
    const stabHigh = mod(empireMods(s, me), 'stability');
    h.loyalty = 10;
    const stabLow = mod(empireMods(s, me), 'stability');
    expect(stabHigh - stabLow).toBeCloseTo((80 / 50) * 0.8 * 6, 3);
    // force a revolt
    h.ambition = 'war'; // unmet at peace
    for (let i = 0; i < 200 && !inRevolt(s, h); i++) { h.loyalty = 5; s.tick += 30; governanceMonthly(s); }
    expect(inRevolt(s, h)).toBe(true);
    const revoltStab = mod(empireMods(s, me), 'stability');
    expect(revoltStab).toBeLessThan(stabLow);
    me.stock.influence = 500;
    // suppression needs warships at the capital
    const atCap = Object.values(s.fleets).filter((f) => f.ownerId === me.id && f.systemId === me.capitalSystemId).reduce((a, f) => a + f.ships.length, 0);
    const pw = h.power;
    const r = execute(s, me.id, { type: 'houseAction', houseId: h.id, action: 'suppress' });
    expect(r.ok).toBe(atCap >= 3);
    if (r.ok) { expect(inRevolt(s, h)).toBe(false); expect(h.power).toBe(pw - 25); }
    const l = me.houses![1].loyalty;
    expect(execute(s, me.id, { type: 'houseAction', houseId: me.houses![1].id, action: 'grant' }).ok).toBe(true);
    expect(me.houses![1].loyalty).toBe(Math.min(100, l + 15));
  });

  it('petitions arise, can be answered, and lapse to a free default', () => {
    const s = newGame({ seed: 25 });
    const me = s.empires[s.playerId];
    for (let i = 0; i < 40 && !(me.petitions!.length); i++) { s.tick += 30; governanceMonthly(s); }
    expect(me.petitions!.length).toBeGreaterThan(0);
    const p = me.petitions![0];
    me.stock.credits = 5000; me.stock.influence = 500; me.stock.minerals = 5000; me.stock.energy = 5000; me.stock.alloys = 5000;
    expect(execute(s, me.id, { type: 'resolvePetition', petitionId: p.id, option: 99 }).ok).toBe(false);
    expect(execute(s, me.id, { type: 'resolvePetition', petitionId: p.id, option: 0 }).ok).toBe(true);
    expect(me.petitions!.find((x) => x.id === p.id)).toBeUndefined();
    for (const d of PETITIONS) expect(d.options[defaultOption(d.id)].cost).toBeUndefined();
    // lapse
    for (let i = 0; i < 40 && !(me.petitions!.length); i++) { s.tick += 30; governanceMonthly(s); }
    const q = me.petitions![0];
    s.tick = q.expires; governanceMonthly(s);
    expect(me.petitions!.find((x) => x.id === q.id)).toBeUndefined();
  });

  it('governors add administrative capacity', () => {
    const s = newGame({ seed: 26 });
    const me = s.empires[s.playerId];
    const cap0 = getLedger(s, me).adminCap;
    const gov = createCharacter(s, me.id, 'governor', { level: 4 });
    gov.skills.gov_admin = 2;
    expect(execute(s, me.id, { type: 'assignCharacter', charId: gov.id, assignment: { kind: 'province', sectorId: s.galaxy.systems[me.capitalSystemId!].sector! } }).ok).toBe(true);
    expect(getLedger(s, me, true).adminCap).toBe(cap0 + 3);
  });

  it('AI realms govern over years and the state survives save and load', () => {
    const s = newGame({ seed: 27 });
    runDays(s, 360 * 4);
    const ai = majors(s).filter((e) => e.alive && !e.isPlayer);
    expect(ai.some((e) => (e.decrees?.length ?? 0) > 0 || Object.keys(e.decreeCooldowns ?? {}).length > 0)).toBe(true);
    for (const e of ai) expect(e.petitions!.length).toBeLessThanOrEqual(3);
    const b = deserialize(serialize(s));
    expect(fingerprint(b)).toBe(fingerprint(s));
    runDays(s, 200); runDays(b, 200);
    expect(fingerprint(b)).toBe(fingerprint(s));
  });

  it('older saves gain houses and governance fields on load', () => {
    const raw = gunzipSync(readFileSync('tests/fixtures/save-v1-small.json.gz')).toString('utf8');
    const s = deserialize(raw);
    for (const e of s.empires.filter((x) => x.alive && (x.kind === 'major' || x.kind === 'minor'))) {
      expect(e.houses!.length).toBeGreaterThan(0);
      expect(Array.isArray(e.decrees)).toBe(true);
      expect(Array.isArray(e.petitions)).toBe(true);
    }
    runDays(s, 90);
  });
});
