// The Grand Expansion: state, setup, save migration and the small hooks the rest of the
// simulation calls (economy, construction, research, commands, territory, modifiers).
//
// Three pillars live in their own modules and are driven from here:
//   ancients.ts  the Stagnant Ascendancies (Archons of Veil, Automata Prime), awakening and the War in Heaven
//   conclave.ts  the High Conclave: seats, weighted votes, resolutions and directives
//   threats.ts   the Void Devourer and the Sentinels' rewards
//   omega.ts     the Omega Incursion
//
// Cadence: expansionDaily() only checks deadlines (O(1) unless something is due); expansionMonthly()
// does the bounded strategic work; nothing scans the whole galaxy every day.

import { blankEmpire } from './engine';
import { createFleet } from './fleets';
import { adjacency, ensureBodies, jumpDistances } from './galaxy';
import { makeRng, int, next, type RngState } from './rng';
import { setSystemOwner } from './territory';
import { ensureRuler } from './succession';
import { TECHS } from './data/techs';
import { SHIPS } from './data/ships';
import { PRECURSORS, PRECURSOR_IDS, SENTINEL_KINDS, DEVOURER } from './data/expansion';
import { hash2 } from './rng';
import type { Colony, Empire, GameState } from './types';
import type { Boon, Directive, ExpansionState, InjunctionProject, PoliticsState, PrecursorId, PrecursorState } from './expansionTypes';
import { ancientsMonthly } from './ancients';
import { conclaveDaily, conclaveMonthly } from './conclave';
import { devourerDaily, devourerMonthly, sentinelSite } from './threats';
import { omegaDaily, omegaMonthly } from './omega';
import { politicsMonthly } from './politics';

/** The expansion state (created on first use for states made by hand in tests). */
export function exp(state: GameState): ExpansionState {
  if (!state.expansion) setupExpansion(state);
  return state.expansion!;
}

/** Is the expansion present? (it always is after newGame / deserialize) */
export function hasExpansion(state: GameState): boolean { return !!state.expansion; }

function emptyExpansion(): ExpansionState {
  return {
    version: 1,
    precursors: [],
    heaven: { active: false, warId: null, startTick: null, pledges: {}, coalition: [], ended: null },
    conclave: { founded: null, founders: [], seats: {}, delegateCursor: 0, nextRotation: 0, session: null, directives: [], history: [], nextOrdinary: 0, motionCooldown: {}, vetoUsed: {}, suspended: {}, defiance: {} },
    devourer: { empireId: -1, fleetId: null, status: 'unborn', spawnAt: 0, nextMoveTick: 0, target: null, scars: {}, trail: [], fed: 0, hungry: 0, bornTick: null, slainBy: null, endTick: null },
    sentinels: {},
    omega: { stage: 'dormant', empireId: -1, trigger: null, stageTick: 0, rift: null, integrity: 100, strength: 0, corrupted: {}, neglect: {}, nextWave: 0, project: null, resolution: null, recovery: {}, credit: {}, intel: {}, lattice: 0, spread: 0, losses: { colonies: 0, systems: 0 }, exploiter: null, reopened: 0 },
    reputation: {},
    boons: {},
    politics: emptyPolitics(),
  };
}

export function emptyPolitics(): PoliticsState {
  return { pacts: [], offers: [], regard: {}, agendas: {}, history: [], cooldown: {}, warden: null, claimant: null, noticed: {} };
}

/**
 * Create the expansion: place the two Precursor enclaves, the cosmic realms, the Sentinels'
 * charges and the Devourer's arrival date. Uses its own seeded stream (derived from the game seed)
 * so the main simulation stream is untouched; the same seed always gives the same placement.
 * Runs on a new game and, once, on a save from before the expansion.
 */
