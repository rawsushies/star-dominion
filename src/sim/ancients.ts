// The Stagnant Ascendancies: the Archons of Veil and Automata Prime.
//
// Hybrid awakening. Both powers begin dormant in small enclaves. Pressure builds from what the
// galaxy does (realms reaching the Galactic Hegemony, Dyson Swarms, forbidden machine intelligence,
// settling sacred worlds, intruding warships, slain Sentinels, the Continuum Engine, the Omega
// Incursion), and every point is attributed to the realm that caused it. Warnings come at 50 and
// 75; at 100 the power awakens, raises its hosts and makes war on those it blames most. When both
// are awake they fight the War in Heaven, which younger realms may join on either side, stay out
// of, band together against as an independent coalition, or exploit by salvaging ancient worlds.
// An awakened power left in peace for some years returns to watchfulness; one that loses all its
// worlds falls, and whoever took its throne world inherits its relics.

import { execute } from './commands';
import { addMemory, joinWar, makePeace, opinion } from './diplomacy';
import { createFleet, fleetPower, makeShip, orbitSecured, routeFleet, shipStats } from './fleets';
import { adjacency, jumpDistances } from './galaxy';
import { grantRelics } from './relics';
import { techCost, TECH_BY_ID } from './data/techs';
import { canResearch } from './research';
import { armed, bordering, warBetween } from './territory';
import { canAfford, log, pay } from './util';
import { KNOWLEDGE_COOLDOWN, KNOWLEDGE_COST, KNOWLEDGE_OPINION, PRECURSORS, PRESSURE, SPONSOR_COST, SPONSOR_OPINION, WATCHFUL_YEARS } from './data/expansion';
import type { Cost, Empire, GameState, ShipClass } from './types';
import type { PrecursorId, PrecursorState } from './expansionTypes';
import { addBoon, addReputation, exp, isSovereign, precursorById, sponsorOf } from './expansion';
import { hasAccord, regardLines } from './politics';
import { TREATY_LABEL } from './diplomacy';

const MAX_SOURCES = 24;

export function precursorEmpire(state: GameState, ps: PrecursorState): Empire | undefined {
  return ps.empireId >= 0 ? state.empires[ps.empireId] : undefined;
}

export function activePrecursors(state: GameState): PrecursorState[] {
  return (state.expansion?.precursors ?? []).filter((p) => p.status !== 'absent' && p.status !== 'fallen' && precursorEmpire(state, p)?.alive);
}

/** Add pressure to a precursor, attributed to a realm (or to nobody). */
export function addPressure(state: GameState, ps: PrecursorState, amount: number, label: string, empireId: number | null) {
  if (ps.status === 'absent' || ps.status === 'fallen' || amount === 0) return;
  ps.pressure = Math.max(0, Math.min(PRESSURE.awaken + 20, ps.pressure + amount));
  if (empireId != null && amount > 0) ps.blame[empireId] = (ps.blame[empireId] ?? 0) + amount;
  const last = ps.sources[ps.sources.length - 1];
  if (last && last.label === label && last.empireId === empireId && state.tick - last.tick < 30) last.amount = Math.round((last.amount + amount) * 100) / 100;
  else ps.sources.push({ tick: state.tick, label, amount: Math.round(amount * 100) / 100, empireId });
  if (ps.sources.length > MAX_SOURCES) ps.sources.splice(0, ps.sources.length - MAX_SOURCES);
}

/** Share of the pressure on a precursor that a realm caused (0..1). */
export function blameShare(ps: PrecursorState, id: number): number {
  let total = 0;
  for (const k in ps.blame) total += ps.blame[k];
  return total > 0 ? (ps.blame[id] ?? 0) / total : 0;
}

/** How a precursor regards a younger realm. */
export function precursorOpinionLines(state: GameState, ps: PrecursorState, other: number): [string, number][] {
  const out: [string, number][] = [['Ancient disdain', -10]];
  const other0 = state.empires[other];
  // the rival ancient power: enmity, unless an accord stands between them
  if (other0?.kind === 'precursor') {
    out.push(hasAccord(state) ? ['Accord of the ancients', 20] : ['Ancient enmity', -30]);
    if (warBetween(state, ps.empireId, other)) out.push(['At war', -50]);
    return out;
  }
  const share = blameShare(ps, other);
  if (share > 0.02) out.push(['Disturbed their slumber', -Math.round(share * 40)]);
  if (ps.sponsored[other]) out.push(['Sponsored sovereign', 35]);
  if (warBetween(state, ps.empireId, other)) out.push(['At war', -50]);
  const pledge = state.expansion?.heaven.pledges[other];
  if (pledge === ps.id) out.push(['Fights at their side', 30]);
  else if (pledge) out.push(['Pledged to their enemy', -40]);
  out.push(...treatyLines(state, ps.empireId, other));
  out.push(...regardLines(state, ps, other));
  for (const p of state.expansion?.politics?.pacts ?? []) {
    if (p.kind === 'compact' && p.target === ps.empireId && p.members.includes(other)) out.push(['Leagued against us', -20]);
    if (p.kind === 'collusion' && p.members.includes(ps.empireId) && p.members.includes(other)) out.push(['Our confederate', 20]);
  }
  return out;
}

/** How a younger realm regards a precursor. */
export function towardPrecursorLines(state: GameState, ps: PrecursorState, self: number): [string, number][] {
  const out: [string, number][] = [['Ancient power', -5]];
  if (ps.sponsored[self]) out.push(['Our sponsor', 25]);
  if (warBetween(state, ps.empireId, self)) out.push(['At war', -50]);
  if (ps.status === 'awakened') out.push(['Awakened and dangerous', -10]);
  out.push(...treatyLines(state, self, ps.empireId));
  return out;
}

