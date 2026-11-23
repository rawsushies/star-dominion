// The living galaxy: an aggregated model of what happens between the decisions
// of rulers. Worlds produce and consume (the ledger already itemises each world),
// and merchants turn surpluses and deficits into standing routes whose convoys
// sail on a schedule; war, blockades and corsairs cut them, and the worlds at
// the far end go short. People move toward prosperity and away from war. Realms
// rise, enjoy golden ages, decline, fracture and recover, and minor states can
// grow into great powers. What matters is written into a galactic history that
// later decisions remember (through opinion memories and the AI's war choices).
//
// Frequencies: route safety and war damage every 5 days, arrivals daily,
// everything else monthly; the arcs of realms yearly. Nothing here simulates
// individual citizens or cargo transactions: routes carry monthly volumes.

import type { Colony, Empire, GameState, Planet, ResId } from './types';
import { TRADE_GOODS, type HistoryEntry, type LifeState, type Migration, type RealmArc, type RouteStatus, type TradeGood, type TradeRoute } from './lifeTypes';
import {
  CARGO_PER_CONVOY, CONVOY_SPEED, DEPOT_MAX, DEPOT_MIN_STOCK, DEPOT_SHARE, DEVASTATION, HISTORY_MAX, INTERSTELLAR_JUMPS, INTERSTELLAR_MAX,
  INTERSTELLAR_PER_REALM, MIGRATIONS_PER_REALM, MIGRATION_MAX, RECOGNITION_YEARS, ROUTE_EFF, ROUTE_IDLE_MONTHS, SECESSION_CRISIS,
  SECESSION_GAP_YEARS, SOURCES_PER_WORLD, TRADE_MIN, PHASE_LABEL,
} from './data/life';
import { BUILDINGS } from './data/buildings';
import { getLedger, blankEmpire } from './engine';
import { findPath, jumpsWithin, laneLength } from './galaxy';
import { armed, isHostile, setSystemOwner, supplyNetwork, warBetween, hasTreaty } from './territory';
import { addMemory, hasContact, opinion } from './diplomacy';
import { embargoed } from './expansion';
import { marketBounds, MARKET_BASE } from './commands';
import { createFleet } from './fleets';
import { log, nextId, emptyStock, formatDate } from './util';
import { pick } from './rng';
import { RULER_FIRST, RULER_LAST } from './data/names';
import { ensureRuler } from './succession';
import { ensureCapital } from './capital';
import { ensureHouses } from './governance';
import { shortageOf } from './economy';
import type { GovernmentId } from './types';

// ------------------------------------------------------------------ state

export function emptyLife(): LifeState {
  return { routes: [], migrations: [], arcs: {}, history: [], ruins: {}, volume: [], noticed: {} };
}

export function life(state: GameState): LifeState {
  return (state.life ??= emptyLife());
}

/** Older saves get the living galaxy in its empty state; fields added later get defaults. */
export function migrateLife(state: GameState) {
  state.life = { ...emptyLife(), ...(state.life ?? {}) };
}

/** economies the living galaxy models */
export function economic(e: Empire | undefined): e is Empire {
  return !!e && e.alive && (e.kind === 'major' || e.kind === 'minor' || e.kind === 'rebels');
}

function arcOf(state: GameState, id: number): RealmArc {
  const L = life(state);
  return (L.arcs[id] ??= { phase: 'founding', since: state.tick, econ: [], pop: [], peakEcon: 0, crisis: 0, pressure: 0, prosperity: 50, born: state.tick });
}

// ------------------------------------------------------------------ history

/** Write an event into galactic history (and, if notable, the news). */
export function chronicle(state: GameState, h: Omit<HistoryEntry, 'id' | 'tick'>) {
  const L = life(state);
  const entry: HistoryEntry = { id: nextId(state), tick: state.tick, ...h };
  L.history.push(entry);
  if (L.history.length > HISTORY_MAX) {
    // forget the least weighty of the oldest half first
    const half = L.history.slice(0, Math.floor(L.history.length / 2));
    let worst = 0;
    for (let i = 1; i < half.length; i++) if (half[i].weight < half[worst].weight) worst = i;
    L.history.splice(worst, 1);
  }
  const mine = h.who.includes(state.playerId);
  if (h.weight >= 2 || mine) {
    const severity = ({ golden: 'good', rise: 'good', recovery: 'good', recognition: 'info', ascendant: 'good', trade: 'good', rebuilt: 'good', boom: 'good' } as Record<string, 'good' | 'info'>)[h.kind]
      ?? (h.kind === 'collapse' || h.kind === 'secession' || h.kind === 'famine' ? 'danger' : 'warn');
    log(state, { kind: 'history', severity, title: h.title, text: `${h.cause} ${h.effect}`.trim(), empires: h.weight >= 2 ? [] : h.who.filter((w) => state.empires[w]?.isPlayer), systemId: h.systemId, planetId: h.planetId });
  }
  return entry;
}

function noticeOnce(state: GameState, key: string, gapDays: number): boolean {
  const L = life(state);
  const t = L.noticed[key];
  if (t != null && state.tick - t < gapDays) return false;
  L.noticed[key] = state.tick;
  return true;
}

// ------------------------------------------------------------------ worlds

const name = (state: GameState, id: number) => state.empires[id]?.name ?? 'a fallen realm';

/** The world's character, read from what it is built for (for the map and the planet screen). */
export type WorldRole = 'capital' | 'agrarian' | 'mining' | 'energy' | 'industrial' | 'technological' | 'research' | 'trade' | 'fortress' | 'urban' | 'frontier';
export function worldRole(state: GameState, p: Planet): WorldRole {
  const c = p.colony;
  if (!c) return 'frontier';
  if (state.empires[c.ownerId]?.capitalPlanetId === p.id) return 'capital';
  if (c.pops < 5) return 'frontier';
  const b = c.buildings;
  const score: [WorldRole, number][] = [
    ['agrarian', (b.agri ?? 0) * 1 + (b.hydroponics ?? 0) * 2],
    ['mining', (b.mining ?? 0) + (b.rare_extractor ?? 0) * 2],
    ['energy', (b.power ?? 0) + (b.fusion_plant ?? 0) * 2],
    ['industrial', (b.refinery ?? 0) * 2.5 + (b.component_works ?? 0) * 3],
    ['technological', (b.electronics_fab ?? 0) * 2.5],
    ['research', (b.research_lab ?? 0) * 3],
    ['trade', (b.commerce_hub ?? 0) * 3 + (b.spaceport ?? 0)],
    ['fortress', (b.garrison ?? 0) * 1.5 + (b.orbital_defense ?? 0) * 1.5 + (b.planetary_shield ?? 0) * 2],
    ['urban', (b.residential ?? 0) * 0.8 + (b.arcology ?? 0) * 5 + (b.entertainment ?? 0)],
  ];
  score.sort((x, y) => y[1] - x[1]);
  return score[0][1] > 0 ? score[0][0] : 'frontier';
}

export type WorldCondition = 'thriving' | 'prosperous' | 'developing' | 'struggling' | 'declining' | 'devastated' | 'occupied' | 'besieged' | 'frontier';
/** How a world is faring, from its simulated state (drives the map's look of each system). */
export function worldCondition(state: GameState, p: Planet): WorldCondition {
  const c = p.colony;
  if (!c) return 'frontier';
  if ((c.devastation ?? 0) >= 45) return 'devastated';
  if (c.resistance > 25 && c.originalOwnerId != null) return 'occupied';
  if (besieged(state, p)) return 'besieged';
  const pr = c.prosperity ?? 50;
  if ((c.dev ?? 30) < 22) return 'frontier';
  if (pr >= 74) return 'thriving';
  if (pr >= 60) return 'prosperous';
  if (pr < 32 || c.stability < 22) return 'declining';
  if (pr < 44) return 'struggling';
  return 'developing';
}

