import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { newGame, runDays, step } from '../src/sim/engine';
import { execute } from '../src/sim/commands';
import { deserialize, fingerprint, serialize } from '../src/sim/save';
import { computeLedger } from '../src/sim/economy';
import { canBuildShip } from '../src/sim/construction';
import { createFleet, removeFleet } from '../src/sim/fleets';
import { addMemory, opinion } from '../src/sim/diplomacy';
import { friends, isHostile, warBetween } from '../src/sim/territory';
import { empireMods, mod } from '../src/sim/modifiers';
import { addPressure, awaken, precursorTick } from '../src/sim/ancients';
import { computeWeights, refreshSeats, aiLean, canVote } from '../src/sim/conclave';
import { devourerFleet, onSentinelsDefeated, sentinelSite } from '../src/sim/threats';
import { omegaFleets, resolve } from '../src/sim/omega';
import { embargoed, exp, injunctionBlocks, precursorById, reputation, systemCondition } from '../src/sim/expansion';
import { PRESSURE, SESSION_DAYS } from '../src/sim/data/expansion';
import type { GameState } from '../src/sim/types';

const majors = (g: GameState) => g.empires.filter((e) => e.kind === 'major' && e.alive);
const runMonths = (g: GameState, n: number) => runDays(g, n * 30);
/** advance to the next month boundary (monthly systems run when tick % 30 === 0) */
const toMonth = (g: GameState) => { do step(g); while (g.tick % 30 !== 0); };

function founded(seed = 101, aiCount = 4): GameState {
  const g = newGame({ seed, galaxySize: 'medium', aiCount });
  for (const e of majors(g)) e.era = Math.max(e.era, 1);
  g.tick = 360 * 3 - 1;
  toMonth(g);
  expect(g.expansion!.conclave.founded).not.toBeNull();
  for (const e of majors(g)) e.stock.influence = 500;
  return g;
}

describe('Grand Expansion: setup and saves', () => {
  it('places two ancient powers with enclaves, two cosmic realms and Sentinel charges, deterministically', () => {
    const a = newGame({ seed: 5, galaxySize: 'medium', aiCount: 4 });
    const b = newGame({ seed: 5, galaxySize: 'medium', aiCount: 4 });
    expect(fingerprint(a)).toBe(fingerprint(b));
    const x = a.expansion!;
    expect(x.precursors.map((p) => p.id)).toEqual(['veil', 'automata']);
    for (const p of x.precursors) {
      expect(p.status).toBe('dormant');
      const pe = a.empires[p.empireId];
      expect(pe.kind).toBe('precursor');
      expect(p.sacred.length).toBeGreaterThanOrEqual(2);
      for (const sid of p.sacred) expect(a.galaxy.systems[sid].owner).toBe(pe.id);
      expect(a.planets.some((pl) => pl.colony?.ownerId === pe.id)).toBe(true);
      // their enclaves are not next to a great realm's capital
      for (const m of majors(a)) expect(p.sacred).not.toContain(m.capitalSystemId);
    }
    expect(x.precursors[0].sacredWorlds.length).toBeGreaterThan(0);
    expect(a.empires.filter((e) => e.kind === 'cosmic')).toHaveLength(2);
    const lairs = a.galaxy.systems.filter((s) => s.features.includes('guardian'));
    expect(lairs.length).toBeGreaterThan(0);
    for (const s of lairs) expect(['gateway', 'relic_vault', 'shipyard', 'archive']).toContain(x.sentinels[s.id].kind);
    expect(x.devourer.spawnAt).toBeGreaterThanOrEqual(360 * 20);
    // cosmic realms are hostile to all and are never eliminated for lacking worlds
    const cosmic = a.empires.find((e) => e.kind === 'cosmic')!;
    expect(isHostile(a, cosmic.id, a.playerId)).toBe(true);
    runMonths(a, 2);
    expect(cosmic.alive).toBe(true);
  });

  it('a save from before the expansion loads with it in its starting state and keeps simulating', () => {
    const raw = JSON.parse(gunzipSync(readFileSync('tests/fixtures/save-v1-small.json.gz')).toString('utf8'));
    expect(raw.expansion).toBeUndefined();
    const s = deserialize(JSON.stringify(raw));
    expect(s.expansion).toBeDefined();
    expect(s.expansion!.conclave.founded).toBeNull();
    expect(s.expansion!.devourer.spawnAt).toBeGreaterThan(s.tick);
    // loading what was just migrated changes nothing (no default filled on the second load)
    expect(fingerprint(deserialize(serialize(s)))).toBe(fingerprint(s));
    runDays(s, 90);
    const again = deserialize(serialize(s));
    expect(fingerprint(again)).toBe(fingerprint(s));
  });

  it('a save made mid-expansion round-trips every new field', () => {
    const g = founded(7);
    const veil = precursorById(g, 'veil')!;
    addPressure(g, veil, 30, 'test', g.playerId);
    exp(g).reputation[g.playerId] = -12;
    exp(g).boons[g.playerId] = [{ key: 'shipSpeed', value: 0.1, label: 'test' }];
    const back = deserialize(serialize(g));
    expect(back.expansion).toEqual(g.expansion);
    expect(fingerprint(back)).toBe(fingerprint(g));
    // an expansion written by an earlier build without newer fields still loads
    const old = JSON.parse(serialize(g));
    delete old.expansion.precursors[0].tributeCooldown;
    delete old.expansion.omega.lattice;
    const migrated = deserialize(JSON.stringify(old));
    expect(migrated.expansion!.precursors[0].tributeCooldown).toEqual({});
    expect(migrated.expansion!.omega.lattice).toBe(0);
  });

  it('rejects a save whose expansion points at things that do not exist', () => {
    const g = newGame({ seed: 8, galaxySize: 'small', aiCount: 2 });
    const bad = JSON.parse(serialize(g));
    bad.expansion.omega.rift = 99999;
    expect(() => deserialize(JSON.stringify(bad))).toThrow(/rift/);
  });
});

