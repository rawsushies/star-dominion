// Territory, hostility, supply networks, visibility and claim costs.

import { adjacency, jumpDistances } from './galaxy';
import { BUILDINGS } from './data/buildings';
import { SHIPS } from './data/ships';
import { empireMods, mod, type Mods } from './modifiers';
import type { BuildingId, Empire, GameState } from './types';

export function ownedSystems(state: GameState, empireId: number): number[] {
  const out: number[] = [];
  for (const s of state.galaxy.systems) if (s.owner === empireId) out.push(s.id);
  return out;
}

export function warBetween(state: GameState, a: number, b: number) {
  return state.wars.find(
    (w) => (w.attackers.includes(a) && w.defenders.includes(b)) || (w.attackers.includes(b) && w.defenders.includes(a)),
  );
}

export function isHostile(state: GameState, a: number, b: number): boolean {
  if (a === b) return false;
  const ea = state.empires[a];
  const eb = state.empires[b];
  if (!ea || !eb) return false;
  if (ea.kind === 'guardian' || eb.kind === 'guardian') return true;
  if (ea.kind === 'raiders' || eb.kind === 'raiders') return true;
  return !!warBetween(state, a, b);
}

export function hasTreaty(state: GameState, a: number, b: number, type: string): boolean {
  return state.treaties.some((t) => t.type === type && ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
}

/** Empires whose territory counts as friendly for supply/trade (allies, overlord/vassals). */
export function friends(state: GameState, id: number): number[] {
  const out = [id];
  for (const t of state.treaties) {
    if (t.type !== 'alliance' && t.type !== 'vassal') continue;
    if (t.a === id) out.push(t.b);
    else if (t.b === id) out.push(t.a);
  }
  return out;
}

const netCache = new WeakMap<GameState, Map<string, Set<number>>>();

/** Systems reachable from the capital through own or friendly territory. */
export function supplyNetwork(state: GameState, empireId: number): Set<number> {
  let m = netCache.get(state);
  if (!m) { m = new Map(); netCache.set(state, m); }
  const key = `${empireId}:${state.empires[empireId]?.capitalSystemId}:${ownershipSig(state)}`;
  const hit = m.get(key);
  if (hit) return hit;
  if (m.size > 256) m.clear();
  const e = state.empires[empireId];
  const set = new Set<number>();
  if (e?.capitalSystemId != null) {
    const fr = new Set(friends(state, empireId));
    const adj = adjacency(state.galaxy);
    const q = [e.capitalSystemId];
    set.add(e.capitalSystemId);
    for (let h = 0; h < q.length; h++) {
      for (const v of adj[q[h]]) {
        const o = state.galaxy.systems[v].owner;
        if (set.has(v) || o == null || !fr.has(o)) continue;
        set.add(v);
        q.push(v);
      }
    }
  }
  m.set(key, set);
  return set;
}

function ownershipSig(state: GameState): string {
  let h = 0;
  for (const s of state.galaxy.systems) h = (h * 31 + (s.owner ?? -1) + 2) | 0;
  return String(h) + ':' + state.treaties.length;
}

export function armed(f: { ships: { cls: string }[] }): boolean {
  return f.ships.some((s) => SHIPS[s.cls as keyof typeof SHIPS].damage > 0 || (SHIPS[s.cls as keyof typeof SHIPS].strike ?? 0) > 0);
}

export function hostileArmedPresence(state: GameState, empireId: number, systemId: number): boolean {
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.systemId !== systemId || f.progress > 0) continue;
    if (f.ownerId === empireId) continue;
    const ek = state.empires[f.ownerId]?.kind;
    if (ek === 'guardian') continue; // guardians never leave their lair, they do not raid
    if (isHostile(state, empireId, f.ownerId) && armed(f)) return true;
  }
  return false;
}

