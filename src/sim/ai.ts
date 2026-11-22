// AI kingdoms. Each AI runs every few days and issues the SAME validated
// commands a player can (via execute()), so it obeys every rule: costs,
// tech, ownership, logistics. Behaviour is driven by personality.

import { BUILDINGS, BUILDABLE } from './data/buildings';
import { SHIPS } from './data/ships';
import { TECH_BY_ID, techCost } from './data/techs';
import { execute, STATION_COST } from './commands';
import { getLedger } from './engine';
import { canBuild, buildingCost, shipCost } from './construction';
import { availableTechs } from './research';
import { fleetPower, isCivilianFleet, routeFleet, shipStats } from './fleets';
import { evaluateProposal, opinion, hasContact, makePeace, intelLevel, applyDeal, PEACE_LABEL, systemValue } from './diplomacy';
import { bordering, claimCost, hasTreaty, isHostile, ownedSystems, warBetween, armed, isExplored } from './territory';
import { empireMods, hasTech } from './modifiers';
import { planetHab } from './economy';
import { adjacency, jumpDistances, findPath, nearestWhere } from './galaxy';
import { canAfford, log, nextId } from './util';
import { charactersOf, captivesHeldBy, canLearn, rosterLimit, recruitCost, recruitChance, ransomPrice, provinceGovernor, effectiveAttrs } from './characters';
import { SKILLS, ROLES } from './data/characters';
import { COUNCIL_SEATS } from './data/council';
import { canIssueDecree, canActOnHouse, inRevolt, maxDecrees } from './governance';
import { PETITION_BY_ID, DECREE_BY_ID } from './data/governance';
import { opsOf, OP_MAX_LEVEL } from './operations';
import { canQueueCapital, openPlots, plotOccupant, capitalCost, plannedLevel } from './capital';
import { CAPITAL_BUILDINGS } from './data/capital';
import { next, chance } from './rng';
import type { BuildingId, Empire, Fleet, GameState, PeaceTerm, Planet, ShipClass, TreatyType , OpMode } from './types';
import type { TechCategory } from './data/techs';
import type { DesignationId } from './data/designations';
import { rulerAge, heirOf, HEIR_COST } from './succession';
import { covertOps, networkBonus, validateOp } from './espionage';
import { isAtWarWith } from './economy';
import type { CovertKind } from './types';
import { MEGA_BY_ID } from './data/megastructures';
import { megaInstalment } from './construction';
import { aiPreset, coalitionWanted, estimatePower, militaryFill, planOf, reviewStrategy } from './strategy';
import { hegemon } from './victory';
import { orbitSecured } from './fleets';

export function runAI(state: GameState, e: Empire) {
  const isMajor = e.kind === 'major';
  if (isMajor) reviewStrategy(state, e);
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
  if (state.tick % 30 >= 10 && state.tick % 30 < 15) governance(state, e);
  if (state.tick % 90 >= 20 && state.tick % 90 < 25) designations(state, e);
  if (state.tick % 60 >= 40 && state.tick % 60 < 45) heir(state, e);
  if (state.tick % 30 >= 25 && isMajor) covert(state, e);
  if (state.tick % 20 >= 15) capitalCity(state, e);
}

// ---------------------------------------------------------------- espionage

/** Idle spymasters go to work: sabotage and theft against enemies, networks and theft against rivals. */
function covert(state: GameState, e: Empire) {
  const busy = new Set(covertOps(state).map((o) => o.agentId));
  const agents = state.characters.filter((c) => c.ownerId === e.id && c.status === 'active' && c.role === 'spymaster' && !busy.has(c.id));
  if (!agents.length || e.stock.credits < 300) return;
  const rivals = state.empires.filter((o) => o.alive && o.id !== e.id && (o.kind === 'major' || o.kind === 'minor'))
    .map((o) => ({ o, war: isAtWarWith(state, e.id, o.id), op: opinion(state, e.id, o.id) }))
    .sort((a, b) => Number(b.war) - Number(a.war) || a.op - b.op);
  const agent = agents[0];
  for (const { o, war } of rivals) {
    const theirWorld = state.planets.filter((p) => p.colony?.ownerId === o.id).sort((a, b) => b.colony!.pops - a.colony!.pops)[0];
    const plan: [CovertKind, number | null][] = war && theirWorld ? [['sabotage', theirWorld.id], ['incite_unrest', theirWorld.id], ['steal_tech', null]]
      : networkBonus(state, e.id, o.id) ? [['steal_tech', null]] : [['gather_intel', null]];
    for (const [kind, planet] of plan) {
      if (!validateOp(state, e, o.id, kind, agent.id, planet)) { execute(state, e.id, { type: 'launchCovert', targetId: o.id, kind, agentId: agent.id, planetId: planet }); return; }
    }
  }
}

// ---------------------------------------------------------------- succession

