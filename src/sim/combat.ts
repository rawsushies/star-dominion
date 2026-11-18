// Space combat. Each day, every system containing mutually hostile forces
// fights three rounds. Ships pick targets by size preference; hit chance is
// tracking vs evasion; shields absorb first, armour mitigates per-shot damage,
// strike craft are thinned by enemy point defence. Fleet composition, tech,
// admirals, supply and terrain therefore all matter — a large but
// badly-composed fleet can lose to a smaller balanced one.

import { DEFENSE_PLATFORM, SHIPS, STARBASE, type HullSize } from './data/ships';
import { empireMods, mod } from './modifiers';
import { admiralOf, adjustWarScoreForEvent, removeFleet, routeFleet, shipStats } from './fleets';
import { armed, friends, isHostile } from './territory';
import { costValue, log, nextId } from './util';
import { range, weighted, chance } from './rng';
import { adjacency } from './galaxy';
import type { BattleReport, Fleet, GameState, Ship } from './types';

interface Unit {
  key: number; // stable id for report (ship id, or negative for structures)
  side: 0 | 1;
  owner: number;
  label: string;
  size: HullSize;
  hull: number;
  maxHull: number;
  shields: number;
  maxShields: number;
  armor: number;
  maxArmor: number;
  pierce: number;
  damage: number;
  strike: number;
  tracking: number;
  evasion: number;
  pd: number;
  prefers: HullSize[];
  ship?: Ship;
  fleet?: Fleet;
  kind: 'ship' | 'starbase' | 'platform';
  planetId?: number;
  value: number;
}

const ROUNDS_PER_DAY = 3;
const MAX_REPORT_ROUNDS = 45;

export function resolveCombat(state: GameState): Set<number> {
  const engaged = new Set<number>();
  const bySystem = new Map<number, Fleet[]>();
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.progress > 0 || !f.ships.length) continue;
    let arr = bySystem.get(f.systemId);
    if (!arr) { arr = []; bySystem.set(f.systemId, arr); }
    arr.push(f);
  }
  const systems = [...bySystem.keys()].sort((a, b) => a - b);
  for (const sid of systems) fightAt(state, sid, bySystem.get(sid)!, engaged);
  // close reports for systems that went quiet
  for (const b of state.battles) {
    if (b.ongoing && !systems.includes(b.systemId)) b.ongoing = false;
  }
  return engaged;
}

