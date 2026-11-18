// AI kingdoms. Each AI runs every few days and issues the SAME validated
// commands a player can (via execute()), so it obeys every rule: costs,
// tech, ownership, logistics. Behaviour is driven by personality.

import { BUILDINGS, BUILDABLE } from './data/buildings';
import { SHIPS } from './data/ships';
import { TECH_BY_ID, techCost } from './data/techs';
import { execute } from './commands';
import { getLedger } from './engine';
import { canBuild, buildingCost, shipCost } from './construction';
import { availableTechs } from './research';
import { fleetPower, isCivilianFleet, routeFleet } from './fleets';
import { evaluateProposal, opinion, hasContact, canDeclareWar, makePeace, applyDeal, PEACE_LABEL, systemValue } from './diplomacy';
import { bordering, claimCost, hasTreaty, isHostile, ownedSystems, warBetween, armed, isExplored } from './territory';
import { empireMods, hasTech } from './modifiers';
import { planetHab } from './economy';
import { adjacency, jumpDistances, findPath } from './galaxy';
import { canAfford, log, nextId } from './util';
import { charactersOf, captivesHeldBy, canLearn, rosterLimit, recruitCost, recruitChance, ransomPrice, provinceGovernor, effectiveAttrs } from './characters';
import { SKILLS, ROLES } from './data/characters';
import { COUNCIL_SEATS } from './data/council';
import { next, chance } from './rng';
import type { BuildingId, Empire, Fleet, GameState, PeaceTerm, Planet, ShipClass, TreatyType } from './types';
import type { TechCategory } from './data/techs';

export function runAI(state: GameState, e: Empire) {
  const isMajor = e.kind === 'major';
  economy(state, e);
  research(state, e);
  policies(state, e);
  market(state, e);
  military(state, e);
  if (isMajor) {
    expansion(state, e);
    scouting(state, e);
  }
  operations(state, e);
  if (state.tick % 30 < 5) diplomacy(state, e);
  if (state.tick % 15 < 5) characters(state, e);
}

// ---------------------------------------------------------------- economy

function economy(state: GameState, e: Empire) {
  const L = getLedger(state, e);
  const colonies = state.planets.filter((p) => p.colony?.ownerId === e.id);
  const shipyards = colonies.filter((p) => (p.colony!.buildings.shipyard ?? 0) > 0).length;
  const reserve = { minerals: 60, credits: 40 };
  for (const p of colonies) {
    const c = p.colony!;
    if (c.queue.length >= 2) continue;
    const rep = L.planets[p.id];
    if (!rep) continue;
    let best: BuildingId | null = null;
    let bestScore = 3;
    for (const b of BUILDABLE) {
      if (!canBuild(state, e, p, b).ok) continue;
      const s = scoreBuilding(state, e, p, b, L, rep, shipyards, colonies.length);
      if (s > bestScore) { bestScore = s; best = b; }
    }
    if (!best) continue;
    const cost = buildingCost(state, e, best);
    const afford = Object.entries(cost).every(([k, v]) => e.stock[k as keyof typeof e.stock] >= (v as number) + ((reserve as any)[k] ?? 0));
    if (!afford) continue;
    execute(state, e.id, { type: 'queueBuilding', planetId: p.id, building: best });
  }
  // Orbital extractors on owned uncolonised bodies
  if (e.stock.minerals > 250 && e.stock.credits > 120) {
    for (const sid of ownedSystems(state, e.id)) {
      for (const pid of state.galaxy.systems[sid].planetIds) {
        const p = state.planets[pid];
        if (p.colony || p.station || p.colonizing) continue;
        const habitable = planetHab(state, p, e, empireMods(state, e)) >= 0.5;
        if (habitable) continue; // reserve for colonisation
        const kind = p.deposits.research >= 3 ? 'research' : p.type === 'gas_giant' || p.deposits.energy > p.deposits.minerals ? 'energy' : 'mining';
        if (execute(state, e.id, { type: 'buildStation', planetId: pid, kind }).ok) return;
      }
    }
  }
  // Starbase upgrades on the capital and colonised border systems
  if (e.stock.alloys > 400 && e.stock.credits > 300 && e.capitalSystemId != null) {
    const cap = state.galaxy.systems[e.capitalSystemId];
    if (cap.starbase < 2 && !cap.starbaseUpgrade) execute(state, e.id, { type: 'upgradeStarbase', systemId: cap.id });
    else if (e.stock.alloys > 900) {
      for (const sid of ownedSystems(state, e.id)) {
        const sys = state.galaxy.systems[sid];
        if (sys.starbase === 1 && !sys.starbaseUpgrade && sys.planetIds.some((p) => state.planets[p].colony?.ownerId === e.id)) {
          execute(state, e.id, { type: 'upgradeStarbase', systemId: sid });
          break;
        }
      }
    }
  }
  // Megastructures for wealthy, advanced AIs
  // (a civilisation chasing the next era wants them sooner)
  if (e.stock.alloys > ((e.era ?? 0) >= 1 ? 1700 : 2500) && e.kind === 'major') {
    for (const id of ['continuum_engine', 'sector_array', 'dyson_swarm', 'stellar_collector', 'grand_archive', 'lattice', 'orbital_ring']) {
      for (const sid of ownedSystems(state, e.id)) {
        if (execute(state, e.id, { type: 'startMegastructure', systemId: sid, mega: id }).ok) return;
      }
    }
  }
}