function besieged(state: GameState, p: Planet): boolean {
  const owner = p.colony?.ownerId;
  if (owner == null) return false;
  for (const f of fleetsAt(state).get(p.systemId) ?? []) {
    if (f.ownerId !== owner && armed(f) && isHostile(state, owner, f.ownerId) && state.empires[f.ownerId]?.kind !== 'guardian') return true;
  }
  return false;
}

// per-tick index of fleets at rest by system (never saved)
const fleetIndex = new WeakMap<GameState, { tick: number; n: number; map: Map<number, GameState['fleets'][string][]> }>();
export function fleetsAt(state: GameState): Map<number, GameState['fleets'][string][]> {
  const n = Object.keys(state.fleets).length;
  const hit = fleetIndex.get(state);
  if (hit && hit.tick === state.tick && hit.n === n) return hit.map;
  const map = new Map<number, GameState['fleets'][string][]>();
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.progress > 0 || !f.ships.length) continue;
    let l = map.get(f.systemId);
    if (!l) { l = []; map.set(f.systemId, l); }
    l.push(f);
  }
  fleetIndex.set(state, { tick: state.tick, n, map });
  return map;
}

// ------------------------------------------------------------------ routes

export function routeVolume(r: TradeRoute): number {
  let v = 0;
  for (const k in r.cargo) v += r.cargo[k as TradeGood] ?? 0;
  return v;
}

export function convoysOf(r: TradeRoute): number {
  return Math.max(1, Math.min(8, Math.round(routeVolume(r) / CARGO_PER_CONVOY)));
}

/** Where each convoy of a route is at time `t` (fractional ticks): fraction along the path, and whether it is laden. */
export function convoyPositions(r: TradeRoute, t: number): { u: number; laden: boolean; docked: boolean }[] {
  const n = convoysOf(r);
  const P = Math.max(2, r.days * 2);
  const out: { u: number; laden: boolean; docked: boolean }[] = [];
  const blocked = r.status === 'blockaded' || r.status === 'severed';
  // a route opened at `since`: convoys leave one after another, not all at once
  const age = t - r.since;
  for (let k = 0; k < n; k++) {
    const off = (k * P) / n;
    if (age < off) continue; // not yet departed
    if (blocked) { out.push({ u: 0, laden: true, docked: true }); continue; }
    const ph = (((age - off) % P) + P) % P / P;
    out.push(ph < 0.5 ? { u: ph * 2, laden: true, docked: false } : { u: (1 - ph) * 2, laden: false, docked: false });
  }
  return out;
}

function travelDays(state: GameState, path: number[]): number {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += laneLength(state.galaxy, path[i - 1], path[i]);
  return Math.max(2, Math.round(d / CONVOY_SPEED));
}

/** Total monthly cargo exchanged between two realms (both directions). */
export function tradeTies(state: GameState, a: number, b: number): number {
  let v = 0;
  for (const r of state.life?.routes ?? []) if ((r.a === a && r.b === b) || (r.a === b && r.b === a)) v += routeVolume(r) * ROUTE_EFF[r.status];
  return v;
}

/** Goods a realm runs short of that another realm exports (a reason to covet its worlds). */
export function resourceLure(state: GameState, e: Empire, o: Empire): number {
  const L = getLedger(state, e);
  if (!L.shortages.length) return 0;
  const Lo = getLedger(state, o);
  let lure = 0;
  for (const r of L.shortages) if ((Lo.net[r] ?? 0) > 3) lure++;
  return lure;
}

/** Cargo a world receives per month, by good, after route losses. */
function deliveries(state: GameState): Map<number, Partial<Record<TradeGood, number>>> {
  const out = new Map<number, Partial<Record<TradeGood, number>>>();
  for (const r of life(state).routes) {
    const eff = ROUTE_EFF[r.status];
    let m = out.get(r.to);
    if (!m) { m = {}; out.set(r.to, m); }
    for (const k in r.cargo) m[k as TradeGood] = (m[k as TradeGood] ?? 0) + (r.cargo[k as TradeGood] ?? 0) * eff;
  }
  return out;
}

/** Internal supply routes of one realm: each importing world draws on its nearest sources. */
function planInternal(state: GameState, e: Empire, keep: Map<string, Partial<Record<TradeGood, number>>>) {
  const L = getLedger(state, e);
  const network = supplyNetwork(state, e.id);
  const worlds: Planet[] = [];
  for (const pid in L.planets) if (state.planets[+pid].colony?.ownerId === e.id) worlds.push(state.planets[+pid]);
  if (!worlds.length) return;
  const supply = new Map<number, Partial<Record<TradeGood, number>>>();
  const need: { p: Planet; goods: Partial<Record<TradeGood, number>> }[] = [];
  for (const p of worlds) {
    const prod = L.planets[p.id].production;
    const s: Partial<Record<TradeGood, number>> = {};
    const n: Partial<Record<TradeGood, number>> = {};
    let any = false;
    for (const g of TRADE_GOODS) {
      const v = prod[g] ?? 0;
      if (v > TRADE_MIN) s[g] = v;
      // the capital draws on the realm's stores directly
      else if (v < -TRADE_MIN && !shortageOf(e, g) && p.id !== e.capitalPlanetId) { n[g] = -v; any = true; }
    }
    supply.set(p.id, s);
    if (any) need.push({ p, goods: n });
  }
  // the capital depot dispatches the realm's reserves
  const cap = e.capitalPlanetId != null && L.planets[e.capitalPlanetId] ? e.capitalPlanetId : null;
  if (cap != null) {
    const s = supply.get(cap)!;
    for (const g of TRADE_GOODS) if (e.stock[g] > DEPOT_MIN_STOCK) s[g] = (s[g] ?? 0) + Math.min(DEPOT_MAX, e.stock[g] / DEPOT_SHARE);
  }
  const sys = state.galaxy.systems;
  need.sort((x, y) => x.p.id - y.p.id);
  for (const { p, goods } of need) {
    const here = sys[p.systemId];
    // nearest few sources by distance, then the ones that cover most
    const near = worlds.filter((q) => q.id !== p.id && Object.keys(supply.get(q.id)!).some((g) => (goods[g as TradeGood] ?? 0) > 0))
      .map((q) => ({ q, d: Math.hypot(sys[q.systemId].x - here.x, sys[q.systemId].y - here.y) }))
      .sort((x, y) => x.d - y.d || x.q.id - y.q.id).slice(0, 6);
    if (cap != null && cap !== p.id && !near.some((x) => x.q.id === cap)) near.push({ q: state.planets[cap], d: Math.hypot(sys[state.planets[cap].systemId].x - here.x, sys[state.planets[cap].systemId].y - here.y) });
    const covers = (q: Planet) => { const s = supply.get(q.id)!; let v = 0; for (const g of TRADE_GOODS) v += Math.min(goods[g] ?? 0, s[g] ?? 0); return v; };
    let used = 0;
    while (used < SOURCES_PER_WORLD && near.length) {
      // the source that covers most of what is still needed, nearer ones preferred
      near.sort((x, y) => covers(y.q) / (1 + y.d / 400) - covers(x.q) / (1 + x.d / 400) || x.q.id - y.q.id);
      const { q } = near.shift()!;
      const s = supply.get(q.id)!;
      const cargo: Partial<Record<TradeGood, number>> = {};
      let total = 0;
      for (const g of TRADE_GOODS) {
        const want = goods[g] ?? 0, have = s[g] ?? 0;
        const take = Math.min(want, have);
        if (take > 0.05) { cargo[g] = Math.round(take * 10) / 10; s[g] = have - take; goods[g] = want - take; total += take; }
      }
      if (total < TRADE_MIN) continue;
      used++;
      const k = `${q.id}>${p.id}`;
      const prev = keep.get(k);
      if (prev) for (const g in prev) cargo[g as TradeGood] = (cargo[g as TradeGood] ?? 0) + (prev[g as TradeGood] ?? 0);
      keep.set(k, cargo);
      void network;
    }
  }
}