export function setupExpansion(state: GameState) {
  const x = emptyExpansion();
  state.expansion = x;
  const rng = makeRng((state.settings.seed ^ 0x5eedc0de) >>> 0);
  for (const id of PRECURSOR_IDS) x.precursors.push(placePrecursor(state, rng, id));
  // the cosmic realms: no worlds, no diplomacy, hostile to all
  x.devourer.empireId = addCosmic(state, 'The Void Devourer', 'Devourer', '#5b3a8c', { shipHull: 6, shipDamage: 2.5, shipArmor: 3, shipShields: 2 });
  x.omega.empireId = addCosmic(state, 'Omega Incursion', 'Omega', '#d24a8a', { shipHull: 0.6, shipDamage: 0.4 });
  x.devourer.spawnAt = Math.max(360 * int(rng, DEVOURER.earliestYear, DEVOURER.latestYear), state.tick + 360 * 2);
  for (const s of state.galaxy.systems) if (s.features.includes('guardian')) x.sentinels[s.id] = { kind: SENTINEL_KINDS[Math.floor(hash2(s.id, 7, state.settings.seed) * SENTINEL_KINDS.length) % SENTINEL_KINDS.length] };
  for (const e of state.empires) if (isSovereign(e)) x.reputation[e.id] = 0;
  // the new realms get the defaults every realm has, so a migrated save round-trips unchanged
  for (const e of state.empires) if (e.kind === 'precursor' || e.kind === 'cosmic') ensureRuler(state, e);
}

/** Fill fields added to the expansion after a save was written (forward-compatible defaults). */
export function migrateExpansion(state: GameState) {
  const x = state.expansion!;
  const d = emptyExpansion();
  x.heaven = { ...d.heaven, ...x.heaven };
  x.conclave = { ...d.conclave, ...x.conclave };
  x.devourer = { ...d.devourer, ...x.devourer };
  x.omega = { ...d.omega, ...x.omega, losses: { ...d.omega.losses, ...(x.omega?.losses ?? {}) } };
  x.sentinels ??= {};
  x.reputation ??= {};
  x.boons ??= {};
  x.politics = { ...emptyPolitics(), ...(x.politics ?? {}) };
  for (const p of x.precursors) {
    p.blame ??= {}; p.sources ??= []; p.sacred ??= []; p.sacredWorlds ??= []; p.intrusion ??= {}; p.demands ??= {};
    p.sponsored ??= {}; p.knowledgeCooldown ??= {}; p.tributeCooldown ??= {}; p.salvaged ??= {};
    if (p.lastWarTick === undefined) p.lastWarTick = null;
  }
}

function addCosmic(state: GameState, name: string, adjective: string, color: string, mods: Record<string, number>): number {
  const e = blankEmpire(state.empires.length, { name, adjective, color, kind: 'cosmic', personality: { aggression: 1, expansion: 0, mercantile: 0, science: 0, diplomacy: 0, doctrine: 'line' } });
  e.timedMods = Object.entries(mods).map(([key, value]) => ({ key, value, until: 1e9, label: 'Beyond reckoning' }));
  e.aiNextTick = 1e9;
  state.empires.push(e);
  return e.id;
}

function enclaveSize(state: GameState): number {
  const n = state.galaxy.systems.length;
  return n <= 30 ? 2 : n <= 60 ? 3 : n <= 120 ? 4 : 5;
}

