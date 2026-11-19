// Game orchestration: new-game setup and the daily simulation tick.
// Order of a day: combat -> movement -> orders -> supply -> construction ->
// economy/population/research per empire -> monthly systems -> AI.

import { eraMonthly } from './eras';
import { recordYear } from './chronicle';
import { operationsMonthly } from './operations';
import { ensureCapital, progressCapitals } from './capital';
import { governanceMonthly, ensureHouses } from './governance';
import { createCharacter, assign, charactersMonthly, refreshCandidates } from './characters';
import { civilisationPower } from './power';
import { MAX_ERA } from './data/eras';
import { makeRng, int, pick, chance, range, next } from './rng';
import { generateGalaxy, jumpDistances, jumpsWithin, adjacency, ensureBodies } from './galaxy';
import { CIV_TEMPLATES, MINOR_NAMES, RULER_FIRST, RULER_LAST } from './data/names';
import { defaultPolicies, GOVERNMENTS } from './data/governments';
import { PLANET_TYPES } from './data/planets';
import { computeLedger, applyLedgerDay, type Ledger } from './economy';
import { resolveCombat } from './combat';
import { moveFleets, processOrders, supplyAndRepair, createFleet, fleetPower, removeFleet, relocateCapital } from './fleets';
import { progressConstruction } from './construction';
import { progressResearch } from './research';
import { monthlyDiplomacy, addMemory } from './diplomacy';
import { visibleSystems, ownedSystems, setSystemOwner, markExplored, isExplored } from './territory';
import { runAI, runRaiders } from './ai';
import { MARKET_BASE } from './commands';
import { emptyStock, log, nextId } from './util';
import { RESOURCES, type Climate, type Colony, type Empire, type GameSettings, type GameState, type GovernmentId, type PlanetType, type BuildingId, type ResId } from './types';
import { successionMonthly, ensureRuler } from './succession';
import { espionageTick } from './espionage';

export const SAVE_VERSION = 1;

const HOME_TYPE: Record<Climate, PlanetType[]> = {
  wet: ['temperate', 'ocean', 'jungle'],
  dry: ['arid'],
  cold: ['tundra'],
};

export const DEFAULT_SETTINGS: GameSettings = {
  seed: 1337,
  galaxySize: 'medium',
  aiCount: 4,
  playerName: 'Aurelian Throne',
  playerGovernment: 'monarchy',
  playerClimate: 'wet',
  difficulty: 'standard',
};

function blankEmpire(id: number, partial: Partial<Empire>): Empire {
  return {
    id,
    name: 'Unknown',
    adjective: 'Unknown',
    color: '#888',
    isPlayer: false,
    kind: 'major',
    alive: true,
    capitalPlanetId: null,
    capitalSystemId: null,
    climate: 'wet',
    government: 'monarchy',
    governmentChangedTick: -99999,
    policies: defaultPolicies(),
    stock: emptyStock(),
    research: { current: null, progress: 0, queue: [], done: [] },
    explored: [],
    personality: { aggression: 0.4, expansion: 0.5, mercantile: 0.5, science: 0.5, diplomacy: 0.5, doctrine: 'balanced' },
    timedMods: [],
    council: {},
    decrees: [],
    decreeCooldowns: {},
    petitions: [],
    armory: [],
    warExhaustion: 0,
    era: 0,
    emblem: id,
    ruler: '',
    aiNextTick: 3 + id,
    stats: { population: 0, colonies: 0, systems: 0, militaryPower: 0, economyScore: 0, industry: 0, research: 0, navalUsed: 0, navalCap: 0, adminCap: 0, avgStability: 0 },
    ...partial,
  };
}

function newColony(ownerId: number, pops: number, buildings: Partial<Record<BuildingId, number>>): Colony {
  return { ownerId, pops, buildings, queue: [], shipQueue: [], stability: 62, resistance: 0, originalOwnerId: null, foundedTick: -720, lowStabilityMonths: 0, defenseDamage: 0 };
}

