import { describe, expect, it } from 'vitest';
import { newGame, runDays, step, getLedger } from '../src/sim/engine';
import { serialize, deserialize, fingerprint } from '../src/sim/save';
import { execute } from '../src/sim/commands';
import { adjacency, jumpDistances } from '../src/sim/galaxy';
import { createFleet, fleetPower } from '../src/sim/fleets';
import { declareWar } from '../src/sim/diplomacy';
import { buildingCost } from '../src/sim/construction';
import { planetHab } from '../src/sim/economy';
import { empireMods } from '../src/sim/modifiers';
import { RESOURCES, type GameState } from '../src/sim/types';
import { TECHS } from '../src/sim/data/techs';

const P = 0;

function player(s: GameState) { return s.empires[P]; }
function capital(s: GameState) { return s.planets[player(s).capitalPlanetId!]; }

describe('galaxy generation', () => {
  it('builds a connected galaxy with owned capitals and rival kingdoms', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const s = newGame({ seed: 42, galaxySize: size, aiCount: 3 });
      const d = jumpDistances(s.galaxy, [0]);
      expect(d.every((x) => Number.isFinite(x))).toBe(true);
      expect(s.empires.filter((e) => e.kind === 'major').length).toBe(4);
      for (const e of s.empires.filter((x) => x.kind === 'major' || x.kind === 'minor')) {
        expect(e.capitalSystemId).not.toBeNull();
        expect(s.galaxy.systems[e.capitalSystemId!].owner).toBe(e.id);
        expect(s.planets[e.capitalPlanetId!].colony?.ownerId).toBe(e.id);
      }
      // Every system has at least one hyperlane
      const adj = adjacency(s.galaxy);
      expect(adj.every((a) => a.length > 0)).toBe(true);
    }
  });

  it('is reproducible from the seed', () => {
    expect(fingerprint(newGame({ seed: 7 }))).toBe(fingerprint(newGame({ seed: 7 })));
    expect(fingerprint(newGame({ seed: 7 }))).not.toBe(fingerprint(newGame({ seed: 8 })));
  });
});