describe('the Stagnant Ascendancies', () => {
  it('pressure builds from settling sacred worlds, is blamed on the settler, warns, and wakes the power', () => {
    const g = newGame({ seed: 21, galaxySize: 'medium', aiCount: 3 });
    const veil = precursorById(g, 'veil')!;
    const p = g.planets[veil.sacredWorlds[0]];
    p.colony = { ownerId: g.playerId, pops: 3, buildings: {}, queue: [], shipQueue: [], stability: 50, resistance: 0, originalOwnerId: null, foundedTick: 0, lowStabilityMonths: 0, defenseDamage: 0 };
    toMonth(g);
    expect(veil.pressure).toBeGreaterThan(1);
    expect(veil.blame[g.playerId]).toBeGreaterThan(0);
    veil.pressure = PRESSURE.stir;
    toMonth(g);
    expect(veil.status).toBe('stirring');
    expect(g.events.some((e) => e.title.includes('stir'))).toBe(true);
    veil.pressure = PRESSURE.awaken;
    toMonth(g);
    expect(veil.status).toBe('awakened');
    expect(warBetween(g, veil.empireId, g.playerId)).toBeTruthy();
    const hosts = Object.values(g.fleets).filter((f) => f.ownerId === veil.empireId && f.name.includes('Host'));
    expect(hosts).toHaveLength(2);
    // the rival power is roused
    expect(precursorById(g, 'automata')!.pressure).toBeGreaterThanOrEqual(19);
  });

  it('warships left in protected space bring a warning and then war', () => {
    const g = newGame({ seed: 22, galaxySize: 'medium', aiCount: 3 });
    const veil = precursorById(g, 'veil')!;
    const sid = veil.sacred[veil.sacred.length - 1];
    createFleet(g, g.playerId, sid, ['destroyer', 'destroyer'], 'Trespassers').stance = 'passive';
    toMonth(g);
    expect(veil.intrusion[g.playerId]).toBe(1);
    expect(g.events.some((e) => e.title.includes('leave our space') && e.empires.includes(g.playerId))).toBe(true);
    expect(warBetween(g, veil.empireId, g.playerId)).toBeFalsy();
    toMonth(g);
    expect(warBetween(g, veil.empireId, g.playerId)).toBeTruthy();
    // a lone scout is not an intrusion
    const h = newGame({ seed: 22, galaxySize: 'medium', aiCount: 3 });
    const v2 = precursorById(h, 'veil')!;
    createFleet(h, h.playerId, v2.sacred[0], ['scout']);
    toMonth(h); toMonth(h);
    expect(v2.intrusion[h.playerId]).toBeUndefined();
  });

  it('tribute calms a power and is validated; the ancients will not bargain through ordinary diplomacy', () => {
    const g = newGame({ seed: 23, galaxySize: 'medium', aiCount: 3 });
    const veil = precursorById(g, 'veil')!;
    const me = g.empires[g.playerId];
    addPressure(g, veil, 40, 'test', me.id);
    me.stock.rare = 0;
    expect(execute(g, me.id, { type: 'ancients', precursor: 'veil', action: 'tribute' }).ok).toBe(false);
    me.stock.rare = 1000; me.stock.influence = 500;
    const before = veil.pressure;
    expect(execute(g, me.id, { type: 'ancients', precursor: 'veil', action: 'tribute' }).ok).toBe(true);
    expect(veil.pressure).toBeLessThan(before);
    const r = execute(g, me.id, { type: 'propose', to: veil.empireId, give: [{ kind: 'credits', amount: 10 }], receive: [{ kind: 'treaty', treaty: 'nap' }] });
    expect(r.ok).toBe(false);
    expect(execute(g, me.id, { type: 'ancients', precursor: 'veil', action: 'pledge' }).ok).toBe(false); // no War in Heaven
  });

  it('Automata Prime demand technology tribute and punish a refusal', () => {
    const g = newGame({ seed: 24, galaxySize: 'medium', aiCount: 3 });
    const auto = precursorById(g, 'automata')!;
    const me = g.empires[g.playerId];
    me.era = 2;
    g.tick = 90 * 4 - 1;
    toMonth(g);
    expect(auto.demands[me.id]).toBeGreaterThan(g.tick);
    const due = auto.demands[me.id];
    g.tick = due - 1;
    toMonth(g);
    expect(auto.demands[me.id]).toBeUndefined();
    expect(auto.blame[me.id]).toBeGreaterThanOrEqual(6);
  });

  it('sponsorship needs favour, grants a Conclave seat and boons, and is revoked for broken terms', () => {
    const g = founded(25);
    const me = g.empires[g.playerId];
    const auto = precursorById(g, 'automata')!;
    expect(execute(g, me.id, { type: 'ancients', precursor: 'automata', action: 'sponsor' }).ok).toBe(false);
    addMemory(g, auto.empireId, me.id, 'test', 80, 0, 'Test favour');
    expect(opinion(g, auto.empireId, me.id)).toBeGreaterThanOrEqual(30);
    const admin0 = mod(empireMods(g, me), 'admin');
    expect(execute(g, me.id, { type: 'ancients', precursor: 'automata', action: 'sponsor' }).ok).toBe(true);
    expect(mod(empireMods(g, me), 'admin')).toBe(admin0 + 2);
    expect(computeLedger(g, me).lines.some((l) => l.label === 'Automata tithe')).toBe(true);
    refreshSeats(g);
    expect(['founder', 'great', 'sponsored']).toContain(exp(g).conclave.seats[me.id]);
    // forbidden machine intelligence breaks the terms twice: revoked
    me.research.done.push('ai_sentient');
    toMonth(g);
    expect(auto.sponsored[me.id].strikes).toBe(1);
    toMonth(g);
    expect(auto.sponsored[me.id]).toBeUndefined();
  });

  it('restricted knowledge: Automata Prime hand over a technology, then fall silent for years', () => {
    const g = newGame({ seed: 26, galaxySize: 'medium', aiCount: 3 });
    const me = g.empires[g.playerId];
    const auto = precursorById(g, 'automata')!;
    addMemory(g, auto.empireId, me.id, 'test', 60, 0, 'Test favour');
    me.stock.influence = 300;
    const n = me.research.done.length;
    expect(execute(g, me.id, { type: 'ancients', precursor: 'automata', action: 'knowledge' }).ok).toBe(true);
    expect(me.research.done.length).toBe(n + 1);
    expect(execute(g, me.id, { type: 'ancients', precursor: 'automata', action: 'knowledge' }).ok).toBe(false);
    // the Archons resent the consorting
    expect(precursorById(g, 'veil')!.blame[me.id]).toBeGreaterThan(0);
  });

  it('the War in Heaven: both powers awake and fight; realms pledge, band together or salvage', () => {
    const g = newGame({ seed: 27, galaxySize: 'medium', aiCount: 4 });
    const [veil, auto] = [precursorById(g, 'veil')!, precursorById(g, 'automata')!];
    const me = g.empires[g.playerId];
    awaken(g, veil);
    awaken(g, auto);
    const h = exp(g).heaven;
    expect(h.active).toBe(true);
    expect(warBetween(g, veil.empireId, auto.empireId)?.name).toBe('War in Heaven');
    // pledging joins the war on that side
    const rivals = majors(g).filter((e) => !e.isPlayer && !warBetween(g, e.id, veil.empireId) && !warBetween(g, e.id, auto.empireId));
    const r = execute(g, rivals[0].id, { type: 'ancients', precursor: 'veil', action: 'pledge' });
    expect(r.ok).toBe(true);
    expect(warBetween(g, rivals[0].id, auto.empireId)).toBeTruthy();
    // coalition members defend each other against an ancient aggressor
    expect(execute(g, rivals[1].id, { type: 'ancients', precursor: 'veil', action: 'coalition' }).ok).toBe(true);
    expect(execute(g, rivals[2].id, { type: 'ancients', precursor: 'veil', action: 'coalition' }).ok).toBe(true);
    for (const w of g.wars.filter((w) => w.attackers.includes(veil.empireId) && w.defenders.includes(rivals[1].id))) g.wars.splice(g.wars.indexOf(w), 1);
    g.truces = [];
    const vp = g.empires[veil.empireId];
    vp.stock.influence = 500;
    expect(execute(g, vp.id, { type: 'declareWar', target: rivals[1].id }).ok).toBe(true);
    // the coalition answers through the precursor's intrusion/awakening path; emulate the hook's effect check
    // salvage needs an undefended ancient system and our warships in it
    const target = veil.sacred.find((sid) => g.galaxy.systems[sid].owner === veil.empireId)!;
    for (const f of Object.values(g.fleets)) if (f.ownerId === veil.empireId && f.systemId === target) removeFleet(g, f);
    expect(execute(g, me.id, { type: 'ancients', precursor: 'veil', action: 'salvage', systemId: target }).ok).toBe(false);
    createFleet(g, me.id, target, ['cruiser']);
    const rp = me.research.progress;
    expect(execute(g, me.id, { type: 'ancients', precursor: 'veil', action: 'salvage', systemId: target }).ok).toBe(true);
    expect(me.research.progress).toBeGreaterThan(rp);
    expect(reputation(g, me.id)).toBeLessThan(0);
    expect(execute(g, me.id, { type: 'ancients', precursor: 'veil', action: 'salvage', systemId: target }).ok).toBe(false);
  });

  it('awakened hosts take the war to their enemies, and a long peace returns them to watchfulness', () => {
    const g = newGame({ seed: 28, galaxySize: 'medium', aiCount: 3 });
    const veil = precursorById(g, 'veil')!;
    veil.blame[g.playerId] = 50;
    awaken(g, veil);
    expect(warBetween(g, veil.empireId, g.playerId)).toBeTruthy();
    g.tick = Math.ceil(g.tick / 10) * 10 + 7;
    precursorTick(g);
    const moving = Object.values(g.fleets).filter((f) => f.ownerId === veil.empireId && f.name.includes('Host') && f.path.length);
    expect(moving.length).toBeGreaterThan(0);
    g.wars = g.wars.filter((w) => !(w.attackers.includes(veil.empireId) || w.defenders.includes(veil.empireId)));
    veil.lastWarTick = g.tick - 360 * 4;
    toMonth(g);
    expect(veil.status).toBe('watchful');
  });
});

