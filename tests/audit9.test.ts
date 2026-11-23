// Regression tests for the nine issues reported by an external audit. Each test was written to
// reproduce the reported problem before any fix (see docs/AUDIT9.md for which ones did); the ones
// that describe current, correct behaviour guard against the problem appearing later.
import { describe, expect, it, beforeEach } from 'vitest';
import { newGame, step, runDays, getLedger } from '../src/sim/engine';
import { execute, MARKET_BASE } from '../src/sim/commands';
import { serialize, deserialize } from '../src/sim/save';
import { createFleet } from '../src/sim/fleets';
import { declareWar, signTreaty, breakTreaty } from '../src/sim/diplomacy';
import { setSystemOwner, supplyNetwork, ownedSystems } from '../src/sim/territory';
import { adjacency } from '../src/sim/galaxy';
import { RESOURCES, type GameState, type ResId } from '../src/sim/types';
import { __cloudTestHooks, cloudWrite, cloudRead, cloudDelete, cloudList } from '../src/persistence/cloud';
import { FakeFirestore } from './fixtures/fakeFirestore';

const fresh = (seed = 5, size: GameState['settings']['galaxySize'] = 'small') => newGame({ seed, galaxySize: size, aiCount: 3 });

// ---------------------------------------------------------------- 1. market
describe('1. market transactions', () => {
  const rich = () => {
    const g = fresh();
    const e = g.empires[g.playerId];
    e.stock.credits = 1_000_000;
    return { g, e };
  };

  it('a buy-then-sell cycle never makes money, at any size, repeated', () => {
    for (const res of ['alloys', 'minerals', 'rare'] as ResId[]) for (const amount of [50, 1500, 3000, 6000]) {
      const { g, e } = rich();
      const cap = getLedger(g, e).cap[res];
      const start = e.stock.credits + e.stock[res] * 0; // credits only: the goods are sold back
      for (let i = 0; i < 10; i++) {
        const before = e.stock[res];
        const buy = execute(g, g.playerId, { type: 'market', res, amount: Math.min(amount, Math.floor(cap - e.stock[res])) });
        if (!buy.ok) break;
        const bought = e.stock[res] - before;
        execute(g, g.playerId, { type: 'market', res, amount: -bought });
      }
      expect(e.stock.credits, `${res} x${amount}`).toBeLessThanOrEqual(start);
    }
  });

  it('dumping goods then buying them back never makes money either', () => {
    const { g, e } = rich();
    e.stock.alloys = 4000;
    const startValue = e.stock.credits;
    for (let i = 0; i < 10; i++) {
      const have = Math.floor(e.stock.alloys);
      execute(g, g.playerId, { type: 'market', res: 'alloys', amount: -have });
      execute(g, g.playerId, { type: 'market', res: 'alloys', amount: have });
    }
    expect(e.stock.alloys).toBeLessThanOrEqual(4000);
    expect(e.stock.credits).toBeLessThan(startValue);
  });

  it('a large sale is priced along the falling price, not all at the opening price', () => {
    const { g, e } = rich();
    e.stock.minerals = 10_000;
    const p0 = g.market.price.minerals;
    const before = e.stock.credits;
    expect(execute(g, g.playerId, { type: 'market', res: 'minerals', amount: -6000 }).ok).toBe(true);
    const got = e.stock.credits - before;
    expect(got).toBeLessThan(6000 * p0 * 0.8);
    expect(got).toBeGreaterThan(0);
  });

  it('prices stay within their bounds after any sequence of trades', () => {
    const { g, e } = rich();
    for (const r of RESOURCES) if (r !== 'credits' && r !== 'influence') e.stock[r] = 50_000;
    const seq = [9000, -20000, 3000, -3000, 12000, -50000, 1, -1];
    for (const res of ['minerals', 'alloys', 'food'] as ResId[]) for (const a of seq) {
      execute(g, g.playerId, { type: 'market', res, amount: a });
      const p = g.market.price[res];
      expect(p).toBeGreaterThanOrEqual(MARKET_BASE[res] * 0.25 - 1e-9);
      expect(p).toBeLessThanOrEqual(MARKET_BASE[res] * 4 + 1e-9);
    }
  });

  it('malformed orders are refused and change nothing', () => {
    const { g, e } = rich();
    const snap = JSON.stringify({ stock: e.stock, price: g.market.price });
    const bad: unknown[] = [
      { res: 'alloys', amount: NaN }, { res: 'alloys', amount: Infinity }, { res: 'alloys', amount: -Infinity },
      { res: 'alloys', amount: 1e308 }, { res: 'alloys', amount: -1e308 }, { res: 'alloys', amount: '50' }, { res: 'alloys', amount: undefined },
      { res: 'credits', amount: 10 }, { res: 'influence', amount: 10 }, { res: 'unobtainium', amount: 10 }, { res: undefined, amount: 10 },
      { res: '__proto__', amount: 10 }, { res: 'toString', amount: 10 },
    ];
    for (const b of bad) {
      const r = execute(g, g.playerId, { type: 'market', ...(b as object) } as never);
      expect(r.ok, JSON.stringify(b)).toBe(false);
    }
    expect(JSON.stringify({ stock: e.stock, price: g.market.price })).toBe(snap);
    for (const r of RESOURCES) expect(Number.isFinite(e.stock[r])).toBe(true);
  });

  it('cannot buy more than storage can hold (credits are not spent on goods that would be thrown away)', () => {
    const { g, e } = rich();
    const cap = getLedger(g, e).cap.alloys;
    e.stock.alloys = cap - 100;
    const credits = e.stock.credits;
    const r = execute(g, g.playerId, { type: 'market', res: 'alloys', amount: 5000 });
    expect(r.ok).toBe(false);
    expect(e.stock.credits).toBe(credits);
    expect(execute(g, g.playerId, { type: 'market', res: 'alloys', amount: 100 }).ok).toBe(true);
  });

  it('ordinary small trades still cost about the quoted price', () => {
    const { g, e } = rich();
    const p = g.market.price.minerals;
    const before = e.stock.credits;
    execute(g, g.playerId, { type: 'market', res: 'minerals', amount: 100 });
    const paid = before - e.stock.credits;
    expect(paid).toBeGreaterThanOrEqual(Math.floor(100 * p * 1.2));
    expect(paid).toBeLessThanOrEqual(Math.ceil(100 * p * 1.2 * 1.03));
  });
});

