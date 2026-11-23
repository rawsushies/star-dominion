// Emergent politics: deterministic acceptance tests. Each test sets up circumstances through the
// ordinary game state (who is at war, whom the ancients blame, what realms remember) and then lets
// the real decision layer act: agendas, the ancients' regard, `desire`, AI initiative, pact upkeep
// and the execute() command layer. No outcome is forced; the tests check what the simulation does.
import { describe, expect, it } from 'vitest';
import { newGame, step } from '../src/sim/engine';
import { execute } from '../src/sim/commands';
import { addMemory, declareWar, makePeace } from '../src/sim/diplomacy';
import { awaken, precursorEmpire } from '../src/sim/ancients';
import { hasTreaty, warBetween } from '../src/sim/territory';
import { exp, precursorById } from '../src/sim/expansion';
import { accordPact, agendaOf, desire, pactPartners, pol, politicsAI, politicsMonthly, regardOf } from '../src/sim/politics';
import { warCandidates } from '../src/sim/strategy';
import { deserialize, fingerprint, serialize } from '../src/sim/save';
import type { Empire, GameState } from '../src/sim/types';

const majors = (g: GameState) => g.empires.filter((e) => e.kind === 'major' && e.alive);
const rivals = (g: GameState) => majors(g).filter((e) => !e.isPlayer);
const toMonth = (g: GameState) => { do step(g); while (g.tick % 30 !== 0); };

/** A galaxy four years on, where the great realms and the ancients have all met. */
function world(seed: number): GameState {
  const g = newGame({ seed, galaxySize: 'medium', aiCount: 4 });
  g.tick = 360 * 4 - 1;
  toMonth(g);
  for (const e of majors(g)) {
    for (const o of g.empires) if (o.capitalSystemId != null && !e.explored.includes(o.capitalSystemId)) e.explored.push(o.capitalSystemId);
    for (const p of g.expansion!.precursors) for (const s of p.sacred) if (!e.explored.includes(s)) e.explored.push(s);
    e.stock.influence = 400;
  }
  return g;
}
/** wake an ancient power without anyone to blame (so it starts no war of its own) */
function wake(g: GameState, id: 'veil' | 'automata', blame: Record<number, number> = {}) {
  const ps = precursorById(g, id)!;
  ps.blame = { ...blame };
  awaken(g, ps);
  return ps;
}
const history = (g: GameState) => pol(g).history.map((h) => h.kind);