export function newGame(settings: Partial<GameSettings> = {}): GameState {
  const s: GameSettings = { ...DEFAULT_SETTINGS, ...settings };
  const rng = makeRng(s.seed);
  const { galaxy, planets } = generateGalaxy(rng, s.galaxySize, s.seed);
  const state: GameState = {
    version: SAVE_VERSION,
    settings: s,
    tick: 0,
    rng,
    galaxy,
    planets,
    empires: [],
    fleets: {},
    characters: [],
    opinions: {},
    treaties: [],
    wars: [],
    truces: [],
    tributes: [],
    tradeDeals: [],
    proposals: [],
    events: [],
    battles: [],
    market: { price: { ...MARKET_BASE }, volume: Object.fromEntries(RESOURCES.map((r) => [r, 0])) as Record<ResId, number> },
    nextId: 1,
    patrolled: {},
    disruptedRoutes: {},
    playerId: 0,
    gameOver: null,
  };

  // --- choose capitals by farthest-point sampling over hyperlane distance ---
  // Large galaxies start the kingdoms together in one region of an outer arm
  // (like the Sun's neighbourhood); the rest of the galaxy is frontier.
  const huge = galaxy.lazyBodies === true;
  const majors = 1 + Math.max(1, Math.min(6, s.aiCount));
  const minorCount = s.galaxySize === 'small' ? 1 : s.galaxySize === 'medium' ? 3 : 5;
  let region: number[] = galaxy.systems.map((x) => x.id);
  if (huge) {
    const R = galaxy.shape?.R ?? galaxy.width / 2;
    const cxy = galaxy.width / 2;
    const ring = galaxy.systems.filter((x) => { const r = Math.hypot(x.x - cxy, x.y - cxy) / R; return r > 0.5 && r < 0.65 && Math.abs(x.z ?? 0) < 0.03 * R; });
    const centre = ring[int(rng, 0, ring.length - 1)] ?? galaxy.systems[0];
    region = [...jumpsWithin(galaxy, centre.id, 26).keys()];
    for (const id of region) ensureBodies(state, id);
  }
  const regionSet = new Set(region);
  const eligible = region.filter((id) => galaxy.systems[id].star !== 'black_hole' && galaxy.systems[id].planetIds.length >= 2);
  const capitals: number[] = [eligible[int(rng, 0, eligible.length - 1)]];
  while (capitals.length < majors + minorCount) {
    const d = jumpDistances(galaxy, capitals, (id) => regionSet.has(id));
    let best = -1;
    let bestD = -1;
    for (const id of eligible) {
      if (capitals.includes(id) || !Number.isFinite(d[id])) continue;
      const v = d[id] + next(rng) * 0.5;
      if (v > bestD) { bestD = v; best = id; }
    }
    if (best < 0) break;
    capitals.push(best);
  }
  // Independent realms scattered across the wider galaxy (large galaxies only).
  const farRealms: number[] = [];
  if (huge) {
    for (let k = 0, tries = 0; k < 12 && tries < 400; tries++) {
      const id = int(rng, 0, galaxy.systems.length - 1);
      if (regionSet.has(id) || farRealms.includes(id)) continue;
      ensureBodies(state, id);
      if (galaxy.systems[id].planetIds.length < 2 || galaxy.systems[id].star === 'black_hole') continue;
      farRealms.push(id); k++;
    }
  }

  const templates = CIV_TEMPLATES.slice();
  for (let i = templates.length - 1; i > 0; i--) { const j = Math.floor(next(rng) * (i + 1)); [templates[i], templates[j]] = [templates[j], templates[i]]; }

  for (let i = 0; i < majors; i++) {
    const isPlayer = i === 0;
    const t = templates[(i - 1 + templates.length) % templates.length];
    const climate: Climate = isPlayer ? s.playerClimate : t.climate;
    const gov: GovernmentId = isPlayer ? s.playerGovernment : t.government;
    const e = blankEmpire(i, isPlayer
      ? {
          name: s.playerName, adjective: s.playerName.split(' ')[0], color: '#d9b45a', isPlayer: true, climate, government: gov,
          personality: { aggression: 0.5, expansion: 0.5, mercantile: 0.5, science: 0.5, diplomacy: 0.5, doctrine: 'balanced' },
          ruler: `${GOVERNMENTS[gov].ruler} ${pick(rng, RULER_FIRST)} ${pick(rng, RULER_LAST)}`,
        }
      : {
          name: t.name, adjective: t.adjective, color: t.color, climate, government: gov, personality: { ...t.personality },
          ruler: `${GOVERNMENTS[gov].ruler} ${pick(rng, RULER_FIRST)} ${pick(rng, RULER_LAST)}`,
        });
    state.empires.push(e);
    setupHomeworld(state, e, capitals[i], 'major');
  }
  const minorSites = [...capitals.slice(majors), ...farRealms];
  for (let i = 0; i < minorSites.length; i++) {
    const sysId = minorSites[i];
    const sys = galaxy.systems[sysId];
    const e = blankEmpire(state.empires.length, {
      name: `${MINOR_NAMES[i % MINOR_NAMES.length]} ${sys.name}`, adjective: sys.name, color: ['#8c8f96', '#9a8f7a', '#7f8f99', '#998a99', '#8a998a'][i % 5],
      kind: 'minor', climate: pick(rng, ['wet', 'dry', 'cold'] as Climate[]), government: pick(rng, ['republic', 'monarchy', 'corporate', 'feudal'] as GovernmentId[]),
      personality: { aggression: 0.1, expansion: 0, mercantile: 0.6, science: 0.4, diplomacy: 0.7, doctrine: 'balanced' },
      ruler: `${pick(rng, RULER_FIRST)} ${pick(rng, RULER_LAST)}`,
    });
    state.empires.push(e);
    setupHomeworld(state, e, sysId, 'minor');
  }
  // Guardians: ancient automated sentinels guarding precursor ruins
  const guardian = blankEmpire(state.empires.length, { name: 'Precursor Sentinels', adjective: 'Sentinel', color: '#b48cff', kind: 'guardian', personality: { aggression: 0, expansion: 0, mercantile: 0, science: 0, diplomacy: 0, doctrine: 'line' } });
  state.empires.push(guardian);
  const capDist = jumpDistances(galaxy, capitals);
  const lairs = galaxy.systems.filter((x) => x.owner == null && capDist[x.id] >= 3 && (!huge || capDist[x.id] <= 40) && (x.features.includes('ancient_ruins') || x.features.includes('rare_cluster')));
  const lairCount = Math.max(1, Math.min(huge ? 30 : 99, Math.round(galaxy.systems.length / 22)));
  for (let i = 0; i < lairCount && lairs.length; i++) {
    const idx = int(rng, 0, lairs.length - 1);
    const sys = lairs.splice(idx, 1)[0];
    if (!sys.features.includes('ancient_ruins')) sys.features.push('ancient_ruins');
    sys.features.push('guardian');
    const f = createFleet(state, guardian.id, sys.id, ['battleship', 'cruiser', 'cruiser', 'destroyer'], `Sentinel Host of ${sys.name}`);
    f.stance = 'defensive';
  }
  // Raiders exist as a faction; their fleets appear through events.
  state.empires.push(blankEmpire(state.empires.length, { name: 'Void Corsairs', adjective: 'Corsair', color: '#e0565b', kind: 'raiders', personality: { aggression: 1, expansion: 0, mercantile: 0, science: 0, diplomacy: 0, doctrine: 'swarm' } }));

  // Initial exploration & stats
  for (const e of state.empires) {
    if (e.capitalSystemId == null) continue;
    const adj = adjacency(galaxy);
    e.explored = [];
    for (const id of [e.capitalSystemId, ...adj[e.capitalSystemId]]) markExplored(state, e, id);
  }
  for (const e of state.empires) { ensureHouses(state, e); ensureCapital(e); ensureRuler(state, e); }
  refreshCandidates(state);
  updateStats(state);
  recordYear(state);
  log(state, { kind: 'start', severity: 'info', title: 'A new reign begins', text: `${state.empires[0].ruler} ascends the throne of the ${state.empires[0].name}. The galaxy awaits.`, empires: [0] });
  return state;
}

