// The Omega Incursion: a multi-year galactic crisis with a beginning, a middle and an end.
//
// Trigger: a great realm proves the Omega Theorem or brings the Continuum Engine to its second stage.
// Then, month by month:
//   anomalies  (8 months)  strange readings around the realm that caused it
//   warnings   (6 months)  the rift's location is known; there is time to prepare
//   rift       (3 months)  the rift opens; the first hostile fleets pour out
//   incursion             corruption spreads system by system along the fronts, waves of fleets grow
//                          stronger, corrupted worlds wither and undefended ones are lost; trade and
//                          markets across the galaxy suffer
// Answer: fleets besieging the rift wear its integrity down (the counteroffensive; the Conclave can
// coordinate it with an emergency containment war, and members can contribute resources,
// intelligence, containment lattices and fleets). A realm holding the rift then chooses:
//   seal       a long, costly project that ends the incursion; the remnants wither
//   breach     destroy the source at the cost of a large part of the fleet; everything collapses
//   exploit    bind the rift for power: vast output, but the galaxy and the ancients turn on you,
//              corruption lingers longest, and the rift may reopen
// If corruption claims too much of the galaxy, everything is consumed. Resolution leaves lasting
// marks: recovering systems, a Warden of the Galaxy who joins the Conclave's founders, reputation,
// and a reconstruction boom for those who helped.

import { createFleet, fleetPower, removeFleet, routeFleet } from './fleets';
import { adjacency, jumpDistances } from './galaxy';
import { grantRelics } from './relics';
import { armed, setSystemOwner } from './territory';
import { addMemory } from './diplomacy';
import { execute } from './commands';
import { log, pay, canAfford } from './util';
import { int } from './rng';
import { marketBounds } from './commands';
import { CONTRIBUTIONS, OMEGA } from './data/expansion';
import type { Empire, GameState, ShipClass } from './types';
import type { OmegaResolution } from './expansionTypes';
import { addBoon, addReputation, emergencyContainment, exp, isSovereign } from './expansion';
import { activePrecursors, addPressure } from './ancients';

export function omegaActive(state: GameState): boolean {
  const s = state.expansion?.omega.stage;
  return s === 'rift' || s === 'incursion';
}

export function omegaFleets(state: GameState) {
  const id = state.expansion?.omega.empireId ?? -1;
  return Object.values(state.fleets).filter((f) => f.ownerId === id).sort((a, b) => a.id - b.id);
}

function counteroffensive(state: GameState): boolean { return emergencyContainment(state) && directiveOmega(state); }
function directiveOmega(state: GameState): boolean { return state.expansion!.conclave.directives.some((d) => d.resolution.cosmic === 'omega'); }

// ------------------------------------------------------------------ monthly progression

export function omegaMonthly(state: GameState) {
  const x = state.expansion;
  if (!x) return;
  const o = x.omega;
  const months = (state.tick - o.stageTick) / 30;
  switch (o.stage) {
    case 'dormant': checkTrigger(state); return;
    case 'anomalies':
      if (Math.round(months) % 2 === 1 && o.trigger) log(state, { kind: 'omega', severity: 'warn', title: 'Anomalies', text: `Instruments across the ${state.empires[o.trigger.empireId]?.name ?? 'realm'} record impossible readings: light arriving before it leaves, a hum beneath the vacuum.`, empires: [o.trigger.empireId] });
      if (months >= OMEGA.anomalyMonths) toWarnings(state);
      return;
    case 'warnings':
      if (months >= OMEGA.warningMonths) openRift(state);
      return;
    case 'rift':
    case 'incursion':
      if (o.stage === 'rift' && months >= OMEGA.riftMonths) { o.stage = 'incursion'; o.stageTick = state.tick; log(state, { kind: 'omega', severity: 'danger', title: 'The Omega Incursion', text: 'The rift is fully open. Corruption is spreading along the fronts; undefended worlds will be lost.', empires: [] }); }
      incursionMonth(state);
      return;
    case 'resolved':
      resolvedMonth(state);
      return;
  }
}

