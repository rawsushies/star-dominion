// Economic simulation: jobs, production chains, consumption, taxation, trade,
// upkeep and storage. Produces a fully itemised ledger used by both the
// simulation (applied daily as monthly/30) and the UI (breakdowns).

import { BUILDINGS, JOB_PRIORITY, type YieldKey } from './data/buildings';
import { PLANET_TYPES, STAR_TYPES, habitability } from './data/planets';
import { SHIPS } from './data/ships';
import { POLICY_BY_ID } from './data/governments';
import { MEGA_BY_ID } from './data/megastructures';
import { empireMods, hasFlag, mod, type Mods } from './modifiers';
import { findPath } from './galaxy';
import { RESOURCES, type BuildingId, type Colony, type Empire, type GameState, type Planet, type ResId } from './types';
import { governorBonus, industrialistBonus, charactersOf, salary } from './characters';
import { opReport, OP_KINDS, logisticsCapacity, logisticsUsed } from './operations';
import { supplyNetwork, hostileArmedPresence, isHostile, adminCapacity, ownedSystems } from './territory';
import { DESIGNATIONS } from './data/designations';
import { embargoed, isCorrupted, sponsorOf, systemCondition } from './expansion';

export type LedgerKey = ResId | 'research';
export interface LedgerLine { key: LedgerKey; label: string; amount: number }

export interface PlanetReport {
  planetId: number;
  housing: number;
  jobs: number;
  employed: number;
  unemployed: number;
  filled: Partial<Record<BuildingId, number>>;
  hab: number;
  stabilityTarget: number;
  stabilityFactors: [string, number][];
  outputMult: number;
  growth: number; // pops per month
  garrison: number;
  trade: number; // trade value generated (before routing)
  tradeCollected: number;
  routeStatus: 'capital' | 'secure' | 'raided' | 'disrupted' | 'cut';
  routePath: number[];
  connected: boolean;
  production: Partial<Record<LedgerKey, number>>; // net per month for this world
  buildingSlots: number;
  buildingsUsed: number;
  districtCaps: Record<'residential' | 'agri' | 'mining' | 'power', number>;
}

export interface Ledger {
  lines: LedgerLine[];
  net: Record<LedgerKey, number>;
  income: Record<LedgerKey, number>;
  expense: Record<LedgerKey, number>;
  cap: Record<ResId, number>;
  planets: Record<number, PlanetReport>;
  shortages: ResId[];
  adminCap: number;
  adminUsed: number;
  navalCap: number;
  navalUsed: number;
  tradeTotal: number;
  tradeLost: number;
  logisticsCap: number;
  logisticsUsed: number;
}

const DISTRICTS = ['residential', 'agri', 'mining', 'power'] as const;

export function districtCaps(p: Planet): Record<(typeof DISTRICTS)[number], number> {
  const def = PLANET_TYPES[p.type];
  return {
    residential: Math.max(1, Math.round(p.size * def.districts.residential)),
    agri: Math.round(p.size * def.districts.agri),
    mining: Math.round(p.size * def.districts.mining),
    power: Math.round(p.size * def.districts.power),
  };
}

export function buildingSlots(c: Colony): number {
  return Math.min(14, 3 + Math.floor(c.pops / 5));
}

export function buildingsUsed(c: Colony): number {
  let n = 0;
  for (const b in c.buildings) {
    const def = BUILDINGS[b as BuildingId];
    if (def.category !== 'district' && b !== 'capital') n += c.buildings[b as BuildingId] ?? 0;
  }
  // queued non-district items also reserve slots
  for (const q of c.queue) if (q.kind === 'building' && !q.demolish && BUILDINGS[q.id as BuildingId].category !== 'district') n++;
  return n;
}

export function planetHab(state: GameState, p: Planet, e: Empire, mods: Mods): number {
  return habitability(p.type, e.climate, mod(mods, 'habitability'), hasFlag(state, e, 'domes'));
}

export function storageCap(state: GameState, e: Empire, mods: Mods, mine?: Planet[]): Record<ResId, number> {
  let goods = 2000;
  for (const p of mine ?? state.planets) {
    if (p.colony?.ownerId !== e.id) continue;
    for (const b in p.colony.buildings) goods += (BUILDINGS[b as BuildingId].storage ?? 0) * (p.colony.buildings[b as BuildingId] ?? 0);
  }
  goods *= 1 + mod(mods, 'storage');
  const cap = {} as Record<ResId, number>;
  for (const r of RESOURCES) cap[r] = goods;
  cap.credits = goods * 6;
  cap.influence = 1500;
  return cap;
}