function setupHomeworld(state: GameState, e: Empire, sysId: number, kind: 'major' | 'minor') {
  const rng = state.rng;
  const sys = state.galaxy.systems[sysId];
  // Pick the largest non-gas-giant body as homeworld and terraform it to the species climate.
  const candidates = sys.planetIds.map((p) => state.planets[p]).filter((p) => p.type !== 'gas_giant' && p.moonOf == null);
  const home = candidates.sort((a, b) => b.size - a.size)[0] ?? state.planets[sys.planetIds[0]];
  home.type = pick(rng, HOME_TYPE[e.climate]);
  home.size = kind === 'major' ? 20 : 14;
  home.deposits = { minerals: 2, energy: 2, food: 2, rare: kind === 'major' ? 1 : 0, research: 1 };
  home.station = null;
  setSystemOwner(state, sysId, e.id);
  sys.starbase = kind === 'major' ? 2 : 1;
  if (sys.star === 'black_hole' || sys.star === 'neutron') sys.star = 'yellow';
  sys.features = sys.features.filter((f) => f !== 'pulsar' && f !== 'guardian');
  e.capitalPlanetId = home.id;
  e.capitalSystemId = sysId;
  if (kind === 'major') {
    home.colony = newColony(e.id, 30, {
      capital: 1, residential: 3, agri: 3, mining: 3, power: 3, refinery: 1, electronics_fab: 1,
      research_lab: 1, spaceport: 1, shipyard: 1, orbital_defense: 1,
    });
    if (e.climate !== 'wet') {
      // Arid and cold peoples learned closed-loop farming long ago.
      e.research.done.push('bio_hydroponics');
      home.colony.buildings.hydroponics = 1;
    }
    Object.assign(e.stock, { credits: 400, minerals: 500, energy: 300, food: 300, alloys: 250, electronics: 80, components: 20, rare: 100, influence: 80 });
    const guard = createFleet(state, e.id, sysId, ['corvette', 'corvette', 'corvette'], 'Home Guard');
    createFleet(state, e.id, sysId, ['scout'], `${e.adjective} Survey Corps`);
    createFleet(state, e.id, sysId, ['constructor'], `Construction Ship`);
    // founding court: an admiral, an archscholar and a chancellor
    e.council = {};
    assign(state, createCharacter(state, e.id, 'admiral', { level: 2 }), { kind: 'fleet', fleetId: guard.id });
    assign(state, createCharacter(state, e.id, 'scientist', { level: 2 }), { kind: 'council', seat: 'archscholar' });
    assign(state, createCharacter(state, e.id, 'chancellor', { level: 2 }), { kind: 'council', seat: 'chancellor' });
    // Guarantee a reachable second world for early colonisation.
    ensureNearbyHabitable(state, e, sysId);
  } else {
    home.colony = newColony(e.id, 12, { capital: 1, residential: 1, agri: 2, mining: 2, power: 2, refinery: 1, electronics_fab: 1, spaceport: 1, shipyard: 1, orbital_defense: 2, garrison: 1 });
    Object.assign(e.stock, { credits: 300, minerals: 300, energy: 200, food: 200, alloys: 150, electronics: 50, components: 10, rare: 30, influence: 50 });
    createFleet(state, e.id, sysId, ['corvette', 'corvette', 'corvette', 'corvette'], `${e.adjective} Defence Squadron`).stance = 'defensive';
  }
  home.colony.stability = 65;
}

