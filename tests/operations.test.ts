import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { newGame, runDays, getLedger } from '../src/sim/engine';
import { deserialize, serialize, fingerprint } from '../src/sim/save';
import { execute } from '../src/sim/commands';
import { empireMods } from '../src/sim/modifiers';
import { supplyNetwork } from '../src/sim/territory';
import { createFleet } from '../src/sim/fleets';
import { createCharacter } from '../src/sim/characters';
import { opReport, operationsMonthly, logisticsCapacity, opsOf } from '../src/sim/operations';
import type { GameState, Planet } from '../src/sim/types';

const rich = (s: GameState) => Object.assign(s.empires[s.playerId].stock, { minerals: 1e5, credits: 1e5, alloys: 1e5, energy: 1e5 });

/** An uncolonised, non-gas body in a system the player owns (made owned if needed). */
function site(s: GameState, gas = false): Planet {
  const me = s.empires[s.playerId];
  let p = s.planets.find((x) => !x.colony && (gas ? x.type === 'gas_giant' : x.type !== 'gas_giant') && s.galaxy.systems[x.systemId].owner === me.id);
  if (!p) {
    p = s.planets.find((x) => !x.colony && (gas ? x.type === 'gas_giant' : x.type !== 'gas_giant') && x.systemId === me.capitalSystemId)
      ?? s.planets.find((x) => !x.colony && (gas ? x.type === 'gas_giant' : x.type !== 'gas_giant'))!;
    s.galaxy.systems[p.systemId].owner = me.id;
  }
  p.station = null; delete p.op;
  return p;
}
const report = (s: GameState, p: Planet, eff = 1) => { const e = s.empires[s.playerId]; return opReport(s, e, p, empireMods(s, e), { network: supplyNetwork(s, e.id), logisticsEff: eff }); };
const total = (r: ReturnType<typeof report>) => r.output.reduce((a, [, v]) => a + v, 0);