/** Trade between realms: a surplus on one side, a need on the other, peace and a way between. */
function planInterstellar(state: GameState, keep: Map<string, Partial<Record<TradeGood, number>>>, origins: Map<string, [number, number]>) {
  const realms = state.empires.filter(economic).filter((e) => e.capitalPlanetId != null);
  const exports = new Map<number, number>(), imports = new Map<number, number>();
  let total = 0;
  const sys = state.galaxy.systems;
  for (const b of realms) {
    if (total >= INTERSTELLAR_MAX) break;
    const Lb = getLedger(state, b);
    if (b.stock.credits < 150) continue;
    const wants: [TradeGood, number][] = [];
    for (const g of TRADE_GOODS) {
      const cap = Lb.cap[g] || 2000;
      // a deficit, or stores below a third full: buy abroad where goods are plentiful
      const n = Math.max(-(Lb.net[g] ?? 0), (cap * 0.33 - b.stock[g]) / 18);
      if (n > 0.8) wants.push([g, n]);
    }
    if (!wants.length) continue;
    const bs = sys[b.capitalSystemId!];
    const sellers = realms.filter((a) => a.id !== b.id && hasContact(state, a.id, b.id) && hasContact(state, b.id, a.id) && !isHostile(state, a.id, b.id) && !embargoed(state, a.id, b.id))
      .filter((a) => hasTreaty(state, a.id, b.id, 'trade') || (opinion(state, a.id, b.id) >= -10 && opinion(state, b.id, a.id) >= -10))
      .map((a) => ({ a, d: Math.hypot(sys[a.capitalSystemId!].x - bs.x, sys[a.capitalSystemId!].y - bs.y) - (hasTreaty(state, a.id, b.id, 'trade') ? 400 : 0) }))
      .sort((x, y) => x.d - y.d || x.a.id - y.a.id);
    for (const { a } of sellers) {
      if ((imports.get(b.id) ?? 0) >= INTERSTELLAR_PER_REALM || total >= INTERSTELLAR_MAX) break;
      if ((exports.get(a.id) ?? 0) >= INTERSTELLAR_PER_REALM) continue;
      const La = getLedger(state, a);
      const cargo: Partial<Record<TradeGood, number>> = {};
      let sum = 0, best: TradeGood | null = null, bestV = 0;
      for (const [g, n] of wants) {
        const cap = La.cap[g] || 2000;
        // a growing surplus, or a glut in the stores, and fuller stores than the buyer's: sell abroad
        const glut = a.stock[g] > cap * 0.5;
        if (((La.net[g] ?? 0) <= 1.5 || a.stock[g] < cap * 0.25) && !glut) continue;
        if (a.stock[g] / cap < (b.stock[g] / (Lb.cap[g] || 2000)) * 1.5 + 0.05) continue;
        const v = Math.min(n, Math.max(0, La.net[g]) * 0.6 + a.stock[g] / (glut ? 60 : 120), 40);
        if (v < 1) continue;
        cargo[g] = Math.round(v * 10) / 10; sum += v;
        if (v > bestV) { bestV = v; best = g; }
      }
      if (!best) continue;
      // load at the exporter's best producer of the main good, unload at the importer's capital
      let from = a.capitalPlanetId!, fv = -1;
      for (const pid in La.planets) { if (state.planets[+pid].colony?.ownerId !== a.id) continue; const v = La.planets[pid].production[best] ?? 0; if (v > fv) { fv = v; from = +pid; } }
      const k = `${from}>${b.capitalPlanetId}`;
      keep.set(k, cargo);
      origins.set(k, [a.id, b.id]);
      exports.set(a.id, (exports.get(a.id) ?? 0) + 1);
      imports.set(b.id, (imports.get(b.id) ?? 0) + 1);
      total++;
      for (const [g] of wants) if (cargo[g]) { const i = wants.findIndex((w) => w[0] === g); wants[i] = [g, wants[i][1] - cargo[g]!]; }
      void sum;
    }
  }
}

/** A path for a route that avoids systems held by enemies of either party and hostile fleets. */
function routePath(state: GameState, from: number, to: number, a: number, b: number, internal: boolean): number[] | null {
  const fs = state.planets[from].systemId, ts = state.planets[to].systemId;
  if (fs === ts) return [fs];
  const at = fleetsAt(state);
  const network = internal ? supplyNetwork(state, a) : null;
  const sys = state.galaxy.systems;
  const ok = (id: number) => {
    if (network && !network.has(id)) return false;
    const o = sys[id].owner;
    if (o != null && o !== a && o !== b && (isHostile(state, o, a) || isHostile(state, o, b))) return false;
    if (state.expansion?.omega.corrupted[id] != null) return false;
    for (const f of at.get(id) ?? []) if (f.ownerId !== a && f.ownerId !== b && armed(f) && (isHostile(state, a, f.ownerId) || isHostile(state, b, f.ownerId)) && state.empires[f.ownerId]?.kind !== 'guardian') return false;
    return true;
  };
  const p = findPath(state.galaxy, fs, ts, ok);
  if (!p) return null;
  const path = [fs, ...p];
  if (!internal && path.length > INTERSTELLAR_JUMPS + 1) return null;
  return path;
}

/** Monthly: re-plan every route from the worlds' actual surpluses and deficits; keep standing routes alive. */
function rebuildRoutes(state: GameState) {
  const L = life(state);
  const plan = new Map<string, Partial<Record<TradeGood, number>>>();
  const owners = new Map<string, [number, number]>();
  for (const e of state.empires) if (economic(e)) {
    const before = new Set(plan.keys());
    planInternal(state, e, plan);
    for (const k of plan.keys()) if (!before.has(k)) owners.set(k, [e.id, e.id]);
  }
  planInterstellar(state, plan, owners);
  const byKey = new Map<string, TradeRoute>();
  for (const r of L.routes) byKey.set(`${r.from}>${r.to}`, r);
  const keepRoutes: TradeRoute[] = [];
  for (const r of L.routes) {
    const k = `${r.from}>${r.to}`;
    const cf = state.planets[r.from].colony, ct = state.planets[r.to].colony;
    // an endpoint lost or changed hands: the route dies with it
    if (!cf || !ct || cf.ownerId !== r.a || ct.ownerId !== r.b) { retire(state, r, cf && ct ? 'the worlds changed hands' : 'a world was lost'); continue; }
    const fresh = plan.get(k);
    if (fresh && owners.get(k)?.[0] === r.a) {
      r.cargo = fresh; r.idle = 0;
      // re-route a cut route if a safe way exists now
      if (r.status === 'blockaded' || r.status === 'severed' || !r.path.length) {
        const p = routePath(state, r.from, r.to, r.a, r.b, r.a === r.b);
        if (p) { r.path = p; r.days = travelDays(state, p); }
      }
      plan.delete(k);
    } else if (++r.idle >= ROUTE_IDLE_MONTHS) { retire(state, r, 'there was no more trade to carry'); continue; }
    else r.cargo = {};
    keepRoutes.push(r);
  }
  L.routes = keepRoutes;
  for (const [k, cargo] of plan) {
    const [from, to] = k.split('>').map(Number);
    const [a, b] = owners.get(k) ?? [state.planets[from].colony!.ownerId, state.planets[to].colony!.ownerId];
    const path = routePath(state, from, to, a, b, a === b);
    if (!path) continue;
    const r: TradeRoute = { id: nextId(state), from, to, a, b, cargo, path, days: travelDays(state, path), since: state.tick, status: 'open', statusSince: state.tick, idle: 0, carried: 0 };
    L.routes.push(r);
    if (a !== b) founded(state, r);
  }
  void byKey;
}