function ensureNearbyHabitable(state: GameState, e: Empire, sysId: number) {
  const d = jumpDistances(state.galaxy, [sysId]);
  const near = state.planets.filter((p) => d[p.systemId] >= 0 && d[p.systemId] <= 2 && !p.colony && p.moonOf == null && p.type !== 'gas_giant');
  const ok = near.some((p) => PLANET_TYPES[p.type].hab[e.climate] >= 0.6);
  if (ok || !near.length) return;
  const target = near.sort((a, b) => d[a.systemId] - d[b.systemId] || b.size - a.size).find((p) => d[p.systemId] >= 1) ?? near[0];
  target.type = pick(state.rng, HOME_TYPE[e.climate]);
  target.size = Math.max(target.size, 12);
}

// ------------------------------------------------------------------ tick

const ledgerCache = new WeakMap<GameState, Map<number, { tick: number; ledger: Ledger }>>();

export function getLedger(state: GameState, e: Empire, fresh = false): Ledger {
  let m = ledgerCache.get(state);
  if (!m) { m = new Map(); ledgerCache.set(state, m); }
  const hit = m.get(e.id);
  if (!fresh && hit && hit.tick === state.tick) return hit.ledger;
  const ledger = computeLedger(state, e);
  m.set(e.id, { tick: state.tick, ledger });
  return ledger;
}

