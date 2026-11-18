// Fleet simulation: effective ship stats, movement along hyperlanes,
// supply & repair, patrols and order execution (outposts, colonisation,
// invasions). Combat itself lives in combat.ts.

import { SHIPS, SIZE_WEIGHT } from './data/ships';
import { empireMods, mod } from './modifiers';
import { findPath, laneLength } from './galaxy';
import { armed, claimCost, hostileArmedPresence, isHostile, setSystemOwner, supplyNetwork } from './territory';
import { log, nextId, pay } from './util';
import { range } from './rng';
import { planetHab, computeLedger } from './economy';
import type { Admiral, Empire, Fleet, GameState, Ship, ShipClass } from './types';

export interface ShipStats {
  hull: number; armor: number; shields: number; damage: number; strike: number;
  tracking: number; evasion: number; speed: number; pd: number; pierce: number;
}

export function shipStats(state: GameState, e: Empire, cls: ShipClass, admiral?: Admiral | null): ShipStats {
  const d = SHIPS[cls];
  const m = empireMods(state, e);
  let dmgMult = 1 + mod(m, 'shipDamage');
  let tracking = d.tracking + mod(m, 'tracking');
  let evasion = d.evasion + mod(m, 'evasion');
  let speed = d.speed * (1 + mod(m, 'shipSpeed'));
  if (admiral) {
    dmgMult += admiral.skill * 0.03;
    tracking += admiral.skill * 0.008;
    if (admiral.trait === 'gunner') dmgMult += 0.1;
    if (admiral.trait === 'aggressive') dmgMult += 0.12;
    if (admiral.trait === 'tactician') evasion += 0.05;
    if (admiral.trait === 'logistician') speed *= 1.1;
  }
  return {
    hull: d.hull * (1 + mod(m, 'shipHull')),
    armor: d.armor * (1 + mod(m, 'shipArmor')),
    shields: d.shields * (1 + mod(m, 'shipShields')),
    damage: d.damage * dmgMult,
    strike: (d.strike ?? 0) * (dmgMult + mod(m, 'strikeDamage')),
    tracking: Math.min(0.95, tracking),
    evasion: Math.min(0.85, Math.max(0, evasion)),
    speed,
    pd: d.pointDefense ?? 0,
    pierce: d.pierce ?? 0,
  };
}

export function admiralOf(state: GameState, f: Fleet): Admiral | null {
  if (f.admiralId == null) return null;
  return state.admirals.find((a) => a.id === f.admiralId && a.alive) ?? null;
}

export function fleetSpeed(state: GameState, f: Fleet): number {
  const e = state.empires[f.ownerId];
  const adm = admiralOf(state, f);
  let s = Infinity;
  for (const sh of f.ships) s = Math.min(s, shipStats(state, e, sh.cls, adm).speed);
  return s === Infinity ? 0 : s;
}

/** Estimated combat power: sqrt(damage output x effective HP). */
export function fleetPower(state: GameState, f: Fleet): number {
  const e = state.empires[f.ownerId];
  if (!e) return 0;
  const adm = admiralOf(state, f);
  let dmg = 0;
  let hp = 0;
  for (const sh of f.ships) {
    const st = shipStats(state, e, sh.cls, adm);
    dmg += st.damage + st.strike * 0.8;
    hp += sh.hull + (sh.armor ?? st.armor) + st.shields;
  }
  return Math.round(Math.sqrt(Math.max(0, dmg) * Math.max(0, hp)) / 4);
}

export function makeShip(state: GameState, e: Empire, cls: ShipClass): Ship {
  const st = shipStats(state, e, cls);
  return { id: nextId(state), cls, hull: st.hull, armor: st.armor, shields: st.shields, xp: 0 };
}

export function createFleet(state: GameState, ownerId: number, systemId: number, classes: ShipClass[], name?: string): Fleet {
  const e = state.empires[ownerId];
  const id = nextId(state);
  const civ = classes.length > 0 && classes.every((c) => SHIPS[c].civilian);
  const f: Fleet = {
    id,
    ownerId,
    name: name ?? (civ ? `${SHIPS[classes[0]].label} ${id}` : `${ordinal(countFleets(state, ownerId) + 1)} Fleet`),
    systemId,
    path: [],
    progress: 0,
    ships: classes.map((c) => makeShip(state, e, c)),
    admiralId: null,
    stance: civ ? 'passive' : 'aggressive',
    order: { type: 'idle' },
    supply: 100,
    troops: 0,
    retreatCooldown: 0,
  };
  f.troops = f.ships.reduce((a, s) => a + (SHIPS[s.cls].troops ?? 0), 0);
  state.fleets[id] = f;
  return f;
}