function placePrecursor(state: GameState, rng: RngState, id: PrecursorId): PrecursorState {
  const def = PRECURSORS[id];
  const ps: PrecursorState = { id, empireId: -1, status: 'absent', pressure: 0, blame: {}, sources: [], warned: 0, awakenedTick: null, sacred: [], sacredWorlds: [], intrusion: {}, demands: {}, sponsored: {}, knowledgeCooldown: {}, tributeCooldown: {}, salvaged: {}, lastWarTick: null };
  const g = state.galaxy;
  const huge = g.lazyBodies === true;
  const capitals = state.empires.filter((e) => e.alive && e.capitalSystemId != null && (e.kind === 'major' || e.kind === 'minor' || e.kind === 'rebels' || e.kind === 'precursor')).map((e) => e.capitalSystemId!);
  if (!capitals.length) return ps;
  const d = jumpDistances(g, capitals, undefined, huge ? 40 : Infinity);
  const n = g.systems.length;
  const adj = adjacency(g);
  const free = (sid: number) => { const s = g.systems[sid]; return s.owner == null && !s.features.includes('guardian') && !s.outpostProject; };
  // as far from every capital as the galaxy allows (small galaxies are crowded), never adjacent to one
  let maxD = 0;
  for (const s of g.systems) if (free(s.id) && Number.isFinite(d[s.id]) && (!huge || d[s.id] <= 30)) maxD = Math.max(maxD, d[s.id]);
  const minD = Math.max(2, Math.min(huge ? 9 : n <= 60 ? 4 : 5, maxD));
  const scored: { id: number; v: number }[] = [];
  for (const s of g.systems) {
    const dist = d[s.id];
    if (!Number.isFinite(dist) || dist < minD || !free(s.id) || s.star === 'black_hole') continue;
    if (huge && dist > 30) continue;
    const room = adj[s.id].filter(free).length;
    if (room < 1) continue;
    scored.push({ id: s.id, v: Math.min(dist, minD + 4) + room * 0.5 + next(rng) * 1.5 });
  }
  scored.sort((a, b) => b.v - a.v || a.id - b.id);
  // the throne world needs solid ground: materialise planets only for the best few candidates
  // (in the lazy 10,000-system galaxy, generating bodies everywhere would slow every later day)
  let best = -1;
  for (const c of scored.slice(0, 24)) {
    ensureBodies(state, c.id);
    if (g.systems[c.id].planetIds.some((pid) => state.planets[pid].type !== 'gas_giant')) { best = c.id; break; }
  }
  if (best < 0) return ps;
  // the enclave: the core and free neighbours, breadth first
  const enclave = [best];
  for (let h = 0; h < enclave.length && enclave.length < enclaveSize(state); h++) {
    for (const v of adj[enclave[h]]) {
      if (enclave.length >= enclaveSize(state)) break;
      if (!enclave.includes(v) && free(v)) enclave.push(v);
    }
  }
  const e = blankEmpire(state.empires.length, {
    name: def.name, adjective: def.adjective, color: def.color, kind: 'precursor', ruler: def.ruler, government: id === 'veil' ? 'technocracy' : 'technocracy',
    personality: { aggression: id === 'veil' ? 0.7 : 0.5, expansion: 0, mercantile: 0, science: 1, diplomacy: 0.1, doctrine: 'line' },
  });
  e.era = 3;
  e.aiNextTick = 1e9;
  e.research.done = TECHS.filter((t) => t.category !== 'ascension').map((t) => t.id);
  e.timedMods = Object.entries(def.mods).map(([key, value]) => ({ key, value, until: 1e9, label: 'Relic technology' }));
  Object.assign(e.stock, { credits: 6000, minerals: 6000, energy: 6000, food: 4000, alloys: 6000, electronics: 2000, components: 1500, rare: 1500, influence: 400 });
  state.empires.push(e);
  ps.empireId = e.id;
  ps.status = 'dormant';
  for (const [i, sid] of enclave.entries()) {
    ensureBodies(state, sid);
    setSystemOwner(state, sid, e.id);
    const sys = g.systems[sid];
    sys.starbase = i === 0 ? 3 : 2;
    sys.starbaseDamage = 0;
    // the core and (for Automata Prime) a gateway world are settled
    if (i === 0 || (i === 1 && id === 'automata')) {
      const world = sys.planetIds.map((p) => state.planets[p]).filter((p) => !p.colony).sort((a, b) => Number(a.type === 'gas_giant') - Number(b.type === 'gas_giant') || b.size - a.size || a.id - b.id)[0];
      if (world) {
        world.type = id === 'veil' ? 'gaia' : world.type === 'barren' || world.type === 'frozen' ? world.type : 'barren';
        world.size = Math.max(world.size, i === 0 ? 18 : 12);
        world.station = null;
        delete world.op;
        world.colony = ancientColony(e.id, i === 0 ? 26 : 12, i === 0);
        if (i === 0) { e.capitalPlanetId = world.id; e.capitalSystemId = sid; }
      }
    }
  }
  if (e.capitalPlanetId == null) {
    // no world could be settled: the power cannot exist here
    for (const sid of enclave) setSystemOwner(state, sid, null);
    e.alive = false;
    ps.status = 'absent';
    return ps;
  }
  ps.sacred = enclave.slice();
  e.explored = [...new Set(enclave.flatMap((sid) => [sid, ...adj[sid]]))];
  const guard = createFleet(state, e.id, best, def.guard, `${def.adjective} Wardens`);
  guard.stance = 'defensive';
  if (enclave[1] != null) createFleet(state, e.id, enclave[1], def.guard.slice(0, 3), `${def.adjective} Gate Wardens`).stance = 'defensive';
  // the Archons' holy sites beyond the enclave: worlds of ruins and gardens other realms may covet
  if (id === 'veil') {
    const want = Math.max(2, Math.min(6, Math.round(enclaveSize(state) * 1.2)));
    const cands = state.planets.filter((p) => {
      const s = g.systems[p.systemId];
      const dist = d[p.systemId];
      return !p.colony && !p.colonizing && p.type !== 'gas_giant' && p.moonOf == null && s.owner == null && Number.isFinite(dist) && dist >= 2 && dist <= (huge ? 14 : 12) && !enclave.includes(s.id) && !s.features.includes('guardian');
    }).map((p) => ({ p, v: (g.systems[p.systemId].features.includes('ancient_ruins') ? 3 : 0) + (p.type === 'gaia' ? 2 : 0) + p.size / 10 + next(rng) }))
      .sort((a, b) => b.v - a.v || a.p.id - b.p.id);
    const used = new Set<number>();
    for (const { p } of cands) {
      if (ps.sacredWorlds.length >= want) break;
      if (used.has(p.systemId)) continue;
      used.add(p.systemId);
      ps.sacredWorlds.push(p.id);
    }
  }
  return ps;
}

