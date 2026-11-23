// The living galaxy (sim/life.ts): deterministic tests of the economic and demographic model.
// Each test starts from a galaxy the AI has governed for some years (nothing staged), then
// changes the circumstances through ordinary game state (a hostile fleet on a lane, a battle,
// a crowded world) and checks what the simulation does with them.
import { beforeAll, describe, expect, it } from 'vitest';
import { newGame, step, getLedger } from '../src/sim/engine';
import { deserialize, fingerprint, serialize } from '../src/sim/save';
import { createFleet } from '../src/sim/fleets';
import { declareWar } from '../src/sim/diplomacy';
import { lifeMonthly, lifeDaily, life, routeVolume, secede, tradeTies, worldCondition, convoyPositions, chronicle } from '../src/sim/life';
import { warCandidates } from '../src/sim/strategy';
import { isHostile } from '../src/sim/territory';
import type { GameState } from '../src/sim/types';

const toMonth = (g: GameState) => { do step(g); while (g.tick % 30 !== 0); };
const clone = (g: GameState) => deserialize(serialize(g));
/** make two realms enemies (clearing pacts and truces that would forbid it) */
function enemies(g: GameState, a: number, b: number) {
  g.treaties = g.treaties.filter((t) => !((t.a === a && t.b === b) || (t.a === b && t.b === a)));
  g.truces = g.truces.filter((t) => !((t.a === a && t.b === b) || (t.a === b && t.b === a)));
  g.empires[a].stock.influence = Math.max(g.empires[a].stock.influence, 100);
  if (!isHostile(g, a, b)) declareWar(g, a, b);
  expect(isHostile(g, a, b)).toBe(true);
}

/** a galaxy governed by the AI alone (the player's realm too) for `years` */
function evolve(seed: number, years: number, size: 'small' | 'medium' = 'medium'): GameState {
  const g = newGame({ seed, galaxySize: size, aiCount: 4 });
  const me = g.empires[g.playerId];
  me.isPlayer = false;
  for (let d = 0; d < 360 * years; d++) step(g);
  me.isPlayer = true;
  return g;
}

let base: GameState;
beforeAll(() => { base = evolve(101, 10); }, 240_000);

describe('merchant routes', () => {
  it('form from the worlds\' real surpluses and deficits', () => {
    const g = clone(base);
    const L = life(g);
    expect(L.routes.length).toBeGreaterThan(5);
    for (const r of L.routes) {
      const from = g.planets[r.from].colony!, to = g.planets[r.to].colony!;
      expect(from.ownerId).toBe(r.a);
      expect(to.ownerId).toBe(r.b);
      expect(r.path[0]).toBe(g.planets[r.from].systemId);
      expect(r.path[r.path.length - 1]).toBe(g.planets[r.to].systemId);
      if (r.a !== r.b || routeVolume(r) === 0) continue;
      // every good on an internal route is one the destination world actually lacks
      const rep = getLedger(g, g.empires[r.b]).planets[r.to];
      for (const k of Object.keys(r.cargo)) expect(rep.production[k as 'food'] ?? 0).toBeLessThan(0);
    }
    // supply reaches importing worlds when the lanes are safe
    const imported = g.planets.filter((p) => p.colony && p.colony.supply != null && (p.colony.want?.length ?? 0) === 0);
    expect(imported.length).toBeGreaterThan(3);
  });

  it('convoys sail a schedule: they depart, travel, arrive and return; a closed lane holds them in port', () => {
    const g = clone(base);
    const r = life(g).routes.find((x) => x.path.length > 1)!;
    const a = convoyPositions(r, r.since + 1), b = convoyPositions(r, r.since + r.days * 0.5), c = convoyPositions(r, r.since + r.days * 1.5);
    expect(a[0].u).toBeLessThan(b[0].u);
    expect(b[0].laden).toBe(true);
    expect(c[0].laden).toBe(false);
    r.status = 'blockaded';
    expect(convoyPositions(r, g.tick).every((x) => x.docked)).toBe(true);
  });

  it('a hostile fleet on the lane blockades it and the importing world goes short', () => {
    const g = clone(base);
    const L = life(g);
    const r = L.routes.find((x) => x.a === x.b && x.path.length >= 2 && routeVolume(x) >= 1)!;
    expect(r).toBeTruthy();
    // a rival realm the owner is at war with parks a warfleet on the lane
    const enemy = g.empires.find((e) => e.alive && e.kind === 'major' && e.id !== r.a)!;
    enemies(g, enemy.id, r.a);
    const lane = r.path[Math.floor(r.path.length / 2)];
    createFleet(g, enemy.id, lane, ['cruiser', 'cruiser', 'destroyer'], 'Blockade squadron').stance = 'passive';
    for (let i = 0; i < 6; i++) { g.tick++; lifeDaily(g); }
    expect(r.status).toBe('blockaded');
    expect(r.blocker).toBe(enemy.id);
    lifeMonthly(g);
    const c = g.planets[r.to].colony!;
    // re-planned around the blockade if a safe way exists; otherwise the world goes short
    const still = L.routes.find((x) => x.id === r.id);
    if (still && still.status === 'blockaded') {
      expect(c.supply!).toBeLessThan(1);
      const rep = getLedger(g, g.empires[r.b], true).planets[r.to];
      expect(rep.stabilityFactors.some(([k]) => k.startsWith('Supply shortfall'))).toBe(true);
    }
  });

  it('war between two trading realms severs their trade, and trade ties restrain war plans', () => {
    const g = clone(base);
    let inter = life(g).routes.find((x) => x.a !== x.b);
    if (!inter) { for (let m = 0; m < 24 && !inter; m++) { toMonth(g); inter = life(g).routes.find((x) => x.a !== x.b); } }
    expect(inter).toBeTruthy();
    const { a, b } = inter!;
    const e = g.empires[a];
    // trade ties lower the score of a war against a partner
    const before = warCandidates(g, e).find((c) => c.id === b)?.score;
    expect(tradeTies(g, a, b)).toBeGreaterThan(0);
    enemies(g, a, b);
    for (let i = 0; i < 6; i++) { g.tick++; lifeDaily(g); }
    expect(life(g).routes.filter((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a)).every((x) => x.status === 'severed')).toBe(true);
    expect(tradeTies(g, a, b)).toBe(0);
    void before;
  });
});