// ---------------------------------------------------------------- 2. zero population
describe('2. colonies with no population', () => {
  it('a colony at zero population yields finite figures and keeps simulating', () => {
    const g = fresh();
    const e = g.empires[g.playerId];
    const p = g.planets[e.capitalPlanetId!];
    p.colony!.pops = 0;
    const L = getLedger(g, e, true);
    const r = L.planets[p.id];
    for (const v of [r.stabilityTarget, r.growth, r.garrison, r.unemployed, r.trade, r.outputMult]) expect(Number.isFinite(v)).toBe(true);
    for (const res of RESOURCES) expect(Number.isFinite(L.net[res])).toBe(true);
    runDays(g, 60);
    expect(Number.isFinite(p.colony?.stability ?? 0)).toBe(true);
    for (const res of RESOURCES) expect(Number.isFinite(e.stock[res])).toBe(true);
  });
});

// ---------------------------------------------------------------- 3. AI troops
describe('3. AI transports and invasions', () => {
  // B: one heavily fortified world; A: a strong fleet, rich, at war with it
  const fortress = (pops: number, garrisons: number) => {
    const g = fresh(21);
    const [a, b] = [1, 2];
    const A = g.empires[a], B = g.empires[b];
    const bCap = g.planets[B.capitalPlanetId!];
    for (const p of g.planets) if (p.colony?.ownerId === b && p !== bCap) p.colony = null;
    bCap.colony!.pops = pops;
    bCap.colony!.buildings.garrison = garrisons;
    bCap.colony!.buildings.planetary_shield = 1;
    for (const r of RESOURCES) A.stock[r] = 50_000;
    A.stock.influence = 500;
    g.truces = [];
    expect(declareWar(g, a, b)).toBeTruthy();
    createFleet(g, a, A.capitalSystemId!, ['battleship', 'battleship', 'battleship', 'battleship', 'battleship', 'battleship', 'cruiser', 'cruiser'], 'Armada');
    getLedger(g, B, true);
    return { g, a, b, A, bCap };
  };
  const troopsOf = (g: GameState, id: number) => Object.values(g.fleets).reduce((s, f) => s + (f.ownerId === id ? f.troops : 0), 0);

  it('an AI realm keeps raising troops past the old 96 ceiling for a fortress that needs them', async () => {
    const { garrisonEstimateForTest, TROOP_CEILING } = await import('../src/sim/ai');
    const { g, a, b, A, bCap } = fortress(40, 6);
    const need = garrisonEstimateForTest(g, A, bCap);
    expect(need).toBeGreaterThan(96);
    expect(need).toBeLessThanOrEqual(TROOP_CEILING);
    let maxTroops = 0;
    for (let d = 0; d < 360 * 6; d++) {
      step(g); g.gameOver = null;
      if (d % 30 === 0) { for (const r of RESOURCES) A.stock[r] = Math.max(A.stock[r], 20_000); maxTroops = Math.max(maxTroops, troopsOf(g, a)); }
      // B stays a lone fortress: its crowded people would otherwise settle softer targets nearby (sim/life.ts), and allies
      // who join it would offer the attacker softer worlds to invade instead
      for (const p of g.planets) if (p.colony?.ownerId === b && p !== bCap) p.colony = null;
      for (const w of g.wars) if (w.attackers.includes(a)) w.defenders = w.defenders.filter((x) => x === b);
      if (bCap.colony?.ownerId !== b || !g.wars.some((w) => w.attackers.includes(a) && w.defenders.includes(b))) break;
    }
    // before the fix the realm stopped at exactly 96 soldiers and waited in orbit for the rest of the war
    expect(bCap.colony?.ownerId === a || maxTroops > 96, `troops ${maxTroops} vs need ${need.toFixed(0)}`).toBe(true);
  }, 120_000);

  it('a world needing more soldiers than any landing can bring is not chosen as the target', async () => {
    const { garrisonEstimateForTest, TROOP_CEILING } = await import('../src/sim/ai');
    const { g, A, bCap } = fortress(90, 30);
    expect(garrisonEstimateForTest(g, A, bCap)).toBeGreaterThan(TROOP_CEILING);
    for (let d = 0; d < 360; d++) { step(g); g.gameOver = null; }
    expect(A.aiPlan?.troopsWanted ?? 0).toBeLessThanOrEqual(TROOP_CEILING);
  }, 120_000);
});