function ancientColony(ownerId: number, pops: number, core: boolean): Colony {
  return {
    ownerId, pops, queue: [], shipQueue: [], stability: 80, resistance: 0, originalOwnerId: null, foundedTick: -36000, lowStabilityMonths: 0, defenseDamage: 0,
    buildings: core
      ? { capital: 1, residential: 4, agri: 3, mining: 3, power: 4, refinery: 2, electronics_fab: 2, component_works: 1, research_lab: 3, spaceport: 1, shipyard: 1, orbital_defense: 3, planetary_shield: 1, garrison: 2 }
      : { residential: 2, agri: 2, mining: 2, power: 2, refinery: 1, research_lab: 1, orbital_defense: 2, garrison: 1, spaceport: 1, shipyard: 1 },
  };
}

// ------------------------------------------------------------------ shared helpers

export function isSovereign(e: Empire | undefined): boolean {
  return !!e && e.alive && (e.kind === 'major' || e.kind === 'minor' || e.kind === 'rebels');
}

export function precursorById(state: GameState, id: PrecursorId): PrecursorState | undefined {
  return state.expansion?.precursors.find((p) => p.id === id);
}

export function precursorOfEmpire(state: GameState, empireId: number): PrecursorState | undefined {
  return state.expansion?.precursors.find((p) => p.empireId === empireId);
}

export function reputation(state: GameState, id: number): number {
  return state.expansion?.reputation[id] ?? 0;
}

export function addReputation(state: GameState, id: number, delta: number) {
  const x = state.expansion;
  if (!x || !isSovereign(state.empires[id])) return;
  x.reputation[id] = Math.max(-100, Math.min(100, (x.reputation[id] ?? 0) + delta));
}