describe('the High Conclave', () => {
  it('is founded with permanent seats for the leading realms; seats need more than one threshold', () => {
    const g = founded(31);
    const c = exp(g).conclave;
    expect(c.founders.length).toBe(3);
    for (const id of c.founders) expect(c.seats[id]).toBe('founder');
    const voters = Object.keys(c.seats).filter((k) => canVote(g, +k));
    expect(voters.length).toBeGreaterThanOrEqual(4);
    expect(Object.values(c.seats)).toContain('observer');
  });

  it('weights sum to the whole chamber, are capped, and cannot be bought with hoards; a big navy buys only so much', () => {
    const g = founded(32);
    const w0 = computeWeights(g);
    const total = Object.values(w0).reduce((a, v) => a + v, 0);
    expect(total).toBeGreaterThan(99);
    expect(total).toBeLessThan(101);
    for (const v of Object.values(w0)) expect(v).toBeLessThanOrEqual(34.1);
    const me = g.empires[g.playerId];
    me.stock.credits = 1e7; me.stock.alloys = 1e6;
    expect(computeWeights(g)[me.id]).toBe(w0[me.id]);
    me.stats.militaryPower = (me.stats.militaryPower || 1) * 100;
    const w1 = computeWeights(g)[me.id];
    expect(w1).toBeGreaterThan(w0[me.id]);
    expect(w1).toBeLessThan(w0[me.id] * 2);
  });

  it('validates motions: membership, cost, one session at a time, the chamber calendar, emergency grounds', () => {
    const g = founded(33);
    const c = exp(g).conclave;
    const me = g.empires[g.playerId];
    const observer = +Object.keys(c.seats).find((k) => c.seats[+k] === 'observer')!;
    expect(execute(g, observer, { type: 'conclave', action: 'propose', resolution: { kind: 'naval_accords' } }).ok).toBe(false);
    c.seats[me.id] = 'founder'; c.founders.push(me.id);
    expect(execute(g, me.id, { type: 'conclave', action: 'propose', resolution: { kind: 'containment', cosmic: 'omega' }, emergency: true }).ok).toBe(false);
    me.stock.influence = 10;
    g.tick = c.nextOrdinary;
    expect(execute(g, me.id, { type: 'conclave', action: 'propose', resolution: { kind: 'naval_accords' } }).ok).toBe(false);
    me.stock.influence = 500;
    expect(execute(g, me.id, { type: 'conclave', action: 'propose', resolution: { kind: 'embargo', target: me.id } }).ok).toBe(false);
    expect(execute(g, me.id, { type: 'conclave', action: 'propose', resolution: { kind: 'naval_accords' } }).ok).toBe(true);
    expect(me.stock.influence).toBe(475);
    expect(execute(g, me.id, { type: 'conclave', action: 'propose', resolution: { kind: 'naval_accords' } }).ok).toBe(false);
  });

  it('freezes weights when a session opens; AI members vote through the command layer at the deadline', () => {
    const g = founded(34);
    const c = exp(g).conclave;
    const me = g.empires[g.playerId];
    c.seats[me.id] = 'founder'; if (!c.founders.includes(me.id)) c.founders.push(me.id);
    g.tick = c.nextOrdinary;
    expect(execute(g, me.id, { type: 'conclave', action: 'propose', resolution: { kind: 'naval_accords' } }).ok).toBe(true);
    const frozen = { ...c.session!.weights };
    for (const e of majors(g)) e.stats.militaryPower *= 7;
    expect(c.session!.weights).toEqual(frozen);
    const sid = c.session!.id;
    runDays(g, SESSION_DAYS + 1);
    expect(c.session).toBeNull();
    const rec = c.history.find((h) => h.id === sid)!;
    expect(rec).toBeDefined();
    expect(['passed', 'failed', 'vetoed', 'no_quorum']).toContain(rec.result);
    expect(rec.yea + rec.nay + rec.abstain).toBeGreaterThan(99);
  });

  it('lobbying sways AI delegates; the player cannot be lobbied; once per member per session', () => {
    const g = founded(35);
    const c = exp(g).conclave;
    const me = g.empires[g.playerId];
    const ai = majors(g).find((e) => !e.isPlayer && canVote(g, e.id))!;
    c.seats[me.id] = 'founder'; if (!c.founders.includes(me.id)) c.founders.push(me.id);
    g.tick = c.nextOrdinary;
    execute(g, ai.id, { type: 'conclave', action: 'propose', resolution: { kind: 'naval_accords' } });
    const other = majors(g).find((e) => !e.isPlayer && e.id !== ai.id && c.session!.weights[e.id] != null)!;
    const before = aiLean(g, other, c.session!);
    me.stock.credits = 1000;
    expect(execute(g, me.id, { type: 'conclave', action: 'lobby', target: other.id, toward: 'nay' }).ok).toBe(true);
    expect(aiLean(g, other, c.session!)).toBeLessThan(before);
    expect(execute(g, me.id, { type: 'conclave', action: 'lobby', target: other.id, toward: 'nay' }).ok).toBe(false);
    expect(execute(g, ai.id, { type: 'conclave', action: 'lobby', target: me.id, toward: 'yea' }).ok).toBe(false);
  });

  it('a founding veto kills an ordinary motion at a price; an emergency cannot be vetoed', () => {
    const g = founded(36);
    const c = exp(g).conclave;
    const [f1, f2] = c.founders;
    g.tick = c.nextOrdinary;
    expect(execute(g, f1, { type: 'conclave', action: 'propose', resolution: { kind: 'naval_accords' } }).ok).toBe(true);
    const rep0 = reputation(g, f2);
    expect(execute(g, f2, { type: 'conclave', action: 'vote', vote: 'veto' }).ok).toBe(true);
    expect(c.session).toBeNull();
    expect(c.history[c.history.length - 1].result).toBe('vetoed');
    expect(reputation(g, f2)).toBeLessThan(rep0);
    expect(c.directives).toHaveLength(0);
    // the same founder's veto is spent; an emergency session refuses vetoes
    exp(g).omega.stage = 'incursion'; exp(g).omega.rift = g.galaxy.systems.find((s) => s.owner == null)!.id;
    expect(execute(g, f1, { type: 'conclave', action: 'propose', resolution: { kind: 'containment', cosmic: 'omega' }, emergency: true }).ok).toBe(true);
    expect(execute(g, c.founders[2], { type: 'conclave', action: 'vote', vote: 'veto' }).ok).toBe(false);
  });

  function enactDirect(g: GameState, resolution: Parameters<typeof execute>[2] extends never ? never : any) {
    const c = exp(g).conclave;
    const me = g.empires[g.playerId];
    c.seats[me.id] = 'founder'; if (!c.founders.includes(me.id)) c.founders.push(me.id);
    g.tick = Math.max(g.tick, c.nextOrdinary);
    const r = execute(g, me.id, { type: 'conclave', action: 'propose', resolution, emergency: false });
    expect(r.message ?? 'ok').toBe('Motion tabled');
    // everyone votes yea so the directive passes
    for (const k of Object.keys(c.session!.weights)) execute(g, +k, { type: 'conclave', action: 'vote', vote: 'yea' });
    runDays(g, SESSION_DAYS + 1);
    return c.directives[c.directives.length - 1];
  }

  it('Market Embargo suspends real trade: contracts, trade agreements and market terms', () => {
    const g = founded(37);
    const me = g.empires[g.playerId];
    const t = majors(g).find((e) => !e.isPlayer && !exp(g).conclave.founders.includes(e.id)) ?? majors(g).find((e) => !e.isPlayer)!;
    g.tradeDeals.push({ id: 9001, a: me.id, b: t.id, aGives: { minerals: 5 }, bGives: { energy: 5 }, until: g.tick + 3600 });
    expect(computeLedger(g, me).lines.some((l) => l.label.startsWith('Trade deal'))).toBe(true);
    const fee0 = mod(empireMods(g, t), 'marketFee');
    const d = enactDirect(g, { kind: 'embargo', target: t.id });
    expect(d.resolution.kind).toBe('embargo');
    expect(embargoed(g, me.id, t.id)).toBe(true);
    expect(computeLedger(g, me).lines.some((l) => l.label.startsWith('Trade deal'))).toBe(false);
    expect(execute(g, me.id, { type: 'proposeContract', to: t.id, give: { minerals: 1 }, receive: { energy: 1 }, years: 1 }).ok).toBe(false);
    expect(mod(empireMods(g, t), 'marketFee')).toBeGreaterThan(fee0);
    // defiance frees the defier at a price
    const rep0 = reputation(g, me.id);
    expect(execute(g, me.id, { type: 'conclave', action: 'defy', directiveId: d.id }).ok).toBe(true);
    expect(embargoed(g, me.id, t.id)).toBe(false);
    expect(reputation(g, me.id)).toBeLessThan(rep0);
    expect(me.timedMods.some((m) => m.label === 'Conclave censure')).toBe(true);
  });

  it('Naval Accords cap warships by naval capacity and capital hulls, except in a war with the ancients', () => {
    const g = founded(38);
    const me = g.empires[g.playerId];
    me.research.done.push('eng_destroyers', 'eng_cruisers', 'eng_battlecruisers', 'eng_battleships');
    enactDirect(g, { kind: 'naval_accords' });
    const yard = g.planets[me.capitalPlanetId!];
    expect(canBuildShip(g, me, yard, 'corvette')).toEqual({ ok: true });
    for (let i = 0; i < 6; i++) createFleet(g, me.id, me.capitalSystemId!, ['battleship']);
    const r = canBuildShip(g, me, yard, 'battleship');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Naval Accords/);
    expect(canBuildShip(g, me, yard, 'transport').ok).toBe(true);
    // at war with an ancient power, the accords no longer bind
    const veil = precursorById(g, 'veil')!;
    g.wars.push({ id: 777, attackers: [veil.empireId], defenders: [me.id], startTick: g.tick, score: 0, name: 'test' });
    expect(canBuildShip(g, me, yard, 'battleship').ok).toBe(true);
  });

  it('an Ascension Injunction stops the project for bound members until they defy it; repeated defiance suspends a seat', () => {
    const g = founded(39);
    const me = g.empires[g.playerId];
    const d = enactDirect(g, { kind: 'ascension_injunction', project: 'omega_theorem' });
    expect(injunctionBlocks(g, me.id, 'omega_theorem')).toBe(true);
    me.era = 4;
    me.research.done.push('era_dimensional');
    expect(execute(g, me.id, { type: 'setResearch', tech: 'era_omega' }).ok).toBe(false);
    exp(g).conclave.founders = exp(g).conclave.founders.filter((id) => id !== me.id);
    refreshSeats(g);
    expect(execute(g, me.id, { type: 'conclave', action: 'defy', directiveId: d.id }).ok).toBe(true);
    expect(execute(g, me.id, { type: 'setResearch', tech: 'era_omega' }).ok).toBe(true);
    // a second defiance within ten years suspends a seat that is not a founding one
    exp(g).conclave.directives.push({ id: 4242, resolution: { kind: 'naval_accords' }, enacted: g.tick, expires: g.tick + 3600, supporters: [], defiant: [] });
    if (exp(g).conclave.seats[me.id] === 'observer') exp(g).conclave.seats[me.id] = 'delegate';
    expect(execute(g, me.id, { type: 'conclave', action: 'defy', directiveId: 4242 }).ok).toBe(true);
    expect(exp(g).conclave.suspended[me.id]).toBeGreaterThan(g.tick);
    expect(canVote(g, me.id)).toBe(false);
  });

  it('a Containment War sends only its supporters to war, with mutual supply; repeal ends a directive', () => {
    const g = founded(40);
    const veil = precursorById(g, 'veil')!;
    awaken(g, veil);
    const me = g.empires[g.playerId];
    const ais = majors(g).filter((e) => !e.isPlayer && !warBetween(g, e.id, veil.empireId));
    const c = exp(g).conclave;
    c.seats[me.id] = 'founder'; if (!c.founders.includes(me.id)) c.founders.push(me.id);
    g.tick = c.nextOrdinary;
    expect(execute(g, me.id, { type: 'conclave', action: 'propose', resolution: { kind: 'containment', target: veil.empireId } }).ok).toBe(true);
    const yes = ais.find((e) => c.session!.weights[e.id] != null)!;
    const no = ais.find((e) => e.id !== yes.id && c.session!.weights[e.id] != null)!;
    execute(g, yes.id, { type: 'conclave', action: 'vote', vote: 'yea' });
    execute(g, no.id, { type: 'conclave', action: 'vote', vote: 'nay' });
    for (const k of Object.keys(c.session!.weights)) if (!c.session!.votes[+k]) execute(g, +k, { type: 'conclave', action: 'vote', vote: 'yea' });
    runDays(g, SESSION_DAYS + 1);
    const d = c.directives.find((x) => x.resolution.kind === 'containment');
    expect(d).toBeDefined();
    expect(warBetween(g, yes.id, veil.empireId)).toBeTruthy();
    expect(warBetween(g, no.id, veil.empireId)).toBeFalsy();
    // supporters count as friends: their space supplies one another's fleets and carries their trade
    expect(friends(g, me.id)).toContain(yes.id);
    expect(friends(g, me.id)).not.toContain(no.id);
  });
});