// ---------------------------------------------------------------- 4 & 6. cloud saves
describe('4/6. cloud saves', () => {
  let fake: FakeFirestore;
  const uid = 'user-a';
  const meta = (slot: string) => ({ slot, name: slot, realm: 'Test', tick: 1 });
  // incompressible text, so the gzip output spans several 700 kB chunks
  const bulky = (kb: number, seed = 1) => { let x = seed, s = ''; while (s.length < kb * 1024) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += x.toString(36); } return s; };
  beforeEach(() => { fake = new FakeFirestore(); __cloudTestHooks(fake.stub(), { uid, name: 'A', email: null, photo: null }); });

  it('4: overwriting a large save with a smaller one leaves no stale chunks, and delete removes everything', async () => {
    await cloudWrite(meta('s1'), bulky(2600));
    const big = fake.under(`users/${uid}/saves/s1/chunks/`).length;
    expect(big).toBeGreaterThan(1);
    await cloudWrite(meta('s1'), 'small');
    expect(await cloudRead('s1')).toBe('small');
    expect(fake.under(`users/${uid}/saves/s1/chunks/`).length).toBe(1);
    await cloudDelete('s1');
    expect(fake.under(`users/${uid}/saves/s1`)).toEqual([]);
  });

  it('4: a save with a missing chunk is reported clearly, not as a crash', async () => {
    await cloudWrite(meta('s2'), bulky(2600));
    const chunks = fake.under(`users/${uid}/saves/s2/chunks/`);
    fake.docs.delete(chunks[chunks.length - 1]);
    await expect(cloudRead('s2')).rejects.toThrow(/incomplete|missing/i);
  });

  it('4: a read that overlaps a write returns one whole save, never a mix', async () => {
    const A = bulky(2600, 1), B = bulky(1500, 2);
    await cloudWrite(meta('s3'), A);
    // the write of B lands between the read's metadata fetch and its chunk fetches
    const realGet = fake.sdk.getDoc;
    let injected = false;
    fake.sdk.getDoc = async (ref) => {
      const r = await realGet(ref);
      if (!injected && ref.path === `users/${uid}/saves/s3`) { injected = true; await cloudWrite(meta('s3'), B); }
      return r;
    };
    let out: string | null = null;
    try { out = await cloudRead('s3'); } catch (err) { out = `error: ${(err as Error).message}`; }
    fake.sdk.getDoc = realGet;
    expect(out === A || out === B || /incomplete|changed|try again/i.test(String(out)), String(out).slice(0, 80)).toBe(true);
  });

  it('4: two overlapping writes leave one consistent save and no orphaned chunks', async () => {
    const A = bulky(2600, 3), B = bulky(800, 4);
    fake.beforeCommit = () => cloudWrite(meta('s4'), B);
    await cloudWrite(meta('s4'), A);
    const got = await cloudRead('s4');
    expect(got === A || got === B).toBe(true);
    const metaDoc = fake.docs.get(`users/${uid}/saves/s4`)!;
    const chunks = fake.under(`users/${uid}/saves/s4/chunks/`);
    expect(chunks.length).toBe(metaDoc.parts as number);
  });

  it('4: a write landing while another write cleans up is left intact', async () => {
    const A = bulky(2600, 5), B = bulky(1200, 6);
    await cloudWrite(meta('s5'), bulky(3000, 7));
    fake.beforeTxCommit = () => cloudWrite(meta('s5'), B);
    await cloudWrite(meta('s5'), A);
    expect(await cloudRead('s5')).toBe(B);
    const m = fake.docs.get(`users/${uid}/saves/s5`)!;
    expect(fake.under(`users/${uid}/saves/s5/chunks/`).length).toBe(m.parts as number);
  });

  it('4: saves in the layout used before 1.0 are still read, and replaced cleanly', async () => {
    const { gzipSync } = await import('node:zlib');
    const packed = new Uint8Array(gzipSync(Buffer.from('legacy-save')));
    fake.docs.set(`users/${uid}/saves/old`, { slot: 'old', name: 'Old', realm: 'R', tick: 5, savedAt: 1, size: 11, parts: 2 });
    fake.docs.set(`users/${uid}/saves/old/chunks/0`, { b: fake.sdk.Bytes.fromUint8Array(packed.subarray(0, 10)) });
    fake.docs.set(`users/${uid}/saves/old/chunks/1`, { b: fake.sdk.Bytes.fromUint8Array(packed.subarray(10)) });
    expect(await cloudRead('old')).toBe('legacy-save');
    await cloudWrite(meta('old'), 'new-save');
    expect(await cloudRead('old')).toBe('new-save');
    expect(fake.under(`users/${uid}/saves/old/chunks/`).length).toBe(1);
  });

  it('6: slot ids that would leave the save document are refused on write, read and delete', async () => {
    await cloudWrite(meta('victim'), bulky(1600));
    const before = new Map(fake.docs);
    for (const slot of ['victim/chunks/0', 'a/b', '..', '.', '', '__x__', 'x'.repeat(201), 'bad slot', 'ünï']) {
      await expect(cloudWrite(meta(slot), 'evil'), `write ${slot}`).rejects.toThrow(/slot/i);
      await expect(cloudRead(slot), `read ${slot}`).rejects.toThrow(/slot/i);
      await expect(cloudDelete(slot), `delete ${slot}`).rejects.toThrow(/slot/i);
    }
    expect(fake.docs).toEqual(before);
  });

  it('6: every operation stays inside the signed-in user\'s own folder', async () => {
    await cloudWrite(meta('mine'), 'a-data');
    __cloudTestHooks(fake.stub(), { uid: 'user-b', name: 'B', email: null, photo: null });
    expect(await cloudRead('mine')).toBeNull();
    expect(await cloudList()).toEqual([]);
    await cloudWrite(meta('mine'), 'b-data');
    await cloudDelete('mine');
    expect(fake.under('users/user-a/saves/mine').length).toBeGreaterThan(0);
    for (const p of fake.docs.keys()) expect(p.startsWith('users/user-a/') || p.startsWith('users/user-b/')).toBe(true);
    __cloudTestHooks(fake.stub(), null);
    await expect(cloudWrite(meta('mine'), 'x')).rejects.toThrow(/sign in/i);
    expect(await cloudRead('mine')).toBeNull();
  });

  it('6: save names that differ only in punctuation get different slots', async () => {
    const { slotForName } = await import('../src/persistence/slots');
    const a = slotForName('My Save!'), b = slotForName('My Save?'), c = slotForName('my save');
    expect(new Set([a, b, c]).size).toBe(3);
    expect(slotForName('My Save!')).toBe(a); // stable: saving again overwrites the same slot
    for (const s of [a, b, c, slotForName(''), slotForName('/../..'), slotForName('x'.repeat(500))]) expect(s).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
  });
});