function countFleets(state: GameState, ownerId: number): number {
  let n = 0;
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.ownerId === ownerId && !f.ships.every((s) => SHIPS[s.cls].civilian)) n++;
  }
  return n;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function removeFleet(state: GameState, f: Fleet) {
  if (f.admiralId != null) {
    const a = state.admirals.find((x) => x.id === f.admiralId);
    if (a) a.fleetId = null;
  }
  delete state.fleets[f.id];
}

export function isCivilianFleet(f: Fleet): boolean {
  return f.ships.length > 0 && f.ships.every((s) => SHIPS[s.cls].civilian);
}

/** Route a fleet; hypergates owned by the fleet's owner allow instant jumps. */
export function routeFleet(state: GameState, f: Fleet, target: number): boolean {
  if (target === f.systemId) { f.path = []; f.progress = 0; return true; }
  const gate = (sid: number) => state.galaxy.systems[sid].megastructures.some((m) => m.id === 'hypergate' && m.stage >= 1 && m.ownerId === f.ownerId);
  if (gate(f.systemId) && gate(target) && f.progress === 0) {
    f.path = [target];
    f.progress = Infinity; // arrive next tick
    return true;
  }
  const path = findPath(state.galaxy, f.progress > 0 && f.path.length ? f.path[0] : f.systemId, target);
  if (!path) return false;
  if (f.progress > 0 && f.path.length) f.path = [f.path[0], ...path];
  else f.path = path;
  return true;
}

/** Daily movement. Fleets pinned by combat (engaged set) do not move. */
export function moveFleets(state: GameState, engaged: Set<number>) {
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.retreatCooldown > 0) f.retreatCooldown--;
    if (!f.path.length) continue;
    if (engaged.has(f.id) && f.retreatCooldown <= 0) continue;
    let budget = fleetSpeed(state, f);
    while (budget > 0 && f.path.length) {
      const nxt = f.path[0];
      const len = f.progress === Infinity ? 0 : laneLength(state.galaxy, f.systemId, nxt);
      const need = len - (f.progress === Infinity ? len : f.progress);
      if (budget >= need) {
        budget -= Math.max(0, need);
        f.systemId = nxt;
        f.path.shift();
        f.progress = 0;
        arrive(state, f);
        // Entering a system with hostile armed presence stops movement (interdiction).
        if (!isCivilianFleet(f) && f.stance !== 'passive' && hostileArmedPresence(state, f.ownerId, f.systemId)) break;
        if (isCivilianFleet(f) && hostileArmedPresence(state, f.ownerId, f.systemId)) break;
      } else {
        f.progress += budget;
        budget = 0;
      }
    }
  }
}

function arrive(state: GameState, f: Fleet) {
  const e = state.empires[f.ownerId];
  if (!e.explored.includes(f.systemId)) {
    e.explored.push(f.systemId);
    discover(state, e, f);
  }
}

/** First visit effects: derelicts, ancient ruins. */
function discover(state: GameState, e: Empire, f: Fleet) {
  const sys = state.galaxy.systems[f.systemId];
  if (e.kind !== 'major') return;
  if (sys.features.includes('derelict')) {
    const gain = 60 + Math.round(range(state.rng, 0, 80));
    e.stock.alloys += gain;
    sys.features = sys.features.filter((x) => x !== 'derelict');
    log(state, { kind: 'discovery', severity: 'good', title: 'Derelict salvaged', text: `${f.name} stripped a derelict hulk in ${sys.name} for ${gain} alloys.`, empires: [e.id], systemId: sys.id });
  }
  if (sys.features.includes('ancient_ruins') && !sys.ruinsSurveyed && !sys.features.includes('guardian')) {
    sys.ruinsSurveyed = true;
    const rp = 150 + Math.round(range(state.rng, 0, 200));
    e.research.progress += rp;
    log(state, { kind: 'discovery', severity: 'good', title: 'Ancient ruins surveyed', text: `Survey teams decoded precursor archives in ${sys.name}: +${rp} research toward current project.`, empires: [e.id], systemId: sys.id });
  }
}