/** Name an heir once the sovereign is no longer young: the most capable courtier, preferring loyal houses. */
function heir(state: GameState, e: Empire) {
  if (rulerAge(state, e) < 45 || heirOf(state, e) || e.stock.influence < HEIR_COST + 5) return;
  const loyalty = (houseId: number | null | undefined) => e.houses?.find((h) => h.id === houseId)?.loyalty ?? 40;
  const best = state.characters.filter((c) => c.ownerId === e.id && c.status === 'active').sort((a, b) => (b.level * 10 + loyalty(b.houseId)) - (a.level * 10 + loyalty(a.houseId)))[0];
  if (best) execute(state, e.id, { type: 'designateHeir', charId: best.id });
}

// ---------------------------------------------------------------- province designations

const DESIG_FOR: Partial<Record<string, DesignationId>> = { food: 'agrarian', minerals: 'mining', rare: 'mining', energy: 'energy', alloys: 'forge', electronics: 'forge', components: 'forge', research: 'research', trade: 'trade', credits: 'trade' };

/** Give each settled province the role its industry already leans towards. */
function designations(state: GameState, e: Empire) {
  for (const p of state.planets) {
    const c = p.colony;
    if (!c || c.ownerId !== e.id || p.id === e.capitalPlanetId || c.pops < 3) continue;
    if (state.tick - (c.designationTick ?? -99999) < 360 * 3 && c.designation) continue;
    const weight: Record<string, number> = {};
    for (const [b, n] of Object.entries(c.buildings)) for (const [k, v] of Object.entries(BUILDINGS[b as BuildingId].output)) weight[k] = (weight[k] ?? 0) + (v as number) * (n ?? 0);
    let want: DesignationId = 'balanced';
    if ((c.buildings.orbital_defense ?? 0) >= 3) want = 'fortress';
    else {
      const top = Object.entries(weight).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] > 0) want = DESIG_FOR[top[0]] ?? 'balanced';
    }
    if (want !== (c.designation ?? 'balanced') && e.stock.influence >= 32) execute(state, e.id, { type: 'setDesignation', planetId: p.id, designation: want });
  }
}

// ---------------------------------------------------------------- economy