export function step(state: GameState) {
  if (state.gameOver && !state.gameOver.won) return;
  state.tick++;
  const engaged = resolveCombat(state);
  moveFleets(state, engaged);
  processOrders(state);
  supplyAndRepair(state, engaged);
  progressConstruction(state);
  progressCapitals(state);

  for (const e of state.empires) {
    if (!e.alive || e.kind === 'guardian' || e.kind === 'raiders') continue;
    const ledger = getLedger(state, e, true);
    const started = applyLedgerDay(state, e, ledger);
    for (const r of started) {
      if (e.isPlayer) log(state, { kind: 'shortage', severity: 'danger', title: `${label(r)} shortage`, text: shortageText(r), empires: [e.id] });
    }
    progressResearch(state, e, ledger.net.research);
    for (const pid in ledger.planets) {
      const rep = ledger.planets[pid];
      const c = state.planets[+pid].colony!;
      c.pops = Math.max(1, c.pops + rep.growth / 30);
      if (rep.growth > 0) c.pops = Math.min(c.pops, Math.max(rep.housing, c.pops));
      c.stability += (rep.stabilityTarget - c.stability) * 0.02;
      c.lastJobs = rep.jobs;
      c.lastHousing = rep.housing;
    }
    // Trade route disruption notifications (player only)
    if (e.isPlayer) {
      for (const pid in ledger.planets) {
        const rep = ledger.planets[pid];
        const k = String(pid);
        if (rep.routeStatus === 'disrupted') {
          if (state.disruptedRoutes[k] == null) {
            state.disruptedRoutes[k] = state.tick;
            log(state, { kind: 'trade', severity: 'warn', title: 'Trade route disrupted', text: `Hostile ships block the route from ${state.planets[+pid].name} to the capital.`, empires: [e.id], planetId: +pid });
          }
        } else if (state.disruptedRoutes[k] != null) delete state.disruptedRoutes[k];
      }
    }
    if (e.kind === 'major') for (const sid of visibleSystems(state, e.id)) if (!isExplored(e, sid)) markExplored(state, e, sid);
  }

  if (state.tick % 30 === 0) monthly(state);

  for (const e of state.empires) {
    if (!e.alive || e.isPlayer) continue;
    if ((e.kind === 'major' || e.kind === 'minor' || e.kind === 'rebels') && state.tick >= e.aiNextTick) {
      runAI(state, e);
      e.aiNextTick = state.tick + 5;
    }
  }
  if (state.tick % 3 === 0) runRaiders(state);
}

function label(r: ResId) { return r.charAt(0).toUpperCase() + r.slice(1); }
function shortageText(r: ResId): string {
  switch (r) {
    case 'food': return 'Granaries are empty. Populations are starving and will decline.';
    case 'energy': return 'The grid is failing. Industry runs at reduced capacity and stability suffers.';
    case 'credits': return 'The treasury is empty. Wages go unpaid and stability collapses.';
    case 'electronics': return 'Consumer goods have run out. Research labs stall and citizens grow restless.';
    case 'minerals': return 'Mineral reserves exhausted. Foundries and fabricators are idling.';
    case 'alloys': return 'Alloy stocks depleted. Fleets cannot be maintained properly.';
    case 'rare': return 'Rare elements exhausted. Electronics production is crippled.';
    default: return `${label(r)} reserves are depleted.`;
  }
}

function monthly(state: GameState) {
  monthlyDiplomacy(state);
  for (const e of state.empires) e.timedMods = e.timedMods.filter((t) => t.until > state.tick);
  // market prices drift back toward base
  for (const r of RESOURCES) {
    const base = MARKET_BASE[r];
    if (!base) continue;
    state.market.price[r] += (base - state.market.price[r]) * 0.08;
    state.market.volume[r] *= 0.7;
  }
  colonyMonthly(state);
  guardiansCheck(state);
  randomEvents(state);
  eliminationCheck(state);
  charactersMonthly(state, (a, b, v, label) => addMemory(state, a, b, 'envoy', v, 0.5, label));
  governanceMonthly(state);
  successionMonthly(state);
  espionageTick(state, 30);
  operationsMonthly(state);
  if (state.tick % 360 === 0) refreshCandidates(state);
  updateStats(state);
  if (state.tick % 360 === 0) recordYear(state);
  eraMonthly(state);
  victoryCheck(state);
}