function checkTrigger(state: GameState) {
  const o = exp(state).omega;
  for (const e of state.empires) {
    if (!e.alive || e.kind !== 'major') continue;
    let cause: 'theorem' | 'engine' | null = e.research.done.includes('era_omega') ? 'theorem' : null;
    if (!cause && state.galaxy.systems.some((s) => s.megastructures.some((m) => m.id === 'continuum_engine' && m.ownerId === e.id && m.stage >= 2))) cause = 'engine';
    if (!cause) continue;
    o.stage = 'anomalies';
    o.stageTick = state.tick;
    o.trigger = { empireId: e.id, cause, tick: state.tick };
    for (const ps of activePrecursors(state)) addPressure(state, ps, 25, cause === 'theorem' ? `${e.name} proved the Omega Theorem` : `${e.name}'s Continuum Engine tore the vacuum`, e.id);
    log(state, { kind: 'omega', severity: 'warn', title: 'Something answers', text: `${cause === 'theorem' ? 'The proof of the Omega Theorem' : 'The second stage of the Continuum Engine'} by the ${e.name} has been noticed from outside this universe. Anomalies are spreading.`, empires: [] });
    return;
  }
}

function toWarnings(state: GameState) {
  const o = exp(state).omega;
  const origin = o.trigger ? state.empires[o.trigger.empireId] : undefined;
  const from = origin?.capitalSystemId ?? state.galaxy.systems.find((s) => s.owner != null)?.id ?? 0;
  const d = jumpDistances(state.galaxy, [from], undefined, 12);
  const sacred = new Set(activePrecursors(state).flatMap((p) => p.sacred));
  const cands = state.galaxy.systems.filter((s) => Number.isFinite(d[s.id]) && d[s.id] >= 3 && d[s.id] <= 8 && !sacred.has(s.id) && !s.features.includes('guardian'))
    .map((s) => ({ s, v: (s.owner == null ? 3 : 0) - s.planetIds.filter((pid) => state.planets[pid].colony).length * 2 - Math.abs(d[s.id] - 5) }))
    .sort((a, b) => b.v - a.v || a.s.id - b.s.id).slice(0, 6);
  const pick = cands.length ? cands[int(state.rng, 0, cands.length - 1)].s.id : from;
  o.rift = pick;
  o.stage = 'warnings';
  o.stageTick = state.tick;
  log(state, { kind: 'omega', severity: 'danger', title: 'A rift is forming', text: `Every observatory points at ${state.galaxy.systems[pick].name}. In about ${OMEGA.warningMonths} months something will break through there. The High Conclave may meet in emergency once it does.`, empires: [], systemId: pick });
}

function openRift(state: GameState) {
  const o = exp(state).omega;
  if (o.rift == null) { toWarnings(state); return; }
  o.stage = 'rift';
  o.stageTick = state.tick;
  o.integrity = Math.min(100, o.reopened ? 70 : 100);
  o.strength = Math.max(o.strength, 1 + o.reopened);
  o.project = null;
  corrupt(state, o.rift);
  spawnWave(state);
  o.nextWave = state.tick + 90;
  log(state, { kind: 'omega', severity: 'danger', title: `The rift opens at ${state.galaxy.systems[o.rift].name}`, text: 'Hostile fleets pour out of a wound in space. Besiege the rift to wear it down, then seal it, breach it, or try to bind it.', empires: [], systemId: o.rift });
}

function corrupt(state: GameState, sid: number) {
  const o = exp(state).omega;
  if (o.corrupted[sid] != null) return;
  o.corrupted[sid] = state.tick;
  delete o.recovery[sid];
  const owner = state.galaxy.systems[sid].owner;
  if (owner != null && isSovereign(state.empires[owner])) {
    o.losses.systems++;
    log(state, { kind: 'omega', severity: 'danger', title: `${state.galaxy.systems[sid].name} is corrupted`, text: 'Output halves, stability collapses and people flee. A world there with no defending fleet will be lost within months.', empires: [owner], systemId: sid });
  }
}

function waveTarget(state: GameState): number {
  const o = exp(state).omega;
  const navies = state.empires.filter((e) => e.alive && e.kind === 'major').map((e) => e.stats.militaryPower || 0);
  const avg = navies.length ? navies.reduce((a, v) => a + v, 0) / navies.length : 300;
  return Math.max(250, avg * (0.25 + o.strength * 0.08));
}