export function shortageOf(e: Empire, r: ResId): boolean {
  return e.stock[r] < 0.5;
}

function stabilityOutputMult(stab: number): number {
  if (stab < 20) return 0.6;
  if (stab < 40) return 0.6 + ((stab - 20) / 20) * 0.4;
  if (stab > 70) return 1 + ((stab - 70) / 30) * 0.15;
  return 1;
}

export function computeLedger(state: GameState, e: Empire): Ledger {
  const mods = empireMods(state, e);
  const lines: LedgerLine[] = [];
  const add = (key: LedgerKey, label: string, amount: number) => {
    if (Math.abs(amount) < 1e-6) return;
    const ex = lines.find((l) => l.key === key && l.label === label);
    if (ex) ex.amount += amount; else lines.push({ key, label, amount });
  };
  const planets: Record<number, PlanetReport> = {};
  // the realm's colonies, collected once for every per-colony pass below
  const mine: Planet[] = [];
  for (const p of state.planets) if (p.colony?.ownerId === e.id) mine.push(p);
  const network = supplyNetwork(state, e.id);
  const owned = ownedSystems(state, e.id);
  const logisticsCap = logisticsCapacity(state, e, mods, mine);
  const logisticsUse = logisticsUsed(state, e.id);
  const logisticsEff = logisticsUse > logisticsCap ? logisticsCap / logisticsUse : 1;
  const adminCap = adminCapacity(state, e, mods, mine);
  const adminUsed = owned.length;
  const overcap = Math.max(0, adminUsed - adminCap);
  const capitalSys = e.capitalSystemId;
  const starving = shortageOf(e, 'food');
  const energyShort = shortageOf(e, 'energy');
  const goodsShort = shortageOf(e, 'electronics');
  const broke = shortageOf(e, 'credits');
  let colonies = 0;
  let tradeTotal = 0;
  let tradeLost = 0;
  let navalCap = 8 + mod(mods, 'navalCap');

  for (const p of mine) {
    const c = p.colony;
    if (!c || c.ownerId !== e.id) continue;
    colonies++;
    const rep = colonyReport(state, e, p, c, mods, {
      network, capitalSys, overcap, starving, energyShort, goodsShort, broke,
    });
    planets[p.id] = rep;
    for (const l of rep.__lines) add(l.key, l.label, l.amount);
    tradeTotal += rep.trade;
    tradeLost += rep.trade - rep.tradeCollected;
    for (const b in c.buildings) navalCap += (BUILDINGS[b as BuildingId].navalCap ?? 0) * (c.buildings[b as BuildingId] ?? 0);
    delete (rep as any).__lines;
  }

  // Systems: asteroid belts, rare clusters, orbital stations, starbase upkeep
  for (const sid of owned) {
    const sys = state.galaxy.systems[sid];
    if (sys.asteroidBelts) add('minerals', 'Asteroid mining', sys.asteroidBelts * 2.5 * (1 + mod(mods, 'output.minerals')));
    if (sys.features.includes('rare_cluster')) add('rare', 'Rare element clusters', 1.2 * (1 + mod(mods, 'output.rare')));
    if (sys.features.includes('jump_nexus')) add('credits', 'Jump nexus tolls', 4 * (1 + mod(mods, 'tradeValue')));
    const sbUpkeep = [0, 0.8, 2.5, 6][sys.starbase] ?? 0;
    add('credits', 'Starbase upkeep', -sbUpkeep);
    for (const pid of sys.planetIds) {
      const pl = state.planets[pid];
      if (!pl.station || pl.colony) continue;
      const r = opReport(state, e, pl, mods, { network, logisticsEff });
      const label = OP_KINDS[pl.station].label + 's';
      const sc = systemCondition(state, sid);
      for (const [k, v] of r.output) add(k, label, sc ? v * sc.output * (k === 'energy' ? sc.energy : 1) : v);
      for (const [k, v] of r.upkeep) add(k, 'Operation upkeep', v);
    }
    for (const m of sys.megastructures) {
      if (m.ownerId !== e.id || m.stage <= 0) continue;
      const def = MEGA_BY_ID[m.id];
      for (const k in def.outputPerStage ?? {}) {
        const key = k as LedgerKey;
        const base = (def.outputPerStage as any)[k] * m.stage;
        const m2 = 1 + mod(mods, `output.${k}`);
        const mc = k === 'energy' ? systemCondition(state, sid)?.energy ?? 1 : 1;
        add(key, def.label, base * m2 * mc);
      }
    }
  }

  // Base realm income
  add('influence', 'Court & nobility', 1 * (1 + mod(mods, 'output.influence')));
  add('research', 'Royal academies', 2 * (1 + mod(mods, 'output.research')));
  if (overcap > 0) add('influence', 'Administrative overreach', -0.4 * overcap);

  // Fleets
  let navalUsed = 0;
  const shipUpkeep: Partial<Record<ResId, number>> = {};
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.ownerId !== e.id) continue;
    for (const s of f.ships) {
      const def = SHIPS[s.cls];
      navalUsed += def.command;
      for (const r in def.upkeep) shipUpkeep[r as ResId] = (shipUpkeep[r as ResId] ?? 0) + (def.upkeep as any)[r];
    }
  }
  const overNaval = navalCap > 0 ? Math.max(0, navalUsed - navalCap) / navalCap : 0;
  for (const r in shipUpkeep) {
    add(r as ResId, 'Fleet upkeep', -(shipUpkeep[r as ResId] ?? 0) * (1 + mod(mods, 'upkeepShips')) * (1 + overNaval));
  }

  // Pay for the realm's notable people
  let pay = 0;
  for (const ch of charactersOf(state, e.id)) pay += salary(ch);
  add('credits', 'Officer and court salaries', -pay);

  // Policies
  for (const pid in e.policies) {
    const def = POLICY_BY_ID[pid];
    const opt = def?.options.find((o) => o.id === e.policies[pid]);
    if (!opt) continue;
    for (const r in opt.costPerColony ?? {}) add(r as ResId, `Policy: ${def.label}`, -(opt.costPerColony as any)[r] * colonies);
    for (const r in opt.costFlat ?? {}) add(r as ResId, `Policy: ${def.label}`, -(opt.costFlat as any)[r]);
  }

  // Tributes and vassal levies
  for (const t of state.tributes) {
    if (t.until < state.tick) continue;
    if (t.from === e.id) add('credits', `Tribute to ${state.empires[t.to].name}`, -t.perMonth);
    if (t.to === e.id) add('credits', `Tribute from ${state.empires[t.from].name}`, t.perMonth);
  }
  for (const tr of state.treaties) {
    if (tr.type !== 'vassal') continue;
    if (tr.b === e.id) add('credits', 'Vassal levy', -Math.max(2, (e.stats.population || 10) * 0.08));
    if (tr.a === e.id) add('credits', `Levy from ${state.empires[tr.b].name}`, Math.max(2, (state.empires[tr.b].stats.population || 10) * 0.08));
  }
  for (const d of state.tradeDeals) {
    if (d.until < state.tick) continue;
    if (d.a !== e.id && d.b !== e.id) continue;
    if (embargoed(state, d.a, d.b)) continue; // suspended by a Conclave embargo
    const gives = d.a === e.id ? d.aGives : d.bGives;
    const gets = d.a === e.id ? d.bGives : d.aGives;
    const other = state.empires[d.a === e.id ? d.b : d.a].name;
    for (const r in gives) add(r as ResId, `Trade deal: ${other}`, -(gives as any)[r]);
    for (const r in gets) add(r as ResId, `Trade deal: ${other}`, (gets as any)[r]);
  }
  // Trade agreements: +8% of trade value per partner
  const partners = state.treaties.filter((t) => t.type === 'trade' && (t.a === e.id || t.b === e.id) && !embargoed(state, t.a, t.b)).length;
  if (partners) add('credits', 'Trade agreements', (tradeTotal - tradeLost) * 0.08 * partners + 2 * partners);
  const researchPartners = state.treaties.filter((t) => t.type === 'research' && (t.a === e.id || t.b === e.id)).length;
  if (researchPartners) {
    const rp = lines.filter((l) => l.key === 'research' && l.amount > 0).reduce((a, l) => a + l.amount, 0);
    add('research', 'Research cooperation', rp * 0.1 * researchPartners);
  }

  // Automata Prime's tithe on its sponsored sovereigns
  if (sponsorOf(state, e.id)?.id === 'automata') {
    const credits = lines.filter((l) => l.key === 'credits' && l.amount > 0).reduce((a, l) => a + l.amount, 0);
    add('credits', 'Automata tithe', -credits * 0.05);
  }

  const net = {} as Record<LedgerKey, number>;
  const income = {} as Record<LedgerKey, number>;
  const expense = {} as Record<LedgerKey, number>;
  for (const k of [...RESOURCES, 'research'] as LedgerKey[]) { net[k] = 0; income[k] = 0; expense[k] = 0; }
  for (const l of lines) {
    net[l.key] += l.amount;
    if (l.amount > 0) income[l.key] += l.amount; else expense[l.key] -= l.amount;
  }
  const shortages = RESOURCES.filter((r) => r !== 'influence' && shortageOf(e, r) && net[r] < 0);
  return {
    lines, net, income, expense, cap: storageCap(state, e, mods, mine), planets, shortages,
    adminCap, adminUsed, navalCap: Math.round(navalCap), navalUsed, tradeTotal, tradeLost, logisticsCap, logisticsUsed: logisticsUse,
  };
}