const TREATY_WEIGHT: Record<string, number> = { nap: 5, trade: 10, research: 10, defense: 15, alliance: 25, vassal: 10 };
function treatyLines(state: GameState, a: number, b: number): [string, number][] {
  const out: [string, number][] = [];
  for (const t of state.treaties) if ((t.a === a && t.b === b) || (t.a === b && t.b === a)) out.push([TREATY_LABEL[t.type], TREATY_WEIGHT[t.type] ?? 0]);
  return out;
}

/** Is a realm bound to the power by alliance, protection or vassalage (either way)? */
export function boundToAncient(state: GameState, ps: PrecursorState, id: number): boolean {
  return state.treaties.some((t) => (t.type === 'alliance' || t.type === 'defense' || t.type === 'vassal') && ((t.a === ps.empireId && t.b === id) || (t.b === ps.empireId && t.a === id)));
}

// ------------------------------------------------------------------ monthly

export function ancientsMonthly(state: GameState) {
  const x = state.expansion;
  if (!x) return;
  for (const ps of x.precursors) {
    if (ps.status === 'absent' || ps.status === 'fallen') continue;
    const pe = precursorEmpire(state, ps);
    if (!pe?.alive) { fall(state, ps); continue; }
    const before = ps.pressure;
    gatherPressure(state, ps);
    intrusions(state, ps);
    if (ps.id === 'automata') tributeDemands(state, ps);
    obligations(state, ps);
    selfRepair(state, ps);
    haltInheritedOperations(state, ps);
    if (ps.pressure <= before) ps.pressure = Math.max(0, ps.pressure - PRESSURE.decay);
    thresholds(state, ps);
    if (ps.status === 'awakened') {
      reinforce(state, ps);
      const atWar = state.wars.some((w) => w.attackers.includes(ps.empireId) || w.defenders.includes(ps.empireId));
      if (atWar) ps.lastWarTick = state.tick;
      else if (state.tick - (ps.lastWarTick ?? state.tick) >= WATCHFUL_YEARS * 360) settle(state, ps);
    }
  }
  heavenMonthly(state);
}

function gatherPressure(state: GameState, ps: PrecursorState) {
  const veil = ps.id === 'veil';
  // realms that reach the Galactic Hegemony
  for (const e of state.empires) {
    if (!e.alive || e.kind !== 'major') continue;
    if ((e.era ?? 0) >= 3) addPressure(state, ps, 0.4 + ((e.era ?? 0) - 3) * 0.25, `${e.name} spans the galaxy`, e.id);
    if (!veil && e.research.done.includes('ai_sentient')) addPressure(state, ps, 0.4, `${e.name} keeps forbidden machine minds`, e.id);
    if (!veil && e.research.current === 'ai_sentient') addPressure(state, ps, 0.2, `${e.name} builds forbidden machine minds`, e.id);
  }
  // great works across the galaxy
  for (const s of state.galaxy.systems) {
    if (!s.megastructures.length) continue;
    for (const m of s.megastructures) {
      const owner = state.empires[m.ownerId];
      if (!owner || owner.kind === 'precursor') continue;
      if (m.id === 'dyson_swarm' && (m.stage > 0 || m.building)) addPressure(state, ps, (veil ? 0.12 : 0.04) * Math.max(1, m.stage), `A Dyson Swarm englobes ${s.name}`, m.ownerId);
      if (m.id === 'continuum_engine' && (m.stage > 0 || m.building)) addPressure(state, ps, 0.25 + 0.5 * m.stage, `The Continuum Engine at ${s.name}`, m.ownerId);
      if (!veil && m.id === 'grand_archive' && m.stage > 0) addPressure(state, ps, 0.2 * m.stage, `A sentient archive at ${s.name}`, m.ownerId);
    }
  }
  // the Archons' sacred worlds settled by others
  if (veil) {
    for (const pid of ps.sacredWorlds) {
      const c = state.planets[pid]?.colony;
      if (c && state.empires[c.ownerId]?.kind !== 'precursor') addPressure(state, ps, 1.5, `${state.planets[pid].name}, a sacred world, is settled`, c.ownerId);
    }
  }
}

/** Warships in protected space: a warning, then war once the power's patience is spent. */
function intrusions(state: GameState, ps: PrecursorState) {
  const sacred = new Set(ps.sacred.filter((sid) => state.galaxy.systems[sid]?.owner === ps.empireId));
  const intruders = new Set<number>();
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (!sacred.has(f.systemId) || f.progress > 0 || !armed(f) || f.ships.every((s) => s.cls === 'scout' || s.cls === 'constructor' || s.cls === 'colony' || s.cls === 'transport' || s.cls === 'logistics')) continue;
    const o = state.empires[f.ownerId];
    if (!isSovereign(o) || warBetween(state, ps.empireId, f.ownerId) || boundToAncient(state, ps, f.ownerId)) continue;
    intruders.add(f.ownerId);
  }
  const def = PRECURSORS[ps.id];
  for (const k of Object.keys(ps.intrusion)) if (!intruders.has(+k)) delete ps.intrusion[+k];
  for (const o of intruders) {
    const n = (ps.intrusion[o] = (ps.intrusion[o] ?? 0) + 1);
    addPressure(state, ps, 2, `Warships of ${state.empires[o].name} in protected space`, o);
    if (n === 1) log(state, { kind: 'ancients', severity: 'danger', title: `${def.name}: leave our space`, text: `${def.name} have noticed warships of the ${state.empires[o].name} in their protected systems. ${def.intrusionPatience <= 1 ? 'They will strike if the ships are still there next month.' : `They will strike if the ships remain ${def.intrusionPatience} months.`}`, empires: [o] });
    if (n > def.intrusionPatience) {
      const r = execute(state, ps.empireId, { type: 'declareWar', target: o });
      if (r.ok) {
        delete ps.intrusion[o];
        ps.lastWarTick = state.tick;
        coalitionDefends(state, o, ps.empireId);
        log(state, { kind: 'ancients', severity: 'danger', title: `${def.name} strike at the ${state.empires[o].name}`, text: `The trespass into their protected space is answered with war.`, empires: [] });
      }
    }
  }
}