/** Supply, repair, attrition, patrol marking. */
export function supplyAndRepair(state: GameState, engaged: Set<number>) {
  const nets = new Map<number, Set<number>>();
  for (const id in state.fleets) {
    const f = state.fleets[id];
    const e = state.empires[f.ownerId];
    if (e.kind !== 'major' && e.kind !== 'minor' && e.kind !== 'rebels') continue;
    let net = nets.get(f.ownerId);
    if (!net) { net = supplyNetwork(state, f.ownerId); nets.set(f.ownerId, net); }
    const m = empireMods(state, e);
    const inSupply = net.has(f.systemId) && f.progress === 0;
    const adm = admiralOf(state, f);
    const hasTender = f.ships.some((s) => SHIPS[s.cls].supplyAura);
    if (armed(f) && f.progress === 0) state.patrolled[`${f.ownerId}:${f.systemId}`] = state.tick;
    if (inSupply) {
      f.supply = Math.min(100, f.supply + 6);
    } else {
      let drain = 1.4 * (1 + mod(m, 'supplyDrain'));
      if (hasTender) drain *= 0.35;
      if (adm?.trait === 'logistician') drain *= 0.6;
      f.supply = Math.max(0, f.supply - drain);
    }
    if (engaged.has(f.id)) continue;
    const repairRate = (inSupply ? 0.04 : hasTender ? 0.015 : 0) * (1 + mod(m, 'repair'));
    for (const s of f.ships) {
      const st = shipStats(state, e, s.cls, adm);
      if (repairRate > 0) {
        s.hull = Math.min(st.hull, s.hull + st.hull * repairRate);
        s.armor = Math.min(st.armor, (s.armor ?? st.armor) + st.armor * repairRate);
      }
      s.shields = Math.min(st.shields, s.shields + st.shields * 0.25);
      if (f.supply <= 0) s.hull = Math.max(st.hull * 0.1, s.hull - st.hull * 0.006);
    }
  }
}

/** Execute fleet orders once fleets reach their destinations. */
export function processOrders(state: GameState) {
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (!state.fleets[id]) continue;
    const o = f.order;
    if (o.type === 'move') {
      if (!f.path.length && f.systemId === o.target) f.order = { type: 'idle' };
      else if (!f.path.length) routeFleet(state, f, o.target);
    } else if (o.type === 'patrol') {
      if (!f.path.length) {
        const tgt = o.leg === 0 ? o.b : o.a;
        if (f.systemId === tgt) o.leg = o.leg === 0 ? 1 : 0;
        routeFleet(state, f, o.leg === 0 ? o.b : o.a);
      }
    } else if (o.type === 'outpost') {
      if (f.path.length) continue;
      if (f.systemId !== o.systemId) { routeFleet(state, f, o.systemId); continue; }
      startOutpost(state, f, o.systemId);
    } else if (o.type === 'colonize') {
      const p = state.planets[o.planetId];
      if (f.path.length) continue;
      if (f.systemId !== p.systemId) { routeFleet(state, f, p.systemId); continue; }
      startColony(state, f, o.planetId);
    } else if (o.type === 'invade') {
      const p = state.planets[o.planetId];
      if (f.path.length) continue;
      if (f.systemId !== p.systemId) { routeFleet(state, f, p.systemId); continue; }
      tryInvade(state, f, o.planetId);
    } else if (o.type === 'blockade') {
      if (!f.path.length && f.systemId !== o.systemId) routeFleet(state, f, o.systemId);
    }
  }
}