interface Ctx {
  network: Set<number>;
  capitalSys: number | null;
  overcap: number;
  starving: boolean;
  energyShort: boolean;
  goodsShort: boolean;
  broke: boolean;
}

function colonyReport(state: GameState, e: Empire, p: Planet, c: Colony, mods: Mods, ctx: Ctx): PlanetReport & { __lines: LedgerLine[] } {
  const sys = state.galaxy.systems[p.systemId];
  const def = PLANET_TYPES[p.type];
  const hab = planetHab(state, p, e, mods);
  const isCapital = e.capitalPlanetId === p.id;
  const connected = isCapital || ctx.network.has(p.systemId);
  const ln: LedgerLine[] = [];
  const production: Partial<Record<LedgerKey, number>> = {};
  const put = (key: LedgerKey, label: string, amount: number) => {
    if (Math.abs(amount) < 1e-6) return;
    ln.push({ key, label, amount });
    production[key] = (production[key] ?? 0) + amount;
  };

  // Housing & jobs
  let housing = 5;
  const filled: Partial<Record<BuildingId, number>> = {};
  let jobs = 0;
  for (const b in c.buildings) {
    const d = BUILDINGS[b as BuildingId];
    const n = c.buildings[b as BuildingId] ?? 0;
    housing += d.housing * n;
    jobs += d.jobs * n;
  }
  let free = Math.floor(c.pops);
  for (const b of JOB_PRIORITY) {
    const n = c.buildings[b] ?? 0;
    if (!n) continue;
    const want = BUILDINGS[b].jobs * n;
    const take = Math.min(free, want);
    filled[b] = take;
    free -= take;
  }
  const employed = Math.floor(c.pops) - free;
  const unemployed = Math.max(0, c.pops - employed);

  // Stability
  const sf: [string, number][] = [['Baseline', 50]];
  const ms = mod(mods, 'stability');
  if (ms) sf.push(['Government, policy & technology', ms]);
  let bstab = 0;
  for (const b in c.buildings) bstab += (BUILDINGS[b as BuildingId].stability ?? 0) * (c.buildings[b as BuildingId] ?? 0);
  if (bstab) sf.push(['Civic buildings', bstab]);
  if (c.pops > 0 && unemployed > 0.5) sf.push(['Unemployment', -Math.min(30, (unemployed / c.pops) * 45)]);
  if (c.pops > housing) sf.push(['Overcrowding', -Math.min(25, ((c.pops - housing) / housing) * 60)]);
  if (ctx.starving) sf.push(['Famine', -20]);
  if (ctx.goodsShort) sf.push(['Consumer goods shortage', -10]);
  if (ctx.energyShort) sf.push(['Blackouts', -10]);
  if (ctx.broke) sf.push(['Unpaid wages', -15]);
  if (ctx.overcap > 0) sf.push(['Administrative overreach', -Math.min(25, ctx.overcap * 2)]);
  if (e.warExhaustion > 0) sf.push(['War exhaustion', -e.warExhaustion * 0.2]);
  if (!connected) sf.push(['Cut off from the realm', -10]);
  if (c.resistance > 0) sf.push(['Occupation resistance', -c.resistance * 0.35]);
  if (hab < 0.6) sf.push(['Hostile environment', -Math.round((0.6 - hab) * 20)]);
  const gov = governorBonus(state, e.id, sys.sector);
  if (gov.stability) sf.push([`Governor ${gov.name}`, gov.stability]);
  if (c.designation && DESIGNATIONS[c.designation].stability) sf.push([DESIGNATIONS[c.designation].label, DESIGNATIONS[c.designation].stability]);
  // the Devourer, its scars, Omega corruption and recovery (sim/expansion.ts); null in ordinary systems
  const cond = systemCondition(state, p.systemId);
  if (cond) sf.push([cond.label, cond.stability]);
  const ind = industrialistBonus(state, p.id);
  const stabilityTarget = Math.max(0, Math.min(100, sf.reduce((a, [, v]) => a + v, 0)));

  const conn = connected ? 1 : 0.5;
  const outputMult = (cond ? cond.output : 1) * stabilityOutputMult(c.stability) * (1 - c.resistance / 200) * conn * (1 + gov.output + ind.output);
  // province designation: matching yields gain, the rest pay a little; a governor adds a third again
  const desig = DESIGNATIONS[c.designation ?? 'balanced'];
  const govSpec = gov.name ? 1 + (gov.output > 0 ? 0.35 : 0.2) : 1;
  const desigMult = (k: YieldKey) => 1 + (desig.boost[k] != null ? desig.boost[k]! * govSpec : desig.other);

  // Production per building
  const yieldMult = (b: BuildingId, k: YieldKey): number => {
    let m = 1;
    const d = BUILDINGS[b];
    if (d.district === 'agri' && k === 'food') m *= def.yield.food;
    if (d.district === 'mining' && k === 'minerals') m *= def.yield.minerals * (1 + p.deposits.minerals * 0.04);
    if (d.district === 'power' && k === 'energy') m *= def.yield.energy * STAR_TYPES[sys.star].energy;
    if (cond && k === 'energy') m *= cond.energy;
    if (b === 'rare_extractor' && k === 'rare') m *= Math.max(1, p.deposits.rare);
    if (b === 'research_lab' && k === 'research') m *= 1 + p.deposits.research * 0.05;
    if (k === 'trade') m *= 1 + mod(mods, 'tradeValue');
    else m *= 1 + mod(mods, `output.${k}`);
    return m * desigMult(k);
  };
  let trade = 0;
  for (const b in filled) {
    const bid = b as BuildingId;
    const workers = filled[bid] ?? 0;
    if (!workers) continue;
    const d = BUILDINGS[bid];
    // Input availability: if the kingdom has run dry of an input, the line idles at 25%.
    let inputEff = 1;
    for (const r in d.input) if (shortageOf(e, r as ResId)) inputEff = Math.min(inputEff, 0.25);
    const powerEff = ctx.energyShort && d.category === 'industry' ? 0.6 : 1;
    const eff = inputEff * powerEff;
    for (const r in d.input) put(r as ResId, `${d.label} inputs`, -(d.input as any)[r] * workers * eff);
    for (const k in d.output) {
      const amount = (d.output as any)[k] * workers * yieldMult(bid, k as YieldKey) * outputMult * eff;
      if (k === 'trade') trade += amount;
      else put(k as LedgerKey, labelFor(k as LedgerKey, bid), amount);
    }
  }
  // Building upkeep
  for (const b in c.buildings) {
    const d = BUILDINGS[b as BuildingId];
    const n = c.buildings[b as BuildingId] ?? 0;
    for (const r in d.upkeep) put(r as ResId, 'Building upkeep', -(d.upkeep as any)[r] * n * (1 + mod(mods, 'upkeepBuildings')));
  }
  // Pops: consumption & taxes
  put('food', 'Population consumption', -c.pops * 1 * (1 + mod(mods, 'foodUpkeep')));
  put('electronics', 'Consumer goods', -c.pops * 0.05);
  const taxBase = employed * 0.6 + unemployed * 0.2;
  put('credits', 'Taxation', taxBase * (1 + mod(mods, 'tax')) * Math.min(1, stabilityOutputMult(c.stability)) * conn);
  trade += c.pops * 0.15 * (1 + mod(mods, 'tradeValue'));
  // New colonies are supported by the crown until self-sufficient.
  const age = state.tick - c.foundedTick;
  if (!isCapital && age < 720 && c.pops < 6) {
    put('food', 'Colony support', -2);
    put('credits', 'Colony support', -3);
  }

  // Trade routing to the capital
  let routeStatus: PlanetReport['routeStatus'] = 'capital';
  let routePath: number[] = [];
  let tradeCollected = trade;
  if (!isCapital) {
    if (ctx.capitalSys == null || !connected) {
      routeStatus = 'cut';
      tradeCollected = 0;
    } else {
      const path = cachedRoute(state, ctx.network, p.systemId, ctx.capitalSys);
      routePath = [p.systemId, ...path];
      let loss = 0;
      let disrupted = false;
      for (const sid of routePath) {
        if (hostileArmedPresence(state, e.id, sid) || isCorrupted(state, sid)) { disrupted = true; break; }
        const s2 = state.galaxy.systems[sid];
        const patrolled = (state.patrolled[`${e.id}:${sid}`] ?? -999) > state.tick - 45;
        if (s2.starbase < 2 && !patrolled) loss += 0.025;
      }
      if (disrupted) { routeStatus = 'disrupted'; tradeCollected = 0; }
      else {
        loss = Math.min(0.5, loss);
        routeStatus = loss > 0.05 ? 'raided' : 'secure';
        tradeCollected = trade * (1 - loss);
      }
    }
  }
  put('credits', 'Trade routes', tradeCollected);

  // Growth
  let growth = 0;
  const maxPops = housing;
  if (ctx.starving) growth = -0.4;
  else if (c.pops > maxPops + 0.01) growth = -0.25;
  else if (connected && hab > 0) {
    const room = Math.max(0, Math.min(1, (maxPops - c.pops) / 3));
    growth = (0.32 * (0.4 + 0.6 * hab) * (1 + mod(mods, 'growth')) + (c.pops < 4 ? 0.15 : 0)) * room;
    if (c.stability < 25) growth *= 0.5;
  }
  if (cond?.corrupted) growth = Math.min(growth, -0.3);

  let garrison = 2 + c.pops * 0.25;
  for (const b in c.buildings) garrison += (BUILDINGS[b as BuildingId].garrison ?? 0) * (c.buildings[b as BuildingId] ?? 0);
  garrison *= 1 + mod(mods, 'garrison');

  return {
    planetId: p.id, housing, jobs, employed, unemployed, filled, hab, stabilityTarget, stabilityFactors: sf,
    outputMult, growth, garrison, trade, tradeCollected, routeStatus, routePath, connected, production,
    buildingSlots: buildingSlots(c), buildingsUsed: buildingsUsed(c), districtCaps: districtCaps(p), __lines: ln,
  };
}