// ---------------------------------------------------------------- 5. combat
describe('5. near-destroyed starbases', () => {
  it('a starbase left with a sliver of hull does not freeze the siege: the system falls', () => {
    const g = fresh(31);
    const [a, b] = [1, 2];
    g.empires[a].stock.influence = 500;
    g.truces = [];
    // a system of B's without a colony of B's, guarded only by a nearly destroyed starbase
    const sid = ownedSystems(g, b).find((s) => !g.galaxy.systems[s].planetIds.some((p) => g.planets[p].colony?.ownerId === b) && s !== g.empires[b].capitalSystemId)
      ?? (() => { const s = g.galaxy.systems.find((x) => x.owner == null)!; setSystemOwner(g, s.id, b); s.starbase = 1; return s.id; })();
    const sys = g.galaxy.systems[sid];
    for (const f of Object.values(g.fleets)) if (f.systemId === sid) delete g.fleets[f.id];
    sys.starbase = Math.max(1, sys.starbase);
    sys.starbaseDamage = 0.995;
    expect(declareWar(g, a, b)).toBeTruthy();
    createFleet(g, a, sid, ['cruiser', 'cruiser', 'destroyer'], 'Siege').stance = 'aggressive';
    for (let d = 0; d < 20 && sys.owner === b; d++) step(g);
    expect(sys.owner).toBe(a);
  });

  it('battles end once one side has nothing left that can fight', () => {
    const g = fresh(32);
    const [a, b] = [1, 2];
    g.empires[a].stock.influence = 500;
    g.truces = [];
    expect(declareWar(g, a, b)).toBeTruthy();
    const s = g.galaxy.systems.find((x) => x.owner == null && x.planetIds.length === 0) ?? g.galaxy.systems.find((x) => x.owner == null)!;
    createFleet(g, a, s.id, ['battleship', 'battleship', 'cruiser'], 'Big');
    createFleet(g, b, s.id, ['corvette'], 'Small');
    for (let d = 0; d < 30; d++) step(g);
    expect(g.battles.filter((x) => x.systemId === s.id && x.ongoing)).toEqual([]);
  });
});