function economy(state: GameState, e: Empire) {
  const L = getLedger(state, e);
  const colonies = state.planets.filter((p) => p.colony?.ownerId === e.id);
  const shipyards = colonies.filter((p) => (p.colony!.buildings.shipyard ?? 0) > 0).length;
  const reserve = aiPreset(state, e).tightReserves ? { minerals: 30, credits: 20 } : { minerals: 60, credits: 40 };
  for (const p of colonies) {
    const c = p.colony!;
    if (c.queue.length >= 2) continue;
    const rep = L.planets[p.id];
    if (!rep) continue;
    let best: BuildingId | null = null;
    let bestScore = 3;
    const options: [BuildingId, number][] = [];
    for (const b of BUILDABLE) {
      if (!canBuild(state, e, p, b).ok) continue;
      const s = scoreBuilding(state, e, p, b, L, rep, shipyards, colonies.length);
      if (s > 3) options.push([b, s]);
      if (s > bestScore) { bestScore = s; best = b; }
    }
    // a less able court settles for an adequate choice now and then
    if (options.length > 1 && chance(state.rng, aiPreset(state, e).sloppiness)) best = options[Math.floor(next(state.rng) * options.length)][0];
    if (!best) continue;
    const cost = buildingCost(state, e, best);
    const afford = Object.entries(cost).every(([k, v]) => e.stock[k as keyof typeof e.stock] >= (v as number) + ((reserve as any)[k] ?? 0));
    if (!afford) continue;
    execute(state, e.id, { type: 'queueBuilding', planetId: p.id, building: best });
  }
  // Orbital extractors on owned uncolonised bodies
  const Lops = getLedger(state, e);
  // found an operation as soon as one is affordable with a small reserve: waiting for a large
  // mineral surplus trapped mineral-poor realms, which never built the mines that would end it
  if (e.stock.minerals >= STATION_COST.minerals + 60 && e.stock.credits >= STATION_COST.credits + 80 && Lops.logisticsUsed < Lops.logisticsCap) {
    const short = Lops.net.minerals < 60 || e.stock.minerals < 300; // minerals hold the realm back
    const sites: { pid: number; kind: 'research' | 'gas' | 'energy' | 'mining'; score: number }[] = [];
    for (const sid of ownedSystems(state, e.id)) {
      for (const pid of state.galaxy.systems[sid].planetIds) {
        const p = state.planets[pid];
        if (p.colony || p.station || p.colonizing) continue;
        const habitable = planetHab(state, p, e, empireMods(state, e)) >= 0.5;
        if (habitable) continue; // reserve for colonisation
        const kind = p.deposits.research >= 3 ? 'research' : p.type === 'gas_giant' ? 'gas' : p.deposits.energy > p.deposits.minerals ? 'energy' : 'mining';
        sites.push({ pid, kind, score: (kind === 'mining' && short ? 10 : 0) + (p.deposits.minerals ?? 0) + (p.deposits.energy ?? 0) + (p.deposits.research ?? 0) });
      }
    }
    for (const site of sites.sort((a, b) => b.score - a.score)) {
      if (execute(state, e.id, { type: 'buildStation', planetId: site.pid, kind: site.kind }).ok) return;
    }
  }
  operationsAI(state, e);
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
  // (one great work at a time; start when three months of instalments are in the treasury)
  if (e.kind === 'major') {
    const mine = ownedSystems(state, e.id);
    const building = mine.some((sid) => state.galaxy.systems[sid].megastructures.some((m) => m.ownerId === e.id && m.building));
    for (const id of building ? [] : ['continuum_engine', 'sector_array', 'dyson_swarm', 'stellar_collector', 'grand_archive', 'lattice', 'orbital_ring', 'hypergate', 'bastion']) {
      const def = MEGA_BY_ID[id];
      if (!hasTech(e, def.tech)) continue;
      const quarter = Object.fromEntries(Object.entries(megaInstalment(def)).map(([k, v]) => [k, v * 90]));
      if (!canAfford(e, quarter as never)) continue;
      for (const sid of mine) {
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

const MEGA_TECHS = new Set(Object.values(MEGA_BY_ID).map((m) => m.tech).filter(Boolean) as string[]);

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
  const goal = e.kind === 'major' ? planOf(e).goal : 'develop';
  let best = opts[0];
  let bestV = -1;
  for (const t of opts) {
    const def = TECH_BY_ID[t];
    let v = (w[def.category] * 1000) / techCost(t) * (0.85 + next(state.rng) * 0.3);
    if (goal === 'ascend' && (t.startsWith('era_') || MEGA_TECHS.has(t) || def.category === 'ascension')) v *= 2.5;
    if ((goal === 'arm' || goal === 'war') && (def.category === 'weapons' || def.category === 'defense')) v *= 1.6;
    if (goal === 'expand' && (def.category === 'colonization' || def.category === 'propulsion')) v *= 1.4;
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
  // a rich treasury over an empty mineral store buys minerals: buildings, the capital and new
  // operations all need them
  if (e.stock.minerals < 250 && e.stock.credits > 1200) {
    const amount = Math.round(Math.min(250 - e.stock.minerals, ((e.stock.credits - 1200) * 0.25) / Math.max(0.5, state.market.price.minerals)));
    if (amount > 10) execute(state, e.id, { type: 'market', res: 'minerals', amount });
  }
  // a hoarded treasury builds nothing: invest surplus credits in the goods great works and fleets need
  if (e.stock.credits > 4000) {
    const budget = (e.stock.credits - 4000) * 0.15;
    for (const [r, share, fill] of [['alloys', 0.6, 0.6], ['components', 0.25, 0.3], ['electronics', 0.15, 0.3]] as const) {
      const room = L.cap[r] * fill - e.stock[r];
      if (room <= 20) continue;
      const amount = Math.round(Math.min(room, (budget * share) / Math.max(0.5, state.market.price[r])));
      if (amount > 10) execute(state, e.id, { type: 'market', res: r, amount });
    }
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
  const fill = militaryFill(state, e);
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
    // facing a known enemy, half the new hulls answer its fleet: point defence against carriers,
    // high tracking against swarms of small ships, armour-piercing torpedoes and strike craft against heavy lines
    const counter = counterClass(state, e);
    if (counter && yard.colony!.shipQueue.length < 3 && chance(state.rng, 0.5) && canAfford(e, withReserve(shipCost(state, e, counter)))) {
      execute(state, e.id, { type: 'queueShip', planetId: yard.id, cls: counter });
    } else if (pickCls && yard.colony!.shipQueue.length < 3) execute(state, e.id, { type: 'queueShip', planetId: yard.id, cls: pickCls });
  }
  // Troop transports for wars
  if ((war || planOf(e).goal === 'arm') && e.kind === 'major') {
    const troops = Object.values(state.fleets).filter((f) => f.ownerId === e.id).reduce((a, f) => a + f.troops, 0);
    const queuedT = yards.reduce((a, p) => a + p.colony!.shipQueue.filter((q) => q.id === 'transport').length, 0);
    const wanted = Math.min(96, Math.max(24, planOf(e).troopsWanted ?? 0) + (aiPreset(state, e).battleGroups - 1) * 8);
    if (troops + queuedT * 8 < wanted && yards.reduce((a, p) => a + p.colony!.shipQueue.length, 0) < yards.length * 3 && canAfford(e, withReserve(shipCost(state, e, 'transport')))) {
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

/** A hull that counters the fleet of the rival we are arming against or fighting, if we know it well enough. */
function counterClass(state: GameState, e: Empire): ShipClass | null {
  if (e.kind !== 'major') return null;
  const plan = planOf(e);
  if ((plan.goal !== 'arm' && plan.goal !== 'war') || plan.target == null) return null;
  if (intelLevel(state, e.id, plan.target) < 40) return null;
  let total = 0, carriers = 0, small = 0, heavy = 0;
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.ownerId !== plan.target) continue;
    for (const sh of f.ships) {
      const d = SHIPS[sh.cls];
      if (d.civilian || sh.cls === 'transport' || sh.cls === 'scout') continue;
      total += d.command;
      if (sh.cls === 'carrier') carriers += d.command;
      else if (d.size === 'S') small += d.command;
      else if (d.size === 'L' || d.size === 'XL') heavy += d.command;
    }
  }
  if (total < 10) return null;
  const options: ShipClass[] = carriers / total > 0.3 ? ['destroyer', 'dreadnought'] : small / total > 0.5 ? ['destroyer', 'corvette'] : heavy / total > 0.5 ? ['frigate', 'carrier'] : [];
  return options.find((c) => hasTech(e, SHIPS[c].tech)) ?? null;
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
  const dist = jumpDistances(state.galaxy, owned.length ? owned : [e.capitalSystemId ?? 0], undefined, 2);
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
    // the nearest unexplored system (lowest id among equally near ones), searching outwards only
    // as far as needed
    const t = nearestWhere(state.galaxy, f.systemId, (id) => !explored.has(id) && !claimed.has(id) && !state.galaxy.systems[id].features.includes('guardian'));
    if (t == null) continue;
    claimed.add(t);
    execute(state, e.id, { type: 'moveFleet', fleetId: f.id, target: t });
  }
}

// ---------------------------------------------------------------- operations

export function enemyStrengthAt(state: GameState, e: Empire, sid: number): number {
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

function warFleets(state: GameState, e: Empire): Fleet[] {
  const out: Fleet[] = [];
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.ownerId !== e.id || isCivilianFleet(f) || !armed(f)) continue;
    if (f.ships.every((s) => s.cls === 'transport' || s.cls === 'scout')) continue;
    out.push(f);
  }
  return out.sort((a, b) => fleetPower(state, b) - fleetPower(state, a) || a.id - b.id);
}

function sendTo(state: GameState, e: Empire, f: Fleet, target: number) {
  if (f.systemId === target && !f.path.length) return;
  if (f.order.type === 'move' && (f.order as { target: number }).target === target) return;
  execute(state, e.id, { type: 'moveFleet', fleetId: f.id, target });
}

/** Nearest owned system with a starbase (to repair and resupply), from a fleet's position. */
function nearestHaven(state: GameState, e: Empire, from: number): number | null {
  const t = nearestWhere(state.galaxy, from, (id) => { const s = state.galaxy.systems[id]; return s.owner === e.id && s.starbase > 0; });
  return t ?? e.capitalSystemId;
}

/** Estimated garrison of a hostile world, through the realm's intelligence on its owner. */
function garrisonEstimate(state: GameState, e: Empire, p: Planet): number {
  const owner = state.empires[p.colony!.ownerId];
  const real = getLedger(state, owner).planets[p.id]?.garrison ?? 4;
  const shield = (p.colony!.buildings.planetary_shield ?? 0) > 0 ? 1 / 0.6 : 1;
  // land enough to win even when the dice favour the defender (each side rolls ±15%)
  return real * shield * (estimatePower(state, e.id, owner.id) == null ? 1.7 : 1.4);
}

/**
 * Fleet operations. Fleets are organised by the plan: defence of the realm first, then a main
 * battle group that takes enemy worlds with the transports following, and (with better
 * coordination) raiding groups that blockade weakly held enemy systems. Hurt fleets go home to
 * repair; outmatched ones retreat.
 */
function operations(state: GameState, e: Empire) {
  const fleets = warFleets(state, e);
  if (!fleets.length) return;
  const preset = aiPreset(state, e);
  const owned = new Set(ownedSystems(state, e.id));
  const free = new Set(fleets.map((f) => f.id));
  const pow = (f: Fleet) => fleetPower(state, f);

  // 0) Damaged or starving fleets break off to repair.
  for (const f of fleets) {
    const hullFrac = f.ships.reduce((a, s) => a + s.hull, 0) / Math.max(1, f.ships.reduce((a, s) => a + shipStats(state, e, s.cls).hull, 0));
    if (f.supply < 25 || hullFrac < 0.45) {
      const haven = nearestHaven(state, e, f.systemId);
      if (haven != null && !(f.systemId === haven && !f.path.length)) { sendTo(state, e, f, haven); free.delete(f.id); }
      else if (haven === f.systemId && hullFrac < 0.8) free.delete(f.id); // stay docked until repaired
    }
  }

  // 1) Defence: answer every hostile fleet inside our borders with enough strength, nearest first.
  const threats: { sid: number; p: number }[] = [];
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (!owned.has(f.systemId) || !isHostile(state, e.id, f.ownerId) || !armed(f)) continue;
    if (state.empires[f.ownerId].kind === 'guardian') continue;
    const t = threats.find((x) => x.sid === f.systemId);
    if (t) t.p += pow(f); else threats.push({ sid: f.systemId, p: pow(f) });
  }
  threats.sort((a, b) => b.p - a.p);
  for (const t of threats) {
    const d = jumpDistances(state.galaxy, [t.sid], undefined, 10);
    const avail = fleets.filter((f) => free.has(f.id)).sort((a, b) => (d[a.systemId] ?? 99) - (d[b.systemId] ?? 99));
    let sum = 0;
    const picked: Fleet[] = [];
    for (const f of avail) { if (sum > t.p * 1.15) break; picked.push(f); sum += pow(f); }
    if (sum > t.p * 0.9) for (const f of picked) { sendTo(state, e, f, t.sid); free.delete(f.id); }
    else if (e.capitalSystemId != null) {
      // too strong to meet in the field: concentrate at the capital, behind its starbase
      for (const f of picked) { sendTo(state, e, f, e.capitalSystemId); free.delete(f.id); }
    }
  }

  const wars = state.wars.filter((w) => w.attackers.includes(e.id) || w.defenders.includes(e.id));
  const groups = fleets.filter((f) => free.has(f.id));
  if (wars.length && (e.kind === 'major' || e.kind === 'rebels') && groups.length) {
    const enemies = new Set<number>();
    for (const w of wars) (w.attackers.includes(e.id) ? w.defenders : w.attackers).forEach((x) => enemies.add(x));
    const main = groups[0];
    const mainP = pow(main) + groups.slice(1).filter((f) => f.systemId === main.systemId).reduce((a, f) => a + pow(f), 0);
    // allies fighting the same enemies: strike near their fleets (a shared front)
    const allyAt = new Set<number>();
    for (const id in state.fleets) {
      const f = state.fleets[id];
      if (f.ownerId === e.id || !armed(f)) continue;
      if (wars.some((w) => (w.attackers.includes(e.id) && w.attackers.includes(f.ownerId)) || (w.defenders.includes(e.id) && w.defenders.includes(f.ownerId)))) allyAt.add(f.systemId);
    }
    const d = jumpDistances(state.galaxy, [main.systemId], undefined, 10);
    const margin = preset.tightReserves ? 1.2 : 1.35;
    const targets = state.planets
      .filter((p) => p.colony && enemies.has(p.colony.ownerId) && Number.isFinite(d[p.systemId]))
      .map((p) => {
        const s = enemyStrengthAt(state, e, p.systemId);
        const cap = state.empires[p.colony!.ownerId].capitalPlanetId === p.id;
        const near = allyAt.has(p.systemId) || adjacency(state.galaxy)[p.systemId].some((v) => allyAt.has(v));
        // worth: people and the enemy capital; cost: distance and the troops a landing would take
        const troopsHave = Object.values(state.fleets).reduce((a, f) => a + (f.ownerId === e.id ? f.troops : 0), 0);
        const need = garrisonEstimate(state, e, p);
        return { p, s, v: (p.colony!.pops * 2 + 10 + (cap ? 30 : 0)) * (near ? 1.4 : 1) / (1 + d[p.systemId]) / (need > troopsHave ? 1 + (need - troopsHave) / 16 : 1) };
      })
      .filter((x) => mainP > x.s * margin)
      .sort((a, b) => b.v - a.v || a.p.id - b.p.id);
    const here = enemyStrengthAt(state, e, main.systemId);
    if (here > mainP * 1.1 && !owned.has(main.systemId)) {
      // outmatched: fall back
      const haven = nearestHaven(state, e, main.systemId);
      if (haven != null) for (const f of groups.filter((g) => g.systemId === main.systemId)) sendTo(state, e, f, haven);
    } else if (targets.length) {
      const t = targets[0];
      sendTo(state, e, main, t.p.systemId);
      // the other groups: raiders blockade weak enemy systems, the rest join the main group
      const raiders = groups.slice(1, preset.battleGroups);
      const raidTargets = state.galaxy.systems.filter((s) => s.owner != null && enemies.has(s.owner) && s.id !== t.p.systemId);
      for (const f of groups.slice(1)) {
        const isRaider = raiders.includes(f) && pow(f) > 15;
        if (isRaider) {
          const rd = jumpDistances(state.galaxy, [f.systemId], undefined, 6);
          const rt = raidTargets.filter((s) => Number.isFinite(rd[s.id]) && enemyStrengthAt(state, e, s.id) * 1.4 < pow(f)).sort((a, b) => rd[a.id] - rd[b.id] || a.id - b.id)[0];
          if (rt) { if (f.systemId !== rt.id) execute(state, e.id, { type: 'fleetOrder', fleetId: f.id, order: { type: 'blockade', systemId: rt.id } }); continue; }
        }
        sendTo(state, e, f, main.path.length ? t.p.systemId : main.systemId);
      }
      // transports wait at the nearest owned system and land once the orbit is ours
      // transports travel with the main battle group, under its guns, and land once the orbit is ours
      const need = garrisonEstimate(state, e, t.p);
      if (e.kind === 'major') planOf(e).troopsWanted = Math.ceil(need);
      for (const tf of Object.values(state.fleets)) {
        if (tf.ownerId !== e.id || tf === main || tf.troops <= 0 || armed(tf) && !tf.ships.every((x) => x.cls === 'transport')) continue;
        if (tf.systemId === main.systemId && !tf.path.length && !main.path.length && main.progress === 0) execute(state, e.id, { type: 'mergeFleets', fleetId: main.id, otherId: tf.id });
        else if (tf.order.type !== 'invade') sendTo(state, e, tf, main.path.length ? main.path[main.path.length - 1] : main.systemId);
      }
      if (main.systemId === t.p.systemId && !main.path.length && main.troops > need && main.order.type !== 'invade' && orbitSecured(state, e.id, t.p.id)) {
        execute(state, e.id, { type: 'fleetOrder', fleetId: main.id, order: { type: 'invade', planetId: t.p.id } });
      }
      return;
    } else {
      // no world we can take: hunt enemy fleets we outmatch in reach, else hold the border
      let prey: { sid: number; p: number } | null = null;
      for (const id in state.fleets) {
        const f = state.fleets[id];
        if (!enemies.has(f.ownerId) || !armed(f) || !Number.isFinite(d[f.systemId])) continue;
        const p = enemyStrengthAt(state, e, f.systemId);
        if (mainP > p * margin && (!prey || p > prey.p)) prey = { sid: f.systemId, p };
      }
      if (prey) { for (const f of groups) sendTo(state, e, f, prey.sid); return; }
      if (e.capitalSystemId != null) for (const f of groups) if (!owned.has(f.systemId) && f.order.type === 'idle') sendTo(state, e, f, e.capitalSystemId);
      return;
    }
  }
  if (!groups.length) return;
  const main = groups[0];
  const myPower = pow(main);
  // 2) Arming for war: stage the fleet on the border facing the rival.
  const plan = e.kind === 'major' ? planOf(e) : null;
  if (plan?.goal === 'arm' && plan.target != null) {
    const theirs = new Set(ownedSystems(state, plan.target));
    const adj = adjacency(state.galaxy);
    const stage = [...owned].filter((sid) => adj[sid].some((v) => theirs.has(v))).sort((a, b) => a - b)[0];
    if (stage != null) { for (const f of groups) sendTo(state, e, f, stage); return; }
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
  if (e.capitalSystemId != null) {
    for (const f of groups) if (f.order.type === 'idle' && !f.path.length && f.systemId !== e.capitalSystemId && !owned.has(f.systemId)) sendTo(state, e, f, e.capitalSystemId);
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
    // weigh the war: score, how long, how tired, and how the strength balance now looks
    const foes = mySide === 'attackers' ? w.defenders : w.attackers;
    const theirP = foes.reduce((a, id) => a + (estimatePower(state, e.id, id) ?? state.empires[id].stats.militaryPower), 0);
    const losing = (e.stats.militaryPower || 1) < theirP * 0.6;
    const otherMajor = state.empires[other].kind === 'major';
    // a winning side presses on while it still has worlds to take and the people will bear it
    const pressOn = myScore > 0 && myScore < 85 && e.warExhaustion < 55 && years < 8 && !losing && canStillTake(state, e, foes);
    if (pressOn) term = null;
    else if (myScore > 70 && years > 1) term = otherMajor && myScore > 80 && (state.empires[other].stats.militaryPower || 1) * 4 < (e.stats.militaryPower || 1) && state.empires[other].stats.systems * 3 <= e.stats.systems ? 'vassalize' : otherMajor ? 'cede' : 'vassalize';
    else if (myScore > 40 && years > 1) term = 'cede';
    else if (myScore > 25 && years > 1.5) term = 'tribute';
    else if (e.warExhaustion > 50 || myScore < -25 || (losing && myScore < 5) || years > 6) term = 'status_quo';    if (!term) continue;
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
  const armTarget = planOf(e).goal === 'arm' || planOf(e).goal === 'war' ? planOf(e).target : null;
  for (const o of majors) {
    if (!hasContact(state, e.id, o.id) || warBetween(state, e.id, o.id) || o.id === armTarget) continue;
    const op = opinion(state, e.id, o.id);
    const ladder: [TreatyType, number][] = [['nap', 10], ['trade', 20 - e.personality.mercantile * 15], ['research', 30 - e.personality.science * 15], ['defense', 55], ['alliance', 75]];
    const coalition = coalitionWanted(state, e, o.id);
    for (const [t, base] of ladder) {
      const need = coalition && t === 'defense' ? Math.min(base, 5) : base;
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
        const lead = hegemon(state);
        if (coalition && t === 'defense' && lead) log(state, { kind: 'coalition', severity: lead.id === state.playerId ? 'danger' : 'info', title: `${e.name} and ${o.name} stand together`, text: `Fearing the power of ${state.empires[lead.id].name}, they sign a mutual defence pact.`, empires: lead.id === state.playerId ? [] : [e.id, o.id] });
      }
      break; // one proposal per partner per cycle
    }
    // Deteriorating relations end treaties
    if (op < -40) for (const t of ['alliance', 'defense', 'research', 'trade'] as TreatyType[]) if (hasTreaty(state, e.id, o.id, t)) execute(state, e.id, { type: 'breakTreaty', target: o.id, treaty: t });
  }
  // Tribute demands from weak neighbours (aggressive AIs, player included)
  if (e.personality.aggression > 0.6 && chance(state.rng, 0.08)) {
    const weak = majors.find((o) => o.isPlayer && bordering(state, e.id, o.id) && (e.stats.militaryPower > (estimatePower(state, e.id, o.id) ?? 1e9) * 2.5) && !warBetween(state, e.id, o.id));
    if (weak && !state.proposals.some((p) => p.from === e.id && p.to === weak.id)) {
      state.proposals.push({ id: nextId(state), from: e.id, to: weak.id, give: [], receive: [{ kind: 'credits', amount: Math.round(150 + e.stats.population * 4) }], tick: state.tick, kind: 'deal' });
      log(state, { kind: 'diplomacy', severity: 'warn', title: `${e.name} demands tribute`, text: 'Their envoys hint that refusal would be unwise.', empires: [weak.id] });
    }
  }
  // Wars are declared by the strategic plan (strategy.ts). While arming, secure the other flanks.
  const plan = planOf(e);
  if (plan.goal === 'arm' && plan.target != null) {
    for (const o of majors) {
      if (o.id === plan.target || o.isPlayer || !bordering(state, e.id, o.id) || hasTreaty(state, e.id, o.id, 'nap') || warBetween(state, e.id, o.id)) continue;
      const prop = { id: nextId(state), from: e.id, to: o.id, give: [{ kind: 'treaty' as const, treaty: 'nap' as TreatyType }], receive: [], tick: state.tick, kind: 'deal' as const };
      if (evaluateProposal(state, prop).accept) applyDeal(state, prop);
    }
  }
}

/** Does our strongest battle group outmatch the defences of some enemy world within reach? */
function canStillTake(state: GameState, e: Empire, foes: number[]): boolean {
  const fleets = warFleets(state, e);
  if (!fleets.length) return false;
  const p = fleetPower(state, fleets[0]);
  const enemies = new Set(foes);
  const d = jumpDistances(state.galaxy, [fleets[0].systemId], undefined, 8);
  return state.planets.some((pl) => pl.colony && enemies.has(pl.colony.ownerId) && Number.isFinite(d[pl.systemId]) && p > enemyStrengthAt(state, e, pl.systemId) * 1.3);
}

// ---------------------------------------------------------------- raiders

export function runRaiders(state: GameState) {
  const raiders = state.empires.find((x) => x.kind === 'raiders');
  if (!raiders) return;
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.ownerId !== raiders.id || f.path.length) continue;
    // Raid the nearest poorly defended colonised system within 3 jumps; otherwise lurk.
    const d = jumpDistances(state.galaxy, [f.systemId], undefined, 3);
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

// ---------------------------------------------------------------- governance

function governance(state: GameState, e: Empire) {
  const value = (r: Record<string, number> | undefined) => Object.entries(r ?? {}).reduce((a, [k, v]) => a + v * (k === 'influence' ? 4 : k === 'credits' ? 0.5 : 1), 0);
  // answer the council's petitions
  for (const p of [...(e.petitions ?? [])]) {
    const def = PETITION_BY_ID[p.def];
    const h = e.houses?.find((x) => x.id === p.houseId);
    let best = -1, bestScore = -Infinity;
    def.options.forEach((o, i) => {
      if (Object.entries(o.cost ?? {}).some(([k, v]) => (e.stock[k as keyof typeof e.stock] ?? 0) < v * 2)) return;
      const timed = o.timed ? Object.entries(o.timed.mods).reduce((a, [, v]) => a + v * 120, 0) : 0;
      const sc = (o.house ?? 0) * ((h?.power ?? 30) / 40) * (h && h.loyalty < 40 ? 1.8 : 1) + (o.allHouses ?? 0) * 3 + (o.member ?? 0) * 0.6 + value(o.gain) * 0.1 - value(o.cost) * 0.06 + timed
        + (o.research ?? 0) * 0.04 + (o.planet?.stability ?? 0) * 0.4 + (o.planet?.pops ?? 0) * 8 + (o.planet?.resistance ?? 0) * -0.2
        - (o.raiders ?? 0) * 12 + (o.reputation ?? 0) * 0.4 * e.personality.diplomacy + (o.fleet ? 12 * e.personality.aggression : 0);
      if (sc > bestScore) { bestScore = sc; best = i; }
    });
    if (best >= 0) execute(state, e.id, { type: 'resolvePetition', petitionId: p.id, option: best });
  }
  // keep the houses in hand
  for (const h of e.houses ?? []) {
    if (inRevolt(state, h) || h.loyalty < 30) {
      if (!canActOnHouse(state, e, h, 'suppress') && (e.personality.aggression > 0.5 || inRevolt(state, h))) execute(state, e.id, { type: 'houseAction', houseId: h.id, action: 'suppress' });
      else if (e.stock.influence > 60) execute(state, e.id, { type: 'houseAction', houseId: h.id, action: 'grant' });
    }
  }
  // decrees
  // a decree costs 20-50 influence; keep 40 back for outposts and colonies (waiting for 110, as
  // before, meant most realms never issued one)
  if ((e.decrees?.length ?? 0) >= maxDecrees(state, e) || e.stock.influence < 60) return;
  const wants: string[] = [];
  const stab = e.stats?.avgStability ?? 50;
  if (stab < 40) wants.push('festival', 'martial_law', 'tax_relief');
  if (state.wars.some((w) => w.attackers.includes(e.id) || w.defenders.includes(e.id))) wants.push('war_footing', 'conscription');
  if (e.stock.credits < 200 && stab > 50 && !(e.houses ?? []).some((h) => h.ambition === 'low_taxes' && h.loyalty < 45)) wants.push('tax_levy');
  if (e.personality.science > 0.5) wants.push('research_grant');
  if (e.personality.mercantile > 0.5) wants.push('trade_charter');
  if (e.personality.expansion > 0.5) wants.push('census');
  wants.push('building_programme', 'forge_quotas');
  for (const id of wants) {
    if (canIssueDecree(state, e, id)) continue;
    if (e.stock.influence < (DECREE_BY_ID[id]?.cost.influence ?? 0) + 40) continue;
    execute(state, e.id, { type: 'issueDecree', decree: id });
    break;
  }
}

// ---------------------------------------------------------------- capital city

/** Raise the capital: the Citadel when it can rise, otherwise the building the realm's temperament favours. */
function capitalCity(state: GameState, e: Empire) {
  const cap = e.capital;
  if (!cap || cap.queue.length >= 1) return;
  const pers = e.personality;
  const weight: Record<string, number> = {
    citadel: 3, throne_hall: 1.6, treasury: 1.5 + pers.mercantile, hall_of_heroes: 0.8, research_institute: 1 + pers.science * 1.5,
    imperial_shipyards: 0.8 + pers.aggression * 1.5, refinery_complex: 1.2, diplomatic_quarter: 0.6 + pers.diplomacy, military_academy: 0.6 + pers.aggression,
    intelligence_bureau: 0.6, grand_market: 0.6 + pers.mercantile * 1.5, bastion: 0.5 + (1 - pers.aggression) * 0.6, arcology: 1, stellar_observatory: 1, stellar_forge: 1.2, monument_of_ages: 1,
  };
  const free = openPlots(e).find((p) => !plotOccupant(cap, p));
  let best: string | null = null, bestScore = 0;
  for (const def of CAPITAL_BUILDINGS) {
    const plot = cap.buildings[def.id] ? undefined : free;
    if (canQueueCapital(state, e, def.id, plot)) continue;
    const cost = capitalCost(def, plannedLevel(e, def.id) + 1);
    // keep a reserve for the rest of the realm
    if (Object.entries(cost).some(([k, v]) => (e.stock[k as keyof typeof e.stock] ?? 0) < v * (k === 'credits' ? 1.5 : 1.15) + 20)) continue;
    const sc = (weight[def.id] ?? 1) / Math.sqrt(1 + plannedLevel(e, def.id));
    if (sc > bestScore) { bestScore = sc; best = def.id; }
  }
  if (best) execute(state, e.id, { type: 'capitalBuild', building: best, plot: cap.buildings[best] ? undefined : free });
}

// ---------------------------------------------------------------- resource operations

/** Run operations: surge what the realm is short of, rest depleted sites, keep within freighter capacity, upgrade the best. */
function operationsAI(state: GameState, e: Empire) {
  const ops = opsOf(state, e.id);
  if (!ops.length) return;
  const L = getLedger(state, e);
  const short = new Set(L.shortages);
  const prod: Record<string, string[]> = { mining: ['minerals', 'rare'], energy: ['energy'], research: [], gas: ['energy', 'rare'] };
  let spare = L.logisticsCap - L.logisticsUsed;
  for (const p of ops) {
    const op = p.op!;
    if (op.mode === 'halted') {
      if (spare >= op.level && op.reserve > 0.3) { spare -= op.level; execute(state, e.id, { type: 'setOperationMode', planetId: p.id, mode: 'standard' }); }
      continue;
    }
    let want: OpMode = 'standard';
    if (op.reserve < 0.25) want = 'sustain';
    else if (prod[p.station!].some((r) => short.has(r as never) || (e.stock as Record<string, number>)[r] < 50) && op.reserve > 0.5) want = 'surge';
    else if (op.mode === 'sustain' && op.reserve < 0.8) want = 'sustain';
    if (want !== op.mode) execute(state, e.id, { type: 'setOperationMode', planetId: p.id, mode: want });
  }
  // over freighter capacity: rest the weakest operations
  let over = L.logisticsUsed - L.logisticsCap;
  for (const p of ops.slice().sort((a, b) => a.op!.reserve - b.op!.reserve)) {
    if (over <= 0) break;
    if (p.op!.mode === 'halted') continue;
    over -= p.op!.level;
    execute(state, e.id, { type: 'setOperationMode', planetId: p.id, mode: 'halted' });
  }
  // upgrade one operation when there is spare capacity and money
  if (spare > 0 && L.logisticsUsed < L.logisticsCap && e.stock.minerals > 400 && e.stock.credits > 250) {
    const best = ops.filter((p) => p.op!.level < OP_MAX_LEVEL && p.op!.mode !== 'halted').sort((a, b) => b.op!.reserve - a.op!.reserve)[0];
    if (best) execute(state, e.id, { type: 'upgradeOperation', planetId: best.id });
  }
}