const WAVE: ShipClass[] = ['cruiser', 'destroyer', 'battleship', 'frigate', 'cruiser', 'carrier'];

function spawnWave(state: GameState) {
  const o = exp(state).omega;
  if (o.rift == null) return;
  if (omegaFleets(state).length >= 10) return;
  const f = createFleet(state, o.empireId, o.rift, ['cruiser', 'destroyer']);
  f.name = `Omega Wave ${f.id}`;
  f.stance = 'aggressive';
  const target = waveTarget(state);
  let i = 0;
  while (fleetPower(state, f) < target && f.ships.length < 30) {
    const cls: ShipClass = o.strength > 3 && i % 6 === 5 ? 'dreadnought' : WAVE[i % WAVE.length];
    const extra = createFleet(state, o.empireId, o.rift, [cls]);
    f.ships.push(...extra.ships);
    removeFleet(state, extra);
    i++;
  }
}

function incursionMonth(state: GameState) {
  const x = exp(state);
  const o = x.omega;
  if (o.rift == null) return;
  o.strength += o.stage === 'incursion' ? 0.05 : 0.02;
  // escalation reaches every Omega hull
  const oe = state.empires[o.empireId];
  for (const tm of oe.timedMods) { if (tm.key === 'shipDamage') tm.value = 0.4 + o.strength * 0.06; if (tm.key === 'shipHull') tm.value = 0.6 + o.strength * 0.06; }
  // the galaxy's economy suffers while the rift is open
  for (const e of state.empires) {
    if (!isSovereign(e)) continue;
    e.timedMods = e.timedMods.filter((t) => t.label !== 'Omega disruption');
    e.timedMods.push({ key: 'tradeValue', value: -0.1, until: state.tick + 31, label: 'Omega disruption' });
  }
  for (const r of ['energy', 'rare'] as const) state.market.price[r] = Math.min(marketBounds(r)[1], state.market.price[r] * 1.03);
  siege(state);
  spread(state);
  neglect(state);
  credit(state);
  checkConsumed(state);
}

/** Fleets holding the rift with no Omega warship there wear its integrity down. */
function siege(state: GameState) {
  const o = exp(state).omega;
  const rift = o.rift!;
  let ours = 0, theirs = 0;
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.systemId !== rift || f.progress > 0 || !armed(f)) continue;
    if (f.ownerId === o.empireId) theirs += fleetPower(state, f);
    else if (isSovereign(state.empires[f.ownerId])) ours += fleetPower(state, f);
  }
  if (ours > 0 && theirs === 0) {
    const bonus = counteroffensive(state) ? 1.25 : 1;
    o.integrity = Math.max(0, o.integrity - Math.min(14, (2 + (ours / Math.max(200, waveTarget(state))) * 6) * bonus));
  } else if (ours === 0) o.integrity = Math.min(100, o.integrity + 1);
}

/** Corruption creeps outward each month along the fronts (bounded: a few systems a month). */
function spread(state: GameState) {
  const o = exp(state).omega;
  if (o.stage !== 'incursion' && Object.keys(o.corrupted).length >= 2) return;
  const adj = adjacency(state.galaxy);
  const d = jumpDistances(state.galaxy, [o.rift!], undefined, 40);
  const omegaAt = new Set(omegaFleets(state).filter((f) => f.progress === 0).map((f) => f.systemId));
  const sacred = new Set(activePrecursors(state).flatMap((p) => p.sacred));
  const cands = new Map<number, number>();
  for (const k of Object.keys(o.corrupted)) {
    for (const v of adj[+k]) {
      if (o.corrupted[v] != null || cands.has(v)) continue;
      const s = state.galaxy.systems[v];
      const present = omegaAt.has(v);
      if (sacred.has(v) && !present) continue; // the ancients' space resists
      const defended = !present && (Object.values(state.fleets).some((f) => f.systemId === v && f.progress === 0 && armed(f) && isSovereign(state.empires[f.ownerId])) || (s.owner != null && s.starbase >= 2 && s.starbaseDamage < 0.5));
      if (defended) continue;
      cands.set(v, (present ? 0 : 100) + (Number.isFinite(d[v]) ? d[v] : 50));
    }
  }
  // the spread accumulates: a fraction of a system a month at first, faster as the incursion
  // strengthens, in proportion to the size of the galaxy; a containment lattice halves it
  const size = Math.max(0.7, Math.min(3, Math.sqrt(state.galaxy.systems.length / 60)));
  o.spread += (OMEGA.spreadBase + o.strength * OMEGA.spreadPerStrength) * size * (o.lattice > state.tick ? 0.5 : 1);
  const n = Math.min(cands.size, Math.floor(o.spread));
  o.spread -= n;
  if (!cands.size) o.spread = Math.min(o.spread, 1);
  const order = [...cands.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, n);
  for (const [v] of order) corrupt(state, v);
}