/** Automata Prime demand technology tribute from advanced realms every few years. */
function tributeDemands(state: GameState, ps: PrecursorState) {
  const pe = precursorEmpire(state, ps)!;
  for (const k of Object.keys(ps.demands)) {
    const id = +k;
    const due = ps.demands[id];
    const e = state.empires[id];
    if (!e?.alive) { delete ps.demands[id]; continue; }
    if (state.tick < due) continue;
    delete ps.demands[id];
    ps.tributeCooldown[id] = state.tick + 360;
    addPressure(state, ps, 6, `${e.name} withheld the tribute`, id);
    addMemory(state, ps.empireId, id, 'withheld_tribute', -20, 0.3, 'Withheld our tribute');
    log(state, { kind: 'ancients', severity: 'danger', title: 'Tribute withheld', text: `The ${e.name} ignored the demand of ${pe.name}. The machines remember.`, empires: [id] });
    if (ps.status === 'awakened' && execute(state, ps.empireId, { type: 'declareWar', target: id }).ok) coalitionDefends(state, id, ps.empireId);
  }
  if (state.tick % 90 !== 0) return;
  for (const e of state.empires) {
    if (!e.alive || e.kind !== 'major' || ps.demands[e.id] != null || ps.sponsored[e.id] || warBetween(state, ps.empireId, e.id) || boundToAncient(state, ps, e.id)) continue;
    if ((ps.tributeCooldown[e.id] ?? 0) > state.tick) continue;
    if ((e.era ?? 0) < 2 && !e.research.done.includes('ai_sentient')) continue;
    ps.demands[e.id] = state.tick + 180;
    ps.tributeCooldown[e.id] = state.tick + 360 * 3;
    log(state, { kind: 'ancients', severity: 'warn', title: `${pe.name} demands tribute`, text: `Automata Prime demand a tribute of technology from the ${e.name} within 180 days (${tributeCostText(state, ps, e)}). Refusal angers them.`, empires: [e.id] });
  }
}

export function tributeCost(state: GameState, ps: PrecursorState, e: Empire): Cost {
  const k = 1 + (e.era ?? 0) * 0.5;
  const out: Cost = {};
  for (const [r, v] of Object.entries(PRECURSORS[ps.id].tribute)) out[r as keyof Cost] = Math.round((v ?? 0) * k);
  return out;
}
function tributeCostText(state: GameState, ps: PrecursorState, e: Empire) {
  const c = tributeCost(state, ps, e);
  const parts = Object.entries(c).map(([k, v]) => `${v} ${k}`);
  if (PRECURSORS[ps.id].tributeResearch) parts.push(`${PRECURSORS[ps.id].tributeResearch} research`);
  return parts.join(', ');
}

/** Sponsored sovereigns keep their sponsor's terms, or lose its favour. */
function obligations(state: GameState, ps: PrecursorState) {
  for (const k of Object.keys(ps.sponsored)) {
    const id = +k;
    const e = state.empires[id];
    if (!e?.alive) { delete ps.sponsored[id]; continue; }
    let broke: string | null = null;
    if (ps.id === 'veil') {
      if (ps.sacredWorlds.some((pid) => state.planets[pid]?.colony?.ownerId === id)) broke = 'settled a sacred world';
      else if (state.galaxy.systems.some((s) => s.megastructures.some((m) => m.id === 'dyson_swarm' && m.ownerId === id))) broke = 'raised a Dyson Swarm';
    } else if (e.research.done.includes('ai_sentient') || e.research.current === 'ai_sentient') broke = 'pursued forbidden machine intelligence';
    const pledge = state.expansion?.heaven.pledges[id];
    if (!broke && pledge && pledge !== ps.id) broke = 'pledged to its enemy';
    if (!broke) continue;
    const sp = ps.sponsored[id];
    sp.strikes++;
    addMemory(state, ps.empireId, id, 'broke_terms', -15, 0.3, 'Broke our terms');
    if (sp.strikes >= 2) {
      delete ps.sponsored[id];
      addMemory(state, ps.empireId, id, 'revoked', -40, 0.3, 'Betrayed our sponsorship');
      addPressure(state, ps, 10, `${e.name} betrayed its sponsorship`, id);
      log(state, { kind: 'ancients', severity: 'danger', title: `${PRECURSORS[ps.id].name} withdraw their sponsorship`, text: `The ${e.name} ${broke}. The sponsorship is revoked and with it every favour.`, empires: [] });
    } else {
      log(state, { kind: 'ancients', severity: 'warn', title: `${PRECURSORS[ps.id].name}: a broken term`, text: `The ${e.name} ${broke}, against the terms of sponsorship (${PRECURSORS[ps.id].sponsorDuty}). Once more and the sponsorship ends.`, empires: [id] });
    }
  }
}

/** The ancients run no freighter logistics: stations on worlds they take lie idle. */
function haltInheritedOperations(state: GameState, ps: PrecursorState) {
  for (const s of state.galaxy.systems) {
    if (s.owner !== ps.empireId) continue;
    for (const pid of s.planetIds) { const op = state.planets[pid].op; if (op && op.mode !== 'halted') op.mode = 'halted'; }
  }
}

/** Ancient hulls repair themselves at home (the engine's supply step serves younger realms only). */
function selfRepair(state: GameState, ps: PrecursorState) {
  const rate = ps.id === 'automata' ? 0.4 : 0.2;
  const owned = new Set(ps.sacred);
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.ownerId !== ps.empireId) continue;
    const home = owned.has(f.systemId) || state.galaxy.systems[f.systemId].owner === ps.empireId;
    const pe = precursorEmpire(state, ps)!;
    for (const s of f.ships) {
      const max = makeShipStats(state, pe, s.cls);
      const r = home ? rate : rate * 0.25;
      s.hull = Math.min(max.hull, s.hull + max.hull * r);
      s.armor = Math.min(max.armor, (s.armor ?? max.armor) + max.armor * r);
      s.shields = max.shields;
    }
    f.supply = 100;
  }
}