describe('the Void Devourer and the Sentinels', () => {
  it('enters on schedule, announces and keeps to its path, drains energy, scars, and pays its killer', () => {
    const g = newGame({ seed: 51, galaxySize: 'medium', aiCount: 4 });
    const dv = exp(g).devourer;
    g.tick = dv.spawnAt - 1;
    toMonth(g);
    expect(dv.status).toBe('roaming');
    const f = devourerFleet(g)!;
    expect(f).toBeTruthy();
    expect(dv.target).not.toBeNull();
    const announced = dv.target!;
    runDays(g, 61 + 30);
    expect(dv.trail).toContain(announced);
    // put it on a world of the player and check the drain and the trade cut
    const me = g.empires[g.playerId];
    const home = me.capitalSystemId!;
    const energyBefore = computeLedger(g, me).net.energy;
    f.systemId = home; f.path = []; f.progress = 0;
    expect(systemCondition(g, home)?.energy).toBeLessThan(0.5);
    expect(computeLedger(g, me).net.energy).toBeLessThan(energyBefore);
    dv.trail.push(home);
    dv.nextMoveTick = g.tick + 1000; // keep it here for the month
    // fed on: it leaves a scar
    for (const id in g.fleets) if (g.fleets[id].ownerId === me.id) removeFleet(g, g.fleets[id]);
    toMonth(g);
    expect(dv.scars[home]).toBeGreaterThan(g.tick);
    expect(reputation(g, me.id)).toBeLessThan(0); // nobody defended the system
    // killed by the player's fleet
    createFleet(g, me.id, home, ['cruiser']);
    removeFleet(g, f);
    toMonth(g);
    expect(dv.status).toBe('slain');
    expect(dv.slainBy).toBe(me.id);
    expect(exp(g).boons[me.id].some((b) => b.label === 'Heart of the Devourer')).toBe(true);
  });

  it('moves deterministically: the same seed gives the same path', () => {
    const run = () => {
      const g = newGame({ seed: 52, galaxySize: 'medium', aiCount: 3 });
      g.tick = exp(g).devourer.spawnAt - 1;
      runDays(g, 360 * 2);
      return exp(g).devourer.trail.join(',');
    };
    expect(run()).toBe(run());
  });

  it('a Sentinel host destroyed yields its site reward to the victor and angers Automata Prime', () => {
    const g = newGame({ seed: 53, galaxySize: 'medium', aiCount: 3 });
    const me = g.empires[g.playerId];
    const lair = g.galaxy.systems.find((s) => s.features.includes('guardian'))!;
    const site = sentinelSite(g, lair.id);
    site.kind = 'archive';
    for (const id in g.fleets) if (g.empires[g.fleets[id].ownerId].kind === 'guardian' && g.fleets[id].systemId === lair.id) removeFleet(g, g.fleets[id]);
    createFleet(g, me.id, lair.id, ['cruiser']);
    const techs = me.research.done.length;
    const auto = precursorById(g, 'automata')!;
    toMonth(g);
    expect(lair.features.includes('guardian')).toBe(false);
    expect(site.claimedBy).toBe(me.id);
    expect(me.research.done.length).toBe(techs + 1);
    expect(auto.blame[me.id]).toBeGreaterThanOrEqual(6);
    expect(reputation(g, me.id)).toBeGreaterThan(0);
    expect(onSentinelsDefeated(g, lair.id)).toBe(me.id); // claimed once only
  });
});