function startOutpost(state: GameState, f: Fleet, systemId: number) {
  const e = state.empires[f.ownerId];
  const sys = state.galaxy.systems[systemId];
  const ctor = f.ships.find((s) => s.cls === 'constructor');
  if (!ctor) { f.order = { type: 'idle' }; return; }
  if (sys.outpostProject && sys.outpostProject.empireId === e.id) return; // in progress
  if (sys.owner != null || sys.outpostProject) {
    f.order = { type: 'idle' };
    if (e.isPlayer) log(state, { kind: 'outpost', severity: 'warn', title: 'Outpost aborted', text: `${sys.name} has already been claimed.`, empires: [e.id], systemId });
    return;
  }
  if (hostileArmedPresence(state, e.id, systemId)) return; // wait for the system to be clear
  const cost = claimCost(state, e, systemId);
  if (!pay(e, { influence: cost, alloys: 40 })) {
    if (state.tick % 30 === 0 && e.isPlayer) log(state, { kind: 'outpost', severity: 'warn', title: 'Outpost stalled', text: `Need ${cost} influence and 40 alloys to raise an outpost in ${sys.name}.`, empires: [e.id], systemId });
    return;
  }
  sys.outpostProject = { empireId: e.id, progress: 0, total: 60 };
  // The constructor is consumed into the starbase.
  f.ships = f.ships.filter((s) => s !== ctor);
  f.order = { type: 'idle' };
  if (!f.ships.length) removeFleet(state, f);
}

function startColony(state: GameState, f: Fleet, planetId: number) {
  const e = state.empires[f.ownerId];
  const p = state.planets[planetId];
  const sys = state.galaxy.systems[p.systemId];
  const ship = f.ships.find((s) => s.cls === 'colony');
  const m = empireMods(state, e);
  if (!ship) { f.order = { type: 'idle' }; return; }
  const fail = (why: string) => {
    f.order = { type: 'idle' };
    if (e.isPlayer) log(state, { kind: 'colony', severity: 'warn', title: 'Colonisation aborted', text: `${p.name}: ${why}`, empires: [e.id], planetId });
  };
  if (p.colony || p.colonizing) return fail('the world is already settled.');
  if (sys.owner != null && sys.owner !== e.id) return fail('the system belongs to another power.');
  if (planetHab(state, p, e, m) <= 0) return fail('the world is uninhabitable for our species.');
  if (hostileArmedPresence(state, e.id, p.systemId)) return;
  if (sys.owner == null) {
    // Founding a colony also raises a basic outpost.
    const cost = claimCost(state, e, sys.id);
    if (!pay(e, { influence: cost })) {
      if (state.tick % 30 === 0 && e.isPlayer) log(state, { kind: 'colony', severity: 'warn', title: 'Colonisation stalled', text: `Need ${cost} influence to claim ${sys.name} for the colony.`, empires: [e.id], planetId });
      return;
    }
    setSystemOwner(state, sys.id, e.id);
    sys.starbase = 1;
    sys.starbaseDamage = 0;
  }
  p.colonizing = { empireId: e.id, progress: 0, total: Math.round(150 / (1 + mod(m, 'colonizeSpeed'))) };
  f.ships = f.ships.filter((s) => s !== ship);
  f.order = { type: 'idle' };
  if (!f.ships.length) removeFleet(state, f);
}

export function orbitSecured(state: GameState, empireId: number, planetId: number): boolean {
  const p = state.planets[planetId];
  if (hostileArmedPresence(state, empireId, p.systemId)) return false;
  const c = p.colony;
  if (!c) return false;
  const platforms = c.buildings.orbital_defense ?? 0;
  if (platforms > 0 && c.defenseDamage < 0.99) return false;
  const sys = state.galaxy.systems[p.systemId];
  if (sys.owner === c.ownerId && sys.starbase > 0 && sys.starbaseDamage < 0.99) return false;
  return true;
}