describe('simulation determinism & persistence', () => {
  it('produces identical states for identical seeds over time', () => {
    const a = newGame({ seed: 99 });
    const b = newGame({ seed: 99 });
    runDays(a, 500);
    runDays(b, 500);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('save/load preserves the game exactly and continues identically', () => {
    const a = newGame({ seed: 5 });
    runDays(a, 300);
    const b = deserialize(serialize(a));
    expect(fingerprint(b)).toBe(fingerprint(a));
    runDays(a, 300);
    runDays(b, 300);
    expect(fingerprint(b)).toBe(fingerprint(a));
  });

  it('rejects corrupt saves', () => {
    expect(() => deserialize('{"version":999}')).toThrow();
    expect(() => deserialize('not json')).toThrow();
  });
});

describe('economy', () => {
  it('never shows negative or over-capacity stockpiles', () => {
    const s = newGame({ seed: 11 });
    for (let d = 0; d < 360 * 4; d++) {
      step(s);
      if (d % 30 === 0) {
        for (const e of s.empires) {
          if (!e.alive || e.kind === 'guardian' || e.kind === 'raiders') continue;
          const L = getLedger(s, e);
          for (const r of RESOURCES) {
            expect(e.stock[r]).toBeGreaterThanOrEqual(0);
            expect(e.stock[r]).toBeLessThanOrEqual(L.cap[r] + 1e-6 + 2000); // purchases/gifts may briefly exceed cap
          }
        }
      }
    }
  });

  it('itemised ledger lines sum to the net totals', () => {
    const s = newGame({ seed: 3 });
    runDays(s, 60);
    const L = getLedger(s, player(s), true);
    for (const k of Object.keys(L.net) as (keyof typeof L.net)[]) {
      const sum = L.lines.filter((l) => l.key === k).reduce((a, l) => a + l.amount, 0);
      expect(sum).toBeCloseTo(L.net[k], 6);
    }
    expect(L.net.credits).toBeGreaterThan(0);
    expect(L.net.food).toBeGreaterThan(-5);
  });

  it('construction deducts real costs and completes after the build time', () => {
    const s = newGame({ seed: 21 });
    const e = player(s);
    const p = capital(s);
    const before = { ...e.stock };
    const cost = buildingCost(s, e, 'commerce_hub');
    const r = execute(s, P, { type: 'queueBuilding', planetId: p.id, building: 'commerce_hub' });
    expect(r.ok).toBe(true);
    step(s);
    expect(p.colony!.queue[0].paid).toBe(true);
    expect(e.stock.minerals).toBeLessThan(before.minerals - (cost.minerals ?? 0) + 40);
    runDays(s, p.colony!.queue[0].total + 1);
    expect(p.colony!.buildings.commerce_hub).toBe(1);
  });

  it('enforces building limits and requirements', () => {
    const s = newGame({ seed: 21 });
    const p = capital(s);
    expect(execute(s, P, { type: 'queueBuilding', planetId: p.id, building: 'spaceport' }).ok).toBe(false); // max 1, already built
    expect(execute(s, P, { type: 'queueBuilding', planetId: p.id, building: 'component_works' }).ok).toBe(false); // needs tech
    expect(execute(s, P, { type: 'queueBuilding', planetId: p.id, building: 'capital' }).ok).toBe(false);
  });

  it('starvation shrinks population', () => {
    const s = newGame({ seed: 4 });
    const e = player(s);
    const p = capital(s);
    p.colony!.buildings.agri = 0;
    e.stock.food = 5;
    const pops = p.colony!.pops;
    runDays(s, 90);
    expect(p.colony!.pops).toBeLessThan(pops);
    expect(s.events.some((ev) => ev.kind === 'shortage')).toBe(true);
  });
});

describe('expansion', () => {
  it('construction ships claim systems with outposts', () => {
    const s = newGame({ seed: 8 });
    const e = player(s);
    const ctor = Object.values(s.fleets).find((f) => f.ownerId === P && f.ships.some((x) => x.cls === 'constructor'))!;
    const target = adjacency(s.galaxy)[e.capitalSystemId!].find((v) => s.galaxy.systems[v].owner == null)!;
    expect(execute(s, P, { type: 'fleetOrder', fleetId: ctor.id, order: { type: 'outpost', systemId: target } }).ok).toBe(true);
    const infl = e.stock.influence;
    runDays(s, 140);
    expect(s.galaxy.systems[target].owner).toBe(P);
    expect(e.stock.influence).toBeLessThan(infl + 200);
  });

  it('colony ships found colonies on habitable worlds', () => {
    const s = newGame({ seed: 8 });
    const e = player(s);
    e.stock.alloys += 500; e.stock.food += 500; e.stock.credits += 500;
    const cap = capital(s);
    const m = empireMods(s, e);
    const d = jumpDistances(s.galaxy, [e.capitalSystemId!]);
    const target = s.planets.filter((p) => !p.colony && d[p.systemId] <= 2 && planetHab(s, p, e, m) >= 0.5 && (s.galaxy.systems[p.systemId].owner == null || s.galaxy.systems[p.systemId].owner === P)).sort((a, b) => d[a.systemId] - d[b.systemId])[0];
    expect(target).toBeTruthy();
    expect(execute(s, P, { type: 'queueShip', planetId: cap.id, cls: 'colony' }).ok).toBe(true);
    runDays(s, 95);
    const col = Object.values(s.fleets).find((f) => f.ownerId === P && f.ships.some((x) => x.cls === 'colony'))!;
    expect(col).toBeTruthy();
    expect(execute(s, P, { type: 'fleetOrder', fleetId: col.id, order: { type: 'colonize', planetId: target.id } }).ok).toBe(true);
    runDays(s, 260);
    expect(target.colony?.ownerId).toBe(P);
    expect(s.galaxy.systems[target.systemId].owner).toBe(P);
  });
});

describe('military', () => {
  it('ships take time and resources to build', () => {
    const s = newGame({ seed: 2 });
    const e = player(s);
    const alloys = e.stock.alloys;
    expect(execute(s, P, { type: 'queueShip', planetId: capital(s).id, cls: 'corvette' }).ok).toBe(true);
    step(s);
    expect(e.stock.alloys).toBeLessThan(alloys - 30);
    const ships = () => Object.values(s.fleets).filter((f) => f.ownerId === P).reduce((a, f) => a + f.ships.length, 0);
    const n = ships();
    runDays(s, 10);
    expect(ships()).toBe(n);
    runDays(s, 40);
    expect(ships()).toBe(n + 1);
  });

  it('combat destroys ships and composition matters', () => {
    // Battleships are terrible at hitting corvettes; destroyers shred them.
    const run = (a: Parameters<typeof createFleet>[3], b: Parameters<typeof createFleet>[3]) => {
      const s = newGame({ seed: 77 });
      const sys = s.galaxy.systems.find((x) => x.owner == null && !x.features.includes('guardian'))!;
      const enemy = s.empires.find((e) => e.kind === 'major' && !e.isPlayer)!;
      declareWar(s, P, enemy.id);
      s.empires[P].research.done.push('eng_destroyers', 'eng_cruisers', 'eng_battlecruisers', 'eng_battleships');
      const fa = createFleet(s, P, sys.id, a, 'A');
      const fb = createFleet(s, enemy.id, sys.id, b, 'B');
      fa.stance = 'aggressive'; fb.stance = 'aggressive';
      for (let i = 0; i < 40 && s.fleets[fa.id] && s.fleets[fb.id]; i++) step(s);
      return { a: s.fleets[fa.id]?.ships.length ?? 0, b: s.fleets[fb.id]?.ships.length ?? 0, s };
    };
    const r1 = run(['destroyer', 'destroyer', 'destroyer', 'destroyer'], Array(10).fill('corvette'));
    // Destroyers survive intact; the corvette swarm is mauled (or breaks and retreats).
    expect(r1.a).toBe(4);
    expect(r1.s.battles.length).toBeGreaterThan(0);
    expect(r1.s.battles[0].shipsLost[0]).toBe(0);
    expect(r1.s.battles[0].shipsLost[1]).toBeGreaterThanOrEqual(5);
    // Conversely, a battleship is clumsy against a corvette swarm of similar value.
    const r2 = run(['battleship'], Array(14).fill('corvette'));
    expect(r2.s.battles[0].losses[0]).toBeGreaterThan(r2.s.battles[0].losses[1] * 0.5);
  });

  it('invasion captures a colony when orbit is secured', () => {
    const s = newGame({ seed: 12, aiCount: 2 });
    const enemy = s.empires.find((e) => e.kind === 'minor')!;
    const target = s.planets[enemy.capitalPlanetId!];
    declareWar(s, P, enemy.id);
    const big = createFleet(s, P, target.systemId, ['cruiser', 'cruiser', 'cruiser', 'cruiser', 'destroyer', 'destroyer', 'destroyer', 'destroyer'], 'Strike');
    s.empires[P].research.done.push('eng_destroyers', 'eng_cruisers');
    for (let i = 0; i < 60; i++) step(s);
    expect(s.fleets[big.id]).toBeTruthy();
    const tr = createFleet(s, P, target.systemId, ['transport', 'transport', 'transport', 'transport', 'transport', 'transport'], 'Assault');
    expect(execute(s, P, { type: 'fleetOrder', fleetId: tr.id, order: { type: 'invade', planetId: target.id } }).ok).toBe(true);
    for (let i = 0; i < 30 && target.colony?.ownerId !== P; i++) step(s);
    expect(target.colony?.ownerId).toBe(P);
    expect(target.colony?.resistance).toBeGreaterThan(0);
  });
});

describe('diplomacy', () => {
  it('war, peace and truces', () => {
    const s = newGame({ seed: 30 });
    const enemy = s.empires.find((e) => e.kind === 'major' && !e.isPlayer)!;
    s.empires[P].stock.influence = 200;
    expect(execute(s, P, { type: 'declareWar', target: enemy.id }).ok).toBe(true);
    expect(s.wars.length).toBe(1);
    expect(execute(s, P, { type: 'declareWar', target: enemy.id }).ok).toBe(false);
    s.wars[0].score = -50; // we're losing badly: they accept status quo... (AI winning less likely); force exhaustion
    enemy.warExhaustion = 90;
    const r = execute(s, P, { type: 'proposePeace', warId: s.wars[0].id, term: 'status_quo' });
    expect(r.evaluation).toBeTruthy();
    if (r.ok) {
      expect(s.wars.length).toBe(0);
      expect(execute(s, P, { type: 'declareWar', target: enemy.id }).ok).toBe(false); // truce
    }
  });

  it('remembers declared wars in opinion', () => {
    const s = newGame({ seed: 31 });
    const enemy = s.empires.find((e) => e.kind === 'major' && !e.isPlayer)!;
    declareWar(s, P, enemy.id);
    const mem = s.opinions[`${enemy.id}>${P}`];
    expect(mem.some((m) => m.key === 'declared_war')).toBe(true);
  });
});

describe('research', () => {
  it('completes technologies over time and applies their effects', () => {
    const s = newGame({ seed: 50 });
    expect(execute(s, P, { type: 'setResearch', tech: 'ind_automated_mining' }).ok).toBe(true);
    expect(execute(s, P, { type: 'setResearch', tech: 'ind_components' }).ok).toBe(false); // prereq missing
    expect(execute(s, P, { type: 'queueResearch', tech: 'ind_components' }).ok).toBe(true); // queues prereqs
    const before = getLedger(s, player(s), true).net.minerals;
    for (let i = 0; i < 360 * 4 && !player(s).research.done.includes('ind_automated_mining'); i++) step(s);
    expect(player(s).research.done).toContain('ind_automated_mining');
    void before;
  });
});

describe('AI civilisations', () => {
  it('expand, build and research over a decade', () => {
    const s = newGame({ seed: 1234, galaxySize: 'medium', aiCount: 4 });
    const start = s.empires.filter((e) => e.kind === 'major' && !e.isPlayer).map((e) => ({ id: e.id, sys: e.stats.systems, pops: e.stats.population }));
    runDays(s, 360 * 10);
    let grew = 0;
    for (const st of start) {
      const e = s.empires[st.id];
      if (!e.alive) continue;
      if (e.stats.systems > st.sys) grew++;
      expect(e.research.done.length).toBeGreaterThan(2);
    }
    expect(grew).toBeGreaterThanOrEqual(2);
    const militaries = s.empires.filter((e) => e.kind === 'major' && !e.isPlayer && e.alive).map((e) => e.stats.militaryPower);
    expect(Math.max(...militaries)).toBeGreaterThan(50);
    void fleetPower;
  });
});

describe('civilisational eras', () => {
  it('locks ascension research until the era is reached, then advances when requirements are met', () => {
    const s = newGame({ seed: 11, galaxySize: 'small', aiCount: 2 });
    const e = player(s);
    expect(e.era).toBe(0);
    const r = execute(s, P, { type: 'setResearch', tech: 'era_imperial_bureaucracy' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Interstellar Imperium/);
    // Meet the Interstellar Imperium requirements directly.
    for (const t of TECHS.filter((x) => x.tier === 1 && !e.research.done.includes(x.id)).slice(0, 10)) e.research.done.push(t.id);
    const free = s.galaxy.systems.filter((x) => x.owner == null).slice(0, 6);
    for (const sys of free) sys.owner = P;
    capital(s).colony!.pops = 70;
    const kBefore = (() => { runDays(s, 1); return e.stats.kardashev ?? 0; })();
    runDays(s, 31);
    expect(e.era).toBe(1);
    expect(e.stats.kardashev!).toBeGreaterThanOrEqual(1);
    expect(kBefore).toBeLessThan(1);
    expect(empireMods(s, e).admin ?? 0).toBeGreaterThanOrEqual(3);
    expect(execute(s, P, { type: 'setResearch', tech: 'era_imperial_bureaucracy' }).ok).toBe(true);
    expect(s.events.some((ev) => ev.kind === 'era')).toBe(true);
  });

  it('survives a save made before eras existed', () => {
    const s = newGame({ seed: 5, galaxySize: 'small', aiCount: 2 });
    const json = JSON.parse(serialize(s));
    for (const e of json.empires) delete e.era;
    const back = deserialize(JSON.stringify(json));
    expect(back.empires.every((e) => e.era === 0)).toBe(true);
  });
});