/** Corrupted worlds with no defending fleet are lost after some months. */
function neglect(state: GameState) {
  const o = exp(state).omega;
  for (const k of Object.keys(o.corrupted)) {
    const sid = +k;
    const sys = state.galaxy.systems[sid];
    for (const pid of sys.planetIds) {
      const p = state.planets[pid];
      const c = p.colony;
      if (!c || !isSovereign(state.empires[c.ownerId])) { delete o.neglect[pid]; continue; }
      const guarded = Object.values(state.fleets).some((f) => f.systemId === sid && f.progress === 0 && armed(f) && (f.ownerId === c.ownerId || state.treaties.some((t) => (t.type === 'alliance' || t.type === 'vassal') && ((t.a === c.ownerId && t.b === f.ownerId) || (t.b === c.ownerId && t.a === f.ownerId)))));
      if (guarded) { delete o.neglect[pid]; continue; }
      const n = (o.neglect[pid] = (o.neglect[pid] ?? 0) + 1);
      if (n === OMEGA.neglectMonths - 2) log(state, { kind: 'omega', severity: 'danger', title: `${p.name} is failing`, text: 'Without a defending fleet the corrupted world will be lost in two months.', empires: [c.ownerId], planetId: pid, systemId: sid });
      if (n < OMEGA.neglectMonths) continue;
      const owner = c.ownerId;
      if (state.empires[owner].capitalPlanetId === pid && state.planets.some((q) => q.id !== pid && q.colony?.ownerId === owner) === false) { o.neglect[pid] = OMEGA.neglectMonths - 1; continue; } // a realm's last world holds out
      p.colony = null;
      delete o.neglect[pid];
      o.losses.colonies++;
      addReputation(state, owner, -4);
      if (!sys.planetIds.some((q) => state.planets[q].colony?.ownerId === owner) && sys.owner === owner) setSystemOwner(state, sid, null);
      log(state, { kind: 'omega', severity: 'danger', title: `${p.name} is lost`, text: `The corruption has consumed the colony on ${p.name}. Nothing remains.`, empires: [], planetId: pid, systemId: sid });
    }
  }
}

function credit(state: GameState) {
  const o = exp(state).omega;
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.systemId !== o.rift || f.progress > 0 || !armed(f) || !isSovereign(state.empires[f.ownerId])) continue;
    o.credit[f.ownerId] = (o.credit[f.ownerId] ?? 0) + fleetPower(state, f) / 50;
  }
}

function checkConsumed(state: GameState) {
  const o = exp(state).omega;
  let claimed = 0, lost = 0;
  for (const s of state.galaxy.systems) {
    if (s.owner != null && isSovereign(state.empires[s.owner])) { claimed++; if (o.corrupted[s.id] != null) lost++; }
  }
  if (claimed > 0 && lost >= 5 && lost / claimed >= OMEGA.consumeShare) resolve(state, 'consumed', null);
}

// ------------------------------------------------------------------ daily

export function omegaDaily(state: GameState) {
  const o = state.expansion?.omega;
  if (!o || !(o.stage === 'rift' || o.stage === 'incursion')) return;
  if (state.tick >= o.nextWave) {
    spawnWave(state);
    o.nextWave = state.tick + Math.max(45, Math.round(120 - o.strength * 8));
  }
  if (o.project) {
    const holder = Object.values(state.fleets).some((f) => f.ownerId === o.project!.empireId && f.systemId === o.rift && f.progress === 0 && armed(f));
    const contested = omegaFleets(state).some((f) => f.systemId === o.rift && f.progress === 0 && armed(f));
    if (!state.empires[o.project.empireId]?.alive) o.project = null;
    else if (holder && !contested) {
      o.project.progress++;
      if (o.project.progress >= o.project.total) resolve(state, 'sealed', o.project.empireId);
    }
  }
  if (state.tick % 10 === 3) waveOrders(state);
}