export function addBoon(state: GameState, id: number, boon: Boon) {
  const x = exp(state);
  (x.boons[id] ??= []).push(boon);
}

/** The precursor sponsoring a realm, if any. */
export function sponsorOf(state: GameState, empireId: number): PrecursorState | undefined {
  return state.expansion?.precursors.find((p) => p.sponsored[empireId] && state.empires[p.empireId]?.alive);
}

/** Directives currently in force. */
export function directives(state: GameState): Directive[] {
  return state.expansion?.conclave.directives ?? [];
}

/** Is the realm bound by a directive? Seated members are, unless they defied it or are its target. */
export function boundBy(state: GameState, d: Directive, empireId: number): boolean {
  const c = state.expansion?.conclave;
  if (!c) return false;
  const seat = c.seats[empireId];
  if (!seat || seat === 'observer') return false;
  if ((c.suspended[empireId] ?? 0) > state.tick) return false;
  if (d.defiant.includes(empireId) || d.resolution.target === empireId) return false;
  return true;
}

/** Are a and b barred from trading by a Market Embargo (one is the target, the other bound by it)? */
export function embargoed(state: GameState, a: number, b: number): boolean {
  for (const d of directives(state)) {
    if (d.resolution.kind !== 'embargo') continue;
    const t = d.resolution.target;
    if ((t === a && boundBy(state, d, b)) || (t === b && boundBy(state, d, a))) return true;
  }
  return false;
}

/** Is any emergency containment against a cosmic threat in force (it suspends the Naval Accords)? */
export function emergencyContainment(state: GameState): boolean {
  return directives(state).some((d) => d.resolution.kind === 'containment' && d.resolution.cosmic != null);
}

function fightingAncientsOrCosmos(state: GameState, empireId: number): boolean {
  for (const w of state.wars) {
    const foes = w.attackers.includes(empireId) ? w.defenders : w.defenders.includes(empireId) ? w.attackers : null;
    if (foes?.some((f) => state.empires[f]?.kind === 'precursor')) return true;
  }
  const o = state.expansion?.omega;
  return !!o && (o.stage === 'rift' || o.stage === 'incursion');
}

export const CAPITAL_SHIPS = ['battleship', 'dreadnought'] as const;
export function capitalShipLimit(e: Empire): number { return 2 + (e.era ?? 0); }

/** Why the Naval Accords forbid this ship to this realm right now, or null. */
export function navalAccordsBlock(state: GameState, e: Empire, cls: string): string | null {
  const d = directives(state).find((x) => x.resolution.kind === 'naval_accords');
  if (!d || !boundBy(state, d, e.id) || emergencyContainment(state) || fightingAncientsOrCosmos(state, e.id)) return null;
  const def = SHIPS_LIGHT[cls];
  if (!def || def.civilian) return null;
  let used = 0, capital = 0;
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.ownerId !== e.id) continue;
    for (const s of f.ships) { const sd = SHIPS_LIGHT[s.cls]; if (!sd.civilian) used += sd.command; if ((CAPITAL_SHIPS as readonly string[]).includes(s.cls)) capital++; }
  }
  for (const p of state.planets) {
    if (p.colony?.ownerId !== e.id) continue;
    for (const q of p.colony.shipQueue) { const sd = SHIPS_LIGHT[q.id]; if (!sd?.civilian) used += sd?.command ?? 0; if ((CAPITAL_SHIPS as readonly string[]).includes(q.id)) capital++; }
  }
  const cap = e.stats.navalCap || 8;
  if (used + def.command > cap) return `Naval Accords: warships beyond your naval capacity (${Math.round(used)}/${Math.round(cap)}) are forbidden`;
  if ((CAPITAL_SHIPS as readonly string[]).includes(cls) && capital >= capitalShipLimit(e)) return `Naval Accords: at most ${capitalShipLimit(e)} battleships and dreadnoughts`;
  return null;
}