function colonyMonthly(state: GameState) {
  for (const p of state.planets) {
    const c = p.colony;
    if (!c) continue;
    const e = state.empires[c.ownerId];
    // Occupation resistance fades with garrisons & stability
    if (c.resistance > 0) {
      const garrisons = c.buildings.garrison ?? 0;
      const decay = (1.2 + garrisons * 1.5) * (1 + (e.policies.border_security === 'fortified' ? 0.5 : 0));
      c.resistance = Math.max(0, c.resistance - decay + (c.stability < 25 ? 2 : 0));
    }
    // Rebellion
    if (c.stability < 12 && e.capitalPlanetId !== p.id) c.lowStabilityMonths++;
    else c.lowStabilityMonths = Math.max(0, c.lowStabilityMonths - 1);
    if (c.lowStabilityMonths >= 4 && c.pops >= 2) revolt(state, p.id);
    else if (c.lowStabilityMonths === 2 && e.isPlayer) {
      log(state, { kind: 'unrest', severity: 'danger', title: `Unrest on ${p.name}`, text: `Stability is collapsing (${Math.round(c.stability)}). Without relief the world will revolt within months.`, empires: [e.id], planetId: p.id });
    }
  }
}

/** A world throws off its ruler: it returns to its original owner, or declares itself a rebel state. Exported for tests. */
export function revolt(state: GameState, planetId: number) {
  const p = state.planets[planetId];
  const c = p.colony!;
  const owner = state.empires[c.ownerId];
  const orig = c.originalOwnerId != null ? state.empires[c.originalOwnerId] : null;
  c.lowStabilityMonths = 0;
  if (orig && orig.alive && orig.id !== owner.id) {
    c.ownerId = orig.id;
    c.originalOwnerId = null;
    c.resistance = 0;
    c.stability = 45;
    c.queue = [];
    c.shipQueue = [];
    reassignSystem(state, p.systemId, owner.id, orig.id);
    log(state, { kind: 'rebellion', severity: 'danger', title: `${p.name} rises in revolt`, text: `The people of ${p.name} have overthrown ${owner.adjective} rule and returned to ${orig.name}.`, empires: [] });
    return;
  }
  // Declare independence as a new rebel state
  const id = state.empires.length;
  const sys = state.galaxy.systems[p.systemId];
  const rebels = blankEmpire(id, {
    name: `Free State of ${p.name}`, adjective: p.name.split(' ')[0], color: '#a0a39b', kind: 'rebels',
    climate: owner.climate, government: pick(state.rng, ['republic', 'feudal', 'junta'] as GovernmentId[]),
    personality: { aggression: 0.2, expansion: 0, mercantile: 0.5, science: 0.4, diplomacy: 0.6, doctrine: 'balanced' },
    capitalPlanetId: p.id, capitalSystemId: p.systemId, ruler: `${pick(state.rng, RULER_FIRST)} ${pick(state.rng, RULER_LAST)}`,
    explored: [p.systemId, ...adjacency(state.galaxy)[p.systemId]],
  });
  rebels.stock = { ...emptyStock(), credits: 200, minerals: 200, energy: 100, food: 100, alloys: 80, influence: 20 };
  ensureRuler(state, rebels); // so a save made before the next month round-trips unchanged
  state.empires.push(rebels);
  c.ownerId = id;
  c.originalOwnerId = null;
  c.resistance = 0;
  c.stability = 50;
  c.queue = [];
  c.shipQueue = [];
  c.buildings.capital = 1;
  if (!c.buildings.garrison) c.buildings.garrison = 1;
  reassignSystem(state, sys.id, owner.id, id);
  createFleet(state, id, sys.id, ['corvette', 'corvette'], 'Liberation Flotilla').stance = 'defensive';
  state.wars.push({ id: nextId(state), attackers: [id], defenders: [owner.id], startTick: state.tick, score: 10, name: `${p.name} War of Independence` });
  addMemory(state, id, owner.id, 'oppressor', -50, 0.3, 'Former oppressor');
  log(state, { kind: 'rebellion', severity: 'danger', title: `${p.name} declares independence`, text: `Rebels have seized ${p.name} from the ${owner.name} and proclaimed the ${rebels.name}.`, empires: [], planetId: p.id, systemId: sys.id });
}

function reassignSystem(state: GameState, systemId: number, from: number, to: number) {
  const sys = state.galaxy.systems[systemId];
  const fromHolds = sys.planetIds.some((pid) => state.planets[pid].colony?.ownerId === from);
  if (!fromHolds) setSystemOwner(state, systemId, to);
  if (sys.starbase === 0 && sys.owner === to) sys.starbase = 1;
}