function scoreBuilding(state: GameState, e: Empire, p: Planet, b: BuildingId, L: ReturnType<typeof getLedger>, rep: NonNullable<ReturnType<typeof getLedger>['planets'][number]>, shipyards: number, colonies: number): number {
  const n = L.net;
  const pers = e.personality;
  const c = p.colony!;
  const def = BUILDINGS[b];
  const roomForJobs = rep.unemployed >= 1.5 || c.pops >= rep.jobs - 1;
  let s = 0;
  switch (b) {
    case 'agri': s = n.food < 4 ? 12 - n.food : n.food < 10 ? 4 : 0; break;
    case 'hydroponics': s = n.food < 4 ? 11 - n.food * 0.5 : 0; break;
    case 'power': s = n.energy < 6 ? 11 - n.energy * 0.5 : n.energy < 15 ? 4 : 1; break;
    case 'fusion_plant': s = n.energy < 10 ? 10 : 2; break;
    case 'mining': s = n.minerals < 12 ? 9 : n.minerals < 30 ? 4 : 1; break;
    case 'residential': s = c.pops >= rep.housing - 2 ? 10 : 0; break;
    case 'arcology': s = c.pops >= rep.housing - 2 ? 9 : 0; break;
    case 'refinery': s = n.minerals > 8 && n.alloys < 25 ? 6 + pers.aggression * 4 : 0; break;
    case 'electronics_fab': s = n.electronics < 3 && (e.stock.rare > 20 || n.rare > 0.5) ? 7 : n.electronics < 8 ? 3 : 0; break;
    case 'rare_extractor': s = n.rare < 1.5 ? 8 : 2; break;
    case 'component_works': s = n.components < 3 && n.alloys > 3 && n.electronics > 2 ? 6 : 0; break;
    case 'research_lab': s = 3 + pers.science * 6 - (n.electronics < 1 ? 4 : 0); break;
    case 'spaceport': s = c.pops >= 6 ? 5 + pers.mercantile * 3 : 0; break;
    case 'shipyard': s = shipyards < 1 + Math.floor(colonies / 4) ? 7 : 0; break;
    case 'commerce_hub': s = 2 + pers.mercantile * 6 + (n.credits < 15 ? 3 : 0); break;
    case 'admin_center': s = L.adminUsed >= L.adminCap - 1 ? 9 : 1; break;
    case 'entertainment': s = c.stability < 45 ? 10 : c.stability < 55 ? 4 : 0; break;
    case 'garrison': s = c.resistance > 10 ? 9 : (state.wars.some((w) => w.attackers.includes(e.id) || w.defenders.includes(e.id)) ? 3 : 0); break;
    case 'orbital_defense': s = (c.buildings.orbital_defense ?? 0) < 2 && c.pops > 8 ? 3 + pers.aggression : 0; break;
    case 'planetary_shield': s = c.pops > 15 ? 3 : 0; break;
    case 'storage_depot': s = Object.entries(L.cap).some(([k, v]) => k !== 'credits' && k !== 'influence' && e.stock[k as keyof typeof e.stock] > v * 0.85) ? 6 : 0; break;
  }
  if (def.jobs > 0 && def.category !== 'district' && !roomForJobs) s -= 4;
  if (def.jobs > 0 && rep.unemployed >= 2) s += 3;
  if (def.district === 'agri') s *= p.type === 'ocean' || p.type === 'temperate' ? 1.2 : 0.8;
  if (def.district === 'mining') s *= ['desert', 'volcanic', 'barren', 'arid'].includes(p.type) ? 1.25 : 0.9;
  return s;
}

// ---------------------------------------------------------------- research

const CAT_WEIGHT = (e: Empire): Record<TechCategory, number> => {
  const p = e.personality;
  return {
    propulsion: 0.7 + p.expansion * 0.5,
    weapons: 0.5 + p.aggression * 1.2,
    defense: 0.6 + (1 - p.aggression) * 0.4 + p.aggression * 0.3,
    industry: 1.1,
    energy: 0.9,
    biology: 0.8 + p.expansion * 0.3,
    ai: 0.6 + p.science * 0.8,
    colonization: 0.6 + p.expansion * 0.8,
    engineering: 0.7 + p.aggression * 0.8,
    ascension: 2.0,
  };
};

function research(state: GameState, e: Empire) {
  if (e.research.current) return;
  const opts = availableTechs(e);
  if (!opts.length) return;
  // Urgent needs first: food and energy independence.
  const L = getLedger(state, e);
  for (const [need, tech] of [[L.net.food < 0, 'bio_hydroponics'], [L.net.food < 0, 'bio_genome_crops'], [L.net.energy < 0, 'en_fusion'], [L.net.energy < 0, 'en_grid']] as [boolean, string][]) {
    if (need && opts.includes(tech)) { execute(state, e.id, { type: 'setResearch', tech }); return; }
  }
  const w = CAT_WEIGHT(e);
  let best = opts[0];
  let bestV = -1;
  for (const t of opts) {
    const def = TECH_BY_ID[t];
    const v = (w[def.category] * 1000) / techCost(t) * (0.85 + next(state.rng) * 0.3);
    if (v > bestV) { bestV = v; best = t; }
  }
  execute(state, e.id, { type: 'setResearch', tech: best });
}