/** Is this realm enjoined from the project by an Ascension Injunction? */
export function injunctionBlocks(state: GameState, empireId: number, project: InjunctionProject): boolean {
  return directives(state).some((d) => d.resolution.kind === 'ascension_injunction' && d.resolution.project === project && boundBy(state, d, empireId));
}

export function megaProject(megaId: string): InjunctionProject | null {
  return megaId === 'continuum_engine' ? 'continuum_engine' : megaId === 'dyson_swarm' ? 'dyson_swarm' : null;
}

/** Realms whose space supplies a realm's fleets because they wage a containment war together. */
export function containmentPartners(state: GameState, id: number): number[] {
  const out: number[] = [];
  for (const d of directives(state)) {
    if (d.resolution.kind !== 'containment' || !d.supporters.includes(id)) continue;
    for (const s of d.supporters) if (s !== id && state.empires[s]?.alive && !out.includes(s)) out.push(s);
  }
  return out;
}

/** A signature of the containment partnerships (supply-network caches key on it). */
export function containmentSig(state: GameState): string {
  let s = '';
  for (const d of directives(state)) if (d.resolution.kind === 'containment') s += `c${d.id}:${d.supporters.join('.')},`;
  return s;
}

/** Extra systems a realm sees: the tracked Devourer, the fronts of the incursion (with shared
 * intelligence) and, for containment partners, the target's fleets. */
export function extraVision(state: GameState, empireId: number): number[] {
  const x = state.expansion;
  if (!x) return [];
  const out: number[] = [];
  const dv = x.devourer;
  if (dv.status === 'roaming' && dv.fleetId != null && state.fleets[dv.fleetId]) {
    out.push(state.fleets[dv.fleetId].systemId);
    if (dv.target != null) out.push(dv.target);
  }
  const o = x.omega;
  if ((o.stage === 'rift' || o.stage === 'incursion') && (o.rift != null)) {
    out.push(o.rift);
    const shared = Object.values(o.intel).some((t) => t > state.tick) && x.conclave.seats[empireId] != null && x.conclave.seats[empireId] !== 'observer';
    if (shared) for (const k in o.corrupted) out.push(+k);
  }
  for (const d of directives(state)) {
    if (d.resolution.kind !== 'containment' || d.resolution.target == null || !d.supporters.includes(empireId)) continue;
    for (const id in state.fleets) if (state.fleets[id].ownerId === d.resolution.target) out.push(state.fleets[id].systemId);
  }
  return out;
}

/**
 * Conditions on a system that change what its worlds produce: the Devourer feeding there, the scar
 * it left, Omega corruption and recovery. Returns null for an ordinary system (the common case).
 */
export interface SystemCondition { energy: number; output: number; stability: number; label: string; corrupted: boolean }
export function systemCondition(state: GameState, sid: number): SystemCondition | null {
  const x = state.expansion;
  if (!x) return null;
  let cond: SystemCondition | null = null;
  const dv = x.devourer;
  if (dv.status === 'roaming' && dv.fleetId != null && state.fleets[dv.fleetId]?.systemId === sid && state.fleets[dv.fleetId].progress === 0) {
    cond = { energy: DEVOURER.drain, output: 0.85, stability: -10, label: 'The Void Devourer feeds here', corrupted: false };
  } else if ((dv.scars[sid] ?? 0) > state.tick) {
    cond = { energy: DEVOURER.scar, output: 1, stability: -2, label: 'Scarred by the Devourer', corrupted: false };
  }
  const o = x.omega;
  if (o.corrupted[sid] != null) {
    const c = { energy: 1, output: 0.5, stability: -25, label: 'Omega corruption', corrupted: true };
    cond = cond ? { energy: cond.energy, output: cond.output * c.output, stability: cond.stability + c.stability, label: `${cond.label}; ${c.label}`, corrupted: true } : c;
  } else if ((o.recovery[sid] ?? 0) > state.tick) {
    const c = { energy: 1, output: 0.8, stability: -6, label: 'Recovering from corruption', corrupted: false };
    cond = cond ? { ...cond, output: cond.output * c.output, stability: cond.stability + c.stability, label: `${cond.label}; ${c.label}` } : c;
  }
  return cond;
}