// ---------------------------------------------------------------- 7. corrupted saves
describe('7. corrupted saves', () => {
  const good = () => JSON.parse(serialize(fresh(41))) as Record<string, any>;
  const cases: [string, (s: Record<string, any>) => void][] = [
    ['empires is not a list', (s) => { s.empires = {}; }],
    ['no empires', (s) => { s.empires = []; }],
    ['player id out of range', (s) => { s.playerId = 99; }],
    ['tick is not a number', (s) => { s.tick = 'soon'; }],
    ['a stock value is missing (NaN written as null)', (s) => { s.empires[0].stock.credits = null; }],
    ['a stock value is text', (s) => { s.empires[1].stock.alloys = '12'; }],
    ['a planet points at a missing system', (s) => { s.planets[0].systemId = 99999; }],
    ['a system lists a missing planet', (s) => { s.galaxy.systems[0].planetIds = [99999]; }],
    ['a colony belongs to a missing realm', (s) => { const p = s.planets.find((x: any) => x.colony); p.colony.ownerId = 77; }],
    ['a fleet sits in a missing system', (s) => { const f = Object.values(s.fleets)[0] as any; f.systemId = -5; }],
    ['a fleet has no ship list', (s) => { const f = Object.values(s.fleets)[0] as any; f.ships = null; }],
    ['a lane joins a missing system', (s) => { s.galaxy.lanes.push([0, 99999]); }],
    ['population is not a number', (s) => { const p = s.planets.find((x: any) => x.colony); p.colony.pops = null; }],
    ['the market price is missing', (s) => { s.market.price.alloys = null; }],
    ['the random state is missing', (s) => { s.rng = null; }],
  ];
  for (const [what, corrupt] of cases) {
    it(`refuses a save where ${what}`, () => {
      const s = good();
      corrupt(s);
      expect(() => deserialize(JSON.stringify(s))).toThrow(/corrupt|unsupported|not a star dominion/i);
    });
  }
  it('still loads legitimate saves, including ones with harmless out-of-range values', () => {
    const g = fresh(42);
    runDays(g, 400);
    const s = JSON.parse(serialize(g));
    // values the engine itself has been seen to produce must not make a save unloadable
    const p = s.planets.find((x: any) => x.colony);
    p.colony.resistance = 100.6; p.colony.stability = -0.6;
    const back = deserialize(JSON.stringify(s));
    expect(back.tick).toBe(g.tick);
    runDays(back, 30);
  });
});