function makeShipStats(state: GameState, e: Empire, cls: ShipClass) {
  return shipStats(state, e, cls);
}

function thresholds(state: GameState, ps: PrecursorState) {
  const def = PRECURSORS[ps.id];
  if (ps.status === 'awakened') return;
  if (ps.pressure >= PRESSURE.awaken) { awaken(state, ps); return; }
  if (ps.pressure >= PRESSURE.final && ps.warned < PRESSURE.final) {
    ps.warned = PRESSURE.final;
    log(state, { kind: 'ancients', severity: 'danger', title: `${def.name}: the final warning`, text: `${def.name} stir in their enclave. One more provocation and they wake. They blame ${blamedText(state, ps)}.`, empires: [] });
  } else if (ps.pressure >= PRESSURE.stir && ps.warned < PRESSURE.stir) {
    ps.warned = PRESSURE.stir;
    if (ps.status === 'dormant') ps.status = 'stirring';
    log(state, { kind: 'ancients', severity: 'warn', title: `${def.name} stir`, text: `Something ancient turns in its sleep. ${def.name} are troubled by ${blamedText(state, ps)}.`, empires: [] });
  } else if (ps.pressure < PRESSURE.stir - 10 && ps.status === 'stirring') {
    ps.status = 'dormant';
    ps.warned = 0;
  }
}

function blamedText(state: GameState, ps: PrecursorState): string {
  const top = Object.entries(ps.blame).sort((a, b) => b[1] - a[1] || +a[0] - +b[0]).slice(0, 2).filter(([id]) => state.empires[+id]?.alive);
  return top.length ? top.map(([id]) => `the ${state.empires[+id].name}`).join(' and ') : 'the younger realms';
}

/** Realms the power blames enough to make war on (the worst offender always). */
export function offenders(state: GameState, ps: PrecursorState): number[] {
  const ranked = Object.entries(ps.blame).map(([id, v]) => ({ id: +id, v })).filter((o) => isSovereign(state.empires[o.id]) && !ps.sponsored[o.id] && !boundToAncient(state, ps, o.id)).sort((a, b) => b.v - a.v || a.id - b.id);
  const total = ranked.reduce((a, o) => a + o.v, 0);
  return ranked.filter((o, i) => i === 0 || o.v >= total * 0.25).slice(0, 2).map((o) => o.id);
}

/** The awakening: hosts are raised, war is declared on the offenders, the rival power is roused. */
export function awaken(state: GameState, ps: PrecursorState) {
  const def = PRECURSORS[ps.id];
  const pe = precursorEmpire(state, ps);
  if (!pe?.alive || ps.status === 'awakened') return;
  ps.status = 'awakened';
  ps.awakenedTick = state.tick;
  ps.lastWarTick = state.tick;
  ps.warned = PRESSURE.awaken;
  ps.pressure = Math.max(ps.pressure, PRESSURE.awaken);
  pe.stock.influence = Math.max(pe.stock.influence, 400);
  raiseHosts(state, ps);
  const foes = offenders(state, ps);
  for (const o of foes) if (execute(state, ps.empireId, { type: 'declareWar', target: o }).ok) coalitionDefends(state, o, ps.empireId);
  log(state, { kind: 'ancients', severity: 'danger', title: `${def.name} awaken`, text: `${def.lore.split('.')[0]}. They have woken${foes.length ? ` and make war on ${foes.map((o) => `the ${state.empires[o].name}`).join(' and ')}` : ''}. Their hosts gather at ${state.galaxy.systems[pe.capitalSystemId ?? ps.sacred[0]].name}.`, empires: [], systemId: pe.capitalSystemId ?? undefined });
  const other = activePrecursors(state).find((p) => p.id !== ps.id);
  if (other) {
    if (other.status === 'awakened') startHeaven(state, ps, other);
    else addPressure(state, other, 20, `${def.name} have awoken`, null);
  }
}

function raiseHosts(state: GameState, ps: PrecursorState) {
  const def = PRECURSORS[ps.id];
  const pe = precursorEmpire(state, ps)!;
  const target = hostTarget(state);
  const home = pe.capitalSystemId ?? ps.sacred[0];
  for (let h = 0; h < 2; h++) {
    const f = createFleet(state, pe.id, home, [...def.host, 'transport', 'transport', 'transport', 'transport'], `${def.adjective} Host ${h === 0 ? 'Ascendant' : 'Eternal'}`);
    let guard = 0;
    while (fleetPower(state, f) < target / 2 && f.ships.length < 48 && guard++ < 10) for (const c of def.host) f.ships.push(makeShip(state, pe, c));
    f.troops = f.ships.reduce((a, s) => a + (s.cls === 'transport' ? 8 : 0), 0);
    f.stance = 'aggressive';
  }
}

/** The strength an awakened power keeps its hosts at: well above the strongest younger navy. */
function hostTarget(state: GameState): number {
  let strongest = 0;
  for (const e of state.empires) if (e.alive && e.kind === 'major') strongest = Math.max(strongest, e.stats.militaryPower || 0);
  // a floor that grows with the age of the galaxy: overwhelming for a young realm, not annihilating
  return Math.max(Math.min(1200, 250 + 35 * state.tick / 360), strongest * 1.4);
}

