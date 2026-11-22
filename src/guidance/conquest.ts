// The facts the "Your First War" lesson needs: a sensible first target (a weak neighbour), how
// much fleet and how many troops it takes, and the orders "Do it for me" gives. Everything is read
// from the real game state; the lesson never cheats on the player's behalf.

import type { Command } from '../sim/commands';
import type { Fleet, GameState, ShipClass } from '../sim/types';
import { getLedger } from '../sim/engine';
import { hasContact } from '../sim/diplomacy';
import { warBetween } from '../sim/territory';
import { fleetPower, isCivilianFleet, orbitSecured } from '../sim/fleets';
import { findPath } from '../sim/galaxy';
import { SHIPS } from '../sim/data/ships';
import { guidanceOf } from './state';

export interface Focus { empireId: number; planetId: number }

const STARBASE = [0, 30, 110, 320];

/** Strength guarding a world: the owner's fleets in the system, its station and its defence platforms. */
export function defenceAt(g: GameState, planetId: number): number {
  const p = g.planets[planetId];
  const owner = p.colony?.ownerId;
  if (owner == null) return 0;
  let v = 0;
  for (const f of Object.values(g.fleets)) if (f.ownerId === owner && f.systemId === p.systemId) v += fleetPower(g, f);
  const sys = g.galaxy.systems[p.systemId];
  if (sys.owner === owner) v += STARBASE[sys.starbase] * (1 - sys.starbaseDamage);
  v += (p.colony!.buildings.orbital_defense ?? 0) * 35 * (1 - p.colony!.defenseDamage);
  return v;
}

/** Soldiers defending a world (a planetary shield makes them count for more). */
export function garrisonOf(g: GameState, planetId: number): number {
  const p = g.planets[planetId];
  if (!p.colony) return 0;
  const real = getLedger(g, g.empires[p.colony.ownerId]).planets[planetId]?.garrison ?? 4;
  return real * ((p.colony.buildings.planetary_shield ?? 0) > 0 ? 1 / 0.6 : 1);
}

/** Troops to land: enough to win even on a bad roll. */
export const troopsNeeded = (g: GameState, planetId: number) => Math.ceil(garrisonOf(g, planetId) * 1.4);

/** Warship strength to bring: well above what guards the world and what its owner can send. */
export function fleetNeeded(g: GameState, f: Focus): number {
  const owner = g.empires[f.empireId];
  return Math.round(Math.max(40, defenceAt(g, f.planetId) * 1.6, (owner.stats.militaryPower || 0) * 0.8));
}

const warFleet = (f: Fleet) => f.ships.length > 0 && !isCivilianFleet(f) && f.ships.some((s) => !['transport', 'scout', 'constructor', 'colony', 'logistics'].includes(s.cls));
export const myWarFleets = (g: GameState) => Object.values(g.fleets).filter((f) => f.ownerId === g.playerId && warFleet(f));
export const myWarPower = (g: GameState) => myWarFleets(g).reduce((a, f) => a + fleetPower(g, f), 0);
export const myTroops = (g: GameState) => Object.values(g.fleets).reduce((a, f) => a + (f.ownerId === g.playerId ? f.troops : 0), 0);
const queued = (g: GameState, pred: (cls: string) => boolean) => g.planets.reduce((a, p) => a + (p.colony?.ownerId === g.playerId ? p.colony.shipQueue.filter((q) => pred(q.id)).length : 0), 0);
export const queuedTroops = (g: GameState) => queued(g, (c) => c === 'transport') * (SHIPS.transport.troops ?? 8);
export const queuedWarships = (g: GameState) => queued(g, (c) => !SHIPS[c as ShipClass]?.civilian && c !== 'transport');

/** Pick the easiest world to take: a known, reachable realm's colony, small realms first. */
export function pickTarget(g: GameState): Focus | null {
  const me = g.empires[g.playerId];
  const home = me.capitalSystemId;
  if (home == null) return null;
  let best: { f: Focus; score: number } | null = null;
  for (const p of g.planets) {
    const c = p.colony;
    if (!c || c.ownerId === g.playerId) continue;
    const owner = g.empires[c.ownerId];
    if (!owner.alive || (owner.kind !== 'minor' && owner.kind !== 'major') || !hasContact(g, g.playerId, owner.id)) continue;
    if (!me.explored.includes(p.systemId)) continue;
    const path = findPath(g.galaxy, home, p.systemId);
    if (!path) continue;
    const f = { empireId: owner.id, planetId: p.id };
    const score = (owner.kind === 'minor' ? 0 : 400) + fleetNeeded(g, f) + garrisonOf(g, p.id) * 6 + path.length * 15 + (owner.capitalPlanetId === p.id && owner.kind === 'major' ? 300 : 0);
    if (!best || score < best.score) best = { f, score };
  }
  return best?.f ?? null;
}