function founded(state: GameState, r: TradeRoute) {
  const goods = Object.keys(r.cargo).join(', ');
  const B = state.empires[r.b];
  // feeding a hungry realm is remembered
  if ((r.cargo.food ?? 0) > 0 && (shortageOf(B, 'food') || getLedger(state, B).net.food < 0)) {
    addMemory(state, r.b, r.a, 'fed_us', 15, 0.1, 'Fed our people');
  }
  if ((r.a === state.playerId || r.b === state.playerId) && noticeOnce(state, `route:${r.a}:${r.b}`, 720)) {
    log(state, { kind: 'trade', severity: 'good', title: 'New merchant route', text: `Merchants now carry ${goods} from ${state.planets[r.from].name} (${name(state, r.a)}) to ${state.planets[r.to].name} (${name(state, r.b)}).`, empires: [state.playerId], planetId: r.to });
  }
}

function retire(state: GameState, r: TradeRoute, why: string) {
  const years = (state.tick - r.since) / 360;
  if (r.a !== r.b && years >= 3) {
    chronicle(state, {
      kind: 'trade', title: `The ${state.planets[r.from].name}–${state.planets[r.to].name} trade ends`,
      cause: `After ${Math.floor(years)} years the route between the ${name(state, r.a)} and the ${name(state, r.b)} closed: ${why}.`,
      effect: `${Math.round(r.carried)} units had passed along it.`, who: [r.a, r.b], systemId: state.planets[r.to].systemId, weight: 1,
    });
  }
}

/** Every 5 days: is each route safe? Corsairs raid, enemy fleets blockade, war severs. */
function checkRoutes(state: GameState) {
  const L = life(state);
  const at = fleetsAt(state);
  for (const r of L.routes) {
    let status: RouteStatus = 'open';
    let blocker: number | null = null;
    if (r.a !== r.b && warBetween(state, r.a, r.b)) status = 'severed';
    else {
      for (const sid of r.path) {
        if (state.expansion?.omega.corrupted[sid] != null) { status = 'severed'; break; }
        for (const f of at.get(sid) ?? []) {
          if (f.ownerId === r.a || f.ownerId === r.b || !armed(f)) continue;
          const k = state.empires[f.ownerId]?.kind;
          if (k === 'guardian') continue;
          if (!isHostile(state, r.a, f.ownerId) && !isHostile(state, r.b, f.ownerId)) continue;
          if (k === 'raiders') { if (status === 'open') { status = 'raided'; blocker = f.ownerId; } }
          else { status = 'blockaded'; blocker = f.ownerId; break; }
        }
        if (status === 'blockaded') break;
      }
    }
    if (status !== r.status) onStatus(state, r, status, blocker);
    r.blocker = blocker;
  }
}

function onStatus(state: GameState, r: TradeRoute, status: RouteStatus, blocker: number | null) {
  const was = r.status;
  r.status = status;
  r.statusSince = state.tick;
  const cut = status === 'blockaded' || status === 'severed';
  const player = state.playerId;
  if ((r.a === player || r.b === player) && cut && noticeOnce(state, `cut:${r.id}`, 120)) {
    log(state, {
      kind: 'trade', severity: 'warn', title: status === 'severed' ? 'Merchant route severed' : 'Merchant route blockaded',
      text: `Convoys from ${state.planets[r.from].name} to ${state.planets[r.to].name} cannot get through${blocker != null ? `: ${name(state, blocker)} warships hold the lane` : ''}. ${state.planets[r.to].name} will go short of ${Object.keys(r.cargo).join(', ') || 'its imports'}.`,
      empires: [player], planetId: r.to,
    });
  }
  // a third party strangling commerce between two realms (or a realm's own supply) is remembered
  if (cut && blocker != null && blocker !== r.a && blocker !== r.b && economic(state.empires[blocker]) && routeVolume(r) >= 4) {
    addMemory(state, r.b, blocker, 'strangled', -12, 0.3, 'Strangled our commerce');
    if (r.a !== r.b && state.tick - r.since > 360 * 2 && noticeOnce(state, `blk:${r.a}:${r.b}:${blocker}`, 720)) {
      chronicle(state, {
        kind: 'blockade', title: `${name(state, blocker)} blockades the ${state.planets[r.to].name} trade`,
        cause: `${name(state, blocker)} warships closed the lane between the ${name(state, r.a)} and the ${name(state, r.b)}.`,
        effect: `${state.planets[r.to].name} lost ${Math.round(routeVolume(r))} units of ${Object.keys(r.cargo).join(', ')} a month.`,
        who: [blocker, r.a, r.b], systemId: state.planets[r.to].systemId, weight: 2,
      });
    }
  }
  void was;
}

// ------------------------------------------------------------------ worlds, monthly

function worldsMonthly(state: GameState) {
  const got = deliveries(state);
  const L = life(state);
  const throughput = new Map<number, number>();
  for (const r of L.routes) {
    const v = routeVolume(r) * ROUTE_EFF[r.status];
    throughput.set(r.from, (throughput.get(r.from) ?? 0) + v);
    throughput.set(r.to, (throughput.get(r.to) ?? 0) + v);
    r.carried += v;
  }
  for (const e of state.empires) {
    if (!economic(e)) continue;
    const Lg = getLedger(state, e);
    for (const pid in Lg.planets) {
      const p = state.planets[+pid];
      const c = p.colony;
      if (!c || c.ownerId !== e.id) continue; // lost since the ledger was drawn up this morning
      const rep = Lg.planets[+pid];
      // supply: what this world imports and what actually arrives
      const recv = got.get(p.id) ?? {};
      let need = 0, have = 0;
      const want: TradeGood[] = [];
      for (const g of TRADE_GOODS) {
        const v = rep.production[g] ?? 0;
        if (v >= -TRADE_MIN || shortageOf(e, g) || p.id === e.capitalPlanetId) continue;
        need += -v;
        const r = Math.min(-v, recv[g] ?? 0);
        have += r;
        if (r < -v * 0.6) want.push(g);
      }
      const supply = need > 0 ? Math.min(1, have / need) : 1;
      const wasShort = (c.supply ?? 1) < 0.6;
      c.supply = Math.round(supply * 100) / 100;
      c.want = want;
      if (supply < 0.6 && !wasShort && e.isPlayer && noticeOnce(state, `short:${p.id}`, 180)) {
        log(state, { kind: 'shortage', severity: 'warn', title: `${p.name} goes short`, text: `Merchant routes deliver only ${Math.round(supply * 100)}% of what ${p.name} imports (${want.join(', ')}). Stability and output there suffer until the lanes are reopened.`, empires: [e.id], planetId: p.id });
      }
      const cut = want.includes('food') && supply < 0.4 && c.pops >= 6 ? L.routes.find((r) => r.to === p.id && (r.status === 'blockaded' || r.status === 'severed')) : undefined;
      if (want.includes('food') && supply < 0.4 && c.pops >= 6 && noticeOnce(state, `famine:${p.id}`, 1440) && noticeOnce(state, `famine:${e.id}`, 360)) {
        chronicle(state, {
          kind: 'famine', title: `Hunger on ${p.name}`,
          cause: cut ? `${cut.blocker != null ? `${name(state, cut.blocker)} warships` : 'War'} cut the grain convoys from ${state.planets[cut.from].name}.` : `No merchant could bring grain to ${p.name}.`,
          effect: `The ${name(state, e.id)} world of ${Math.round(c.pops)} million goes hungry; its people begin to leave.`,
          who: cut?.blocker != null ? [e.id, cut.blocker] : [e.id], planetId: p.id, systemId: p.systemId, weight: cut && c.pops >= 25 ? 2 : 1,
        });
      }
      // prosperity: work, order, supply, commerce and safety
      const pops = Math.max(1, c.pops);
      const employed = rep.employed / pops;
      const dev = c.devastation ?? 0;
      const tp = throughput.get(p.id) ?? 0;
      const target = Math.max(0, Math.min(100,
        12 + c.stability * 0.38 + employed * 16 + supply * 10 + Math.min(10, tp * 0.4) + (rep.housing > c.pops ? 4 : -6) - dev * 0.55 - (besieged(state, p) ? 10 : 0) + (rep.connected ? 0 : -8)));
      const prev = c.prosperity ?? target;
      c.prosperity = Math.round((prev + (target - prev) * 0.12) * 10) / 10;
      // settlement maturity: a new colony fills out over years; war scars set it back
      let built = 0, districts = 0;
      for (const b in c.buildings) { const n = c.buildings[b as keyof typeof c.buildings] ?? 0; if (BUILDINGS[b as keyof typeof BUILDINGS].category === 'district') districts += n; else built += n; }
      const dt = Math.min(100, (c.pops * 2 + built * 4 + districts * 1.2) * (1 - dev / 150));
      const d0 = c.dev ?? Math.min(dt, 8);
      c.dev = Math.round((d0 + (dt - d0) * (dt > d0 ? 0.035 : 0.08)) * 10) / 10;
      // war damage heals, faster on prosperous worlds
      if (dev > 0) {
        const healed = Math.max(0, dev - (0.8 + (c.prosperity ?? 50) / 60));
        if (dev >= 45 && healed < 45 && noticeOnce(state, `rebuilt:${p.id}`, 720)) {
          chronicle(state, { kind: 'rebuilt', title: `${p.name} rebuilt`, cause: `Years of reconstruction have cleared the ruins of ${p.name}.`, effect: `Its cities and industry work again for the ${name(state, e.id)}.`, who: [e.id], planetId: p.id, systemId: p.systemId, weight: 1 });
        }
        c.devastation = Math.round(healed * 10) / 10;
      }
      // mines run out: the rich veins of a heavily worked world are not endless
      const miners = rep.filled.mining ?? 0;
      if (miners > 0 && p.deposits.minerals > 0) {
        const before = p.deposits.minerals;
        p.deposits.minerals = Math.max(0, Math.round((before - miners * 0.0007) * 10000) / 10000);
        if (before >= 0.5 && p.deposits.minerals < 0.5) {
          chronicle(state, { kind: 'depletion', title: `The mines of ${p.name} are worked out`, cause: `Generations of mining exhausted the rich ore of ${p.name}.`, effect: 'Its mining districts now yield only what any rock would.', who: [e.id], planetId: p.id, systemId: p.systemId, weight: 1 });
        }
      }
      const rare = rep.filled.rare_extractor ?? 0;
      if (rare > 0 && p.deposits.rare > 1) p.deposits.rare = Math.max(1, Math.round((p.deposits.rare - rare * 0.0005) * 10000) / 10000);
    }
  }
}