// ---------------------------------------------------------------- policy & market

function policies(state: GameState, e: Empire) {
  if (state.tick % 60 >= 5) return;
  const atWar = state.wars.some((w) => w.attackers.includes(e.id) || w.defenders.includes(e.id));
  const stab = e.stats.avgStability || 50;
  const want = (pol: string, opt: string) => { if (e.policies[pol] !== opt && e.stock.influence > 30) execute(state, e.id, { type: 'setPolicy', policy: pol, option: opt }); };
  if (stab < 38) want('taxation', 'low');
  else if (stab > 68 && e.personality.mercantile > 0.6) want('taxation', 'high');
  else if (stab > 45 && stab < 62) want('taxation', 'standard');
  if (atWar && e.stock.credits > 300) want('military_budget', 'increased');
  else if (!atWar) want('military_budget', 'standard');
  if (e.personality.science > 0.7 && e.stock.credits > 600) want('research_priority', 'prioritized');
}

function market(state: GameState, e: Empire) {
  const L = getLedger(state, e);
  for (const r of ['minerals', 'energy', 'food', 'alloys', 'electronics', 'rare'] as const) {
    if (e.stock[r] > L.cap[r] * 0.85) execute(state, e.id, { type: 'market', res: r, amount: -Math.round(e.stock[r] * 0.2) });
    else if (e.stock[r] < 30 && L.net[r] < 0 && e.stock.credits > 400) execute(state, e.id, { type: 'market', res: r, amount: 80 });
  }
}

// ---------------------------------------------------------------- military

const DOCTRINE: Record<string, ShipClass[]> = {
  swarm: ['corvette', 'corvette', 'frigate', 'destroyer', 'corvette', 'cruiser', 'frigate'],
  line: ['destroyer', 'cruiser', 'battleship', 'battlecruiser', 'cruiser', 'destroyer', 'dreadnought'],
  carrier: ['destroyer', 'carrier', 'cruiser', 'carrier', 'destroyer', 'battleship'],
  balanced: ['corvette', 'destroyer', 'cruiser', 'battlecruiser', 'frigate', 'carrier', 'battleship', 'dreadnought'],
};

function atWar(state: GameState, id: number) {
  return state.wars.some((w) => w.attackers.includes(id) || w.defenders.includes(id));
}

function military(state: GameState, e: Empire) {
  const L = getLedger(state, e);
  const war = atWar(state, e.id);
  const fill = e.kind === 'major' ? (war ? 1.05 : 0.45 + e.personality.aggression * 0.45) : war ? 0.8 : 0.35;
  const target = L.navalCap * fill;
  const yards = state.planets.filter((p) => p.colony?.ownerId === e.id && (p.colony.buildings.shipyard ?? 0) > 0);
  if (!yards.length) return;
  const queued = yards.reduce((a, p) => a + p.colony!.shipQueue.filter((q) => !SHIPS[q.id as ShipClass].civilian).reduce((s, q) => s + SHIPS[q.id as ShipClass].command, 0), 0);
  if (L.navalUsed + queued < target && L.net.credits > 0) {
    const doc = DOCTRINE[e.personality.doctrine];
    const options = doc.filter((c) => hasTech(e, SHIPS[c].tech));
    // Rotate through doctrine by fleet composition: build what we have least of.
    const counts: Record<string, number> = Object.create(null);
    for (const id in state.fleets) if (state.fleets[id].ownerId === e.id) for (const s of state.fleets[id].ships) counts[s.cls] = (counts[s.cls] ?? 0) + 1;
    const pickCls = options.slice().sort((a, b) => (counts[a] ?? 0) / (doc.filter((x) => x === a).length) - (counts[b] ?? 0) / (doc.filter((x) => x === b).length))
      .sort((a, b) => SHIPS[b].command - SHIPS[a].command)
      .find((c) => canAfford(e, withReserve(shipCost(state, e, c))));
    const yard = yards.sort((a, b) => a.colony!.shipQueue.length - b.colony!.shipQueue.length)[0];
    if (pickCls && yard.colony!.shipQueue.length < 3) execute(state, e.id, { type: 'queueShip', planetId: yard.id, cls: pickCls });
  }
  // Troop transports for wars
  if (war && e.kind === 'major') {
    const troops = Object.values(state.fleets).filter((f) => f.ownerId === e.id).reduce((a, f) => a + f.troops, 0);
    const queuedT = yards.reduce((a, p) => a + p.colony!.shipQueue.filter((q) => q.id === 'transport').length, 0);
    if (troops + queuedT * 8 < 32 && canAfford(e, withReserve(shipCost(state, e, 'transport')))) {
      execute(state, e.id, { type: 'queueShip', planetId: yards[0].id, cls: 'transport' });
    }
  }
  // Consolidate idle warfleets at the same system; assign admirals
  const idle = Object.values(state.fleets).filter((f) => f.ownerId === e.id && !f.path.length && f.order.type === 'idle' && !isCivilianFleet(f) && !f.ships.every((s) => s.cls === 'transport') && !f.ships.every((s) => s.cls === 'scout'));
  const bySys = new Map<number, Fleet[]>();
  for (const f of idle) { const a = bySys.get(f.systemId) ?? []; a.push(f); bySys.set(f.systemId, a); }
  for (const [, fs] of bySys) {
    if (fs.length < 2) continue;
    fs.sort((a, b) => b.ships.length - a.ships.length);
    for (const o of fs.slice(1)) execute(state, e.id, { type: 'mergeFleets', fleetId: fs[0].id, otherId: o.id });
  }
}