const routeCache = new WeakMap<Set<number>, Map<string, number[]>>();
function cachedRoute(state: GameState, network: Set<number>, from: number, to: number): number[] {
  let m = routeCache.get(network);
  if (!m) { m = new Map(); routeCache.set(network, m); }
  const k = `${from}>${to}`;
  let r = m.get(k);
  if (!r) { r = findPath(state.galaxy, from, to, (id) => network.has(id)) ?? []; m.set(k, r); }
  return r;
}

function labelFor(k: LedgerKey, b: BuildingId): string {
  const d = BUILDINGS[b];
  if (d.category === 'district') return d.label.replace(' District', ' districts');
  return d.label;
}

/** Apply one day of the ledger to stockpiles; returns shortages that began today. */
export function applyLedgerDay(state: GameState, e: Empire, ledger: Ledger): ResId[] {
  const started: ResId[] = [];
  for (const r of RESOURCES) {
    const before = e.stock[r];
    let v = before + ledger.net[r] / 30;
    if (v < 0) v = 0;
    if (v > ledger.cap[r]) v = Math.max(before > ledger.cap[r] ? Math.min(before, v) : ledger.cap[r], 0);
    e.stock[r] = v;
    if (before >= 0.5 && v < 0.5 && ledger.net[r] < 0) started.push(r);
  }
  return started;
}

export function isAtWarWith(state: GameState, a: number, b: number): boolean {
  return isHostile(state, a, b);
}