/** Omega fleets push out from the rift towards the nearest worlds on the front. */
function waveOrders(state: GameState) {
  const o = exp(state).omega;
  const adj = adjacency(state.galaxy);
  for (const f of omegaFleets(state)) {
    if (f.path.length || f.progress > 0) continue;
    const d = jumpDistances(state.galaxy, [f.systemId], undefined, 8);
    let best = -1, bestV = Infinity;
    for (const s of state.galaxy.systems) {
      if (!Number.isFinite(d[s.id]) || s.id === f.systemId) continue;
      const colonies = s.planetIds.some((pid) => { const c = state.planets[pid].colony; return c && isSovereign(state.empires[c.ownerId]); });
      if (!colonies) continue;
      const front = o.corrupted[s.id] != null || adj[s.id].some((v) => o.corrupted[v] != null);
      const v = d[s.id] + (front ? 0 : 3);
      if (v < bestV || (v === bestV && s.id < best)) { bestV = v; best = s.id; }
    }
    const here = state.galaxy.systems[f.systemId];
    const holdHere = here.planetIds.some((pid) => { const c = state.planets[pid].colony; return c && isSovereign(state.empires[c.ownerId]); });
    if (best >= 0 && !holdHere) { if (routeFleet(state, f, best)) f.order = { type: 'move', target: best }; }
  }
}

// ------------------------------------------------------------------ resolution

function resolvedMonth(state: GameState) {
  const o = exp(state).omega;
  for (const k of Object.keys(o.recovery)) if (o.recovery[+k] <= state.tick) delete o.recovery[+k];
  // a sealed rift's remnants wither
  if (o.resolution?.kind === 'sealed') for (const f of omegaFleets(state)) { for (const s of f.ships) s.hull *= 0.8; f.ships = f.ships.filter((s) => s.hull > 20); if (!f.ships.length) removeFleet(state, f); }
  // a bound rift may tear free
  if (o.resolution?.kind === 'exploited' && state.tick % 360 === 0 && int(state.rng, 1, 100) <= 10) {
    const who = o.exploiter;
    o.reopened++;
    o.resolution = null;
    o.stage = 'warnings';
    o.stageTick = state.tick - (OMEGA.warningMonths - 1) * 30;
    if (who != null) for (const ps of activePrecursors(state)) addPressure(state, ps, 15, `The rift bound by ${state.empires[who].name} tears free`, who);
    log(state, { kind: 'omega', severity: 'danger', title: 'The bound rift tears free', text: `The power the ${who != null ? state.empires[who].name : 'binders'} drew from the rift has broken its chains. It will open again within weeks, stronger than before.`, empires: [], systemId: o.rift ?? undefined });
  }
}