function withReserve(c: Record<string, number | undefined>) {
  const out: Record<string, number> = {};
  for (const k in c) out[k] = (c[k] ?? 0) * 1.15 + (k === 'credits' ? 50 : 0);
  return out;
}

function mainFleet(state: GameState, e: Empire): Fleet | null {
  let best: Fleet | null = null;
  let bp = 0;
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.ownerId !== e.id || isCivilianFleet(f) || !armed(f)) continue;
    const p = fleetPower(state, f);
    if (p > bp) { bp = p; best = f; }
  }
  return best;
}

// ---------------------------------------------------------------- expansion

function expansion(state: GameState, e: Empire) {
  const L = getLedger(state, e);
  const m = empireMods(state, e);
  const yards = state.planets.filter((p) => p.colony?.ownerId === e.id && (p.colony.buildings.shipyard ?? 0) > 0);
  const myFleets = Object.values(state.fleets).filter((f) => f.ownerId === e.id);
  const ctorShips = myFleets.filter((f) => f.ships.some((s) => s.cls === 'constructor'));
  const colonyShips = myFleets.filter((f) => f.ships.some((s) => s.cls === 'colony'));
  const queuedCtor = yards.reduce((a, p) => a + p.colony!.shipQueue.filter((q) => q.id === 'constructor').length, 0);
  const queuedCol = yards.reduce((a, p) => a + p.colony!.shipQueue.filter((q) => q.id === 'colony').length, 0);
  const owned = ownedSystems(state, e.id);
  const ownedSet = new Set(owned);
  const explored = new Set(e.explored);
  const hostileFleetAt = (sid: number) => Object.values(state.fleets).some((f) => f.systemId === sid && isHostile(state, e.id, f.ownerId) && armed(f));

  // Outpost targets
  const dist = jumpDistances(state.galaxy, owned.length ? owned : [e.capitalSystemId ?? 0]);
  const pending = new Set(myFleets.filter((f) => f.order.type === 'outpost').map((f) => (f.order as any).systemId));
  const outpostTargets = state.galaxy.systems
    .filter((s) => s.owner == null && !s.outpostProject && explored.has(s.id) && dist[s.id] <= 2 && !s.features.includes('guardian') && !pending.has(s.id) && !hostileFleetAt(s.id))
    .map((s) => ({ s, v: systemValue(state, s.id) + s.planetIds.filter((p) => planetHab(state, state.planets[p], e, m) >= 0.5).length * 80 - dist[s.id] * 40 }))
    .sort((a, b) => b.v - a.v);
  const wantExpand = owned.length < L.adminCap + 2 + Math.round(e.personality.expansion * 4);
  if (wantExpand && outpostTargets.length && ctorShips.length + queuedCtor < (e.personality.expansion > 0.7 ? 2 : 1) && yards.length && e.stock.influence > 20) {
    if (canAfford(e, withReserve(shipCost(state, e, 'constructor')))) execute(state, e.id, { type: 'queueShip', planetId: yards[0].id, cls: 'constructor' });
  }
  for (const f of ctorShips) {
    if (f.order.type !== 'idle' || f.path.length) continue;
    const t = outpostTargets.find((x) => !pending.has(x.s.id));
    if (!t) break;
    if (e.stock.influence + 10 < claimCost(state, e, t.s.id)) break;
    if (execute(state, e.id, { type: 'fleetOrder', fleetId: f.id, order: { type: 'outpost', systemId: t.s.id } }).ok) pending.add(t.s.id);
  }

  // Colonisation targets: habitable worlds in owned systems (or adjacent unowned ones)
  const colonizing = new Set(myFleets.filter((f) => f.order.type === 'colonize').map((f) => (f.order as any).planetId));
  const minHab = hasTech(e, 'col_domes') ? 0.25 : 0.45;
  const colTargets = state.planets
    .filter((p) => !p.colony && !p.colonizing && !colonizing.has(p.id) && p.type !== 'gas_giant')
    .filter((p) => (ownedSet.has(p.systemId) || (state.galaxy.systems[p.systemId].owner == null && dist[p.systemId] <= 1 && explored.has(p.systemId))) && !state.galaxy.systems[p.systemId].features.includes('guardian'))
    .map((p) => ({ p, h: planetHab(state, p, e, m) }))
    .filter((x) => x.h >= minHab)
    .sort((a, b) => b.h * b.p.size - a.h * a.p.size);
  if (colTargets.length && colonyShips.length + queuedCol < 1 && yards.length && L.net.food > 0) {
    if (canAfford(e, withReserve(shipCost(state, e, 'colony')))) execute(state, e.id, { type: 'queueShip', planetId: yards[0].id, cls: 'colony' });
  }
  for (const f of colonyShips) {
    if (f.order.type !== 'idle' || f.path.length) continue;
    const t = colTargets.find((x) => !colonizing.has(x.p.id));
    if (!t) break;
    if (execute(state, e.id, { type: 'fleetOrder', fleetId: f.id, order: { type: 'colonize', planetId: t.p.id } }).ok) colonizing.add(t.p.id);
  }
}