describe('the Omega Incursion', () => {
  function triggered(seed = 61): GameState {
    const g = founded(seed);
    const me = g.empires[g.playerId];
    me.research.done.push('era_dimensional', 'era_omega');
    toMonth(g);
    expect(exp(g).omega.stage).toBe('anomalies');
    expect(exp(g).omega.trigger!.empireId).toBe(me.id);
    return g;
  }

  it('progresses through anomalies, warnings and the rift into a spreading incursion with real losses', () => {
    const g = triggered();
    const o = exp(g).omega;
    runMonths(g, 8);
    expect(o.stage).toBe('warnings');
    expect(o.rift).not.toBeNull();
    runMonths(g, 6);
    expect(o.stage).toBe('rift');
    expect(o.corrupted[o.rift!]).toBeDefined();
    expect(omegaFleets(g).length).toBeGreaterThan(0);
    runMonths(g, 4);
    expect(o.stage).toBe('incursion');
    const n0 = Object.keys(o.corrupted).length;
    runMonths(g, 6);
    expect(Object.keys(o.corrupted).length).toBeGreaterThan(n0);
    // the galaxy's trade suffers while the rift is open
    expect(g.empires[g.playerId].timedMods.some((t) => t.label === 'Omega disruption')).toBe(true);
    // a corrupted, undefended colony is lost (one of the player's, so no AI garrison comes to save it)
    const victim = g.planets.find((p) => !p.colony && p.type !== 'gas_giant' && g.galaxy.systems[p.systemId].owner == null && !Object.values(g.fleets).some((f) => f.systemId === p.systemId))!;
    victim.colony = { ownerId: g.playerId, pops: 4, buildings: {}, queue: [], shipQueue: [], stability: 50, resistance: 0, originalOwnerId: null, foundedTick: 0, lowStabilityMonths: 0, defenseDamage: 0 };
    o.corrupted[victim.systemId] = g.tick;
    for (const id in g.fleets) if (g.fleets[id].systemId === victim.systemId) removeFleet(g, g.fleets[id]);
    o.neglect[victim.id] = 5;
    toMonth(g);
    expect(victim.colony).toBeNull();
    expect(o.losses.colonies).toBeGreaterThan(0);
  });

  it('a fleet holding the rift wears it down; sealing takes time and ends the crisis with a Warden', () => {
    const g = triggered(62);
    const o = exp(g).omega;
    const me = g.empires[g.playerId];
    runMonths(g, 15);
    expect(['rift', 'incursion']).toContain(o.stage);
    for (const f of omegaFleets(g)) removeFleet(g, f);
    const fleet = createFleet(g, me.id, o.rift!, ['battleship', 'battleship', 'cruiser', 'cruiser', 'cruiser']);
    fleet.stance = 'aggressive';
    o.nextWave = g.tick + 10000;
    expect(execute(g, me.id, { type: 'omega', action: 'seal' }).ok).toBe(false); // too strong yet
    const i0 = o.integrity;
    toMonth(g);
    expect(o.integrity).toBeLessThan(i0);
    o.integrity = 50;
    me.stock.rare = 1000; me.stock.components = 1000; me.stock.influence = 500;
    expect(execute(g, me.id, { type: 'omega', action: 'seal' }).ok).toBe(true);
    runDays(g, 185);
    expect(o.stage).toBe('resolved');
    expect(o.resolution!.kind).toBe('sealed');
    expect(exp(g).boons[me.id].some((b) => b.label === 'Warden of the Galaxy')).toBe(true);
    expect(exp(g).conclave.founders).toContain(me.id);
    expect(Object.keys(o.recovery).length).toBeGreaterThan(0);
  });

  it('breaching costs a fleet dearly and destroys every Omega fleet; binding the rift brings power and enmity', () => {
    const g = triggered(63);
    const o = exp(g).omega;
    const me = g.empires[g.playerId];
    runMonths(g, 15);
    for (const f of omegaFleets(g)) if (f.systemId === o.rift) removeFleet(g, f);
    const fleet = createFleet(g, me.id, o.rift!, ['cruiser', 'cruiser', 'cruiser', 'cruiser', 'cruiser']);
    o.integrity = 10;
    expect(execute(g, me.id, { type: 'omega', action: 'breach' }).ok).toBe(true);
    expect(fleet.ships.length).toBe(3);
    expect(omegaFleets(g)).toHaveLength(0);
    expect(o.resolution!.kind).toBe('destroyed');

    const h = triggered(64);
    const ho = exp(h).omega;
    const hm = h.empires[h.playerId];
    runMonths(h, 15);
    for (const f of omegaFleets(h)) if (f.systemId === ho.rift) removeFleet(h, f);
    createFleet(h, hm.id, ho.rift!, ['cruiser']);
    ho.integrity = 65;
    hm.stock.influence = 500;
    hm.era = 3;
    expect(execute(h, hm.id, { type: 'omega', action: 'exploit' }).ok).toBe(false); // needs the Continuum
    hm.era = 4;
    const research0 = mod(empireMods(h, hm), 'output.research');
    expect(execute(h, hm.id, { type: 'omega', action: 'exploit' }).ok).toBe(true);
    expect(mod(empireMods(h, hm), 'output.research')).toBeGreaterThan(research0);
    expect(reputation(h, hm.id)).toBeLessThanOrEqual(-30);
    expect(ho.exploiter).toBe(hm.id);
  });

  it('contributions are validated and change the crisis; a consumed galaxy ends the reign', () => {
    const g = triggered(65);
    const o = exp(g).omega;
    const me = g.empires[g.playerId];
    expect(execute(g, me.id, { type: 'conclave', action: 'contribute', kind: 'resources' }).ok).toBe(false); // no rift yet
    runMonths(g, 15);
    me.stock.alloys = 2000; me.stock.energy = 2000; me.stock.credits = 2000; me.stock.components = 500; me.stock.influence = 300;
    const i0 = o.integrity;
    expect(execute(g, me.id, { type: 'conclave', action: 'contribute', kind: 'resources' }).ok).toBe(true);
    expect(o.integrity).toBe(Math.max(0, i0 - 4));
    expect(execute(g, me.id, { type: 'conclave', action: 'contribute', kind: 'infrastructure' }).ok).toBe(true);
    expect(o.lattice).toBeGreaterThan(g.tick);
    expect(execute(g, me.id, { type: 'conclave', action: 'contribute', kind: 'intel' }).ok).toBe(true);
    expect(o.credit[me.id]).toBeGreaterThanOrEqual(55);
    resolve(g, 'consumed', null);
    expect(g.gameOver?.kind).toBe('consumed');
    expect(g.gameOver?.won).toBe(false);
  });
});