function guardiansCheck(state: GameState) {
  for (const sys of state.galaxy.systems) {
    if (!sys.features.includes('guardian')) continue;
    const alive = Object.values(state.fleets).some((f) => f.systemId === sys.id && state.empires[f.ownerId].kind === 'guardian');
    if (!alive) {
      sys.features = sys.features.filter((f) => f !== 'guardian');
      log(state, { kind: 'guardian', severity: 'good', title: `Sentinels of ${sys.name} destroyed`, text: 'The precursor ruins are now open to survey by any fleet that arrives.', empires: [], systemId: sys.id });
    }
  }
}

function randomEvents(state: GameState) {
  const rng = state.rng;
  for (const e of state.empires) {
    if (!e.alive || e.kind !== 'major') continue;
    if (!chance(rng, 0.09)) continue;
    const colonies = state.planets.filter((p) => p.colony?.ownerId === e.id);
    if (!colonies.length) continue;
    const roll = int(rng, 0, 8);
    const p = pick(rng, colonies);
    const c = p.colony!;
    const ev = (severity: 'good' | 'warn' | 'danger' | 'info', title: string, text: string) =>
      log(state, { kind: 'event', severity, title, text, empires: [e.id], planetId: p.id, systemId: p.systemId });
    switch (roll) {
      case 0: p.deposits.minerals += 2; ev('good', 'Mineral vein discovered', `Surveyors on ${p.name} found a rich ore body. Mining districts there yield more.`); break;
      case 1: e.timedMods.push({ key: 'output.energy', value: -0.2, until: state.tick + 180, label: 'Solar storms' }); ev('warn', 'Solar storms', 'Stellar flares disrupt power generation across the realm (-20% energy for 6 months).'); break;
      case 2: {
        if (e.research.done.includes('bio_medicine')) { ev('info', 'Epidemic contained', `Regenerative medicine halted an outbreak on ${p.name}.`); break; }
        c.pops = Math.max(1, c.pops * 0.9); ev('danger', 'Epidemic', `A plague swept ${p.name}, killing a tenth of the population.`); break;
      }
      case 3: e.timedMods.push({ key: 'stability', value: 6, until: state.tick + 360, label: 'Cultural renaissance' }); ev('good', 'Cultural renaissance', 'A flowering of the arts lifts spirits across the realm (+6 stability for a year).'); break;
      case 4: e.timedMods.push({ key: 'tradeValue', value: 0.25, until: state.tick + 360, label: 'Trade boom' }); ev('good', 'Trade boom', 'Merchant houses report record profits (+25% trade value for a year).'); break;
      case 5: spawnRaiders(state, e); break;
      case 6: e.research.progress += 120; ev('good', 'Scientific breakthrough', 'A serendipitous discovery advances current research (+120).'); break;
      case 7: c.pops += 2; c.stability -= 4; ev('info', 'Refugee wave', `Refugees from beyond the frontier settle on ${p.name} (+2 pops, -4 stability).`); break;
      case 8: c.stability -= 12; ev('warn', 'Labour strikes', `Workers on ${p.name} walk out over conditions (-12 stability).`); break;
    }
  }
}

export function spawnRaiders(state: GameState, target: Empire) {
  const raiders = state.empires.find((x) => x.kind === 'raiders');
  if (!raiders) return;
  const existing = Object.values(state.fleets).filter((f) => f.ownerId === raiders.id).length;
  if (existing >= 4) return;
  const owned = new Set(ownedSystems(state, target.id));
  const adj = adjacency(state.galaxy);
  const spots = state.galaxy.systems.filter((s) => s.owner == null && adj[s.id].some((v) => owned.has(v)) && !s.features.includes('guardian'));
  if (!spots.length) return;
  const sys = pick(state.rng, spots);
  const years = state.tick / 360;
  const n = 2 + Math.floor(years / 4);
  const classes: ('corvette' | 'frigate' | 'destroyer' | 'cruiser')[] = [];
  for (let i = 0; i < Math.min(12, n); i++) classes.push(years > 15 && i % 4 === 0 ? 'cruiser' : years > 6 && i % 3 === 0 ? 'destroyer' : 'corvette');
  const f = createFleet(state, raiders.id, sys.id, classes, `Corsair Raiders of ${sys.name}`);
  f.stance = 'aggressive';
  log(state, { kind: 'raiders', severity: 'danger', title: 'Corsair raiders sighted', text: `A raider band of ${classes.length} ships gathers at ${sys.name}, threatening ${target.adjective} trade lanes.`, empires: [target.id], systemId: sys.id });
}