export function resolve(state: GameState, kind: OmegaResolution, empireId: number | null) {
  const x = exp(state);
  const o = x.omega;
  o.stage = 'resolved';
  o.stageTick = state.tick;
  o.resolution = { kind, empireId, tick: state.tick };
  o.project = null;
  const years = kind === 'consumed' ? 20 : OMEGA.recoveryYears[kind];
  for (const k of Object.keys(o.corrupted)) o.recovery[+k] = state.tick + years * 360;
  if (kind !== 'consumed') { o.corrupted = {}; o.neglect = {}; }
  if (kind === 'destroyed' || kind === 'exploited') for (const f of omegaFleets(state)) removeFleet(state, f);
  const who = empireId != null ? state.empires[empireId] : null;
  if (kind === 'consumed') {
    log(state, { kind: 'omega', severity: 'danger', title: 'The galaxy is consumed', text: 'The corruption has claimed too much of the galaxy. The age of kingdoms ends in silence.', empires: [] });
    if (!state.gameOver) state.gameOver = { won: false, reason: 'The Omega Incursion consumed the galaxy before anyone could close the rift.', kind: 'consumed' };
    return;
  }
  if (kind === 'exploited' && who) {
    o.exploiter = who.id;
    addBoon(state, who.id, { key: 'output.energy', value: 0.3, label: 'Omega tap' });
    addBoon(state, who.id, { key: 'output.research', value: 0.25, label: 'Omega tap' });
    addReputation(state, who.id, -40);
    for (const e of state.empires) if (e.alive && e.id !== who.id && (e.kind === 'major' || e.kind === 'minor')) addMemory(state, e.id, who.id, 'bound_omega', -30, 0.2, 'Bound the Omega for itself');
    for (const ps of activePrecursors(state)) addPressure(state, ps, 40, `${who.name} bound the Omega rift`, who.id);
    log(state, { kind: 'omega', severity: 'warn', title: `The ${who.name} bind the rift`, text: 'The incursion stops, its fleets turned to dust, and the rift now pours power into one realm. The galaxy will not forgive it, the ancients least of all, and the chains may not hold.', empires: [] });
    return;
  }
  // sealed or destroyed: credit the realms that fought
  if (who) o.credit[who.id] = (o.credit[who.id] ?? 0) + 50;
  const ranked = Object.entries(o.credit).map(([k, v]) => ({ id: +k, v })).filter((r) => isSovereign(state.empires[r.id])).sort((a, b) => b.v - a.v || a.id - b.id);
  const warden = ranked[0]?.id ?? who?.id ?? null;
  if (warden != null) {
    addBoon(state, warden, { key: 'stability', value: 5, label: 'Warden of the Galaxy' });
    addReputation(state, warden, 30);
    grantRelics(state, state.empires[warden], 4, 'Warden of the Galaxy');
    const c = x.conclave;
    if (c.founded != null && !c.founders.includes(warden) && state.empires[warden].kind === 'major') c.founders.push(warden);
  }
  if (kind === 'destroyed' && who) addBoon(state, who.id, { key: 'shipDamage', value: 0.1, label: 'Breaker of the Rift' });
  for (const r of ranked) {
    if (r.id !== warden) addReputation(state, r.id, Math.min(15, r.v / 10));
    state.empires[r.id].timedMods.push({ key: 'tradeValue', value: 0.15, until: state.tick + 360 * 5, label: 'Reconstruction boom' });
  }
  for (const k of Object.keys(x.conclave.seats)) {
    const id = +k;
    if (x.conclave.seats[id] !== 'observer' && !(o.credit[id] > 0)) addReputation(state, id, -5);
  }
  log(state, {
    kind: 'omega', severity: 'good', title: kind === 'sealed' ? 'The rift is sealed' : 'The rift is destroyed',
    text: `${who ? `The ${who.name} ${kind === 'sealed' ? 'sealed' : 'breached and destroyed'} the rift. ` : ''}${warden != null ? `The ${state.empires[warden].name} are hailed as Warden of the Galaxy${x.conclave.founders.includes(warden) ? ' and hold a permanent seat in the Conclave' : ''}. ` : ''}Corrupted systems will take ${years} years to recover. ${o.losses.colonies} worlds were lost.`,
    empires: [],
  });
}

// ------------------------------------------------------------------ commands

export type OmegaAction = 'seal' | 'breach' | 'exploit';

export function riftHeldBy(state: GameState, empireId: number): boolean {
  const o = state.expansion?.omega;
  if (!o || o.rift == null) return false;
  let mine = false;
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.systemId !== o.rift || f.progress > 0 || !armed(f)) continue;
    if (f.ownerId === o.empireId) return false;
    if (f.ownerId === empireId) mine = true;
  }
  return mine;
}