function scouting(state: GameState, e: Empire) {
  const scouts = Object.values(state.fleets).filter((f) => f.ownerId === e.id && f.ships.length && f.ships.every((s) => s.cls === 'scout'));
  const explored = new Set(e.explored);
  const unexplored = state.galaxy.systems.filter((s) => !explored.has(s.id) && !s.features.includes('guardian'));
  if (!unexplored.length) {
    // nothing left: retire scouts to save upkeep
    for (const f of scouts) if (!f.path.length) execute(state, e.id, { type: 'disbandFleet', fleetId: f.id });
    return;
  }
  if (!scouts.length && state.tick < 360 * 8) {
    const yard = state.planets.find((p) => p.colony?.ownerId === e.id && (p.colony.buildings.shipyard ?? 0) > 0);
    if (yard && !yard.colony!.shipQueue.some((q) => q.id === 'scout') && canAfford(e, withReserve(shipCost(state, e, 'scout')))) execute(state, e.id, { type: 'queueShip', planetId: yard.id, cls: 'scout' });
  }
  const claimed = new Set<number>();
  for (const f of scouts) {
    if (f.path.length) { claimed.add(f.path[f.path.length - 1]); continue; }
    const d = jumpDistances(state.galaxy, [f.systemId]);
    const t = unexplored.filter((s) => !claimed.has(s.id) && Number.isFinite(d[s.id])).sort((a, b) => d[a.id] - d[b.id])[0];
    if (!t) continue;
    claimed.add(t.id);
    execute(state, e.id, { type: 'moveFleet', fleetId: f.id, target: t.id });
  }
}

// ---------------------------------------------------------------- operations

function enemyStrengthAt(state: GameState, e: Empire, sid: number): number {
  let p = 0;
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.systemId === sid && isHostile(state, e.id, f.ownerId)) p += fleetPower(state, f);
  }
  const sys = state.galaxy.systems[sid];
  if (sys.owner != null && isHostile(state, e.id, sys.owner) && sys.starbase > 0) p += [0, 30, 110, 320][sys.starbase] * (1 - sys.starbaseDamage);
  for (const pid of sys.planetIds) {
    const c = state.planets[pid].colony;
    if (c && isHostile(state, e.id, c.ownerId)) p += (c.buildings.orbital_defense ?? 0) * 35 * (1 - c.defenseDamage);
  }
  return p;
}

function operations(state: GameState, e: Empire) {
  const main = mainFleet(state, e);
  if (!main) return;
  const owned = new Set(ownedSystems(state, e.id));
  const myPower = fleetPower(state, main);
  // 1) Defend: hostile armed fleets inside our borders
  let threat: { sid: number; p: number } | null = null;
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (!owned.has(f.systemId) || !isHostile(state, e.id, f.ownerId) || !armed(f)) continue;
    if (state.empires[f.ownerId].kind === 'guardian') continue;
    const p = fleetPower(state, f);
    if (!threat || p > threat.p) threat = { sid: f.systemId, p };
  }
  if (threat && myPower > threat.p * 0.9) {
    if (main.systemId !== threat.sid && (main.order.type !== 'move' || (main.order as any).target !== threat.sid)) {
      execute(state, e.id, { type: 'moveFleet', fleetId: main.id, target: threat.sid });
    }
    return;
  }
  const wars = state.wars.filter((w) => w.attackers.includes(e.id) || w.defenders.includes(e.id));
  if (wars.length && e.kind === 'major') {
    if (main.supply < 25 && e.capitalSystemId != null) { if (main.systemId !== e.capitalSystemId) execute(state, e.id, { type: 'moveFleet', fleetId: main.id, target: e.capitalSystemId }); return; }
    const enemies = new Set<number>();
    for (const w of wars) (w.attackers.includes(e.id) ? w.defenders : w.attackers).forEach((x) => enemies.add(x));
    // 2) Attack: nearest enemy colony system we can overpower
    const d = jumpDistances(state.galaxy, [main.systemId]);
    const targets = state.planets
      .filter((p) => p.colony && enemies.has(p.colony.ownerId))
      .map((p) => ({ p, d: d[p.systemId], s: enemyStrengthAt(state, e, p.systemId) }))
      .filter((x) => Number.isFinite(x.d) && x.d <= 8)
      .sort((a, b) => a.d + a.s / 100 - (b.d + b.s / 100));
    const t = targets.find((x) => myPower > x.s * 1.3);
    if (t) {
      if (main.systemId !== t.p.systemId) {
        if (main.order.type !== 'move' || (main.order as any).target !== t.p.systemId) execute(state, e.id, { type: 'moveFleet', fleetId: main.id, target: t.p.systemId });
      } else {
        // Fleet holds orbit: bring in the troops
        const transports = Object.values(state.fleets).filter((f) => f.ownerId === e.id && f.troops > 0 && f.order.type !== 'invade');
        for (const tf of transports) execute(state, e.id, { type: 'fleetOrder', fleetId: tf.id, order: { type: 'invade', planetId: t.p.id } });
      }
      // merge stray transports into a single group at home first
      return;
    }
  }
  // 3) Peacetime: hunt raiders inside or adjacent to our territory, else return home
  const adj = adjacency(state.galaxy);
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (state.empires[f.ownerId].kind !== 'raiders') continue;
    const near = owned.has(f.systemId) || adj[f.systemId].some((v) => owned.has(v));
    if (near && myPower > fleetPower(state, f) * 1.2) {
      if (main.systemId !== f.systemId && main.order.type === 'idle') execute(state, e.id, { type: 'moveFleet', fleetId: main.id, target: f.systemId });
      return;
    }
  }
  // Clear guardian lairs once strong enough (opens precursor ruins)
  if (e.kind === 'major' && main.order.type === 'idle' && state.tick > 360 * 5) {
    for (const s of state.galaxy.systems) {
      if (!s.features.includes('guardian')) continue;
      const lair = enemyStrengthAt(state, e, s.id);
      const path = findPath(state.galaxy, main.systemId, s.id);
      if (path && path.length <= 5 && myPower > lair * 1.8 && isExplored(e, s.id)) {
        execute(state, e.id, { type: 'moveFleet', fleetId: main.id, target: s.id });
        return;
      }
    }
  }
  if (main.order.type === 'idle' && !main.path.length && e.capitalSystemId != null && main.systemId !== e.capitalSystemId && !owned.has(main.systemId)) {
    execute(state, e.id, { type: 'moveFleet', fleetId: main.id, target: e.capitalSystemId });
  }
}