// ---------------------------------------------------------------- 8. route cache
describe('8. supply network and route cache', () => {
  it('routes follow ownership changes made the same day', () => {
    const g = fresh(51);
    const e = g.empires[g.playerId];
    const cap = e.capitalSystemId!;
    const adj = adjacency(g.galaxy);
    const n1 = adj[cap].find((v) => g.galaxy.systems[v].owner == null)!;
    setSystemOwner(g, n1, e.id);
    const net1 = supplyNetwork(g, e.id);
    expect(net1.has(n1)).toBe(true);
    setSystemOwner(g, n1, null);
    expect(supplyNetwork(g, e.id).has(n1)).toBe(false);
  });

  it('the supply network follows a pact turned into an alliance on the same day', () => {
    const g = fresh(52);
    const me = g.playerId;
    const adj = adjacency(g.galaxy);
    const cap = g.empires[me].capitalSystemId!;
    const other = 1;
    const border = adj[cap].find((v) => g.galaxy.systems[v].owner == null)!;
    setSystemOwner(g, border, other);
    signTreaty(g, me, other, 'nap');
    expect(supplyNetwork(g, me).has(border)).toBe(false);
    breakTreaty(g, me, other, 'nap', true);
    signTreaty(g, me, other, 'alliance');
    expect(supplyNetwork(g, me).has(border)).toBe(true);
  });
});

// ---------------------------------------------------------------- 9. megastructures under blockade
describe('9. megastructures and hostile warships', () => {
  const setup = () => {
    const g = fresh(61);
    const e = g.empires[g.playerId];
    e.research.done.push('en_dyson', 'en_stellar_collector', 'def_bastion');
    for (const r of RESOURCES) e.stock[r] = 100_000;
    const sid = e.capitalSystemId!;
    const enemy = 1;
    g.empires[enemy].stock.influence = 500;
    g.truces = [];
    return { g, e, sid, enemy };
  };

  it('a great project cannot be started while enemy warships hold the system', () => {
    const { g, sid, enemy } = setup();
    expect(declareWar(g, enemy, g.playerId)).toBeTruthy();
    createFleet(g, enemy, sid, ['battleship', 'battleship'], 'Blockade');
    const r = execute(g, g.playerId, { type: 'startMegastructure', systemId: sid, mega: 'bastion' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/hostile|enemy/i);
  });

  it('work on a great project pauses (and is not charged) while enemy warships are present, then resumes', async () => {
    const { hostileArmedPresence } = await import('../src/sim/territory');
    const { MEGA_BY_ID } = await import('../src/sim/data/megastructures');
    const { megaInstalment } = await import('../src/sim/construction');
    const { progressConstruction } = await import('../src/sim/construction');
    const { g, e, sid, enemy } = setup();
    expect(execute(g, g.playerId, { type: 'startMegastructure', systemId: sid, mega: 'bastion' }).ok).toBe(true);
    const m = g.galaxy.systems[sid].megastructures.find((x) => x.id === 'bastion')!;
    runDays(g, 5);
    expect(m.progress + m.stage * 1000).toBeGreaterThan(0);
    expect(declareWar(g, enemy, g.playerId)).toBeTruthy();
    createFleet(g, enemy, sid, ['battleship', 'battleship'], 'Blockade');
    expect(hostileArmedPresence(g, g.playerId, sid)).toBe(true);
    // construction alone, so combat and the economy do not move the fleet or the stockpile
    const before = m.progress + m.stage * 1000;
    const cost = Object.keys(megaInstalment(MEGA_BY_ID.bastion));
    const stock0 = cost.map((k) => e.stock[k as ResId]);
    for (let d = 0; d < 10; d++) progressConstruction(g);
    expect(m.progress + m.stage * 1000).toBe(before);
    expect(cost.map((k) => e.stock[k as ResId])).toEqual(stock0);
    for (const f of Object.values(g.fleets)) if (f.ownerId === enemy && f.systemId === sid) delete g.fleets[f.id];
    for (let d = 0; d < 3; d++) progressConstruction(g);
    expect(m.progress + m.stage * 1000).toBeGreaterThan(before);
  });
});