export function isCorrupted(state: GameState, sid: number): boolean {
  return state.expansion?.omega.corrupted[sid] != null;
}

// ------------------------------------------------------------------ modifiers

/** Expansion modifiers of a realm: boons, sponsorship, and the penalties of an embargo. */
export function expansionMods(state: GameState, e: Empire): Record<string, number> | undefined {
  const x = state.expansion;
  if (!x) return undefined;
  const out: Record<string, number> = {};
  const add = (k: string, v: number) => { out[k] = (out[k] ?? 0) + v; };
  for (const b of x.boons[e.id] ?? []) add(b.key, b.value);
  const sp = sponsorOf(state, e.id);
  if (sp) for (const b of PRECURSORS[sp.id].sponsorBoons) add(b.key, b.value);
  for (const d of x.conclave.directives) if (d.resolution.kind === 'embargo' && d.resolution.target === e.id) { add('marketFee', 0.75); add('tradeValue', -0.15); }
  return out;
}

/** Cheap signature of the inputs to expansionMods (the modifier cache keys on it). */
export function expansionSig(state: GameState, e: Empire): string {
  const x = state.expansion;
  if (!x) return '';
  const sp = sponsorOf(state, e.id);
  let emb = 0;
  for (const d of x.conclave.directives) if (d.resolution.kind === 'embargo' && d.resolution.target === e.id) emb++;
  return `${x.boons[e.id]?.length ?? 0}:${sp?.id ?? '-'}:${emb}`;
}

/** Labelled lines for the UI (where a realm's expansion bonuses come from). */
export function expansionModLines(state: GameState, e: Empire): Boon[] {
  const x = state.expansion;
  if (!x) return [];
  const out: Boon[] = [...(x.boons[e.id] ?? [])];
  const sp = sponsorOf(state, e.id);
  if (sp) out.push(...PRECURSORS[sp.id].sponsorBoons);
  for (const d of x.conclave.directives) if (d.resolution.kind === 'embargo' && d.resolution.target === e.id) out.push({ key: 'tradeValue', value: -0.15, label: 'Conclave embargo' }, { key: 'marketFee', value: 0.75, label: 'Conclave embargo' });
  return out;
}

// ------------------------------------------------------------------ cadence

export function expansionDaily(state: GameState) {
  const x = state.expansion;
  if (!x) return;
  conclaveDaily(state);
  devourerDaily(state);
  omegaDaily(state);
}

export function expansionMonthly(state: GameState) {
  const x = state.expansion;
  if (!x) return;
  for (const e of state.empires) if (isSovereign(e) && x.reputation[e.id] == null) x.reputation[e.id] = 0;
  // reputation drifts slowly back towards zero
  for (const k in x.reputation) { const v = x.reputation[k]; if (v > 0) x.reputation[k] = Math.max(0, v - 0.1); else if (v < 0) x.reputation[k] = Math.min(0, v + 0.1); }
  ancientsMonthly(state);
  devourerMonthly(state);
  omegaMonthly(state);
  politicsMonthly(state);
  conclaveMonthly(state);
}

export { sentinelSite };

/** Warships for the Naval Accords: armed hulls (transports, tenders and civilian craft are not restricted). */
const SHIPS_LIGHT = Object.fromEntries(Object.entries(SHIPS).map(([k, d]) => [k, { command: d.command, civilian: d.civilian || (d.damage <= 0 && (d.strike ?? 0) <= 0) || k === 'scout' }])) as Record<string, { command: number; civilian?: boolean }>;