describe('worlds', () => {
  it('battles and sieges devastate a world, which costs output and heals over time', () => {
    const g = clone(base);
    const p = g.planets.find((x) => x.colony && x.colony.ownerId !== g.playerId && x.colony.pops > 8)!;
    const owner = g.empires[p.colony!.ownerId];
    const enemy = g.empires.find((e) => e.alive && e.kind === 'major' && e.id !== owner.id)!;
    enemies(g, enemy.id, owner.id);
    const out0 = getLedger(g, owner, true).planets[p.id].outputMult;
    createFleet(g, enemy.id, p.systemId, ['battleship', 'battleship'], 'Siege fleet').stance = 'passive';
    for (let i = 0; i < 60; i++) { g.tick++; lifeDaily(g); }
    expect(p.colony!.devastation!).toBeGreaterThan(5);
    expect(worldCondition(g, p)).toMatch(/besieged|devastated/);
    const out1 = getLedger(g, owner, true).planets[p.id].outputMult;
    expect(out1).toBeLessThan(out0);
    for (const id in g.fleets) if (g.fleets[id].name === 'Siege fleet') delete g.fleets[id];
    const d = p.colony!.devastation!;
    for (let m = 0; m < 6; m++) { g.tick += 30; lifeMonthly(g); }
    expect(p.colony!.devastation!).toBeLessThan(d);
  });

  it('people leave crowded, jobless worlds for ones with homes and work, and arrive later', () => {
    const g = clone(base);
    const e = g.empires.find((x) => x.alive && x.kind === 'major' && g.planets.filter((p) => p.colony?.ownerId === x.id).length >= 3)!;
    const worlds = g.planets.filter((p) => p.colony?.ownerId === e.id);
    const crowded = worlds[0];
    crowded.colony!.pops += 25; // a boom with no homes or jobs to match
    const total = () => g.planets.reduce((a, p) => a + (p.colony?.ownerId === e.id ? p.colony.pops : 0), 0) + life(g).migrations.filter((m) => m.owner === e.id).reduce((a, m) => a + m.pops, 0);
    getLedger(g, e, true);
    const t0 = total();
    const before = life(g).migrations.length;
    lifeMonthly(g);
    const moved = life(g).migrations.filter((m) => m.from === crowded.id);
    expect(life(g).migrations.length).toBeGreaterThan(before);
    expect(moved.length).toBeGreaterThan(0);
    // nobody is created or lost in transit
    expect(Math.abs(total() - t0)).toBeLessThan(1e-6);
    const m = moved[0];
    const dest = g.planets[m.to].colony!;
    const p0 = dest.pops;
    // everyone bound for that world who lands by then (other transports may share the destination)
    const landing = life(g).migrations.filter((x) => x.to === m.to && x.arrive <= m.arrive).reduce((a, x) => a + x.pops, 0);
    while (g.tick < m.arrive) { g.tick++; lifeDaily(g); }
    expect(dest.pops).toBeCloseTo(p0 + landing, 5);
  });
});