/** Every 5 days: battles, sieges and corruption damage the worlds where they happen. */
function warDamage(state: GameState) {
  const at = fleetsAt(state);
  const battleAt = new Set<number>();
  for (const b of state.battles) if (b.ongoing) battleAt.add(b.systemId);
  const corrupted = state.expansion?.omega.corrupted ?? {};
  for (const p of state.planets) {
    const c = p.colony;
    if (!c) continue;
    let add = 0;
    let by: number | null = null;
    if (battleAt.has(p.systemId)) add += DEVASTATION.battle;
    for (const f of at.get(p.systemId) ?? []) {
      if (f.ownerId === c.ownerId || !armed(f) || !isHostile(state, c.ownerId, f.ownerId)) continue;
      if (state.empires[f.ownerId]?.kind === 'guardian') continue;
      add += DEVASTATION.siege; by = f.ownerId; break;
    }
    if (corrupted[p.systemId] != null) add += DEVASTATION.corruption;
    if (!add) continue;
    const before = c.devastation ?? 0;
    c.devastation = Math.min(100, before + add);
    if (before < 50 && c.devastation >= 50 && c.pops >= 4) ravaged(state, p, c, by);
  }
}

function ravaged(state: GameState, p: Planet, c: Colony, by: number | null) {
  if (by != null && economic(state.empires[by])) addMemory(state, c.ownerId, by, 'ravaged', -20, 0.15, 'Ravaged our worlds');
  if (!noticeOnce(state, `ravaged:${p.id}`, 720)) return;
  chronicle(state, {
    kind: 'devastation', title: `${p.name} lies in ruins`,
    cause: by != null ? `The ${name(state, by)} brought war to the orbit of ${p.name}.` : `Fighting and corruption wrecked ${p.name}.`,
    effect: `Half its cities and industry of the ${name(state, c.ownerId)} are wrecked; output and growth fall until it is rebuilt.`,
    who: by != null ? [c.ownerId, by] : [c.ownerId], planetId: p.id, systemId: p.systemId, weight: 2,
  });
}

/** A conquered world is sacked (called by fleets.conquerPlanet). */
export function sackWorld(c: Colony) {
  c.devastation = Math.min(100, (c.devastation ?? 0) + DEVASTATION.conquest);
}

// ------------------------------------------------------------------ migration

function inTransitTo(state: GameState): Map<number, number> {
  const m = new Map<number, number>();
  for (const x of life(state).migrations) m.set(x.to, (m.get(x.to) ?? 0) + x.pops);
  return m;
}

function attract(state: GameState, p: Planet, hab: number, crowd = 0): number {
  const c = p.colony!;
  // crowded, jobless worlds draw nobody (crowd: share of people without a home or a job)
  return -crowd * 40 + (c.prosperity ?? 50) * 0.6 + c.stability * 0.3 + hab * 25 - (c.devastation ?? 0) * 0.8 - ((c.supply ?? 1) < 0.8 ? 15 : 0) - (besieged(state, p) ? 40 : 0);
}