/** The lesson's target, chosen once and kept while it still makes sense. */
export function conquestFocus(g: GameState): Focus | null {
  const s = guidanceOf(g);
  const f = s.focus;
  if (f) {
    const owner = g.planets[f.planetId]?.colony?.ownerId;
    if (owner === f.empireId || owner === g.playerId) return f;
  }
  s.focus = pickTarget(g) ?? undefined;
  return s.focus ?? null;
}

export const captured = (g: GameState, f: Focus | null) => !!f && g.planets[f.planetId].colony?.ownerId === g.playerId;
export const atWarWith = (g: GameState, f: Focus | null) => !!f && !!warBetween(g, g.playerId, f.empireId);
export const orbitWon = (g: GameState, f: Focus | null) => !!f && (captured(g, f) || orbitSecured(g, g.playerId, f.planetId));

// ---------------------------------------------------------------- "Do it for me"

function shipyard(g: GameState) {
  const me = g.empires[g.playerId];
  const mine = g.planets.filter((p) => p.colony?.ownerId === g.playerId && (p.colony.buildings.shipyard ?? 0) > 0);
  return mine.find((p) => p.id === me.capitalPlanetId) ?? mine[0] ?? null;
}

export function bestWarship(g: GameState): ShipClass {
  const done = g.empires[g.playerId].research.done;
  return (['destroyer', 'frigate', 'corvette'] as ShipClass[]).find((c) => !SHIPS[c].tech || done.includes(SHIPS[c].tech!)) ?? 'corvette';
}

export function orderWarships(g: GameState): Command[] {
  const yard = shipyard(g);
  if (!yard) return [];
  const free = Math.max(0, 8 - yard.colony!.shipQueue.length);
  return Array.from({ length: Math.min(3, free) }, () => ({ type: 'queueShip', planetId: yard.id, cls: bestWarship(g) }) as Command);
}

export function orderTransports(g: GameState, f: Focus | null): Command[] {
  const yard = shipyard(g);
  if (!yard || !f) return [];
  const missing = troopsNeeded(g, f.planetId) - myTroops(g) - queuedTroops(g);
  const n = Math.min(Math.max(1, Math.ceil(missing / (SHIPS.transport.troops ?? 8))), 4, Math.max(0, 8 - yard.colony!.shipQueue.length));
  return Array.from({ length: n }, () => ({ type: 'queueShip', planetId: yard.id, cls: 'transport' }) as Command);
}

/** Merge the fleets at home into the strongest one, then send it (troops aboard) to the target. */
export function orderAttack(g: GameState, f: Focus | null): Command[] {
  if (!f) return [];
  const target = g.planets[f.planetId].systemId;
  const mine = Object.values(g.fleets).filter((x) => x.ownerId === g.playerId && x.ships.length && (warFleet(x) || x.troops > 0));
  if (!mine.length) return [];
  const main = mine.slice().sort((a, b) => fleetPower(g, b) - fleetPower(g, a))[0];
  const out: Command[] = [];
  for (const x of mine) if (x !== main && x.systemId === main.systemId && !x.path.length && !main.path.length) out.push({ type: 'mergeFleets', fleetId: main.id, otherId: x.id });
  out.push({ type: 'moveFleet', fleetId: main.id, target });
  for (const x of mine) if (x !== main && (x.systemId !== main.systemId || x.path.length || main.path.length)) out.push({ type: 'moveFleet', fleetId: x.id, target });
  return out;
}

export function orderInvade(g: GameState, f: Focus | null): Command[] {
  if (!f) return [];
  const sid = g.planets[f.planetId].systemId;
  return Object.values(g.fleets).filter((x) => x.ownerId === g.playerId && x.troops > 0 && x.systemId === sid && !x.path.length)
    .map((x) => ({ type: 'fleetOrder', fleetId: x.id, order: { type: 'invade', planetId: f.planetId } }) as Command);
}