function eliminationCheck(state: GameState) {
  for (const e of state.empires) {
    if (!e.alive || e.kind === 'guardian' || e.kind === 'raiders') continue;
    const colonies = state.planets.filter((p) => p.colony?.ownerId === e.id);
    if (colonies.length) {
      if (e.capitalPlanetId == null || state.planets[e.capitalPlanetId].colony?.ownerId !== e.id) relocateCapital(state, e.id);
      continue;
    }
    e.alive = false;
    for (const s of state.galaxy.systems) if (s.owner === e.id) setSystemOwner(state, s.id, null);
    for (const id in state.fleets) if (state.fleets[id].ownerId === e.id) removeFleet(state, state.fleets[id]);
    state.treaties = state.treaties.filter((t) => t.a !== e.id && t.b !== e.id);
    for (const w of state.wars) { w.attackers = w.attackers.filter((x) => x !== e.id); w.defenders = w.defenders.filter((x) => x !== e.id); }
    state.wars = state.wars.filter((w) => w.attackers.length && w.defenders.length);
    log(state, { kind: 'fall', severity: 'danger', title: `${e.name} has fallen`, text: `The last world of the ${e.name} has been lost. Their realm is no more.`, empires: [] });
  }
}

export function updateStats(state: GameState) {
  for (const e of state.empires) {
    if (!e.alive) continue;
    let pop = 0; let col = 0; let stab = 0;
    for (const p of state.planets) if (p.colony?.ownerId === e.id) { pop += p.colony.pops; col++; stab += p.colony.stability; }
    let mil = 0;
    for (const id in state.fleets) if (state.fleets[id].ownerId === e.id) mil += fleetPower(state, state.fleets[id]);
    const L = e.kind === 'guardian' || e.kind === 'raiders' ? null : getLedger(state, e, true);
    e.stats = {
      population: Math.round(pop * 10) / 10,
      colonies: col,
      systems: ownedSystems(state, e.id).length,
      militaryPower: mil,
      economyScore: L ? Math.round(L.income.credits + L.income.minerals * 0.5 + L.income.energy * 0.4 + L.income.alloys * 2 + L.income.electronics * 2.5 + L.income.components * 5 + L.income.research) : 0,
      industry: L ? Math.round(L.income.alloys + L.income.electronics + L.income.components * 2) : 0,
      research: L ? Math.round(L.net.research) : 0,
      navalUsed: L?.navalUsed ?? 0,
      navalCap: L?.navalCap ?? 0,
      adminCap: L?.adminCap ?? 0,
      avgStability: col ? Math.round(stab / col) : 0,
    };
    if (e.kind === 'major') { const pw = civilisationPower(state, e); e.stats.kardashev = Math.round(pw.k * 1000) / 1000; e.stats.powerW = pw.watts; }
  }
}

function victoryCheck(state: GameState) {
  const player = state.empires[state.playerId];
  if (!player.alive) {
    state.gameOver = { won: false, reason: 'Your realm has fallen. The last of your worlds is lost.' };
    log(state, { kind: 'gameover', severity: 'danger', title: 'The reign has ended', text: state.gameOver.reason, empires: [] });
    return;
  }
  if (state.gameOver) return;
  const total = state.galaxy.systems.length;
  const mine = player.stats.systems;
  const rivalsStanding = state.empires.filter((e) => e.alive && e.kind === 'major' && !e.isPlayer && !state.treaties.some((t) => t.type === 'vassal' && t.a === player.id && t.b === e.id));
  if ((player.era ?? 0) >= MAX_ERA) {
    state.gameOver = { won: true, reason: 'Your civilisation has reached Omega Sovereignty and transcended the age of kingdoms.' };
    log(state, { kind: 'victory', severity: 'good', title: 'Ascension achieved', text: `${state.gameOver.reason} You may continue to rule.`, empires: [] });
    return;
  }
  if (mine / total >= 0.6 || rivalsStanding.length === 0) {
    state.gameOver = { won: true, reason: rivalsStanding.length === 0 ? 'Every rival kingdom has fallen or kneels before your throne.' : 'Your banners fly over three fifths of the galaxy.' };
    log(state, { kind: 'victory', severity: 'good', title: 'Galactic Dominion achieved', text: `${state.gameOver.reason} You may continue to rule.`, empires: [] });
  }
}

export function runDays(state: GameState, days: number) {
  for (let i = 0; i < days; i++) step(state);
}

export { range };