/** Awakened foundries rebuild lost hosts: a few hulls a month at the throne world while below strength. */
function reinforce(state: GameState, ps: PrecursorState) {
  const pe = precursorEmpire(state, ps)!;
  const home = pe.capitalSystemId;
  if (home == null || state.galaxy.systems[home].owner !== pe.id) return;
  const hosts = Object.values(state.fleets).filter((f) => f.ownerId === pe.id && f.name.includes('Host')).sort((a, b) => a.id - b.id);
  const power = hosts.reduce((a, f) => a + fleetPower(state, f), 0);
  if (power >= hostTarget(state)) return;
  const def = PRECURSORS[ps.id];
  let f = hosts.find((h) => h.systemId === home && !h.path.length);
  if (!f) { f = createFleet(state, pe.id, home, [def.host[0]], `${def.adjective} Host Reborn`); f.stance = 'aggressive'; }
  for (let i = 0; i < 2 && f.ships.length < 48; i++) f.ships.push(makeShip(state, pe, def.host[(f.ships.length + i) % def.host.length]));
}

/** An awakened power left in peace returns to watchfulness. */
function settle(state: GameState, ps: PrecursorState) {
  ps.status = 'watchful';
  ps.pressure = 40;
  ps.warned = 0;
  for (const k in ps.blame) ps.blame[k] *= 0.5;
  log(state, { kind: 'ancients', severity: 'info', title: `${PRECURSORS[ps.id].name} grow watchful`, text: 'Years have passed without a quarrel. The ancient power withdraws its attention, but it does not sleep as deeply as before.', empires: [] });
}

/** The power has lost every world: its relics pass to whoever holds its throne world. */
function fall(state: GameState, ps: PrecursorState) {
  ps.status = 'fallen';
  ps.sponsored = {};
  ps.demands = {};
  const def = PRECURSORS[ps.id];
  const pe = precursorEmpire(state, ps);
  const throne = pe?.capitalPlanetId != null ? state.planets[pe.capitalPlanetId] : null;
  const heir = throne?.colony && isSovereign(state.empires[throne.colony.ownerId]) ? throne.colony.ownerId : null;
  if (heir != null) {
    const e = state.empires[heir];
    addBoon(state, heir, { key: 'output.research', value: 0.1, label: `Relics of the ${def.adjective}s` });
    addBoon(state, heir, { key: 'shipDamage', value: 0.1, label: `Relics of the ${def.adjective}s` });
    addReputation(state, heir, 10);
    grantRelics(state, e, 3, `The relics of ${def.name}`);
  }
  log(state, { kind: 'ancients', severity: 'warn', title: `${def.name} have fallen`, text: `The last world of ${def.name} is lost.${heir != null ? ` The ${state.empires[heir].name} inherit their relics.` : ''}`, empires: [] });
}

// ------------------------------------------------------------------ the War in Heaven

function startHeaven(state: GameState, a: PrecursorState, b: PrecursorState) {
  const h = exp(state).heaven;
  if (h.active || warBetween(state, a.empireId, b.empireId) || hasAccord(state)) return;
  // an ancient power that kneels to a younger realm fights only its overlord's wars
  if (state.treaties.some((t) => t.type === 'vassal' && (t.b === a.empireId || t.b === b.empireId))) return;
  state.empires[a.empireId].stock.influence = Math.max(state.empires[a.empireId].stock.influence, 100);
  const r = execute(state, a.empireId, { type: 'declareWar', target: b.empireId });
  if (!r.ok) return;
  const war = state.wars.find((w) => w.attackers.includes(a.empireId) && w.defenders.includes(b.empireId));
  if (!war) return;
  war.name = 'War in Heaven';
  h.active = true;
  h.warId = war.id;
  h.startTick = state.tick;
  h.ended = null;
  log(state, { kind: 'ancients', severity: 'danger', title: 'The War in Heaven', text: `${PRECURSORS[a.id].name} and ${PRECURSORS[b.id].name}, both awake, turn on each other. Younger realms may pledge to either side, stand together as an independent coalition, stay out of it, or pick over the ruins.`, empires: [] });
}

function heavenMonthly(state: GameState) {
  const h = exp(state).heaven;
  if (!h.active) return;
  const war = state.wars.find((w) => w.id === h.warId);
  const [veil, auto] = [precursorById(state, 'veil'), precursorById(state, 'automata')];
  const alive = (p?: PrecursorState) => !!p && p.status !== 'fallen' && !!precursorEmpire(state, p)?.alive;
  let victor: PrecursorId | null | undefined;
  if (!war) victor = alive(veil) && !alive(auto) ? 'veil' : alive(auto) && !alive(veil) ? 'automata' : null;
  else if (state.tick - (h.startTick ?? state.tick) >= 360 * 8) {
    // a stalemate of eight years ends in an armistice; the side ahead claims the honour
    const veilAttacker = veil != null && war.attackers.includes(veil.empireId);
    victor = war.score === 0 ? null : (war.score > 0) === veilAttacker ? 'veil' : 'automata';
    makePeace(state, war, 'status_quo', war.score >= 0 ? 'attackers' : 'defenders');
  }
  if (victor === undefined) return;
  endHeaven(state, victor);
}

/** Both powers awake, no accord between them: the War in Heaven begins (after an accord breaks). */
export function startHeavenIfRivals(state: GameState) {
  const act = activePrecursors(state).filter((p) => p.status === 'awakened');
  if (act.length === 2) startHeaven(state, act[0], act[1]);
}

/** The War in Heaven ended at the negotiating table (an accord of the ancients). */
export function endHeavenByAccord(state: GameState) {
  const h = exp(state).heaven;
  if (!h.active) return;
  endHeaven(state, null, 'The ancient powers have come to terms.');
}

function endHeaven(state: GameState, victor: PrecursorId | null, why?: string) {
  const h = exp(state).heaven;
  h.active = false;
  const text = why ?? (victor ? `${PRECURSORS[victor].name} prevail.` : 'Neither power prevails.');
  h.ended = { tick: state.tick, victor, text };
  for (const [k, side] of Object.entries(h.pledges)) {
    const id = +k;
    const e = state.empires[id];
    if (!e?.alive) continue;
    if (victor && side === victor) {
      addBoon(state, id, { key: 'output.research', value: 0.05, label: `Favour of ${PRECURSORS[victor].name}` });
      addReputation(state, id, 5);
      grantRelics(state, e, 2, 'Victory in the War in Heaven');
    } else if (victor) addReputation(state, id, -3);
  }
  for (const id of h.coalition) addReputation(state, id, 4);
  log(state, { kind: 'ancients', severity: 'warn', title: 'The War in Heaven ends', text: `${text} ${Object.keys(h.pledges).length ? 'Their allies share the outcome.' : ''}`, empires: [] });
  h.pledges = {};
}

