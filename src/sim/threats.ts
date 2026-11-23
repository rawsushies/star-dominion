// Cosmic threats below the Omega crisis: the Void Devourer and the Sentinels.
//
// The Void Devourer enters the galaxy once, two to three decades in. It moves every forty days to a
// neighbouring system, always announcing its next destination a full move ahead (tracked on every
// map), and prefers the richest energy it can reach. Where it sits, worlds and stations lose most of
// their energy and trade routes through it are cut (it is a hostile fleet); where it fed it leaves a
// scar that dims energy for years and devours a stage of any Dyson Swarm or Stellar Collector. It
// grows as it feeds and starves where there is nothing to eat. It can be fought with ordinary
// fleets and starbases; whoever kills it takes its heart. Realms that leave their systems to it with
// no fleet nearby lose standing. After sixteen years it leaves.
//
// Sentinels guard what the precursors left: gateways, relic vaults, shipyards and research
// archives. Destroying a host yields that site's reward to the victor, raises its reputation, and
// angers Automata Prime, who built them.

import type { BattleReport, Empire, GameState, Fleet } from './types';
import { createFleet, fleetPower, removeFleet, routeFleet, shipStats } from './fleets';
import { adjacency, jumpDistances } from './galaxy';
import { grantRelics } from './relics';
import { canResearch } from './research';
import { TECH_BY_ID } from './data/techs';
import { armed } from './territory';
import { log } from './util';
import { int, hash2 } from './rng';
import { DEVOURER, SENTINEL_KINDS, SENTINEL_SITES } from './data/expansion';
import type { SentinelSite } from './expansionTypes';
import { addBoon, addReputation, exp, isSovereign, precursorById } from './expansion';
import { addPressure } from './ancients';

// ------------------------------------------------------------------ the Void Devourer

export function devourerFleet(state: GameState): Fleet | null {
  const dv = state.expansion?.devourer;
  if (!dv || dv.status !== 'roaming' || dv.fleetId == null) return null;
  return state.fleets[dv.fleetId] ?? null;
}

function energyValue(state: GameState, sid: number): number {
  const s = state.galaxy.systems[sid];
  let v = s.owner != null && isSovereign(state.empires[s.owner]) ? 3 : 0;
  for (const pid of s.planetIds) {
    const p = state.planets[pid];
    if (p.colony) v += (p.colony.buildings.power ?? 0) * 3 + (p.colony.buildings.fusion_plant ?? 0) * 4 + p.colony.pops * 0.2;
    if (p.station === 'energy') v += 3;
  }
  for (const m of s.megastructures) if (m.id === 'dyson_swarm' || m.id === 'stellar_collector' || m.id === 'sector_array' || m.id === 'continuum_engine') v += 6 * Math.max(1, m.stage);
  if (s.star === 'blue' || s.star === 'white') v += 1;
  return v;
}

/** Where the Devourer goes next from `from`: the richest neighbour it has not just visited (deterministic). */
export function devourerNextTarget(state: GameState, from: number): number | null {
  const dv = exp(state).devourer;
  const adj = adjacency(state.galaxy)[from] ?? [];
  if (!adj.length) return null;
  const recent = dv.trail.slice(-5);
  let best = -1, bestV = -Infinity;
  for (const v of adj) {
    const age = recent.lastIndexOf(v);
    const val = energyValue(state, v) - (age >= 0 ? 100 - age : 0);
    if (val > bestV || (val === bestV && v < best)) { bestV = val; best = v; }
  }
  return best;
}

