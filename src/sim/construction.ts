// Construction: planetary building queues, shipyards, outposts, starbase
// upgrades, colonisation and megastructure projects. All projects have real
// costs (paid when work starts) and real build times.

import { BUILDINGS } from './data/buildings';
import { TECH_BY_ID } from './data/techs';
import { industrialistBonus } from './characters';
import { SHIPS } from './data/ships';
import { STARBASE } from './data/ships';
import { MEGA_BY_ID } from './data/megastructures';
import { empireMods, hasTech, mod } from './modifiers';
import { buildingSlots, buildingsUsed, districtCaps } from './economy';
import { createFleet, isCivilianFleet, makeShip } from './fleets';
import { setSystemOwner, hostileArmedPresence } from './territory';
import { canAfford, log, pay, scaleCost } from './util';
import { sendLetter } from './envoys';
import type { BuildingId, Colony, Cost, Empire, GameState, Planet, ShipClass } from './types';
import { injunctionBlocks, megaProject, navalAccordsBlock } from './expansion';

export function buildingCost(state: GameState, e: Empire, id: BuildingId): Cost {
  return scaleCost(BUILDINGS[id].cost, Math.max(0.3, 1 + mod(empireMods(state, e), 'buildCost')));
}

export function buildingDays(state: GameState, e: Empire, id: BuildingId): number {
  return Math.max(10, Math.round(BUILDINGS[id].days / Math.max(0.3, 1 + mod(empireMods(state, e), 'buildSpeed'))));
}

export function shipCost(state: GameState, e: Empire, cls: ShipClass): Cost {
  const m = empireMods(state, e);
  let mult = Math.max(0.3, 1 + mod(m, 'shipCost'));
  if (cls === 'colony') {
    const colonies = state.planets.reduce((a, p) => a + (p.colony?.ownerId === e.id ? 1 : 0), 0);
    mult *= Math.max(0.3, 1 + mod(m, 'colonyCost')) * (1 + 0.1 * Math.max(0, colonies - 1));
  }
  return scaleCost(SHIPS[cls].cost, mult);
}

export function shipDays(state: GameState, e: Empire, cls: ShipClass): number {
  return Math.max(8, Math.round(SHIPS[cls].days / Math.max(0.3, 1 + mod(empireMods(state, e), 'shipBuildSpeed'))));
}

export function count(c: Colony, id: BuildingId): number {
  return (c.buildings[id] ?? 0) + c.queue.filter((q) => q.id === id && !q.demolish).length;
}

export function canBuild(state: GameState, e: Empire, p: Planet, id: BuildingId): { ok: boolean; reason?: string } {
  const c = p.colony;
  const d = BUILDINGS[id];
  if (!c || c.ownerId !== e.id) return { ok: false, reason: 'Not your colony' };
  if (d.buildable === false) return { ok: false, reason: 'Cannot be constructed' };
  if (!hasTech(e, d.tech)) return { ok: false, reason: `Requires research: ${TECH_BY_ID[d.tech!]?.name ?? d.tech}` };
  if (d.needs && !(c.buildings[d.needs] ?? 0)) return { ok: false, reason: `Requires ${BUILDINGS[d.needs].label}` };
  if (d.deposit === 'rare' && p.deposits.rare <= 0) return { ok: false, reason: 'No rare element deposit' };
  const have = count(c, id);
  if (d.max != null && have >= d.max) return { ok: false, reason: `Limit ${d.max} per world` };
  if (c.queue.length >= 6) return { ok: false, reason: 'Construction queue full (6)' };
  if (d.district) {
    const cap = districtCaps(p)[d.district];
    if (have >= cap) return { ok: false, reason: `No ${d.district} district space (${cap})` };
  } else if (buildingsUsed(c) >= buildingSlots(c)) {
    return { ok: false, reason: `All ${buildingSlots(c)} building slots used — grow population` };
  }
  return { ok: true };
}

export function canBuildShip(state: GameState, e: Empire, p: Planet, cls: ShipClass): { ok: boolean; reason?: string } {
  const c = p.colony;
  if (!c || c.ownerId !== e.id) return { ok: false, reason: 'Not your colony' };
  if (!(c.buildings.shipyard ?? 0)) return { ok: false, reason: 'Requires an Orbital Shipyard' };
  if (!hasTech(e, SHIPS[cls].tech)) return { ok: false, reason: `Requires research: ${TECH_BY_ID[SHIPS[cls].tech!]?.name ?? SHIPS[cls].tech}` };
  if (c.shipQueue.length >= 8) return { ok: false, reason: 'Shipyard queue full (8)' };
  const accord = navalAccordsBlock(state, e, cls);
  if (accord) return { ok: false, reason: accord };
  return { ok: true };
}