/** Coalition members come to the defence of one another when a power attacks one of them. */
function coalitionDefends(state: GameState, victim: number, aggressor: number) {
  const h = state.expansion?.heaven;
  if (!h || !h.coalition.includes(victim)) return;
  const war = state.wars.find((w) => w.attackers.includes(aggressor) && w.defenders.includes(victim));
  if (!war) return;
  for (const id of h.coalition) if (id !== victim && state.empires[id]?.alive) joinWar(state, war, id, 'defenders');
}

// ------------------------------------------------------------------ awakened operations (every 10 days)

export function precursorTick(state: GameState) {
  for (const ps of activePrecursors(state)) {
    const pe = precursorEmpire(state, ps)!;
    const wars = state.wars.filter((w) => w.attackers.includes(pe.id) || w.defenders.includes(pe.id));
    if (ps.status !== 'awakened') { dormantWar(state, ps, wars); continue; }
    hostOperations(state, ps, wars);
    seekPeace(state, ps, wars);
    if (Math.floor(state.tick / 10) % 36 === 0) demandSubmission(state, ps);
  }
}

/** A dormant power at war only defends its enclave, and offers peace once the trespass ends. */
function dormantWar(state: GameState, ps: PrecursorState, wars: typeof state.wars) {
  if (!wars.length) return;
  const sacred = new Set(ps.sacred);
  const foeHere = Object.values(state.fleets).some((f) => sacred.has(f.systemId) && armed(f) && wars.some((w) => (w.attackers.includes(ps.empireId) ? w.defenders : w.attackers).includes(f.ownerId)));
  if (foeHere) { ps.lastWarTick = state.tick; return; }
  if (state.tick - (ps.lastWarTick ?? 0) < 90) return;
  for (const w of wars) {
    if (state.expansion?.heaven.warId === w.id) continue;
    const leader = w.attackers[0] === ps.empireId || w.defenders[0] === ps.empireId;
    if (leader) execute(state, ps.empireId, { type: 'proposePeace', warId: w.id, term: 'status_quo' });
  }
}

function hostOperations(state: GameState, ps: PrecursorState, wars: typeof state.wars) {
  const pe = precursorEmpire(state, ps)!;
  const foes = new Set<number>();
  for (const w of wars) (w.attackers.includes(pe.id) ? w.defenders : w.attackers).forEach((f) => foes.add(f));
  const home = pe.capitalSystemId ?? ps.sacred[0];
  const fleets = Object.values(state.fleets).filter((f) => f.ownerId === pe.id && armed(f) && !f.name.includes('Warden')).sort((a, b) => a.id - b.id);
  if (!fleets.length) return;
  const homeD = jumpDistances(state.galaxy, [home], undefined, 14);
  for (const f of fleets) {
    if (f.path.length || f.progress > 0) continue;
    const hull = f.ships.reduce((a, s) => a + s.hull, 0);
    const full = f.ships.reduce((a, s) => a + makeShipStats(state, pe, s.cls).hull, 0);
    if (hull < full * 0.45 && f.systemId !== home) { routeFleet(state, f, home) && (f.order = { type: 'move', target: home }); continue; }
    if (!foes.size) { if (f.systemId !== home) execute(state, pe.id, { type: 'moveFleet', fleetId: f.id, target: home }); continue; }
    // at a foe's world with the orbit secured: land
    const here = state.galaxy.systems[f.systemId];
    const landing = here.planetIds.map((pid) => state.planets[pid]).find((p) => p.colony && foes.has(p.colony.ownerId) && orbitSecured(state, pe.id, p.id));
    if (landing && f.troops > 0 && f.order.type !== 'invade') { execute(state, pe.id, { type: 'fleetOrder', fleetId: f.id, order: { type: 'invade', planetId: landing.id } }); continue; }
    if (here.owner != null && foes.has(here.owner) && (here.starbase > 0 && here.starbaseDamage < 0.99)) continue; // keep breaking the starbase
    // next target: the nearest foe system to the enclave (they fight close to home first)
    const fd = jumpDistances(state.galaxy, [f.systemId], undefined, 12);
    let best = -1, bestV = Infinity;
    for (const s of state.galaxy.systems) {
      if (s.owner == null || !foes.has(s.owner) || !Number.isFinite(fd[s.id])) continue;
      const v = fd[s.id] + (Number.isFinite(homeD[s.id]) ? homeD[s.id] * 0.5 : 8) - (s.planetIds.some((pid) => state.planets[pid].colony?.ownerId === s.owner) ? 1 : 0);
      if (v < bestV || (v === bestV && s.id < best)) { bestV = v; best = s.id; }
    }
    if (best >= 0 && best !== f.systemId) execute(state, pe.id, { type: 'moveFleet', fleetId: f.id, target: best });
  }
}

function seekPeace(state: GameState, ps: PrecursorState, wars: typeof state.wars) {
  for (const w of wars) {
    if (state.expansion?.heaven.warId === w.id) continue;
    const side = w.attackers[0] === ps.empireId ? 1 : w.defenders[0] === ps.empireId ? -1 : 0;
    if (!side) continue;
    const score = w.score * side;
    const months = (state.tick - w.startTick) / 30;
    if (score >= 35 && months >= 12) execute(state, ps.empireId, { type: 'proposePeace', warId: w.id, term: ps.id === 'veil' ? 'cede' : 'tribute' });
    else if (score <= -45 || months >= 72) execute(state, ps.empireId, { type: 'proposePeace', warId: w.id, term: 'status_quo' });
  }
}