describe('Emergent politics', () => {
  it('an ancient power comes to admire a younger realm and offers it a genuine alliance', () => {
    const g = world(101);
    const me = g.empires[g.playerId];
    const veil = wake(g, 'veil');
    const foe = rivals(g)[0];
    // the Archons go to war with a younger realm; the player fights the same enemy and keeps their terms
    expect(execute(g, veil.empireId, { type: 'declareWar', target: foe.id }).ok).toBe(true);
    g.truces = [];
    expect(execute(g, me.id, { type: 'declareWar', target: foe.id }).ok).toBe(true);
    const before = regardOf(g, veil, me.id).admiration;
    let offer = null;
    for (let m = 0; m < 48 && !offer; m++) {
      me.stock.rare += 200; me.stock.influence += 40;
      execute(g, me.id, { type: 'ancients', precursor: 'veil', action: 'tribute' });
      toMonth(g);
      offer = pol(g).offers.find((o) => o.from === veil.empireId && o.to === me.id && o.kind === 'alliance');
    }
    expect(regardOf(g, veil, me.id).admiration).toBeGreaterThan(before + 20);
    expect(offer, 'the Archons should offer an alliance').toBeTruthy();
    expect(offer!.motives.some(([k]) => k === 'Admires their conduct')).toBe(true);
    expect(execute(g, me.id, { type: 'politics', action: 'respond', offerId: offer!.id, accept: true }).ok).toBe(true);
    expect(hasTreaty(g, me.id, veil.empireId, 'alliance')).toBe(true);
    // genuine: when a third realm attacks the player, the ancient power goes to war for it
    const third = rivals(g).find((e) => e.id !== foe.id && !warBetween(g, e.id, me.id))!;
    g.truces = [];
    g.empires[third.id].stock.influence = 100;
    const war = declareWar(g, third.id, me.id)!;
    expect(war).toBeTruthy();
    expect(war.defenders).toContain(veil.empireId);
    expect(history(g)).toContain('alliance');
  }, 120_000);

  it('a rival with an old grudge proposes a compact with the player against an awakened ancient power', () => {
    const g = world(202);
    const me = g.empires[g.playerId];
    const rival = rivals(g)[0];
    addMemory(g, rival.id, me.id, 'old_feud', -40, 0, 'An old feud');
    const auto = wake(g, 'automata', { [rival.id]: 60, [me.id]: 40 });
    expect(warBetween(g, auto.empireId, rival.id)).toBeTruthy();
    expect(warBetween(g, auto.empireId, me.id)).toBeTruthy();
    let offer = null;
    for (let m = 0; m < 6 && !offer; m++) {
      toMonth(g);
      offer = pol(g).offers.find((o) => o.from === rival.id && o.kind === 'compact' && o.target === auto.empireId);
    }
    expect(offer, 'the rival should seek the player against Automata Prime').toBeTruthy();
    expect(offer!.motives.find(([k]) => k === 'Opinion of them')![1]).toBeLessThan(0); // it still dislikes us
    expect(execute(g, me.id, { type: 'politics', action: 'respond', offerId: offer!.id, accept: true }).ok).toBe(true);
    const pact = pol(g).pacts.find((p) => p.kind === 'compact' && p.target === auto.empireId)!;
    expect(pact.members).toEqual(expect.arrayContaining([rival.id, me.id]));
    // the compact restrains the rival: it no longer plans war on the player
    expect(pactPartners(g, rival.id)).toContain(me.id);
    expect(warCandidates(g, rival).some((c) => c.id === me.id)).toBe(false);
    // and binds the player: if the player makes a separate peace while the rival fights on, the compact remembers
    const w = g.wars.find((x) => x.attackers[0] === auto.empireId && x.defenders[0] === me.id)!;
    makePeace(g, w, 'status_quo', 'attackers');
    politicsMonthly(g);
    expect(pol(g).pacts.some((p) => p.kind === 'compact' && p.members.includes(me.id))).toBe(false);
    expect((g.opinions[`${rival.id}>${me.id}`] ?? []).some((m) => m.key === 'abandoned_pact')).toBe(true);
  }, 120_000);

  it('a rival secretly colludes with an ancient power against the player, and joins its war', () => {
    const g = world(303);
    const me = g.empires[g.playerId];
    const rival = rivals(g)[0];
    addMemory(g, rival.id, me.id, 'hatred', -70, 0, 'Hated foe');
    const veil = precursorById(g, 'veil')!;
    veil.blame = { [me.id]: 30 };
    veil.pressure = 60;
    politicsMonthly(g);
    expect(agendaOf(g, rival.id)!.rival).toBe(me.id);
    politicsAI(g, rival);
    const pact = pol(g).pacts.find((p) => p.kind === 'collusion' && p.target === me.id && p.members.includes(rival.id));
    expect(pact, 'the rival should conspire with the Archons').toBeTruthy();
    expect(pact!.secret).toBe(true);
    expect(pact!.knownBy).not.toContain(me.id);
    expect(pol(g).history.some((h) => h.kind === 'collusion')).toBe(false); // nobody else knows
    // the whispers turn the Archons' eye on the player
    const blame0 = veil.blame[me.id];
    politicsMonthly(g);
    expect(veil.blame[me.id]).toBeGreaterThan(blame0);
    // the Archons wake and strike the realm they blame; their confederate goes to war beside them
    awaken(g, veil);
    expect(warBetween(g, veil.empireId, me.id)).toBeTruthy();
    politicsMonthly(g);
    const war = g.wars.find((w) => w.attackers.includes(veil.empireId) && w.defenders.includes(me.id))!;
    expect(war.attackers).toContain(rival.id);
    expect(pact!.secret).toBe(false);
    expect(g.events.some((e) => e.title === 'A conspiracy revealed' && (e.empires.length === 0 || e.empires.includes(me.id)))).toBe(true);
  }, 120_000);

  it('the ancient powers ally against a common threat, and their accord breaks when it passes', () => {
    const g = world(404);
    const veil = wake(g, 'veil');
    const auto = wake(g, 'automata');
    const h = exp(g).heaven;
    expect(h.active).toBe(true);
    const war = g.wars.find((w) => w.id === h.warId)!;
    // years of the War in Heaven, then the Omega Incursion opens a rift
    h.startTick = war.startTick = g.tick - 360 * 3;
    const o = exp(g).omega;
    o.stage = 'incursion'; o.stageTick = g.tick; o.rift = g.galaxy.systems.find((s) => s.owner == null)!.id;
    politicsMonthly(g);
    const acc = accordPact(g);
    expect(acc, 'the ancients should come to terms').toBeTruthy();
    expect(acc!.depth).toBe('alliance');
    expect(hasTreaty(g, veil.empireId, auto.empireId, 'alliance')).toBe(true);
    expect(h.active).toBe(false);
    expect(warBetween(g, veil.empireId, auto.empireId)).toBeFalsy();
    // the threat passes: the alliance cools to a truce, then the old enmity returns
    o.stage = 'resolved';
    let cooled = false;
    for (let m = 0; m < 40 && accordPact(g); m++) { toMonth(g); if (accordPact(g)?.depth === 'truce') cooled = true; }
    expect(cooled).toBe(true);
    expect(accordPact(g)).toBeUndefined();
    expect(hasTreaty(g, veil.empireId, auto.empireId, 'alliance')).toBe(false);
    expect(history(g)).toEqual(expect.arrayContaining(['accord', 'accord_end']));
    if (veil.status === 'awakened' && auto.status === 'awakened') expect(h.active).toBe(true);
  }, 180_000);

  it('a coalition splits when a member makes a separate peace, and when a member betrays a partner', () => {
    const g = world(505);
    const [a, b, c] = rivals(g);
    const auto = wake(g, 'automata', { [a.id]: 40, [b.id]: 30, [c.id]: 30 });
    politicsMonthly(g);
    for (const id of [b.id, c.id]) expect(execute(g, a.id, { type: 'politics', action: 'propose', kind: 'compact', to: id, target: auto.empireId }).ok).toBe(true);
    const pact = pol(g).pacts.find((p) => p.kind === 'compact' && p.target === auto.empireId)!;
    expect(pact.members.sort()).toEqual([a.id, b.id, c.id].sort());
    // conflicting interests: b settles with the ancients while its partners fight on
    const wb = g.wars.find((w) => (w.attackers[0] === auto.empireId && w.defenders[0] === b.id))!;
    makePeace(g, wb, 'status_quo', 'attackers');
    politicsMonthly(g);
    expect(pact.members).not.toContain(b.id);
    expect((g.opinions[`${a.id}>${b.id}`] ?? []).some((m) => m.key === 'abandoned_pact')).toBe(true);
    // betrayal: c turns on its partner a in the middle of the war
    g.truces = [];
    g.empires[c.id].stock.influence = 100;
    expect(execute(g, c.id, { type: 'declareWar', target: a.id }).ok).toBe(true);
    politicsMonthly(g);
    expect(pol(g).pacts.some((p) => p.kind === 'compact' && p.target === auto.empireId)).toBe(false);
    expect((g.opinions[`${a.id}>${c.id}`] ?? []).some((m) => m.key === 'betrayed_pact')).toBe(true);
    expect(history(g)).toEqual(expect.arrayContaining(['compact', 'leave', 'betrayal']));
  }, 120_000);

  it('a cosmic crisis makes former enemies set their war aside, until it passes', () => {
    const g = world(606);
    const [a, b] = rivals(g);
    g.truces = [];
    expect(declareWar(g, a.id, b.id)).toBeTruthy();
    const o = exp(g).omega;
    o.stage = 'incursion'; o.stageTick = g.tick;
    const sysOf = (e: Empire) => g.galaxy.systems.find((s) => s.owner === e.id && s.id !== e.capitalSystemId) ?? g.galaxy.systems[e.capitalSystemId!];
    o.rift = sysOf(a).id;
    o.corrupted[sysOf(a).id] = g.tick;
    o.corrupted[sysOf(b).id] = g.tick;
    politicsMonthly(g);
    politicsAI(g, a);
    expect(warBetween(g, a.id, b.id)).toBeFalsy();
    const concord = pol(g).pacts.find((p) => p.kind === 'concord')!;
    expect(concord.members).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(pactPartners(g, a.id)).toContain(b.id);
    // the crisis ends; so does the concord, and with it the restraint on their old quarrel
    o.stage = 'resolved';
    politicsMonthly(g);
    expect(pol(g).pacts.some((p) => p.kind === 'concord')).toBe(false);
    expect(pactPartners(g, a.id)).not.toContain(b.id);
    expect((g.opinions[`${a.id}>${b.id}`] ?? []).some((m) => m.key === 'stood_together')).toBe(true);
    expect(history(g)).toEqual(expect.arrayContaining(['concord', 'concord_end']));
  }, 120_000);

  it('the player\'s decisions change the course of the galaxy (and the same decisions replay identically)', () => {
    const setup = () => {
      const g = world(202);
      const rival = rivals(g)[0];
      wake(g, 'automata', { [rival.id]: 60, [g.playerId]: 40 });
      for (let m = 0; m < 6 && !pol(g).offers.some((o) => o.kind === 'compact'); m++) toMonth(g);
      return g;
    };
    const branch = (accept: boolean) => {
      const g = setup();
      const offer = pol(g).offers.find((o) => o.kind === 'compact')!;
      expect(offer).toBeTruthy();
      execute(g, g.playerId, { type: 'politics', action: 'respond', offerId: offer.id, accept });
      for (let m = 0; m < 24; m++) toMonth(g);
      return g;
    };
    const yes = branch(true), no = branch(false), yes2 = branch(true);
    expect(fingerprint(yes)).toBe(fingerprint(yes2)); // deterministic
    const shape = (g: GameState) => JSON.stringify({ pacts: pol(g).pacts.map((p) => [p.kind, [...p.members].sort(), p.target]), wars: g.wars.map((w) => [[...w.attackers].sort(), [...w.defenders].sort()]), history: pol(g).history.map((h) => h.title) });
    expect(shape(yes)).not.toBe(shape(no));
    expect(pol(no).history.some((h) => h.kind === 'compact' && h.actors.includes(no.playerId))).toBe(false);
    expect(pol(yes).history.some((h) => h.kind === 'compact' && h.actors.includes(yes.playerId))).toBe(true);
  }, 240_000);

  it('different seeds write different political histories', () => {
    const run = (seed: number) => {
      const g = newGame({ seed, galaxySize: 'small', aiCount: 4 });
      g.empires[g.playerId].isPlayer = false; // AI plays every realm
      for (let d = 0; d < 360 * 10 && !g.gameOver; d++) step(g);
      return pol(g).history.map((h) => `${h.kind}:${[...h.actors].sort().join(',')}`);
    };
    const runs = [11, 22, 33].map(run);
    expect(runs.filter((r) => r.length > 0).length).toBeGreaterThanOrEqual(2);
    expect(new Set(runs.map((r) => r.join('|'))).size).toBe(3);
    // and old saves without the politics layer load with it in its starting state
    const g = newGame({ seed: 5, galaxySize: 'small', aiCount: 3 });
    const raw = JSON.parse(serialize(g));
    delete raw.expansion.politics;
    const back = deserialize(JSON.stringify(raw));
    expect(back.expansion!.politics.pacts).toEqual([]);
    expect(fingerprint(deserialize(serialize(back)))).toBe(fingerprint(back));
  }, 300_000);

  it('the scoring is itemised and both parties must want a deal', () => {
    const g = world(101);
    const me = g.empires[g.playerId];
    const ps = g.expansion!.precursors.find((p) => precursorEmpire(g, p))!;
    // a dormant power will not ally with anyone, and says why
    const ev = desire(g, ps.empireId, { kind: 'alliance', from: me.id, to: ps.empireId, target: null });
    expect(ev.accept).toBe(false);
    expect(ev.reasons[0][0]).toMatch(/slumber/);
    const r = execute(g, me.id, { type: 'politics', action: 'propose', kind: 'alliance', to: ps.empireId });
    expect(r.ok).toBe(false);
    // malformed commands are refused without changing anything
    const before = fingerprint(g);
    expect(execute(g, me.id, { type: 'politics', action: 'propose', kind: 'nonsense' as never, to: 1 }).ok).toBe(false);
    expect(execute(g, me.id, { type: 'politics', action: 'respond', offerId: 999999, accept: true }).ok).toBe(false);
    expect(execute(g, me.id, { type: 'politics', action: 'expose', pactId: 999999 }).ok).toBe(false);
    expect(fingerprint(g)).toBe(before);
  });
});