describe('resource operations', () => {
  it('founding validates the site, creates an operation and feeds the ordinary ledger', () => {
    const s = newGame({ seed: 41 });
    rich(s);
    const me = s.empires[s.playerId];
    const p = site(s);
    expect(execute(s, me.id, { type: 'buildStation', planetId: p.id, kind: 'gas' }).ok).toBe(false);
    expect(execute(s, me.id, { type: 'buildStation', planetId: p.id, kind: 'mining' }).ok).toBe(true);
    expect(p.op).toMatchObject({ level: 1, mode: 'standard', reserve: 1 });
    expect(execute(s, me.id, { type: 'buildStation', planetId: p.id, kind: 'energy' }).ok).toBe(false);
    const L = getLedger(s, me, true);
    expect(L.lines.some((l) => l.label === 'Mining operations' && l.key === 'minerals' && l.amount > 0)).toBe(true);
    expect(L.lines.some((l) => l.label === 'Operation upkeep' && l.amount < 0)).toBe(true);
    expect(L.logisticsUsed).toBe(1);
    // another realm cannot touch it
    const other = s.empires.find((e) => e.kind === 'major' && e.id !== me.id)!;
    expect(execute(s, other.id, { type: 'setOperationMode', planetId: p.id, mode: 'halted' }).ok).toBe(false);
  });

  it('gas giants take gas harvesters', () => {
    const s = newGame({ seed: 42 });
    rich(s);
    const g = site(s, true);
    expect(execute(s, s.playerId, { type: 'buildStation', planetId: g.id, kind: 'mining' }).ok).toBe(false);
    expect(execute(s, s.playerId, { type: 'buildStation', planetId: g.id, kind: 'gas' }).ok).toBe(true);
    expect(report(s, g).output.map(([k]) => k).sort()).toEqual(['energy', 'rare']);
  });

  it('levels and modes scale output; surge drains the reserve, rest restores it', () => {
    const s = newGame({ seed: 43 });
    rich(s);
    const p = site(s);
    execute(s, s.playerId, { type: 'buildStation', planetId: p.id, kind: 'mining' });
    const base = total(report(s, p));
    expect(execute(s, s.playerId, { type: 'upgradeOperation', planetId: p.id }).ok).toBe(true);
    expect(total(report(s, p))).toBeCloseTo(base * 1.6, 5);
    execute(s, s.playerId, { type: 'setOperationMode', planetId: p.id, mode: 'surge' });
    expect(total(report(s, p))).toBeCloseTo(base * 1.6 * 1.6, 5);
    for (let i = 0; i < 24; i++) operationsMonthly(s);
    expect(p.op!.reserve).toBeLessThan(0.5);
    const depleted = total(report(s, p));
    expect(depleted).toBeLessThan(base * 1.6 * 1.6 * 0.7);
    execute(s, s.playerId, { type: 'setOperationMode', planetId: p.id, mode: 'halted' });
    expect(total(report(s, p))).toBe(0);
    expect(report(s, p).upkeep).toEqual([]);
    const r0 = p.op!.reserve;
    for (let i = 0; i < 12; i++) operationsMonthly(s);
    expect(p.op!.reserve).toBeGreaterThan(r0);
    // max level
    p.op!.level = 5;
    expect(execute(s, s.playerId, { type: 'upgradeOperation', planetId: p.id }).ok).toBe(false);
  });

  it('logistics: overstretch, broken supply and blockade cut deliveries; tenders add capacity', () => {
    const s = newGame({ seed: 44 });
    rich(s);
    const me = s.empires[s.playerId];
    const p = site(s);
    execute(s, me.id, { type: 'buildStation', planetId: p.id, kind: 'mining' });
    const full = total(report(s, p));
    expect(total(report(s, p, 0.5))).toBeCloseTo(full * 0.5, 5);
    const cap0 = logisticsCapacity(s, me, empireMods(s, me));
    createFleet(s, me.id, me.capitalSystemId!, ['logistics']);
    expect(logisticsCapacity(s, me, empireMods(s, me))).toBe(cap0 + 3);
    // outside the supply network
    const e = me;
    const cut = opReport(s, e, p, empireMods(s, e), { network: new Set(), logisticsEff: 1 });
    expect(cut.status).toBe('cut off');
    expect(total(cut)).toBeCloseTo(full * 0.5, 5);
    // a hostile warfleet in the system
    const raiders = s.empires.find((x) => x.kind === 'raiders')!;
    createFleet(s, raiders.id, p.systemId, ['corvette', 'corvette']);
    const b = report(s, p);
    expect(b.status).toBe('blockaded');
    expect(total(b)).toBe(0);
  });

  it('an industrialist can direct an operation and raises its output', () => {
    const s = newGame({ seed: 45 });
    rich(s);
    const p = site(s);
    execute(s, s.playerId, { type: 'buildStation', planetId: p.id, kind: 'mining' });
    const before = total(report(s, p));
    const ind = createCharacter(s, s.playerId, 'industrialist', { level: 5 });
    expect(execute(s, s.playerId, { type: 'assignCharacter', charId: ind.id, assignment: { kind: 'planet', planetId: p.id } }).ok).toBe(true);
    expect(total(report(s, p))).toBeGreaterThan(before);
    // dismantling frees the site and the industrialist's post lapses next month
    expect(execute(s, s.playerId, { type: 'dismantleOperation', planetId: p.id }).ok).toBe(true);
    expect(p.station).toBeNull();
    runDays(s, 31);
    expect(ind.assignment).toBeNull();
  });

  it('old saves give existing stations a default operation, and AI realms run operations', () => {
    const raw = JSON.parse(gunzipSync(readFileSync('tests/fixtures/save-v1-small.json.gz')).toString('utf8'));
    const st = raw.planets.find((p: Planet) => !p.colony) as Planet;
    st.station = 'mining';
    delete st.op;
    const s = deserialize(JSON.stringify(raw));
    expect(s.planets.find((p) => p.id === st.id)!.op).toMatchObject({ level: 1, mode: 'standard' });

    const g = newGame({ seed: 46 });
    runDays(g, 360 * 4);
    const ai = g.empires.filter((e) => e.kind === 'major' && e.alive && !e.isPlayer);
    const all = ai.flatMap((e) => opsOf(g, e.id));
    expect(all.length).toBeGreaterThan(0);
    for (const e of ai) { const L = getLedger(g, e, true); expect(L.logisticsUsed).toBeLessThanOrEqual(L.logisticsCap + 1); }
    const b = deserialize(serialize(g));
    expect(fingerprint(b)).toBe(fingerprint(g));
  });
});