export function adminCapacity(state: GameState, e: Empire, mods?: Mods): number {
  const m = mods ?? empireMods(state, e);
  let cap = 6 + mod(m, 'admin');
  for (const p of state.planets) {
    if (p.colony?.ownerId !== e.id) continue;
    for (const b in p.colony.buildings) cap += (BUILDINGS[b as BuildingId].admin ?? 0) * (p.colony.buildings[b as BuildingId] ?? 0);
  }
  return Math.round(cap);
}

/** Influence cost to raise an outpost in a system. */
export function claimCost(state: GameState, e: Empire, systemId: number): number {
  const owned = ownedSystems(state, e.id);
  const dist = owned.length ? jumpDistances(state.galaxy, owned)[systemId] : 0;
  const m = empireMods(state, e);
  const base = 25 + 8 * Math.max(0, (Number.isFinite(dist) ? dist : 6) - 1) + Math.max(0, owned.length - 8) * 1.5;
  return Math.round(base * Math.max(0.3, 1 + mod(m, 'claimCost')));
}

const visCache = new WeakMap<GameState, { tick: number; rev: number; map: Map<number, Set<number>> }>();

/** Systems an empire can currently observe (owned, adjacent, fleet sensor range, allies). */
export function visibleSystems(state: GameState, empireId: number): Set<number> {
  let c = visCache.get(state);
  const rev = fleetSig(state);
  if (!c || c.tick !== state.tick || c.rev !== rev) { c = { tick: state.tick, rev, map: new Map() }; visCache.set(state, c); }
  const hit = c.map.get(empireId);
  if (hit) return hit;
  const set = new Set<number>();
  const adj = adjacency(state.galaxy);
  const team = friends(state, empireId);
  for (const id of team) {
    const e = state.empires[id];
    if (!e) continue;
    const sensorBonus = mod(empireMods(state, e), 'sensor');
    for (const s of state.galaxy.systems) {
      if (s.owner !== id) continue;
      set.add(s.id);
      for (const v of adj[s.id]) set.add(v);
    }
    for (const fid in state.fleets) {
      const f = state.fleets[fid];
      if (f.ownerId !== id) continue;
      let range = Math.round(sensorBonus);
      for (const sh of f.ships) range = Math.max(range, (SHIPS[sh.cls].sensor ?? 0) + Math.round(sensorBonus));
      set.add(f.systemId);
      if (f.path[0] != null) set.add(f.path[0]);
      if (range > 0) {
        const d = jumpDistances(state.galaxy, [f.systemId]);
        d.forEach((v, i) => { if (v <= range) set.add(i); });
      }
    }
  }
  c.map.set(empireId, set);
  return set;
}

function fleetSig(state: GameState): number {
  let h = 0;
  for (const id in state.fleets) h = (h * 31 + state.fleets[id].systemId + (+id) * 7) | 0;
  return h;
}

/** Systems adjacent to an empire's territory that it does not own. */
export function frontier(state: GameState, empireId: number): number[] {
  const adj = adjacency(state.galaxy);
  const out = new Set<number>();
  for (const s of state.galaxy.systems) {
    if (s.owner !== empireId) continue;
    for (const v of adj[s.id]) if (state.galaxy.systems[v].owner !== empireId) out.add(v);
  }
  return [...out];
}

/** Do two empires share a border (adjacent owned systems)? */
export function bordering(state: GameState, a: number, b: number): number {
  const adj = adjacency(state.galaxy);
  let n = 0;
  for (const s of state.galaxy.systems) {
    if (s.owner !== a) continue;
    for (const v of adj[s.id]) if (state.galaxy.systems[v].owner === b) { n++; break; }
  }
  return n;
}

export function setSystemOwner(state: GameState, systemId: number, owner: number | null) {
  const sys = state.galaxy.systems[systemId];
  sys.owner = owner;
  if (owner == null) { sys.starbase = 0; sys.starbaseUpgrade = null; }
  for (const pid of sys.planetIds) {
    const p = state.planets[pid];
    if (p.station && !p.colony) {
      // orbital stations change hands with the system
    }
    if (p.colonizing && p.colonizing.empireId !== owner) p.colonizing = null;
  }
  for (const m of sys.megastructures) if (owner != null) m.ownerId = owner;
}