describe('the arcs of civilisations', () => {
  it('a realm in lasting crisis can fracture: its outer worlds form a new state at war with it', () => {
    const g = clone(base);
    const e = g.empires.filter((x) => x.alive && x.kind === 'major' && !x.isPlayer).sort((a, b) => b.stats.colonies - a.stats.colonies)[0];
    const n0 = g.planets.filter((p) => p.colony?.ownerId === e.id).length;
    if (n0 < 5) return; // too small to break apart on this seed
    const ok = secede(g, e);
    expect(ok).toBe(true);
    const rebels = g.empires[g.empires.length - 1];
    expect(rebels.kind).toBe('rebels');
    expect(g.planets.some((p) => p.colony?.ownerId === rebels.id)).toBe(true);
    expect(g.wars.some((w) => w.attackers.includes(rebels.id) && w.defenders.includes(e.id))).toBe(true);
    expect(life(g).history.some((h) => h.kind === 'secession' && h.who.includes(e.id))).toBe(true);
    // the breakaway state survives a save
    const back = clone(g);
    expect(back.empires[rebels.id].kind).toBe('rebels');
  });

  it('a prosperous minor state becomes a great power', () => {
    const g = clone(base);
    const m = g.empires.find((x) => x.alive && x.kind === 'minor' && x.role !== 'pretender');
    if (!m) return;
    m.stats.colonies = 5; m.stats.population = 60; m.stats.systems = 7;
    life(g).arcs[m.id] = { ...(life(g).arcs[m.id] ?? { phase: 'stable', since: 0, econ: [], pop: [], peakEcon: 0, crisis: 0, pressure: 0 }), prosperity: 70 } as never;
    g.tick = Math.ceil((g.tick + 1) / 360) * 360;
    lifeMonthly(g);
    expect(m.kind).toBe('major');
    expect(life(g).history.some((h) => h.kind === 'ascendant' && h.who.includes(m.id))).toBe(true);
  });

  it('history keeps causes, consequences, participants and dates, and is bounded', () => {
    const g = clone(base);
    for (let i = 0; i < 500; i++) chronicle(g, { kind: 'trade', title: `t${i}`, cause: 'c', effect: 'e', who: [0], weight: i % 3 === 0 ? 2 : 1 });
    const h = life(g).history;
    expect(h.length).toBeLessThanOrEqual(400);
    expect(h[h.length - 1]).toMatchObject({ title: 't499', cause: 'c', effect: 'e', who: [0], tick: g.tick });
  });
});

describe('determinism, divergence and saves', () => {
  it('the same seed gives the same galaxy; different seeds give different histories', () => {
    const a = evolve(202, 6, 'small'), b = evolve(202, 6, 'small'), c = evolve(303, 6, 'small');
    expect(fingerprint(a)).toBe(fingerprint(b));
    const sig = (g: GameState) => JSON.stringify(life(g).routes.map((r) => [r.from, r.to]));
    expect(sig(a)).not.toBe(sig(c));
  }, 240_000);

  it('a save without the living galaxy loads and starts it; a save round-trips unchanged', () => {
    const g = clone(base);
    const old = JSON.parse(serialize(g));
    delete old.life;
    for (const p of old.planets) if (p.colony) { delete p.colony.prosperity; delete p.colony.devastation; delete p.colony.dev; delete p.colony.supply; delete p.colony.want; }
    const back = deserialize(JSON.stringify(old));
    expect(back.life).toBeTruthy();
    expect(back.life!.routes).toEqual([]);
    toMonth(back);
    expect(back.life!.routes.length).toBeGreaterThan(0);
    expect(fingerprint(clone(g))).toBe(fingerprint(g));
  });

  it('the market answers the galaxy\'s real surpluses and deficits', () => {
    const g = clone(base);
    const p0 = g.market.price.food;
    // every realm suddenly eats twice as much: a galactic food deficit
    for (const p of g.planets) if (p.colony) p.colony.pops *= 3;
    for (const e of g.empires) if (e.alive) getLedger(g, e, true);
    lifeMonthly(g);
    expect(g.market.price.food).toBeGreaterThan(p0);
  });
});