function migrationMonthly(state: GameState) {
  const L = life(state);
  const transit = inTransitTo(state);
  const sys = state.galaxy.systems;
  for (const e of state.empires) {
    if (!economic(e)) continue;
    const Lg = getLedger(state, e);
    const worlds: { p: Planet; push: number; room: number; a: number; hab: number }[] = [];
    let pressure = 0;
    for (const pid in Lg.planets) {
      const p = state.planets[+pid];
      const c = p.colony;
      if (!c || c.ownerId !== e.id) continue; // lost since the ledger was drawn up this morning
      const rep = Lg.planets[+pid];
      const over = Math.max(0, c.pops - rep.housing);
      const dev = c.devastation ?? 0;
      const war = besieged(state, p);
      const push = rep.unemployed + over + (dev > 40 ? c.pops * 0.05 : 0) + ((c.want ?? []).includes('food') ? c.pops * 0.03 : 0) + (war ? c.pops * 0.04 : 0);
      pressure += over + rep.unemployed * 0.5;
      // people go where there are homes and, unless they are settling a young colony, work
      const homes = rep.housing - c.pops - (transit.get(p.id) ?? 0);
      const work = rep.jobs - rep.employed - (transit.get(p.id) ?? 0);
      const room = (c.dev ?? 0) < 35 ? homes : Math.min(homes, work);
      worlds.push({ p, push, room, a: attract(state, p, rep.hab, (over + rep.unemployed) / Math.max(1, c.pops)), hab: rep.hab });
    }
    const arc = arcOf(state, e.id);
    arc.pressure = Math.round(pressure * 10) / 10;
    const sources = worlds.filter((w) => w.push >= 0.6 && w.p.colony!.pops > 3).sort((x, y) => y.push - x.push || x.p.id - y.p.id);
    let flows = 0;
    for (const s of sources) {
      if (flows >= MIGRATIONS_PER_REALM) break;
      const sc = s.p.colony!;
      const targets = worlds.filter((t) => t.p.id !== s.p.id && t.room >= 1 && t.a > s.a + 8 && t.hab > 0.2).sort((x, y) => y.a - x.a || x.p.id - y.p.id);
      let t = targets[0];
      let foreign = false;
      const fleeing = (sc.devastation ?? 0) > 40 || besieged(state, s.p) || (sc.want ?? []).includes('food');
      if (!t && fleeing) {
        // refugees cross the border to a peaceful neighbour
        const best = foreignRefuge(state, s.p, transit);
        if (best) { t = best; foreign = true; }
      }
      if (!t) continue;
      const amount = Math.round(Math.min(s.push, t.room, MIGRATION_MAX, sc.pops - 2) * 10) / 10;
      if (amount < 0.4) continue;
      const kind: Migration['kind'] = fleeing ? 'refugees' : (t.p.colony!.dev ?? 0) < 35 ? 'settlers' : 'labour';
      const d = Math.hypot(sys[t.p.systemId].x - sys[s.p.systemId].x, sys[t.p.systemId].y - sys[s.p.systemId].y);
      const days = Math.max(4, Math.min(90, Math.round(4 + d / CONVOY_SPEED)));
      sc.pops -= amount;
      L.migrations.push({ id: nextId(state), from: s.p.id, to: t.p.id, pops: amount, depart: state.tick, arrive: state.tick + days, kind, owner: t.p.colony!.ownerId });
      transit.set(t.p.id, (transit.get(t.p.id) ?? 0) + amount);
      t.room -= amount;
      flows++;
      if (foreign) {
        const host = t.p.colony!.ownerId;
        addMemory(state, e.id, host, 'sheltered', 8, 0.1, 'Sheltered our people');
        if (amount >= 1.5 && noticeOnce(state, `refuge:${e.id}:${host}`, 720)) {
          chronicle(state, {
            kind: 'refugees', title: `Refugees flee ${s.p.name}`,
            cause: (sc.devastation ?? 0) > 40 ? `War has wrecked ${s.p.name}.` : besieged(state, s.p) ? `Enemy warships besiege ${s.p.name}.` : `${s.p.name} has run out of food.`,
            effect: `Transports carry its people to ${t.p.name} in the realm of the ${name(state, host)}, who take them in.`,
            who: [e.id, host], planetId: t.p.id, systemId: t.p.systemId, weight: 1,
          });
        }
      }
    }
  }
}

function foreignRefuge(state: GameState, from: Planet, transit: Map<number, number>): { p: Planet; push: number; room: number; a: number; hab: number } | null {
  const owner = from.colony!.ownerId;
  const near = jumpsWithin(state.galaxy, from.systemId, 5);
  let best: { p: Planet; push: number; room: number; a: number; hab: number } | null = null;
  for (const [sid] of near) {
    const o = state.galaxy.systems[sid].owner;
    if (o == null || o === owner || !economic(state.empires[o]) || isHostile(state, owner, o)) continue;
    for (const pid of state.galaxy.systems[sid].planetIds) {
      const p = state.planets[pid];
      const c = p.colony;
      if (!c || c.ownerId !== o) continue;
      const rep = getLedger(state, state.empires[o]).planets[pid];
      if (!rep) continue;
      const room = rep.housing - c.pops - (transit.get(pid) ?? 0);
      if (room < 1) continue;
      const a = attract(state, p, rep.hab);
      if (!best || a > best.a || (a === best.a && pid < best.p.id)) best = { p, push: 0, room, a, hab: rep.hab };
    }
  }
  return best;
}

function arrivals(state: GameState) {
  const L = life(state);
  if (!L.migrations.length) return;
  const keep: Migration[] = [];
  for (const m of L.migrations) {
    if (m.arrive > state.tick) { keep.push(m); continue; }
    const c = state.planets[m.to].colony ?? state.planets[m.from].colony;
    if (c) c.pops += m.pops; // home again if the destination is gone; lost if both are
  }
  L.migrations = keep;
}

// ------------------------------------------------------------------ the galactic market

/** Prices answer the galaxy's real surpluses and deficits (the drift back to base is in engine.monthly). */
function marketMonthly(state: GameState) {
  const net: Record<string, number> = {}, gross: Record<string, number> = {};
  for (const e of state.empires) {
    if (!economic(e)) continue;
    const Lg = getLedger(state, e);
    for (const g of TRADE_GOODS) { net[g] = (net[g] ?? 0) + (Lg.net[g] ?? 0); gross[g] = (gross[g] ?? 0) + (Lg.income[g] ?? 0); }
  }
  for (const g of TRADE_GOODS) {
    const p = Math.max(-0.5, Math.min(0.5, -(net[g] ?? 0) / ((gross[g] ?? 0) + 20)));
    const [lo, hi] = marketBounds(g as ResId);
    // supply and demand move prices within half to twice their base; beyond that only trading does
    const base = MARKET_BASE[g as ResId];
    const next = state.market.price[g] * (1 + p * 0.06);
    if ((p > 0 && next > base * 2) || (p < 0 && next < base * 0.5)) continue;
    state.market.price[g] = Math.max(lo, Math.min(hi, next));
  }
}

// ------------------------------------------------------------------ the arcs of civilisations

function arcsMonthly(state: GameState) {
  for (const e of state.empires) {
    if (!economic(e)) continue;
    const arc = arcOf(state, e.id);
    const Lg = getLedger(state, e);
    let pr = 0, n = 0;
    for (const pid in Lg.planets) { const c = state.planets[+pid].colony; if (c?.ownerId !== e.id) continue; pr += c.prosperity ?? 50; n++; }
    arc.prosperity = n ? Math.round(pr / n) : 0;
    const capLost = e.capitalPlanetId == null || state.planets[e.capitalPlanetId]?.colony?.ownerId !== e.id;
    const crisis = (e.stats.avgStability || 50) < 28 || Lg.shortages.length >= 2 || capLost || arc.prosperity < 25;
    arc.crisis = crisis ? arc.crisis + 1 : Math.max(0, arc.crisis - 1);
  }
}

function arcsYearly(state: GameState) {
  const years = state.tick / 360;
  for (const e of state.empires) {
    if (!economic(e)) continue;
    const arc = arcOf(state, e.id);
    arc.econ.push(e.stats.economyScore);
    arc.pop.push(Math.round(e.stats.population));
    if (arc.econ.length > 30) arc.econ.shift();
    if (arc.pop.length > 30) arc.pop.shift();
    arc.peakEcon = Math.max(arc.peakEcon, e.stats.economyScore);
    const now = arc.econ[arc.econ.length - 1];
    const then = arc.econ[Math.max(0, arc.econ.length - 6)];
    const growth = (now - then) / Math.max(10, then);
    const prev = arc.phase;
    let phase = prev;
    if (state.tick - (arc.born ?? 0) < 360 * 3 && arc.econ.length < 3) phase = 'founding';
    else if (arc.crisis >= 6) phase = 'collapsing';
    else if (growth < -0.18) phase = 'declining';
    else if ((prev === 'declining' || prev === 'collapsing') && growth > 0.05) phase = 'recovering';
    else if (prev === 'golden' && state.tick - arc.since < 360 * 3 && arc.prosperity >= 68) phase = 'golden';
    else if (arc.prosperity >= 76 && growth >= 0.1 && (e.stats.avgStability || 0) >= 58 && state.tick - (arc.goldenTick ?? -1e9) > 360 * 15) { phase = 'golden'; arc.goldenTick = state.tick; }
    else if (growth > 0.3) phase = 'rising';
    else if (prev !== 'recovering' || growth > 0.2 || state.tick - arc.since > 360 * 4) phase = 'stable';
    if (phase !== prev) {
      arc.phase = phase;
      arc.since = state.tick;
      phaseChange(state, e, prev, phase, growth);
    }
    void years;
  }
}