function fightAt(state: GameState, sid: number, fleets: Fleet[], engaged: Set<number>) {
  const sys = state.galaxy.systems[sid];
  const present = new Set<number>(fleets.map((f) => f.ownerId));
  const structOwners = new Set<number>();
  if (sys.owner != null && sys.starbase > 0 && sys.starbaseDamage < 0.99) structOwners.add(sys.owner);
  for (const pid of sys.planetIds) {
    const c = state.planets[pid].colony;
    if (c && (c.buildings.orbital_defense ?? 0) > 0 && c.defenseDamage < 0.99) structOwners.add(c.ownerId);
  }
  structOwners.forEach((o) => present.add(o));
  const owners = [...present].sort((a, b) => a - b);
  // Quick reject: anyone hostile to anyone?
  let hostilePair: [number, number] | null = null;
  for (let i = 0; i < owners.length && !hostilePair; i++) for (let j = i + 1; j < owners.length; j++) {
    if (isHostile(state, owners[i], owners[j])) { hostilePair = [owners[i], owners[j]]; break; }
  }
  if (!hostilePair) {
    const rep = state.battles.find((b) => b.ongoing && b.systemId === sid);
    if (rep) rep.ongoing = false;
    return;
  }
  // Build two sides around the first hostile pair, adding friends of each.
  const side0 = new Set<number>([hostilePair[0]]);
  const side1 = new Set<number>([hostilePair[1]]);
  for (const o of owners) {
    if (side0.has(o) || side1.has(o)) continue;
    const h0 = [...side0].some((x) => isHostile(state, x, o));
    const h1 = [...side1].some((x) => isHostile(state, x, o));
    if (h0 && !h1) side1.add(o);
    else if (h1 && !h0) side0.add(o);
  }
  // Raiders/guardians shouldn't team up with each other against a third party unless both hostile.
  const units: Unit[] = [];
  const addFleet = (f: Fleet, side: 0 | 1) => {
    const e = state.empires[f.ownerId];
    const adm = admiralOf(state, f);
    const supplyMult = f.supply > 0 ? 1 : 0.7;
    for (const s of f.ships) {
      const d = SHIPS[s.cls];
      const st = shipStats(state, e, s.cls, adm);
      units.push({
        key: s.id, side, owner: f.ownerId, label: d.label, size: d.size,
        hull: s.hull, maxHull: st.hull, shields: s.shields, maxShields: st.shields, armor: s.armor ?? st.armor, maxArmor: st.armor, pierce: st.pierce,
        damage: st.damage * supplyMult, strike: st.strike * supplyMult, tracking: st.tracking, evasion: st.evasion, pd: st.pd,
        prefers: d.prefers, ship: s, fleet: f, kind: 'ship', value: costValue(d.cost),
      });
    }
    engaged.add(f.id);
  };
  for (const f of fleets) {
    if (side0.has(f.ownerId)) addFleet(f, 0);
    else if (side1.has(f.ownerId)) addFleet(f, 1);
  }
  // Structures
  if (sys.owner != null && sys.starbase > 0 && sys.starbaseDamage < 0.99 && (side0.has(sys.owner) || side1.has(sys.owner))) {
    const e = state.empires[sys.owner];
    const m = empireMods(state, e);
    const prof = STARBASE[sys.starbase]!;
    const bastion = sys.megastructures.find((x) => x.id === 'bastion' && x.stage > 0);
    const mult = (1 + mod(m, 'starbase')) * (bastion ? 1 + 2 * bastion.stage : 1);
    const maxHull = (prof.hull + prof.armor) * mult;
    units.push({
      key: -1 - sid * 10, side: side0.has(sys.owner) ? 0 : 1, owner: sys.owner, label: prof.label, size: 'XL',
      hull: maxHull * (1 - sys.starbaseDamage), maxHull, shields: prof.shields * mult * (1 - (sys.starbaseShieldDown ?? 0)), maxShields: prof.shields * mult,
      armor: 0, maxArmor: 0, pierce: 0, damage: prof.damage * mult, strike: 0, tracking: prof.tracking, evasion: 0, pd: 0.15,
      prefers: ['L', 'M', 'XL', 'S'], kind: 'starbase', value: 0,
    });
  }
  for (const pid of sys.planetIds) {
    const p = state.planets[pid];
    const c = p.colony;
    if (!c || !(c.buildings.orbital_defense ?? 0) || c.defenseDamage >= 0.99) continue;
    if (!side0.has(c.ownerId) && !side1.has(c.ownerId)) continue;
    const e = state.empires[c.ownerId];
    const m = empireMods(state, e);
    const n = c.buildings.orbital_defense ?? 0;
    const mult = 1 + mod(m, 'defensePlatform');
    const shieldMult = (c.buildings.planetary_shield ?? 0) > 0 ? 2 : 1;
    const maxHull = (DEFENSE_PLATFORM.hull + DEFENSE_PLATFORM.armor) * n * mult;
    units.push({
      key: -2 - pid * 10, side: side0.has(c.ownerId) ? 0 : 1, owner: c.ownerId, label: `${p.name} batteries`, size: 'L',
      hull: maxHull * (1 - c.defenseDamage), maxHull, shields: DEFENSE_PLATFORM.shields * n * mult * shieldMult * (1 - (c.shieldDown ?? 0)),
      maxShields: DEFENSE_PLATFORM.shields * n * mult * shieldMult, armor: 0, maxArmor: 0, pierce: 0,
      damage: DEFENSE_PLATFORM.damage * n * mult, strike: 0, tracking: DEFENSE_PLATFORM.tracking, evasion: 0, pd: 0.1,
      prefers: ['L', 'M', 'S', 'XL'], kind: 'platform', planetId: pid, value: 0,
    });
  }
  const sideArmed = [0, 1].map((s) => units.some((u) => u.side === s && (u.damage > 0 || u.strike > 0)));
  const sideHas = [0, 1].map((s) => units.some((u) => u.side === s));
  if (!sideHas[0] || !sideHas[1] || (!sideArmed[0] && !sideArmed[1])) {
    // nothing to fight with: unarmed fleets don't engage each other
    for (const u of units) if (u.fleet) engaged.delete(u.fleet.id);
    return;
  }
  // Passive fleets that are just passing through don't get pinned if the enemy is only structures.
  const pulsar = sys.features.includes('pulsar');
  const nebula = sys.features.includes('nebula');
  if (pulsar) for (const u of units) { u.shields = 0; u.maxShields = 0; }
  if (nebula) for (const u of units) u.tracking = Math.max(0.05, u.tracking - 0.1);

  let rep = state.battles.find((b) => b.ongoing && b.systemId === sid);
  if (!rep) {
    rep = {
      id: nextId(state), tick: state.tick, systemId: sid,
      sides: [[...side0], [...side1]], ships: [], shots: [], rounds: 0,
      losses: [0, 0], shipsLost: [0, 0], winner: -1, ongoing: true,
    };
    state.battles.push(rep);
    if (state.battles.length > 16) state.battles.splice(0, state.battles.length - 16);
    const names = (ids: Set<number>) => [...ids].map((i) => state.empires[i].name).join(', ');
    const involved = [...side0, ...side1];
    log(state, {
      kind: 'battle', severity: 'danger', title: `Battle of ${sys.name}`,
      text: `${names(side0)} engaged ${names(side1)}.`, empires: involved, systemId: sid, battleId: rep.id,
    });
  }
  const snapIndex = new Map<number, number>();
  rep.ships.forEach((s, i) => snapIndex.set(s.id, i));
  for (const u of units) {
    if (!snapIndex.has(u.key)) {
      const hp = new Array(Math.min(rep.rounds, MAX_REPORT_ROUNDS)).fill(1);
      rep.ships.push({ id: u.key, cls: u.ship ? u.ship.cls : u.kind === 'starbase' ? 'dreadnought' : 'battleship', side: u.side, owner: u.owner, hp });
      snapIndex.set(u.key, rep.ships.length - 1);
    }
  }

  const lostValue: [number, number] = [0, 0];
  for (let r = 0; r < ROUNDS_PER_DAY; r++) {
    const alive = (s: 0 | 1) => units.filter((u) => u.side === s && u.hull > 0);
    const a0 = alive(0);
    const a1 = alive(1);
    if (!a0.length || !a1.length) break;
    const pdOf = (arr: Unit[]) => Math.min(0.6, 1 - arr.reduce((p, u) => p * (1 - u.pd), 1));
    const pd = [pdOf(a0), pdOf(a1)];
    const recordRound = rep.rounds < MAX_REPORT_ROUNDS;
    let shotsThisRound = 0;
    const damageQueue: { t: Unit; dmg: number; pierce: number; from: Unit }[] = [];
    for (const u of [...a0, ...a1]) {
      if (u.damage <= 0 && u.strike <= 0) continue;
      const foes = u.side === 0 ? a1 : a0;
      const t = weighted(state.rng, foes, (f) => (u.prefers.includes(f.size) ? 3 - u.prefers.indexOf(f.size) * 0.6 : 0.6) * (f.kind === 'ship' ? 1 : 0.8));
      if (!t) continue;
      if (u.damage > 0) {
        const hit = Math.max(0.05, Math.min(0.95, 0.35 + u.tracking - t.evasion));
        const sizeBonus = u.prefers[0] === t.size ? 1.3 : 1;
        damageQueue.push({ t, dmg: u.damage * hit * sizeBonus * range(state.rng, 0.85, 1.15), pierce: u.pierce, from: u });
      }
      if (u.strike > 0) {
        const t2 = weighted(state.rng, foes, (f) => (f.size === 'S' ? 3 : f.size === 'M' ? 2 : 1));
        if (t2) {
          const hit = Math.max(0.05, Math.min(0.95, 0.35 + 0.85 - t2.evasion));
          damageQueue.push({ t: t2, dmg: u.strike * hit * (1 - pd[u.side === 0 ? 1 : 0]) * range(state.rng, 0.85, 1.15), pierce: 0.3, from: u });
        }
      }
    }
    for (const q of damageQueue) {
      const t = q.t;
      if (t.hull <= 0) continue;
      // Layered defences: shields, then armour plating, then hull.
      const bypass = q.dmg * q.pierce;
      let dmg = q.dmg - bypass;
      const absorbed = Math.min(t.shields, dmg);
      t.shields -= absorbed;
      dmg = dmg - absorbed + bypass;
      const plate = Math.min(t.armor, dmg);
      t.armor -= plate;
      dmg -= plate;
      if (dmg > 0) t.hull -= dmg;
      if (recordRound && shotsThisRound < 28 && chance(state.rng, 0.6)) {
        rep.shots.push({ r: rep.rounds, from: q.from.key, to: t.key, dmg: Math.round(q.dmg) });
        shotsThisRound++;
      }
    }
    for (const u of units) {
      if (u.hull > 0) u.shields = Math.min(u.maxShields, u.shields + u.maxShields * 0.05);
    }
    if (recordRound) {
      for (const u of units) {
        const i = snapIndex.get(u.key)!;
        rep.ships[i].hp.push(Math.max(0, u.hull / u.maxHull));
      }
      // ships not present this round (destroyed earlier, etc.) keep their last value
      for (const s of rep.ships) while (s.hp.length < rep.rounds + 1) s.hp.push(s.hp[s.hp.length - 1] ?? 0);
    }
    rep.rounds++;
  }

  // Apply results
  for (const u of units) {
    if (u.kind === 'ship' && u.ship && u.fleet) {
      if (u.hull <= 0) {
        u.fleet.ships = u.fleet.ships.filter((s) => s !== u.ship);
        rep.losses[u.side] += u.value;
        rep.shipsLost[u.side]++;
        lostValue[u.side] += u.value;
      } else {
        u.ship.hull = u.hull;
        u.ship.armor = u.armor;
        u.ship.shields = u.shields;
        u.ship.xp += 1;
      }
    } else if (u.kind === 'starbase') {
      sys.starbaseDamage = Math.min(1, Math.max(0, 1 - u.hull / u.maxHull));
      sys.starbaseShieldDown = u.maxShields > 0 ? Math.min(1, Math.max(0, 1 - u.shields / u.maxShields)) : 0;
    } else if (u.kind === 'platform' && u.planetId != null) {
      const c = state.planets[u.planetId].colony!;
      c.defenseDamage = Math.min(1, Math.max(0, 1 - u.hull / u.maxHull));
      c.shieldDown = u.maxShields > 0 ? Math.min(1, Math.max(0, 1 - u.shields / u.maxShields)) : 0;
    }
  }
  // War exhaustion & score
  const sides: [number[], number[]] = [[...side0], [...side1]];
  for (const s of [0, 1] as const) {
    if (!lostValue[s]) continue;
    for (const id of sides[s]) {
      const e = state.empires[id];
      if (e.kind !== 'major' && e.kind !== 'minor') continue;
      const m = empireMods(state, e);
      e.warExhaustion = Math.min(100, e.warExhaustion + (lostValue[s] / 400) * (1 + mod(m, 'warExhaustion')));
    }
    const other = s === 0 ? 1 : 0;
    for (const w of sides[other]) for (const l of sides[s]) adjustWarScoreForEvent(state, w, l, Math.min(12, lostValue[s] / 250));
  }
  // Remove empty fleets, kill admirals of destroyed fleets
  for (const f of fleets) {
    if (state.fleets[f.id] && f.ships.length === 0) {
      const adm = admiralOf(state, f);
      if (adm && chance(state.rng, 0.5)) {
        adm.alive = false;
        log(state, { kind: 'admiral', severity: 'danger', title: `Admiral ${adm.name} killed`, text: `Lost with the ${f.name} at ${sys.name}.`, empires: [f.ownerId], systemId: sid });
      }
      removeFleet(state, f);
    } else if (adm(f)) {
      // admirals gain experience from battle
      const a = admiralOf(state, f)!;
      a.xp += 1;
      if (a.xp >= a.skill * 12 && a.skill < 10) { a.skill++; a.xp = 0; }
    }
  }
  // Retreat: badly outmatched non-aggressive fleets disengage toward friendly space.
  const power = (s: 0 | 1) => units.filter((u) => u.side === s && u.hull > 0).reduce((a, u) => a + (u.damage + u.strike) * Math.sqrt(u.hull + u.armor + u.shields), 0);
  const p0 = power(0);
  const p1 = power(1);
  for (const f of fleets) {
    if (!state.fleets[f.id] || !engaged.has(f.id)) continue;
    const side = side0.has(f.ownerId) ? 0 : 1;
    const mine = side === 0 ? p0 : p1;
    const theirs = side === 0 ? p1 : p0;
    const civ = !armed(f);
    const outmatched = theirs > 0 && mine / theirs < (f.stance === 'aggressive' ? 0.15 : 0.45);
    const a = admiralOf(state, f);
    if ((civ || outmatched || f.stance === 'passive') && f.retreatCooldown <= 0 && theirs > 0) {
      if (a?.trait === 'cautious' || civ || chance(state.rng, 0.6)) retreat(state, f);
    }
  }
  // Conclusion
  const left0 = units.some((u) => u.side === 0 && u.hull > 0 && (u.kind !== 'ship' || state.fleets[u.fleet!.id]?.systemId === sid));
  const left1 = units.some((u) => u.side === 1 && u.hull > 0 && (u.kind !== 'ship' || state.fleets[u.fleet!.id]?.systemId === sid));
  if (!left0 || !left1) {
    rep.ongoing = false;
    rep.winner = left0 && !left1 ? 0 : left1 && !left0 ? 1 : -1;
    concludeLog(state, rep);
    captureIfUndefended(state, sid);
  }
  function adm(f: Fleet) { return admiralOf(state, f) != null; }
}