describe('determinism and long campaigns', () => {
  it('two runs with the same seed and commands match exactly through the expansion systems', () => {
    const run = () => {
      const g = newGame({ seed: 71, galaxySize: 'small', aiCount: 3 });
      exp(g).devourer.spawnAt = 360 * 2;
      const veil = precursorById(g, 'veil')!;
      veil.pressure = 95;
      veil.blame[1] = 40;
      for (const e of majors(g)) e.era = Math.max(1, e.era);
      runDays(g, 360 * 5);
      execute(g, g.playerId, { type: 'ancients', precursor: 'automata', action: 'tribute' });
      runDays(g, 360);
      return fingerprint(g);
    };
    expect(run()).toBe(run());
  });

  it('a 40-year all-AI campaign with every crisis forced early stays consistent and round-trips', () => {
    const g = newGame({ seed: 72, galaxySize: 'small', aiCount: 3 });
    g.empires[g.playerId].isPlayer = false;
    const x = exp(g);
    x.devourer.spawnAt = 360 * 6;
    for (const p of x.precursors) p.pressure = 60;
    let triggeredOmega = false;
    for (let y = 1; y <= 40; y++) {
      runDays(g, 360);
      if (y === 12 && !triggeredOmega) { const e = majors(g)[0]; e.research.done.push('era_dimensional', 'era_omega'); triggeredOmega = true; }
      for (const p of x.precursors) { expect(Number.isFinite(p.pressure)).toBe(true); expect(p.pressure).toBeGreaterThanOrEqual(0); expect(p.pressure).toBeLessThanOrEqual(PRESSURE.awaken + 20); }
      for (const v of Object.values(x.reputation)) { expect(v).toBeGreaterThanOrEqual(-100); expect(v).toBeLessThanOrEqual(100); }
      expect(Number.isFinite(x.omega.integrity)).toBe(true);
      for (const e of g.empires) for (const v of Object.values(e.stock)) expect(Number.isFinite(v)).toBe(true);
      for (const f of Object.values(g.fleets)) expect(g.empires[f.ownerId]).toBeDefined();
      if (g.gameOver && !g.gameOver.won) break;
    }
    expect(x.conclave.founded).not.toBeNull();
    expect(x.devourer.status).not.toBe('unborn');
    expect(x.omega.stage).not.toBe('dormant');
    expect(x.conclave.history.length).toBeGreaterThan(0);
    const back = deserialize(serialize(g));
    expect(fingerprint(back)).toBe(fingerprint(g));
    runDays(back, 30);
  }, 240_000);
});