// ---------------------------------------------------------------- diplomacy

function diplomacy(state: GameState, e: Empire) {
  const majors = state.empires.filter((x) => x.alive && x.id !== e.id && (x.kind === 'major' || x.kind === 'minor' || x.kind === 'rebels'));
  // Peace
  for (const w of state.wars) {
    const mySide = w.attackers.includes(e.id) ? 'attackers' : w.defenders.includes(e.id) ? 'defenders' : null;
    if (!mySide) continue;
    const leader = mySide === 'attackers' ? w.attackers[0] : w.defenders[0];
    if (leader !== e.id) continue;
    const other = mySide === 'attackers' ? w.defenders[0] : w.attackers[0];
    const myScore = mySide === 'attackers' ? w.score : -w.score;
    const years = (state.tick - w.startTick) / 360;
    let term: PeaceTerm | null = null;
    if (myScore > 60 && years > 1) term = state.empires[other].kind === 'major' ? 'cede' : 'vassalize';
    else if (myScore > 35 && years > 1.5) term = 'tribute';
    else if (e.warExhaustion > 45 || myScore < -25 || years > 6) term = 'status_quo';
    if (!term) continue;
    const pending = state.proposals.some((p) => p.from === e.id && p.kind === 'peace' && p.warId === w.id);
    if (state.empires[other].isPlayer) {
      if (!pending && chance(state.rng, 0.5)) {
        state.proposals.push({ id: nextId(state), from: e.id, to: other, give: [], receive: [], tick: state.tick, kind: 'peace', peaceTerm: term, warId: w.id });
        log(state, { kind: 'diplomacy', severity: 'info', title: `${e.name} proposes peace`, text: `Terms: ${PEACE_LABEL[term]}. Review it in Diplomacy.`, empires: [other] });
      }
    } else {
      const prop = { id: 0, from: e.id, to: other, give: [], receive: [], tick: state.tick, kind: 'peace' as const, peaceTerm: term, warId: w.id };
      if (evaluateProposal(state, prop).accept) makePeace(state, w, term, mySide);
    }
  }
  if (e.kind !== 'major') {
    // minors accept but rarely initiate; they seek protection
    return;
  }
  // Treaties
  for (const o of majors) {
    if (!hasContact(state, e.id, o.id) || warBetween(state, e.id, o.id)) continue;
    const op = opinion(state, e.id, o.id);
    const ladder: [TreatyType, number][] = [['nap', 10], ['trade', 20 - e.personality.mercantile * 15], ['research', 30 - e.personality.science * 15], ['defense', 55], ['alliance', 75]];
    for (const [t, need] of ladder) {
      if (op < need || hasTreaty(state, e.id, o.id, t)) continue;
      if (t === 'trade' && e.personality.mercantile < 0.35) continue;
      if (t === 'research' && e.personality.science < 0.4) continue;
      const prop = { id: nextId(state), from: e.id, to: o.id, give: [{ kind: 'treaty' as const, treaty: t }], receive: [], tick: state.tick, kind: 'deal' as const };
      if (o.isPlayer) {
        if (!state.proposals.some((p) => p.from === e.id && p.to === o.id)) {
          state.proposals.push(prop);
          log(state, { kind: 'diplomacy', severity: 'info', title: `${e.name} proposes a treaty`, text: `They offer a ${t === 'nap' ? 'Non-Aggression Pact' : t === 'trade' ? 'Trade Agreement' : t === 'research' ? 'Research Cooperation' : t === 'defense' ? 'Mutual Defence Pact' : 'Alliance'}.`, empires: [o.id] });
        }
      } else if (evaluateProposal(state, { ...prop, from: e.id, to: o.id }).accept) {
        applyDeal(state, prop);
      }
      break; // one proposal per partner per cycle
    }
    // Deteriorating relations end treaties
    if (op < -40) for (const t of ['alliance', 'defense', 'research', 'trade'] as TreatyType[]) if (hasTreaty(state, e.id, o.id, t)) execute(state, e.id, { type: 'breakTreaty', target: o.id, treaty: t });
  }
  // Tribute demands from weak neighbours (aggressive AIs, player included)
  if (e.personality.aggression > 0.6 && chance(state.rng, 0.08)) {
    const weak = majors.find((o) => o.isPlayer && bordering(state, e.id, o.id) && (e.stats.militaryPower > (o.stats.militaryPower || 1) * 2.5) && !warBetween(state, e.id, o.id));
    if (weak && !state.proposals.some((p) => p.from === e.id && p.to === weak.id)) {
      state.proposals.push({ id: nextId(state), from: e.id, to: weak.id, give: [], receive: [{ kind: 'credits', amount: Math.round(150 + e.stats.population * 4) }], tick: state.tick, kind: 'deal' });
      log(state, { kind: 'diplomacy', severity: 'warn', title: `${e.name} demands tribute`, text: 'Their envoys hint that refusal would be unwise.', empires: [weak.id] });
    }
  }
  // War declarations
  if (atWar(state, e.id) || e.warExhaustion > 15 || state.tick < 360 * 4) return;
  const myPow = e.stats.militaryPower || 1;
  const candidates = majors
    .filter((o) => bordering(state, e.id, o.id) && !hasTreaty(state, e.id, o.id, 'nap') && !hasTreaty(state, e.id, o.id, 'alliance') && !hasTreaty(state, e.id, o.id, 'defense') && canDeclareWar(state, e.id, o.id).ok)
    .map((o) => {
      // defenders' allies count against us
      let theirPow = o.stats.militaryPower || 1;
      for (const t of state.treaties) if ((t.type === 'defense' || t.type === 'alliance') && (t.a === o.id || t.b === o.id)) theirPow += state.empires[t.a === o.id ? t.b : t.a].stats.militaryPower;
      return { o, ratio: myPow / theirPow, op: opinion(state, e.id, o.id) };
    })
    .filter((x) => x.ratio > 1.6 - e.personality.aggression * 0.5 && x.op < 10 - e.personality.aggression * 20 + (x.o.kind !== 'major' ? 30 * e.personality.expansion : 0))
    .sort((a, b) => b.ratio - a.ratio);
  const c = candidates[0];
  if (c && chance(state.rng, 0.12 + e.personality.aggression * 0.25)) {
    execute(state, e.id, { type: 'declareWar', target: c.o.id });
  }
}