function concludeLog(state: GameState, rep: BattleReport) {
  const sys = state.galaxy.systems[rep.systemId];
  const w = rep.winner;
  const involved = [...rep.sides[0], ...rep.sides[1]];
  const name = (s: 0 | 1) => rep.sides[s].map((i) => state.empires[i].name).join(', ');
  log(state, {
    kind: 'battle_end', severity: 'info',
    title: `Battle of ${sys.name} ${w === -1 ? 'broken off' : 'decided'}`,
    text: w === -1
      ? `Both sides withdrew. Losses: ${rep.shipsLost[0]} vs ${rep.shipsLost[1]} ships.`
      : `${name(w)} prevailed. ${rep.shipsLost[0] + rep.shipsLost[1]} ships destroyed (${Math.round(rep.losses[0] + rep.losses[1])} value).`,
    empires: involved, systemId: rep.systemId, battleId: rep.id,
  });
}

function retreat(state: GameState, f: Fleet) {
  const adj = adjacency(state.galaxy)[f.systemId];
  const fr = new Set(friends(state, f.ownerId));
  const options = adj.filter((v) => {
    const o = state.galaxy.systems[v].owner;
    return o != null && fr.has(o);
  });
  const target = options[0] ?? adj.find((v) => !Object.values(state.fleets).some((g) => g.systemId === v && isHostile(state, g.ownerId, f.ownerId))) ?? adj[0];
  if (target == null) return;
  f.order = { type: 'move', target };
  routeFleet(state, f, target);
  f.retreatCooldown = 4;
  if (state.empires[f.ownerId].isPlayer) {
    log(state, { kind: 'retreat', severity: 'warn', title: `${f.name} retreating`, text: `Withdrawing from ${state.galaxy.systems[f.systemId].name} toward ${state.galaxy.systems[target].name}.`, empires: [f.ownerId], systemId: f.systemId });
  }
}

/** Starbase destroyed and no defender colonies: the system changes hands (wars only). */
function captureIfUndefended(state: GameState, sid: number) {
  const sys = state.galaxy.systems[sid];
  if (sys.owner == null || sys.starbaseDamage < 0.99) return;
  const holds = sys.planetIds.some((pid) => state.planets[pid].colony?.ownerId === sys.owner);
  if (holds) return;
  const victor = Object.values(state.fleets).find((f) => f.systemId === sid && f.progress === 0 && armed(f) && isHostile(state, f.ownerId, sys.owner!) && state.empires[f.ownerId].kind === 'major');
  if (!victor) return;
  const prev = sys.owner;
  sys.owner = victor.ownerId;
  sys.starbaseDamage = 0.5;
  sys.starbaseUpgrade = null;
  for (const m of sys.megastructures) m.ownerId = victor.ownerId;
  adjustWarScoreForEvent(state, victor.ownerId, prev, 5);
  log(state, { kind: 'capture', severity: 'warn', title: `${sys.name} seized`, text: `${state.empires[victor.ownerId].name} captured the ${state.empires[prev].adjective} starbase in ${sys.name}.`, empires: [prev, victor.ownerId], systemId: sid });
}