export function omegaAction(state: GameState, e: Empire, action: OmegaAction): string | null {
  const o = exp(state).omega;
  if (!omegaActive(state) || o.rift == null) return 'There is no open rift';
  if (!isSovereign(e)) return 'Only a sovereign realm can act at the rift';
  if (!riftHeldBy(state, e.id)) return 'Your warships must hold the rift, with no Omega warship there';
  switch (action) {
    case 'seal': {
      if (o.project) return o.project.empireId === e.id ? 'Your sealing is already under way' : `The ${state.empires[o.project.empireId].name} are already sealing the rift`;
      if (o.integrity > OMEGA.sealIntegrity) return `The rift is too strong to seal (integrity ${Math.round(o.integrity)}, must be ${OMEGA.sealIntegrity} or less)`;
      if (!canAfford(e, OMEGA.sealCost)) return `Sealing costs ${Object.entries(OMEGA.sealCost).map(([k, v]) => `${v} ${k}`).join(', ')}`;
      pay(e, OMEGA.sealCost);
      o.project = { empireId: e.id, progress: 0, total: OMEGA.sealDays };
      log(state, { kind: 'omega', severity: 'info', title: 'Sealing the rift', text: `The ${e.name} begin to seal the rift. It takes ${OMEGA.sealDays} days of holding the system; Omega fleets there halt the work.`, empires: [] });
      return null;
    }
    case 'breach': {
      if (o.integrity > OMEGA.breachIntegrity) return `The rift's source is still shielded (integrity ${Math.round(o.integrity)}, must be ${OMEGA.breachIntegrity} or less)`;
      // the strike costs two of every five warships at the rift
      for (const f of Object.values(state.fleets).filter((g) => g.ownerId === e.id && g.systemId === o.rift && g.progress === 0)) {
        f.ships = f.ships.filter((_, i) => i % 5 >= 2);
        if (!f.ships.length) removeFleet(state, f);
      }
      resolve(state, 'destroyed', e.id);
      return null;
    }
    case 'exploit': {
      if (o.integrity > OMEGA.exploitIntegrity) return `The rift is too wild to bind (integrity ${Math.round(o.integrity)}, must be ${OMEGA.exploitIntegrity} or less)`;
      const engine = state.galaxy.systems.some((s) => s.megastructures.some((m) => m.id === 'continuum_engine' && m.ownerId === e.id && m.stage >= 1));
      if ((e.era ?? 0) < 4 && !engine) return 'Binding the rift needs the Transcendent Continuum or a working Continuum Engine';
      if (!pay(e, OMEGA.exploitCost)) return `Binding the rift costs ${OMEGA.exploitCost.influence} influence`;
      resolve(state, 'exploited', e.id);
      return null;
    }
  }
  return 'Unknown action';
}

export type ContributionKind = 'resources' | 'intel' | 'infrastructure' | 'fleet';

export function contribute(state: GameState, e: Empire, kind: ContributionKind, fleetId?: number): string | null {
  const x = exp(state);
  const o = x.omega;
  if (!omegaActive(state) || o.rift == null) return 'Contributions go to the counteroffensive against an open rift';
  if (x.conclave.seats[e.id] == null) return 'Only realms of the Conclave contribute to the crisis effort';
  if (kind === 'fleet') {
    const f = fleetId != null ? state.fleets[fleetId] : undefined;
    if (!f || f.ownerId !== e.id || !armed(f)) return 'Choose one of your warfleets';
    const r = execute(state, e.id, { type: 'moveFleet', fleetId: f.id, target: o.rift });
    if (!r.ok) return r.message ?? 'No route to the rift';
    o.credit[e.id] = (o.credit[e.id] ?? 0) + 5;
    return null;
  }
  const def = CONTRIBUTIONS[kind];
  if (!def) return 'Unknown contribution';
  if (!canAfford(e, def.cost)) return `${def.label} costs ${Object.entries(def.cost).map(([k, v]) => `${v} ${k}`).join(', ')}`;
  pay(e, def.cost);
  o.credit[e.id] = (o.credit[e.id] ?? 0) + def.credit;
  if (kind === 'resources') o.integrity = Math.max(0, o.integrity - 4);
  if (kind === 'intel') o.intel[e.id] = state.tick + 360;
  if (kind === 'infrastructure') o.lattice = Math.max(o.lattice, state.tick) + 90;
  log(state, { kind: 'omega', severity: 'good', title: `${def.label}`, text: `The ${e.name} contribute to the crisis effort${kind === 'resources' ? ': the siege of the rift gains ordnance (-4 integrity)' : kind === 'intel' ? ': every member now sees the fronts for a year' : ': corruption spreads more slowly for three months'}.`, empires: [] });
  return null;
}