function spawnDevourer(state: GameState) {
  const dv = exp(state).devourer;
  const caps = state.empires.filter((e) => e.alive && e.kind === 'major' && e.capitalSystemId != null).map((e) => e.capitalSystemId!);
  if (!caps.length) return;
  const d = jumpDistances(state.galaxy, caps, undefined, 14);
  // it arrives out of the deep: as far from the great capitals as the explored galaxy allows (up to
  // six jumps), preferring unclaimed space, never in a capital or an ancient enclave
  const capSet = new Set(caps);
  const sacred = new Set((state.expansion?.precursors ?? []).flatMap((p) => p.sacred));
  const spots = state.galaxy.systems.filter((s) => !capSet.has(s.id) && !sacred.has(s.id) && !s.features.includes('guardian') && Number.isFinite(d[s.id]) && d[s.id] >= 1)
    .map((s) => ({ s, v: Math.min(6, d[s.id]) * 2 + (s.owner == null ? 3 : 0) }))
    .sort((a, b) => b.v - a.v || a.s.id - b.s.id);
  const pool = spots.slice(0, Math.max(1, Math.min(8, spots.length)));
  if (!pool.length) return;
  const at = pool[int(state.rng, 0, pool.length - 1)].s.id;
  const ce = state.empires[dv.empireId];
  const f = createFleet(state, ce.id, at, ['dreadnought', 'battleship', 'battleship', 'battleship'], 'The Void Devourer');
  f.stance = 'aggressive';
  // scale it to the galaxy it finds: a little stronger than a typical great navy
  const navies = state.empires.filter((e) => e.alive && e.kind === 'major').map((e) => e.stats.militaryPower || 0).sort((a, b) => a - b);
  const median = navies.length ? navies[Math.floor(navies.length / 2)] : 300;
  scaleCosmic(state, ce, f, Math.max(600, median * 1.3));
  dv.status = 'roaming';
  dv.fleetId = f.id;
  dv.bornTick = state.tick;
  dv.trail = [at];
  dv.target = devourerNextTarget(state, at);
  dv.nextMoveTick = state.tick + 60;
  log(state, { kind: 'devourer', severity: 'danger', title: 'The Void Devourer enters the galaxy', text: `A stellar leviathan has appeared at ${state.galaxy.systems[at].name}. It feeds on energy and cuts the trade lanes it sits on. In 60 days it moves to ${dv.target != null ? state.galaxy.systems[dv.target].name : 'parts unknown'}; its path is tracked on the map.`, empires: [], systemId: at });
}

/** Scale a cosmic realm's ships so a fleet reaches roughly the target power (damage and hull alike). */
export function scaleCosmic(state: GameState, ce: Empire, f: Fleet, target: number) {
  const p = Math.max(1, fleetPower(state, f));
  const k = target / p;
  for (const tm of ce.timedMods) if (tm.key === 'shipHull' || tm.key === 'shipDamage' || tm.key === 'shipArmor' || tm.key === 'shipShields') tm.value = Math.max(-0.5, (1 + tm.value) * k - 1);
  for (const s of f.ships) { const st = shipStats(state, ce, s.cls); s.hull = st.hull; s.armor = st.armor; s.shields = st.shields; }
}

export function devourerDaily(state: GameState) {
  const dv = state.expansion?.devourer;
  if (!dv || dv.status !== 'roaming' || state.tick < dv.nextMoveTick) return;
  const f = devourerFleet(state);
  if (!f) return;
  if (f.path.length || f.progress > 0) { dv.nextMoveTick = state.tick + 5; return; }
  const engaged = state.battles.some((b) => b.ongoing && b.systemId === f.systemId);
  if (engaged) { dv.nextMoveTick = state.tick + 5; return; }
  const to = dv.target ?? devourerNextTarget(state, f.systemId);
  if (to == null || !routeFleet(state, f, to)) { dv.target = devourerNextTarget(state, f.systemId); dv.nextMoveTick = state.tick + 10; return; }
  f.order = { type: 'move', target: to };
  dv.trail.push(to);
  if (dv.trail.length > 12) dv.trail.splice(0, dv.trail.length - 12);
  const owner = state.galaxy.systems[to].owner;
  if (energyValue(state, to) < 3) dv.hungry++; else dv.hungry = 0;
  dv.target = devourerNextTarget(state, to);
  dv.nextMoveTick = state.tick + DEVOURER.moveDays;
  const ownerNext = dv.target != null ? state.galaxy.systems[dv.target].owner : null;
  if (ownerNext != null && isSovereign(state.empires[ownerNext])) log(state, { kind: 'devourer', severity: 'danger', title: 'The Devourer turns towards you', text: `After ${state.galaxy.systems[to].name}, the Void Devourer will move on to ${state.galaxy.systems[dv.target!].name} in about ${DEVOURER.moveDays} days.`, empires: [ownerNext], systemId: dv.target! });
  if (owner != null && isSovereign(state.empires[owner])) log(state, { kind: 'devourer', severity: 'danger', title: `The Devourer descends on ${state.galaxy.systems[to].name}`, text: 'Energy output there will collapse while it feeds, and trade through the system is cut.', empires: [owner], systemId: to });
}