// ---------------------------------------------------------------- raiders

export function runRaiders(state: GameState) {
  const raiders = state.empires.find((x) => x.kind === 'raiders');
  if (!raiders) return;
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.ownerId !== raiders.id || f.path.length) continue;
    // Raid the nearest poorly defended colonised system within 3 jumps; otherwise lurk.
    const d = jumpDistances(state.galaxy, [f.systemId]);
    const myP = fleetPower(state, f);
    const targets = state.galaxy.systems
      .filter((s) => s.owner != null && d[s.id] <= 3 && d[s.id] > 0 && state.empires[s.owner].kind !== 'guardian')
      .map((s) => ({ s, def: enemyStrengthAt(state, raiders, s.id), d: d[s.id] }))
      .filter((x) => x.def < myP * 0.8)
      .sort((a, b) => a.d - b.d || a.def - b.def);
    if (targets.length && chance(state.rng, 0.3)) routeFleet(state, f, targets[0].s.id);
  }
}

export { BUILDINGS };

// ---------------------------------------------------------------- characters

/** AI realms manage their people with the same commands as the player:
 *  fill the council and the main fleet, recruit for empty posts, appoint
 *  governors, spend skill points and deal with prisoners. */
function characters(state: GameState, e: Empire) {
  const mine = () => charactersOf(state, e.id);
  const idle = (roles: string[]) => mine().filter((c) => !c.assignment && roles.includes(c.role));
  const score = (c: { role: keyof typeof ROLES }, attrs: Record<string, number>) => ROLES[c.role].primary.reduce((s, a, i) => s + attrs[a] * (3 - i), 0);
  const best = <T extends import('./types').Character>(list: T[]) => list.slice().sort((a, b) => score(b, effectiveAttrs(b)) - score(a, effectiveAttrs(a)))[0];

  // spend skill points: cheapest available skill in order of definition
  for (const c of mine()) {
    while (c.skillPoints > 0) {
      const s = SKILLS.find((k) => k.role === c.role && !canLearn(c, k.id));
      if (!s) break;
      if (!execute(state, e.id, { type: 'learnSkill', charId: c.id, skill: s.id }).ok) break;
    }
  }

  // council seats
  e.council ??= {};
  for (const seat of COUNCIL_SEATS) {
    if (e.council[seat.id] != null && state.characters.find((c) => c.id === e.council![seat.id] && c.status === 'active')) continue;
    const c = best(idle(seat.roles));
    if (c) execute(state, e.id, { type: 'assignCharacter', charId: c.id, assignment: { kind: 'council', seat: seat.id } });
  }

  // main fleet commander
  const main = mainFleet(state, e);
  if (main && !mine().some((c) => c.assignment?.kind === 'fleet' && c.assignment.fleetId === main.id)) {
    const c = best(idle(['admiral']));
    if (c) execute(state, e.id, { type: 'assignCharacter', charId: c.id, assignment: { kind: 'fleet', fleetId: main.id } });
  }
  // other war fleets get any remaining admirals or generals
  for (const f of Object.values(state.fleets)) {
    if (f.ownerId !== e.id || isCivilianFleet(f) || f.id === main?.id) continue;
    if (mine().some((c) => c.assignment?.kind === 'fleet' && c.assignment.fleetId === f.id)) continue;
    const c = best(idle(['admiral', 'general']));
    if (!c) break;
    execute(state, e.id, { type: 'assignCharacter', charId: c.id, assignment: { kind: 'fleet', fleetId: f.id } });
  }

  // governors: the province with most colonies first
  const sectorWeight = new Map<number, number>();
  for (const p of state.planets) {
    if (p.colony?.ownerId !== e.id) continue;
    const sec = state.galaxy.systems[p.systemId]?.sector;
    if (sec != null) sectorWeight.set(sec, (sectorWeight.get(sec) ?? 0) + 1);
  }
  for (const [sec] of [...sectorWeight].sort((a, b) => b[1] - a[1])) {
    if (provinceGovernor(state, e.id, sec)) continue;
    const c = best(idle(['governor']));
    if (!c) break;
    execute(state, e.id, { type: 'assignCharacter', charId: c.id, assignment: { kind: 'province', sectorId: sec } });
  }

  // industrialists to the most developed world; diplomats to the most important court
  for (const c of idle(['industrialist'])) {
    const world = state.planets.filter((p) => p.colony?.ownerId === e.id && !mine().some((x) => x.assignment?.kind === 'planet' && x.assignment.planetId === p.id))
      .sort((a, b) => b.colony!.pops - a.colony!.pops)[0];
    if (!world) break;
    execute(state, e.id, { type: 'assignCharacter', charId: c.id, assignment: { kind: 'planet', planetId: world.id } });
  }
  for (const c of idle(['diplomat'])) {
    const court = state.empires.filter((t) => t.alive && t.id !== e.id && (t.kind === 'major' || t.kind === 'minor') && hasContact(state, e.id, t.id)
      && !warBetween(state, e.id, t.id) && !mine().some((x) => x.assignment?.kind === 'envoy' && x.assignment.empireId === t.id))[0];
    if (!court) break;
    execute(state, e.id, { type: 'assignCharacter', charId: c.id, assignment: { kind: 'envoy', empireId: court.id } });
  }

  // recruit for the most pressing gap, if the purse allows
  if (mine().length < rosterLimit(state, e)) {
    const want: string[] = [];
    for (const seat of COUNCIL_SEATS) if (e.council[seat.id] == null) want.push(...seat.roles);
    if (main && !mine().some((c) => c.role === 'admiral')) want.unshift('admiral');
    if (sectorWeight.size > mine().filter((c) => c.role === 'governor').length) want.push('governor');
    const cands = state.characters.filter((c) => c.status === 'candidate' && c.ownerId === e.id && want.includes(c.role));
    const pickC = cands.sort((a, b) => want.indexOf(a.role) - want.indexOf(b.role) || b.level - a.level)[0];
    if (pickC) {
      const cost = recruitCost(pickC);
      if (e.stock.credits > cost.credits + 300 && e.stock.influence > cost.influence + 20) execute(state, e.id, { type: 'recruitCharacter', charId: pickC.id });
    }
  }

  // prisoners we hold: recruit a willing one, ransom the rest after a while
  for (const c of captivesHeldBy(state, e.id)) {
    const held = state.tick - (c.capturedTick ?? state.tick);
    if (mine().length < rosterLimit(state, e) && recruitChance(state, c) >= 0.5) execute(state, e.id, { type: 'captive', charId: c.id, action: 'recruit' });
    else if (held > 360) execute(state, e.id, { type: 'captive', charId: c.id, action: held > 720 ? 'pardon' : 'ransom' });
  }
  // our people held abroad: buy them back when rich
  for (const c of state.characters) {
    if (c.status !== 'captive' || c.ownerId !== e.id) continue;
    if (e.stock.credits > ransomPrice(c) + 500) execute(state, e.id, { type: 'payRansom', charId: c.id });
  }
}