export function shipyardSlots(state: GameState, p: Planet): number {
  const sys = state.galaxy.systems[p.systemId];
  const ring = sys.megastructures.find((m) => m.id === 'orbital_ring' && m.ownerId === p.colony?.ownerId);
  return 1 + (ring ? ring.stage : 0);
}

export function progressConstruction(state: GameState) {
  for (const p of state.planets) {
    const c = p.colony;
    if (c) {
      const e = state.empires[c.ownerId];
      progressBuildings(state, e, p, c);
      progressShips(state, e, p, c);
      // repair defences slowly when not under attack
      if (!hostileArmedPresence(state, c.ownerId, p.systemId)) {
        if (c.defenseDamage > 0) c.defenseDamage = Math.max(0, c.defenseDamage - 0.015);
        if (c.shieldDown) c.shieldDown = Math.max(0, c.shieldDown - 0.2);
      }
    }
    if (p.colonizing) progressColonizing(state, p);
  }
  for (const sys of state.galaxy.systems) {
    if (sys.owner != null && (sys.starbaseDamage > 0 || sys.starbaseShieldDown) && !hostileArmedPresence(state, sys.owner, sys.id)) {
      sys.starbaseDamage = Math.max(0, sys.starbaseDamage - 0.02);
      sys.starbaseShieldDown = Math.max(0, (sys.starbaseShieldDown ?? 0) - 0.2);
    }
    if (sys.outpostProject) {
      const op = sys.outpostProject;
      if (sys.owner != null) { sys.outpostProject = null; continue; }
      op.progress++;
      if (op.progress >= op.total) {
        sys.outpostProject = null;
        setSystemOwner(state, sys.id, op.empireId);
        sys.starbase = 1;
        sys.starbaseDamage = 0;
        const e = state.empires[op.empireId];
        if (e.isPlayer) {
          // a neighbour notices a claim on its doorstep
          for (const n of state.galaxy.lanes) {
            const other = n[0] === sys.id ? n[1] : n[1] === sys.id ? n[0] : null;
            const o = other != null ? state.galaxy.systems[other].owner : null;
            if (o != null && o !== e.id && state.empires[o].kind === 'major') { sendLetter(state, state.empires[o], 'border'); break; }
          }
        }
        log(state, { kind: 'outpost', severity: 'good', title: `Outpost raised in ${sys.name}`, text: `${sys.name} is now part of the ${e.adjective} realm.`, empires: [op.empireId], systemId: sys.id });
      }
    }
    if (sys.starbaseUpgrade && sys.owner != null) {
      sys.starbaseUpgrade.progress++;
      if (sys.starbaseUpgrade.progress >= sys.starbaseUpgrade.total) {
        sys.starbaseUpgrade = null;
        sys.starbase = Math.min(3, sys.starbase + 1);
        sys.starbaseDamage = 0;
        log(state, { kind: 'starbase', severity: 'good', title: `${STARBASE[sys.starbase]!.label} completed`, text: `The starbase in ${sys.name} has been upgraded.`, empires: [sys.owner], systemId: sys.id });
      }
    }
    for (const m of sys.megastructures) {
      if (!m.building) continue;
      const def = MEGA_BY_ID[m.id];
      const e = state.empires[m.ownerId];
      // blockaded: hostile warships in the system stop the work (and its instalments), as they
      // stop shipments, outposts, colonisation and repairs
      if (hostileArmedPresence(state, m.ownerId, sys.id)) continue;
      // an Ascension Injunction halts the regulated project for bound members
      { const proj = megaProject(m.id); if (proj && injunctionBlocks(state, m.ownerId, proj)) continue; }
      // stages are paid in daily instalments, so great works fit within normal storage;
      // a day the realm cannot pay, the work waits
      if (!pay(e, megaInstalment(def))) continue;
      m.progress++;
      if (m.progress >= def.stageDays) {
        m.stage++;
        m.progress = 0;
        if (m.stage >= def.stages) m.building = false;
        log(state, {
          kind: 'megastructure', severity: 'good',
          title: `${def.label}: stage ${m.stage}/${def.stages} complete`,
          text: m.stage >= def.stages ? `The ${def.label} at ${sys.name} is fully operational.` : `Work continues on the next stage at ${sys.name}.`,
          empires: [], systemId: sys.id,
        });
      }
    }
  }
}