export function devourerMonthly(state: GameState) {
  const x = state.expansion;
  if (!x) return;
  const dv = x.devourer;
  if (dv.status === 'unborn') { if (state.tick >= dv.spawnAt) spawnDevourer(state); return; }
  if (dv.status !== 'roaming') return;
  const f = devourerFleet(state);
  if (!f || !f.ships.length) { slain(state); return; }
  if (state.tick - (dv.bornTick ?? state.tick) >= DEVOURER.lifespanYears * 360) {
    removeFleet(state, f);
    dv.status = 'departed'; dv.fleetId = null; dv.endTick = state.tick; dv.target = null;
    log(state, { kind: 'devourer', severity: 'info', title: 'The Void Devourer departs', text: 'Gorged, the leviathan drifts out of the galaxy. Its scars remain.', empires: [] });
    return;
  }
  const ce = state.empires[dv.empireId];
  // it knits itself back together between meals, and starves on empty space
  for (const s of f.ships) { const st = shipStats(state, ce, s.cls); s.hull = Math.min(st.hull, s.hull + st.hull * (dv.hungry >= 3 ? 0.02 : 0.1)); s.shields = st.shields; s.armor = Math.min(st.armor, (s.armor ?? st.armor) + st.armor * 0.1); }
  if (dv.hungry >= 3) for (const s of f.ships) s.hull *= 0.92;
  if (f.progress > 0) return;
  const sys = state.galaxy.systems[f.systemId];
  if (sys.owner == null || !isSovereign(state.empires[sys.owner])) return;
  // it feeds
  dv.fed++;
  dv.scars[sys.id] = state.tick + DEVOURER.scarYears * 360;
  for (const m of sys.megastructures) {
    if ((m.id === 'dyson_swarm' || m.id === 'stellar_collector') && m.stage > 0) {
      m.stage--; m.building = true; m.progress = 0;
      log(state, { kind: 'devourer', severity: 'danger', title: `The Devourer consumes part of a ${m.id === 'dyson_swarm' ? 'Dyson Swarm' : 'Stellar Collector'}`, text: `A stage of the great work at ${sys.name} is gone.`, empires: [m.ownerId], systemId: sys.id });
      break;
    }
  }
  const owner = sys.owner;
  const adj = adjacency(state.galaxy)[sys.id];
  const defended = Object.values(state.fleets).some((g) => g.ownerId === owner && armed(g) && (g.systemId === sys.id || adj.includes(g.systemId)));
  if (!defended) { addReputation(state, owner, -2); }
  if (dv.fed % 4 === 0 && f.ships.length < DEVOURER.maxShips) {
    const extra = createFleet(state, ce.id, f.systemId, ['battleship']);
    f.ships.push(...extra.ships);
    removeFleet(state, extra);
    log(state, { kind: 'devourer', severity: 'warn', title: 'The Devourer grows', text: `Well fed at ${sys.name}, the leviathan sheds a new spawn. It is stronger now.`, empires: [], systemId: sys.id });
  }
  for (const k of Object.keys(dv.scars)) if (dv.scars[+k] <= state.tick) delete dv.scars[+k];
}

/** Who killed something at a system: the strongest sovereign fleet there, else the last battle's other side. */
export function victorAt(state: GameState, sid: number, loserOwner: number): number | null {
  let best: { id: number; p: number } | null = null;
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.systemId !== sid || f.progress > 0 || !armed(f) || !isSovereign(state.empires[f.ownerId])) continue;
    const p = fleetPower(state, f);
    if (!best || p > best.p || (p === best.p && f.ownerId < best.id)) best = { id: f.ownerId, p };
  }
  if (best) return best.id;
  let rep: BattleReport | undefined;
  for (let i = state.battles.length - 1; i >= 0; i--) if (state.battles[i].systemId === sid) { rep = state.battles[i]; break; }
  if (!rep) return null;
  const side = rep.sides[0].includes(loserOwner) ? rep.sides[1] : rep.sides[0];
  return side.find((id) => isSovereign(state.empires[id])) ?? null;
}