/** Once a year an awakened power demands the submission of weak neighbours. */
function demandSubmission(state: GameState, ps: PrecursorState) {
  const pe = precursorEmpire(state, ps)!;
  for (const e of state.empires) {
    if (!isSovereign(e)) continue;
    if (warBetween(state, pe.id, e.id) || state.treaties.some((t) => t.type === 'vassal' && (t.b === e.id || t.b === pe.id)) || boundToAncient(state, ps, e.id)) continue;
    if (!bordering(state, e.id, pe.id)) continue;
    if ((e.stats.militaryPower || 0) * 4 > (pe.stats.militaryPower || 0)) continue;
    execute(state, pe.id, { type: 'propose', to: e.id, give: [], receive: [{ kind: 'treaty', treaty: 'vassal' }] });
  }
}

// ------------------------------------------------------------------ actions of younger realms

export type AncientsAction = 'tribute' | 'knowledge' | 'sponsor' | 'renounce' | 'pledge' | 'coalition' | 'leave_coalition' | 'salvage';

export function ancientsAction(state: GameState, e: Empire, id: PrecursorId, action: AncientsAction, systemId?: number): { error?: string; message?: string } {
  const x = exp(state);
  const ps = precursorById(state, id);
  if (!isSovereign(e)) return { error: 'Only a sovereign realm may deal with the ancients' };
  if (!ps || ps.status === 'absent') return { error: 'That power is not in this galaxy' };
  const pe = precursorEmpire(state, ps);
  const def = PRECURSORS[id];
  if (ps.status === 'fallen' || !pe?.alive) return { error: `${def.name} have fallen` };
  const atWar = !!warBetween(state, e.id, pe.id);
  switch (action) {
    case 'tribute': {
      if (atWar) return { error: 'They accept no tribute from an enemy' };
      const cost = tributeCost(state, ps, e);
      if (!canAfford(e, cost)) return { error: `The tribute is ${Object.entries(cost).map(([k, v]) => `${v} ${k}`).join(', ')}` };
      const research = def.tributeResearch;
      if (research && e.research.progress < 100) return { error: 'A technology tribute needs at least 100 research in progress to hand over' };
      pay(e, cost);
      if (research) e.research.progress = Math.max(0, e.research.progress - research);
      const calm = (ps.tributeCooldown[e.id] ?? 0) <= state.tick || ps.demands[e.id] != null;
      delete ps.demands[e.id];
      if (calm) {
        ps.pressure = Math.max(0, ps.pressure - 8);
        ps.blame[e.id] = (ps.blame[e.id] ?? 0) * 0.6;
        ps.tributeCooldown[e.id] = state.tick + 180;
      }
      addMemory(state, ps.empireId, e.id, 'tribute', 15, 0.3, 'Paid tribute');
      log(state, { kind: 'ancients', severity: 'info', title: `Tribute to ${def.name}`, text: calm ? `${def.name} accept the offering of the ${e.name}. Their unrest eases.` : `${def.name} accept the offering, but it is too soon after the last to calm them further.`, empires: [e.id] });
      return { message: calm ? 'Tribute accepted: pressure eased' : 'Tribute accepted' };
    }
    case 'knowledge': {
      if (atWar) return { error: 'They share nothing with an enemy' };
      if ((ps.knowledgeCooldown[e.id] ?? 0) > state.tick) return { error: `They will not speak again for ${Math.ceil((ps.knowledgeCooldown[e.id] - state.tick) / 30)} months` };
      if (!ps.sponsored[e.id] && opinion(state, ps.empireId, e.id) < KNOWLEDGE_OPINION) return { error: `They do not trust you enough (opinion ${Math.round(opinion(state, ps.empireId, e.id))}, need ${KNOWLEDGE_OPINION}, or sponsorship)` };
      if (!pay(e, { influence: KNOWLEDGE_COST })) return { error: `Requires ${KNOWLEDGE_COST} influence` };
      ps.knowledgeCooldown[e.id] = state.tick + KNOWLEDGE_COOLDOWN;
      let gained = '';
      if (id === 'automata') {
        const opts = Object.values(TECH_BY_ID).filter((t) => t.category !== 'ascension' && t.tier <= 5 && canResearch(e, t.id)).sort((a, b) => b.tier - a.tier || a.id.localeCompare(b.id));
        const t = opts[0];
        if (t) { e.research.done.push(t.id); if (e.research.current === t.id) e.research.current = null; e.research.queue = e.research.queue.filter((q) => q !== t.id); gained = `the secret of ${t.name}`; }
        else { e.research.progress += 1500; gained = '1500 research'; }
      } else {
        const amount = Math.round(techCost(e.research.current ?? 'eng_mega') * 0.6);
        e.research.progress += amount;
        e.timedMods.push({ key: 'stability', value: 3, until: state.tick + 720, label: 'Archon insight' });
        grantRelics(state, e, 1, 'A relic from the Archons');
        gained = `${amount} research and a psionic calm (+3 stability for two years)`;
      }
      const rival = activePrecursors(state).find((p) => p.id !== id);
      if (rival) addPressure(state, rival, 3, `${e.name} consorts with ${def.name}`, e.id);
      log(state, { kind: 'ancients', severity: 'good', title: `${def.name} share restricted knowledge`, text: `The ${e.name} receive ${gained}.`, empires: [e.id] });
      return { message: `Received ${gained}` };
    }
    case 'sponsor': {
      if (atWar) return { error: 'You are at war with them' };
      if (ps.sponsored[e.id]) return { error: 'They already sponsor you' };
      const other = sponsorOf(state, e.id);
      if (other) return { error: `${PRECURSORS[other.id].name} already sponsor you` };
      if (x.heaven.pledges[e.id] && x.heaven.pledges[e.id] !== id) return { error: 'You are pledged to their enemy' };
      const op = opinion(state, ps.empireId, e.id);
      if (op < SPONSOR_OPINION) return { error: `They do not favour you enough (opinion ${Math.round(op)}, need ${SPONSOR_OPINION})` };
      if (!pay(e, { influence: SPONSOR_COST })) return { error: `Requires ${SPONSOR_COST} influence` };
      ps.sponsored[e.id] = { since: state.tick, strikes: 0 };
      addMemory(state, ps.empireId, e.id, 'sponsored', 10, 0, 'Under our protection');
      const rival = activePrecursors(state).find((p) => p.id !== id);
      if (rival) addPressure(state, rival, 4, `${e.name} accepts the sponsorship of ${def.name}`, e.id);
      log(state, { kind: 'ancients', severity: 'good', title: `Sponsored by ${def.name}`, text: `The ${e.name} are now a sponsored sovereign of ${def.name}, with a seat in the High Conclave. Terms: ${def.sponsorDuty}`, empires: [] });
      return { message: 'Sponsorship granted' };
    }
    case 'renounce': {
      if (!ps.sponsored[e.id]) return { error: 'They do not sponsor you' };
      delete ps.sponsored[e.id];
      addMemory(state, ps.empireId, e.id, 'renounced', -25, 0.3, 'Renounced our sponsorship');
      log(state, { kind: 'ancients', severity: 'warn', title: `Sponsorship renounced`, text: `The ${e.name} renounce the sponsorship of ${def.name}.`, empires: [e.id] });
      return { message: 'Sponsorship renounced' };
    }
    case 'pledge': {
      const h = x.heaven;
      const war = state.wars.find((w) => w.id === h.warId);
      if (!h.active || !war) return { error: 'There is no War in Heaven' };
      if (h.pledges[e.id]) return { error: 'You have already pledged' };
      if (atWar) return { error: 'You are at war with them' };
      const side = war.attackers.includes(pe.id) ? 'attackers' : 'defenders';
      if (!joinWar(state, war, e.id, side)) return { error: 'You cannot join that side' };
      h.pledges[e.id] = id;
      h.coalition = h.coalition.filter((c) => c !== e.id);
      const sp = sponsorOf(state, e.id);
      if (sp && sp.id !== id) sp.sponsored[e.id].strikes = 1;
      addMemory(state, ps.empireId, e.id, 'pledged', 25, 0.2, 'Pledged to our cause');
      return { message: `Pledged to ${def.name}` };
    }
    case 'coalition': {
      const h = x.heaven;
      if (!h.active && !activePrecursors(state).some((p) => p.status === 'awakened')) return { error: 'There is nothing to stand against yet' };
      if (h.pledges[e.id]) return { error: 'You have pledged to a side' };
      if (h.coalition.includes(e.id)) return { error: 'Already in the coalition' };
      h.coalition.push(e.id);
      for (const o of h.coalition) if (o !== e.id) { addMemory(state, o, e.id, 'coalition', 15, 0.2, 'Stands with us in the coalition'); addMemory(state, e.id, o, 'coalition', 15, 0.2, 'Stands with us in the coalition'); }
      log(state, { kind: 'ancients', severity: 'info', title: 'The independent coalition grows', text: `The ${e.name} join the coalition of realms that will defend one another against either ancient power.`, empires: [] });
      return { message: 'Joined the independent coalition' };
    }
    case 'leave_coalition': {
      const h = x.heaven;
      if (!h.coalition.includes(e.id)) return { error: 'Not in the coalition' };
      h.coalition = h.coalition.filter((c) => c !== e.id);
      for (const o of h.coalition) addMemory(state, o, e.id, 'left_coalition', -15, 0.3, 'Abandoned the coalition');
      return { message: 'Left the coalition' };
    }
    case 'salvage': {
      const h = x.heaven;
      if (!h.active) return { error: 'Salvage is only possible while the ancients fight the War in Heaven' };
      if (systemId == null || state.galaxy.systems[systemId]?.owner !== pe.id) return { error: `Choose a system held by ${def.name}` };
      const key = `${e.id}:${systemId}`;
      if ((ps.salvaged[key] ?? 0) > state.tick) return { error: 'This system was picked clean recently' };
      const fleets = Object.values(state.fleets).filter((f) => f.systemId === systemId && f.progress === 0 && armed(f));
      if (!fleets.some((f) => f.ownerId === e.id)) return { error: 'Needs one of your warships in the system' };
      if (fleets.some((f) => f.ownerId === pe.id)) return { error: 'Their warships still guard it' };
      ps.salvaged[key] = state.tick + 720;
      e.research.progress += 400;
      e.stock.rare += 100;
      e.stock.alloys += 200;
      grantRelics(state, e, 1, `Relics salvaged at ${state.galaxy.systems[systemId].name}`);
      addReputation(state, e.id, -4);
      addMemory(state, ps.empireId, e.id, 'salvage', -30, 0.3, 'Plundered our worlds');
      addPressure(state, ps, 5, `${e.name} plunders ${state.galaxy.systems[systemId].name}`, e.id);
      log(state, { kind: 'ancients', severity: 'warn', title: `${state.galaxy.systems[systemId].name} salvaged`, text: `While ${def.name} are distracted, the ${e.name} strip their outworks: +400 research, +100 rare elements, +200 alloys.`, empires: [e.id, pe.id] });
      return { message: 'Salvage taken' };
    }
  }
  return { error: 'Unknown action' };
}

/** Systems within reach of an enclave (UI hint for intrusion). */
export function enclaveBorder(state: GameState, ps: PrecursorState): number[] {
  const adj = adjacency(state.galaxy);
  const out = new Set<number>();
  for (const s of ps.sacred) for (const v of adj[s] ?? []) if (!ps.sacred.includes(v)) out.add(v);
  return [...out];
}