function tryInvade(state: GameState, f: Fleet, planetId: number) {
  const p = state.planets[planetId];
  const c = p.colony;
  const e = state.empires[f.ownerId];
  if (!c || !isHostile(state, f.ownerId, c.ownerId) || state.empires[c.ownerId].kind === 'guardian') { f.order = { type: 'idle' }; return; }
  if (f.troops <= 0) { f.order = { type: 'idle' }; return; }
  if (!orbitSecured(state, f.ownerId, planetId)) return; // keep waiting/bombarding
  const defender = state.empires[c.ownerId];
  const rep = computeLedger(state, defender).planets[planetId];
  const garrison = rep?.garrison ?? 4;
  const shield = (c.buildings.planetary_shield ?? 0) > 0 ? 0.6 : 1;
  const att = f.troops * range(state.rng, 0.85, 1.15) * shield * (f.supply > 0 ? 1 : 0.7);
  const def = garrison * range(state.rng, 0.85, 1.15);
  // Transports land; they are consumed either way.
  f.ships = f.ships.filter((s) => s.cls !== 'transport');
  const landed = f.troops;
  f.troops = 0;
  f.order = { type: 'idle' };
  if (att > def) {
    conquerPlanet(state, planetId, f.ownerId);
    log(state, { kind: 'invasion', severity: e.isPlayer ? 'good' : 'danger', title: `${p.name} captured`, text: `${e.name} landed ${Math.round(landed)} divisions and overwhelmed a garrison of ${Math.round(garrison)}.`, empires: [f.ownerId, defender.id], planetId, systemId: p.systemId });
  } else {
    log(state, { kind: 'invasion', severity: e.isPlayer ? 'danger' : 'good', title: `Invasion of ${p.name} repulsed`, text: `${defender.name}'s garrison (${Math.round(garrison)}) threw back ${Math.round(landed)} ${e.adjective} divisions.`, empires: [f.ownerId, defender.id], planetId, systemId: p.systemId });
    adjustWarScoreForEvent(state, defender.id, f.ownerId, 4);
  }
  if (!f.ships.length) removeFleet(state, f);
}

export function conquerPlanet(state: GameState, planetId: number, newOwner: number) {
  const p = state.planets[planetId];
  const c = p.colony!;
  const oldOwner = c.ownerId;
  const old = state.empires[oldOwner];
  const wasCapital = old.capitalPlanetId === planetId;
  c.ownerId = newOwner;
  if (c.originalOwnerId === newOwner) { c.originalOwnerId = null; c.resistance = 10; }
  else { c.originalOwnerId = c.originalOwnerId ?? oldOwner; c.resistance = 75; }
  c.stability = Math.min(c.stability, 30);
  c.queue = [];
  c.shipQueue = [];
  c.defenseDamage = 1;
  c.lowStabilityMonths = 0;
  if (c.buildings.capital) delete c.buildings.capital;
  c.pops = Math.max(1, c.pops * 0.9);
  adjustWarScoreForEvent(state, newOwner, oldOwner, wasCapital ? 30 : 15);
  // System ownership follows when the defender keeps no colony there.
  const sys = state.galaxy.systems[p.systemId];
  const defenderHolds = sys.planetIds.some((pid) => state.planets[pid].colony?.ownerId === oldOwner);
  if (!defenderHolds) {
    setSystemOwner(state, sys.id, newOwner);
    if (sys.starbase === 0) sys.starbase = 1;
  }
  if (wasCapital) relocateCapital(state, oldOwner);
}

export function relocateCapital(state: GameState, empireId: number) {
  const e = state.empires[empireId];
  let best: number | null = null;
  let bestPops = -1;
  for (const p of state.planets) {
    if (p.colony?.ownerId === empireId && p.colony.pops > bestPops) { best = p.id; bestPops = p.colony.pops; }
  }
  e.capitalPlanetId = best;
  e.capitalSystemId = best != null ? state.planets[best].systemId : null;
  if (best != null) {
    state.planets[best].colony!.buildings.capital = 1;
    log(state, { kind: 'capital', severity: 'warn', title: 'Capital relocated', text: `The ${e.adjective} court has fled to ${state.planets[best].name}.`, empires: [empireId], planetId: best });
  }
}

export function adjustWarScoreForEvent(state: GameState, winner: number, loser: number, amount: number) {
  for (const w of state.wars) {
    if (w.attackers.includes(winner) && w.defenders.includes(loser)) w.score = Math.min(100, w.score + amount);
    else if (w.defenders.includes(winner) && w.attackers.includes(loser)) w.score = Math.max(-100, w.score - amount);
  }
}

export function fleetCommand(f: Fleet): number {
  return f.ships.reduce((a, s) => a + SHIPS[s.cls].command, 0);
}

export function fleetSizeClass(f: Fleet): number {
  return f.ships.reduce((a, s) => a + SIZE_WEIGHT[SHIPS[s.cls].size], 0);
}