function slain(state: GameState) {
  const dv = exp(state).devourer;
  const at = dv.trail[dv.trail.length - 1] ?? null;
  const victor = at != null ? victorAt(state, at, dv.empireId) : null;
  if (dv.fleetId != null && state.fleets[dv.fleetId]) removeFleet(state, state.fleets[dv.fleetId]);
  dv.status = 'slain'; dv.fleetId = null; dv.endTick = state.tick; dv.target = null; dv.slainBy = victor;
  if (victor != null) {
    addBoon(state, victor, { key: 'output.energy', value: 0.1, label: 'Heart of the Devourer' });
    addReputation(state, victor, 15);
    grantRelics(state, state.empires[victor], 3, 'The Void Devourer slain');
  }
  log(state, { kind: 'devourer', severity: 'good', title: 'The Void Devourer is slain', text: victor != null ? `The fleets of the ${state.empires[victor].name} have killed the leviathan. Its heart powers their grid (+10% energy for good).` : 'The leviathan is dead.', empires: [], systemId: at ?? undefined });
}

// ------------------------------------------------------------------ Sentinels

export function sentinelSite(state: GameState, sid: number): SentinelSite {
  const x = exp(state);
  return (x.sentinels[sid] ??= { kind: SENTINEL_KINDS[Math.floor(hash2(sid, 7, state.settings.seed) * SENTINEL_KINDS.length) % SENTINEL_KINDS.length] });
}

/** A Sentinel host is destroyed: the site's reward goes to whoever destroyed it. Called by the engine. */
export function onSentinelsDefeated(state: GameState, sid: number): number | null {
  if (!state.expansion) return null;
  const site = sentinelSite(state, sid);
  if (site.claimedBy != null) return site.claimedBy;
  const guardian = state.empires.find((e) => e.kind === 'guardian');
  const victor = victorAt(state, sid, guardian?.id ?? -1);
  if (victor == null) return null;
  const e = state.empires[victor];
  const sys = state.galaxy.systems[sid];
  site.claimedBy = victor;
  site.tick = state.tick;
  let what = SENTINEL_SITES[site.kind].reward;
  switch (site.kind) {
    case 'gateway': {
      if (!sys.features.includes('jump_nexus')) sys.features.push('jump_nexus');
      const first = !(state.expansion.boons[victor] ?? []).some((b) => b.label === 'Sentinel gateway charts');
      addBoon(state, victor, { key: 'shipSpeed', value: first ? 0.1 : 0.03, label: 'Sentinel gateway charts' });
      break;
    }
    case 'relic_vault': {
      const rp = Math.round(600 * (1 + (e.era ?? 0) * 0.5));
      e.research.progress += rp;
      grantRelics(state, e, 3, `The relic vault of ${sys.name}`);
      what = `+${rp} research${e.isPlayer ? ' and 3 relics' : ''}.`;
      break;
    }
    case 'shipyard': {
      const f = createFleet(state, victor, sid, ['battleship', 'battleship'], `Sentinel-forged Squadron`);
      for (const s of f.ships) { s.relic = { name: 'Sentinel-forged', rarity: 'epic', bonus: 0.3 }; s.hull *= 1.3; }
      addBoon(state, victor, { key: 'navalCap', value: 6, label: 'Ancient shipyard' });
      break;
    }
    case 'archive': {
      const t = Object.values(TECH_BY_ID).filter((d) => d.category !== 'ascension' && d.tier <= 5 && canResearch(e, d.id)).sort((a, b) => b.tier - a.tier || a.id.localeCompare(b.id))[0];
      if (t) { e.research.done.push(t.id); if (e.research.current === t.id) e.research.current = null; e.research.queue = e.research.queue.filter((q) => q !== t.id); }
      addBoon(state, victor, { key: 'output.research', value: 0.05, label: 'Sentinel archive' });
      what = `${t ? `${t.name} unlocked, and ` : ''}+5% research for good.`;
      break;
    }
  }
  addReputation(state, victor, 8);
  const auto = precursorById(state, 'automata');
  if (auto) addPressure(state, auto, 6, `${e.name} destroyed the Sentinels of ${sys.name}`, victor);
  const veil = precursorById(state, 'veil');
  if (veil) addPressure(state, veil, 2, `${e.name} destroyed the Sentinels of ${sys.name}`, victor);
  log(state, { kind: 'guardian', severity: e.isPlayer ? 'good' : 'info', title: `${SENTINEL_SITES[site.kind].label} of ${sys.name} won`, text: `The ${e.name} destroyed its Sentinels. ${what} Automata Prime, who built them, will remember.`, empires: [], systemId: sid });
  return victor;
}