function declineCause(state: GameState, e: Empire): string {
  const Lg = getLedger(state, e);
  const plan = e.aiPlan;
  const lost = plan ? plan.peakSystems - e.stats.systems : 0;
  let short = 0, wrecked = 0, cut = 0;
  for (const pid in Lg.planets) {
    const c = state.planets[+pid].colony;
    if (!c) continue;
    if ((c.supply ?? 1) < 0.6) short++;
    if ((c.devastation ?? 0) > 35) wrecked++;
  }
  for (const r of life(state).routes) if ((r.a === e.id || r.b === e.id) && (r.status === 'blockaded' || r.status === 'severed')) cut++;
  const war = state.wars.find((w) => w.attackers.includes(e.id) || w.defenders.includes(e.id));
  const causes: [number, string][] = [
    [lost * 3, `the loss of ${lost} systems${war ? ` in the ${war.name}` : ''}`],
    [wrecked * 4, `${wrecked} worlds wrecked by war`],
    [cut * 2.5, `${cut} merchant routes cut`],
    [short * 2.5, `${short} worlds going short of imports`],
    [Lg.shortages.length * 4, `empty stores of ${Lg.shortages.join(', ')}`],
    [e.warExhaustion / 10, 'exhaustion after long wars'],
    [Math.max(0, Lg.adminUsed - Lg.adminCap) * 1.5, 'a realm grown too large to govern'],
    [(60 - (e.stats.avgStability || 50)) / 6, 'unrest on its worlds'],
  ];
  causes.sort((x, y) => y[0] - x[0]);
  return causes[0][0] > 0 ? causes[0][1] : 'a slow loss of vigour';
}

function phaseChange(state: GameState, e: Empire, prev: RealmArc['phase'], phase: RealmArc['phase'], growth: number) {
  const pct = `${growth >= 0 ? '+' : ''}${Math.round(growth * 100)}%`;
  const major = e.kind === 'major';
  switch (phase) {
    case 'golden':
      e.timedMods.push({ key: 'stability', value: 5, until: state.tick + 360, label: 'Golden age' });
      chronicle(state, { kind: 'golden', title: `A golden age of the ${e.name}`, cause: `Prosperous worlds (${arcOf(state, e.id).prosperity}), full employment and busy trade lanes.`, effect: 'Art, science and commerce flourish (+5 stability for a year).', who: [e.id], systemId: e.capitalSystemId ?? undefined, weight: major ? 2 : 1 });
      break;
    case 'declining':
      chronicle(state, { kind: 'decline', title: `The ${e.name} in decline`, cause: `The ${e.adjective} economy shrank ${pct} in five years, driven by ${declineCause(state, e)}.`, effect: 'Its rivals take note.', who: [e.id], systemId: e.capitalSystemId ?? undefined, weight: major ? 2 : 1 });
      break;
    case 'collapsing':
      chronicle(state, { kind: 'collapse', title: `The ${e.name} in crisis`, cause: `Months of ${declineCause(state, e)} have broken the ${e.adjective} order.`, effect: 'Without recovery its outer worlds may break away.', who: [e.id], systemId: e.capitalSystemId ?? undefined, weight: major ? 3 : 2 });
      break;
    case 'recovering':
      chronicle(state, { kind: 'recovery', title: `The ${e.name} recovers`, cause: `After its ${prev === 'collapsing' ? 'crisis' : 'decline'}, the ${e.adjective} economy grew ${pct} again.`, effect: 'Trade and order return to its worlds.', who: [e.id], systemId: e.capitalSystemId ?? undefined, weight: 1 });
      break;
    case 'rising':
      if (state.tick > 360 * 6) chronicle(state, { kind: 'rise', title: `The rise of the ${e.name}`, cause: `The ${e.adjective} economy grew ${pct} in five years.`, effect: `It now holds ${e.stats.systems} systems and ${Math.round(e.stats.population)} million people.`, who: [e.id], systemId: e.capitalSystemId ?? undefined, weight: 1 });
      break;
    default: break;
  }
}

/** Yearly: realms in lasting crisis fracture; rebels endure into recognised states; prosperous minors become great powers. */
function transformations(state: GameState) {
  for (const e of state.empires.slice()) {
    if (!economic(e)) continue;
    const arc = arcOf(state, e.id);
    if (e.kind === 'major' && !e.isPlayer && arc.crisis >= SECESSION_CRISIS && state.tick - (arc.splitTick ?? -1e9) > 360 * SECESSION_GAP_YEARS) {
      if (secede(state, e)) { arc.splitTick = state.tick; continue; }
    }
    if (e.kind === 'rebels' && state.tick - (arc.born ?? state.tick) >= 360 * RECOGNITION_YEARS && !state.wars.some((w) => w.attackers.includes(e.id) || w.defenders.includes(e.id))) {
      e.kind = 'minor';
      ensureCapital(e); ensureHouses(state, e); ensureRuler(state, e);
      chronicle(state, { kind: 'recognition', title: `The ${e.name} endures`, cause: `${RECOGNITION_YEARS} years after it broke away, no one contests its freedom.`, effect: 'The galaxy treats it as a sovereign realm.', who: [e.id], systemId: e.capitalSystemId ?? undefined, weight: 1 });
      continue;
    }
    if (e.kind === 'minor' && e.role !== 'pretender') {
      const big = (e.stats.colonies >= 4 && e.stats.population >= 45 && arc.prosperity >= 55) || e.stats.systems >= 7;
      if (big) {
        e.kind = 'major';
        e.personality = { ...e.personality, expansion: Math.max(0.55, e.personality.expansion), aggression: Math.max(0.3, e.personality.aggression) };
        e.aiNextTick = Math.min(e.aiNextTick, state.tick + 1);
        chronicle(state, {
          kind: 'ascendant', title: `The ${e.name} becomes a great power`,
          cause: `${e.stats.colonies} prosperous worlds, ${Math.round(e.stats.population)} million people and ${e.stats.systems} systems.`,
          effect: 'It now pursues its own ambitions among the great realms of the galaxy.', who: [e.id], systemId: e.capitalSystemId ?? undefined, weight: 3,
        });
      }
    }
  }
}

/** A minor state is ascendant (it expands like a great realm) while prosperous and populous. */
export function ascendant(state: GameState, e: Empire): boolean {
  if (e.kind !== 'minor' || e.role === 'pretender') return false;
  const arc = state.life?.arcs[e.id];
  return !!arc && arc.prosperity >= 55 && e.stats.population >= 22;
}