/** One day's share of a megastructure stage's cost. */
export function megaInstalment(def: { stageCost: Record<string, number | undefined>; stageDays: number }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(def.stageCost)) out[k] = (v ?? 0) / def.stageDays;
  return out;
}

function progressBuildings(state: GameState, e: Empire, p: Planet, c: Colony) {
  const q = c.queue[0];
  if (!q) return;
  if (!q.paid) {
    if (q.demolish) q.paid = true;
    else {
      const cost = buildingCost(state, e, q.id as BuildingId);
      if (!pay(e, cost)) return;
      q.paid = true;
    }
  }
  q.progress += (c.stability < 25 ? 0.6 : 1) * (1 + industrialistBonus(state, p.id).build);
  if (q.progress >= q.total) {
    c.queue.shift();
    const id = q.id as BuildingId;
    if (q.demolish) {
      c.buildings[id] = Math.max(0, (c.buildings[id] ?? 0) - 1);
      if (!c.buildings[id]) delete c.buildings[id];
    } else {
      c.buildings[id] = (c.buildings[id] ?? 0) + 1;
      if (e.isPlayer) log(state, { kind: 'construction', severity: 'info', title: `${BUILDINGS[id].label} completed`, text: `Construction finished on ${p.name}.`, empires: [e.id], planetId: p.id, systemId: p.systemId });
    }
  }
}

function progressShips(state: GameState, e: Empire, p: Planet, c: Colony) {
  if (!c.shipQueue.length) return;
  if (!(c.buildings.shipyard ?? 0)) return;
  const slots = shipyardSlots(state, p);
  for (let i = 0; i < Math.min(slots, c.shipQueue.length); i++) {
    const q = c.shipQueue[i];
    if (!q.paid) {
      if (!pay(e, shipCost(state, e, q.id as ShipClass))) continue;
      q.paid = true;
    }
    q.progress++;
  }
  for (let i = c.shipQueue.length - 1; i >= 0; i--) {
    const q = c.shipQueue[i];
    if (q.progress < q.total) continue;
    c.shipQueue.splice(i, 1);
    deliverShip(state, e, p, q.id as ShipClass, q.targetFleetId ?? null);
  }
}

function deliverShip(state: GameState, e: Empire, p: Planet, cls: ShipClass, targetFleetId: number | null) {
  const civ = SHIPS[cls].civilian;
  let fleet = targetFleetId != null ? state.fleets[targetFleetId] : undefined;
  if (fleet && (fleet.ownerId !== e.id || fleet.systemId !== p.systemId || fleet.path.length)) fleet = undefined;
  if (!fleet && !civ) {
    fleet = Object.values(state.fleets).find(
      (f) => f.ownerId === e.id && f.systemId === p.systemId && !f.path.length && f.order.type === 'idle' && !isCivilianFleet(f) && f.ships.length < 40,
    );
  }
  if (fleet && !civ) {
    const ship = makeShip(state, e, cls);
    fleet.ships.push(ship);
    fleet.troops += SHIPS[cls].troops ?? 0;
  } else {
    fleet = createFleet(state, e.id, p.systemId, [cls]);
  }
  if (e.isPlayer) log(state, { kind: 'shipyard', severity: 'good', title: `${SHIPS[cls].label} commissioned`, text: `Launched from ${p.name} into ${fleet.name}.`, empires: [e.id], planetId: p.id, systemId: p.systemId });
}

function progressColonizing(state: GameState, p: Planet) {
  const job = p.colonizing!;
  const sys = state.galaxy.systems[p.systemId];
  if (sys.owner !== job.empireId) { p.colonizing = null; return; }
  job.progress++;
  if (job.progress < job.total) return;
  p.colonizing = null;
  p.station = null;
  p.colony = {
    ownerId: job.empireId,
    pops: 1.5,
    buildings: {},
    queue: [],
    shipQueue: [],
    stability: 55,
    resistance: 0,
    originalOwnerId: null,
    foundedTick: state.tick,
    lowStabilityMonths: 0,
    defenseDamage: 0,
  };
  const e = state.empires[job.empireId];
  log(state, { kind: 'colony', severity: 'good', title: `Colony founded on ${p.name}`, text: `${e.adjective} settlers have established a new world. It will rely on crown support until it grows.`, empires: [e.id], planetId: p.id, systemId: p.systemId });
}

export function starbaseUpgradeCost(level: number): Cost | null {
  const next = STARBASE[level + 1];
  return next ? (next.upgrade as Cost) : null;
}

export function canAffordCost(e: Empire, c: Cost) {
  return canAfford(e, c);
}