/** The outer worlds of a realm in lasting crisis break away as a new state. Returns true if they did. */
export function secede(state: GameState, e: Empire): boolean {
  const mine = state.planets.filter((p) => p.colony?.ownerId === e.id && p.id !== e.capitalPlanetId);
  if (mine.length < 4) return false;
  const cap = e.capitalSystemId != null ? state.galaxy.systems[e.capitalSystemId] : null;
  const far = (p: Planet) => (cap ? Math.hypot(state.galaxy.systems[p.systemId].x - cap.x, state.galaxy.systems[p.systemId].y - cap.y) : 0);
  const seed = mine.slice().sort((a, b) => (a.colony!.stability - far(a) / 50) - (b.colony!.stability - far(b) / 50) || a.id - b.id)[0];
  const near = jumpsWithin(state.galaxy, seed.systemId, 3);
  const group = mine.filter((p) => near.has(p.systemId)).sort((a, b) => (near.get(a.systemId)! - near.get(b.systemId)!) || a.id - b.id).slice(0, Math.max(1, Math.floor((mine.length + 1) / 2)));
  if (!group.length) return false;
  const home = group.slice().sort((a, b) => b.colony!.pops - a.colony!.pops || a.id - b.id)[0];
  const id = state.empires.length;
  const sys = state.galaxy.systems[home.systemId];
  const rebels = blankEmpire(id, {
    name: `${sys.name} Secession`, adjective: sys.name, color: ['#b0a27a', '#8fa6a0', '#a08fb0', '#a6a08f', '#90a6b6'][id % 5], kind: 'rebels',
    climate: e.climate, government: pick(state.rng, ['republic', 'feudal', 'junta', 'corporate'] as GovernmentId[]),
    personality: { aggression: 0.3, expansion: 0.25, mercantile: 0.5, science: 0.4, diplomacy: 0.6, doctrine: 'balanced' },
    capitalPlanetId: home.id, capitalSystemId: home.systemId, ruler: `${pick(state.rng, RULER_FIRST)} ${pick(state.rng, RULER_LAST)}`,
    explored: [...new Set([...e.explored.filter((s) => near.has(s)), ...group.map((p) => p.systemId)])],
  });
  rebels.stock = { ...emptyStock(), credits: 300, minerals: 250, energy: 150, food: 150, alloys: 120, influence: 30 };
  ensureRuler(state, rebels);
  state.empires.push(rebels);
  let pops = 0;
  for (const p of group) {
    const c = p.colony!;
    c.ownerId = id; c.originalOwnerId = null; c.resistance = 0; c.stability = Math.max(c.stability, 45); c.queue = []; c.shipQueue = []; c.lowStabilityMonths = 0;
    pops += c.pops;
  }
  home.colony!.buildings.capital = 1;
  if (!home.colony!.buildings.garrison) home.colony!.buildings.garrison = 1;
  for (const sid of new Set(group.map((p) => p.systemId))) {
    const s = state.galaxy.systems[sid];
    if (!s.planetIds.some((pid) => state.planets[pid].colony?.ownerId === e.id)) { setSystemOwner(state, sid, id); if (s.starbase === 0) s.starbase = 1; }
  }
  createFleet(state, id, home.systemId, group.length >= 3 ? ['frigate', 'corvette', 'corvette', 'corvette'] : ['corvette', 'corvette', 'corvette'], `${sys.name} Free Fleet`).stance = 'defensive';
  state.wars.push({ id: nextId(state), attackers: [id], defenders: [e.id], startTick: state.tick, score: 10, name: `${sys.name} War of Secession` });
  addMemory(state, id, e.id, 'oppressor', -50, 0.3, 'Former oppressor');
  addMemory(state, e.id, id, 'traitors', -30, 0.2, 'Secessionists');
  const arc = arcOf(state, id);
  arc.born = state.tick;
  chronicle(state, {
    kind: 'secession', title: `${sys.name} breaks from the ${e.name}`,
    cause: `Years of ${declineCause(state, e)} left the ${e.adjective} crown unable to hold its outer worlds.`,
    effect: `${group.length} worlds and ${Math.round(pops)} million people form the ${rebels.name}; war follows.`,
    who: [id, e.id], systemId: home.systemId, planetId: home.id, weight: 3,
  });
  return true;
}

/** Yearly: has galactic commerce boomed or collapsed? */
function commerceYearly(state: GameState) {
  const v = life(state).volume;
  if (v.length < 36) return;
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const now = avg(v.slice(-12)), then = avg(v.slice(-36, -24));
  if (then < 20) return;
  const ch = (now - then) / then;
  const wars = state.wars.length;
  if (ch < -0.35 && noticeOnce(state, 'bust', 360 * 5)) {
    chronicle(state, { kind: 'bust', title: 'Galactic commerce collapses', cause: wars ? `${wars} wars have closed the lanes.` : 'Shrinking surpluses left little to trade.', effect: `Interstellar trade fell ${Math.round(-ch * 100)}% in two years; prices of scarce goods soar.`, who: [], weight: 2 });
  } else if (ch > 0.6 && noticeOnce(state, 'boom', 360 * 5)) {
    chronicle(state, { kind: 'boom', title: 'A boom in galactic trade', cause: 'Peace and growing surpluses fill the merchant lanes.', effect: `Trade grew ${Math.round(ch * 100)}% in two years.`, who: [], weight: 2 });
  }
}

// ------------------------------------------------------------------ ruins

const ownersSeen = new WeakMap<GameState, Map<number, number>>();
function ruinsMonthly(state: GameState) {
  const L = life(state);
  const prev = ownersSeen.get(state);
  const now = new Map<number, number>();
  for (const p of state.planets) if (p.colony) now.set(p.id, p.colony.ownerId);
  if (prev) {
    for (const [pid, owner] of prev) {
      if (now.has(pid)) continue;
      const p = state.planets[pid];
      const omega = state.expansion?.omega.corrupted[p.systemId] != null;
      L.ruins[p.systemId] = { tick: state.tick, owner, cause: omega ? 'consumed by the Omega corruption' : 'abandoned' };
      chronicle(state, { kind: 'devastation', title: `${p.name} is lost`, cause: omega ? 'The Omega corruption consumed it.' : `The last people of ${p.name} are gone.`, effect: 'Only ruins remain.', who: [owner], systemId: p.systemId, planetId: pid, weight: 2 });
    }
  }
  ownersSeen.set(state, now);
  // a ruin resettled is no longer a ruin
  for (const k in L.ruins) if (state.galaxy.systems[+k].planetIds.some((pid) => state.planets[pid].colony)) delete L.ruins[k];
}

// ------------------------------------------------------------------ entry points

export function lifeDaily(state: GameState) {
  arrivals(state);
  if (state.tick % 5 === 2) { checkRoutes(state); warDamage(state); }
}

export function lifeMonthly(state: GameState) {
  rebuildRoutes(state);
  checkRoutes(state);
  worldsMonthly(state);
  migrationMonthly(state);
  marketMonthly(state);
  arcsMonthly(state);
  ruinsMonthly(state);
  const L = life(state);
  let vol = 0;
  for (const r of L.routes) if (r.a !== r.b) vol += routeVolume(r) * ROUTE_EFF[r.status];
  L.volume.push(Math.round(vol));
  if (L.volume.length > 120) L.volume.shift();
  for (const k in L.noticed) if (state.tick - L.noticed[k] > 360 * 6) delete L.noticed[k];
  if (state.tick % 360 === 0) { arcsYearly(state); transformations(state); commerceYearly(state); }
}

// ------------------------------------------------------------------ ledger lines (economy.ts)

/** Interstellar trade and internal shipping, as ledger lines for one realm. */
export function tradeLedgerLines(state: GameState, e: Empire, add: (key: ResId, label: string, amount: number) => void, treatyPartner: (o: number) => boolean) {
  const routes = state.life?.routes;
  if (!routes?.length) return;
  let shipping = 0;
  for (const r of routes) {
    if (r.a !== e.id && r.b !== e.id) continue;
    const eff = ROUTE_EFF[r.status];
    if (!eff) continue;
    if (r.a === r.b) {
      for (const g in r.cargo) shipping += (r.cargo[g as TradeGood] ?? 0) * eff * (state.market.price[g as ResId] ?? 1);
      continue;
    }
    const other = r.a === e.id ? r.b : r.a;
    const oname = state.empires[other]?.name ?? 'abroad';
    const tariff = treatyPartner(other) ? 1 + 0.1 : 1;
    let value = 0;
    for (const g in r.cargo) {
      const u = (r.cargo[g as TradeGood] ?? 0) * eff;
      value += u * (state.market.price[g as ResId] ?? 1);
      add(g as ResId, r.a === e.id ? `Exports to ${oname}` : `Imports from ${oname}`, r.a === e.id ? -u : u);
    }
    if (r.a === e.id) add('credits', `Exports to ${oname}`, value * tariff);
    else add('credits', `Imports from ${oname}`, -value + value * (tariff - 1));
  }
  if (shipping > 0) add('credits', 'Merchant shipping', shipping * 0.04);
}

export { PHASE_LABEL, formatDate };
