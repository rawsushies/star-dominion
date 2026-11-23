// Emergent politics: the decision layer that turns opinions, memories, treaties, reputation,
// military balance, grievances and ambitions into alliances, betrayals, coalitions, collusion,
// crisis truces and the shifting stance of the ancient powers.
//
// Nothing here is scripted. Every great realm and ancient power carries an agenda (a priority,
// interests, fears, loyalties, a rival and a vision for the Omega Incursion) recomputed monthly
// from the state of the galaxy; each ancient power keeps a regard (respect, fear, admiration) for
// every younger realm that moves with what that realm does. Overtures are weighed by one scoring
// function, `desire`, from the point of view of each party: a realm proposes what it wants and a
// partner accepts only what it wants too, with itemised reasons the player can read. The same
// function decides whether a member stays loyal to a pact, so circumstances that change can break
// what they made.
//
// Effects are mechanically real and reuse the existing systems: alliances, defence pacts and
// vassalage are ordinary treaties (so allies really join wars, vassals really follow their lord);
// compacts call members into one another's wars; collusion shifts an ancient power's blame and
// brings it, or its confederate, into the war; concords make peace through the ordinary peace
// treaty; accords between the ancients stop or end the War in Heaven. Overtures and responses go
// through execute() ({ type: 'politics' }), for AI realms, ancient powers and the player alike.
// All randomness comes from the seeded stream; caches are per tick and never saved.

import { addMemory, breakTreaty, joinWar, makePeace, opinion, signTreaty } from './diplomacy';
import { execute } from './commands';
import { jumpDistances } from './galaxy';
import { grantRelics } from './relics';
import { chance } from './rng';
import { adjacency } from './galaxy';
import { hasTreaty, warBetween } from './territory';
import { hegemon } from './victory';
import { intelLevel } from './diplomacy';
import { log } from './util';
import { refusedUltimatum, planOf, victoryAim } from './strategy';
import { addBoon, addReputation, exp, isSovereign, precursorById, precursorOfEmpire, reputation, sponsorOf } from './expansion';
import { activePrecursors, addPressure, blameShare, endHeavenByAccord, precursorEmpire, startHeavenIfRivals } from './ancients';
import { keepsTerms } from './expansionAI';
import { omegaActive } from './omega';
import { ANCIENT_GIFTS, HISTORY_MAX, HONOUR_MONTHS, OFFER_COOLDOWN, OFFER_COST, OFFER_DAYS, OFFER_LABEL, PACT_LABEL, PRIORITY_LABEL, PRIORITY_TEXT, PROPOSE_THRESHOLD } from './data/politics';
import type { Empire, GameState, War } from './types';
import type { Agenda, AgendaPriority, OfferKind, Pact, PoliticalOffer, PoliticsState, PrecursorState, Regard } from './expansionTypes';

/** compacts a realm may belong to at once (against different foes) */
const MAX_COMPACTS = 2;
/** after leaving or breaking a compact, a realm may not join one against the same foe for this long */
const REJOIN_DAYS = 360 * 3;

export interface Evaluation { accept: boolean; score: number; reasons: [string, number][] }
export interface Deal { kind: OfferKind; from: number; to: number; target: number | null; crisis?: 'omega' | 'devourer' }

export function pol(state: GameState): PoliticsState {
  return exp(state).politics;
}

// ------------------------------------------------------------------ per-tick caches (never saved)

interface TickCache { tick: number; borders: Map<number, Set<number>> | null; op: Map<string, number>; rift: { rift: number; d: Float64Array | number[] } | null }
const caches = new WeakMap<GameState, TickCache>();
function cache(state: GameState): TickCache {
  let c = caches.get(state);
  if (!c || c.tick !== state.tick) { c = { tick: state.tick, borders: null, op: new Map(), rift: null }; caches.set(state, c); }
  return c;
}

/** Do two realms share a border? (one pass over the galaxy per tick) */
export function borders(state: GameState, a: number, b: number): boolean {
  const c = cache(state);
  if (!c.borders) {
    const m = new Map<number, Set<number>>();
    const adj = adjacency(state.galaxy);
    for (const s of state.galaxy.systems) {
      if (s.owner == null) continue;
      for (const v of adj[s.id]) {
        const o = state.galaxy.systems[v].owner;
        if (o == null || o === s.owner) continue;
        let set = m.get(s.owner);
        if (!set) m.set(s.owner, (set = new Set()));
        set.add(o);
      }
    }
    c.borders = m;
  }
  return !!c.borders.get(a)?.has(b);
}

function op(state: GameState, a: number, b: number): number {
  const c = cache(state);
  const k = `${a}>${b}`;
  let v = c.op.get(k);
  if (v == null) { v = opinion(state, a, b); c.op.set(k, v); }
  return v;
}
/** opinions change within a tick when a deal is struck */
function dirty(state: GameState) { cache(state).op.clear(); }

const power = (state: GameState, id: number) => Math.max(1, state.empires[id]?.stats.militaryPower || 1);

/** Cheap contact test (the full one scans the visible galaxy). */
export function inContact(state: GameState, a: number, b: number): boolean {
  if (a === b) return true;
  const ea = state.empires[a], eb = state.empires[b];
  if (!ea?.alive || !eb?.alive) return false;
  if (warBetween(state, a, b) || borders(state, a, b)) return true;
  if (state.treaties.some((t) => (t.a === a && t.b === b) || (t.a === b && t.b === a))) return true;
  const knows = (x: Empire, y: Empire) => {
    if (y.kind === 'precursor') { const ps = precursorOfEmpire(state, y.id); return !!ps && ps.sacred.some((s) => x.explored.includes(s)); }
    return y.capitalSystemId != null && x.explored.includes(y.capitalSystemId);
  };
  // the ancients know every realm that has found them
  return knows(ea, eb) || knows(eb, ea);
}

const great = (e: Empire | undefined): boolean => !!e && e.alive && e.kind === 'major';
const ancient = (state: GameState, id: number): PrecursorState | undefined => {
  const ps = precursorOfEmpire(state, id);
  return ps && ps.status !== 'fallen' && ps.status !== 'absent' && state.empires[id]?.alive ? ps : undefined;
};

// ------------------------------------------------------------------ history

export function record(state: GameState, kind: string, title: string, text: string, actors: number[], opts: { severity?: 'info' | 'good' | 'warn' | 'danger'; notify?: number[]; secret?: boolean } = {}) {
  const p = pol(state);
  if (!opts.secret) {
    p.history.push({ id: state.nextId++, tick: state.tick, kind, title, text, actors: [...actors] });
    if (p.history.length > HISTORY_MAX) p.history.splice(0, p.history.length - HISTORY_MAX);
  }
  log(state, { kind: 'politics', severity: opts.severity ?? 'info', title, text, empires: opts.notify ?? (opts.secret ? actors : []) });
}

// ------------------------------------------------------------------ the ancients' regard

export function regardOf(state: GameState, ps: PrecursorState, id: number): Regard {
  return pol(state).regard[`${ps.id}:${id}`] ?? { respect: 20, fear: 10, admiration: 25 };
}

function regardTargets(state: GameState, ps: PrecursorState, e: Empire): Regard {
  const pe = precursorEmpire(state, ps)!;
  const ratio = power(state, e.id) / power(state, pe.id);
  const x = exp(state);
  // respect: strength, deeds against the ancient power or alongside it, and the crisis
  let respect = 25 * Math.min(2.4, ratio) + (e.era ?? 0) * 4;
  const war = warBetween(state, e.id, pe.id);
  if (war) respect += Math.max(0, (war.attackers.includes(e.id) ? war.score : -war.score)) * 0.5;
  respect += Math.min(15, (e.warsWon ?? 0) * 3);
  respect += Math.min(20, (x.omega.credit[e.id] ?? 0) / 5);
  if (x.devourer.slainBy === e.id) respect += 15;
  if (pe.capitalSystemId != null && state.galaxy.systems[pe.capitalSystemId]?.owner === e.id) respect += 30;
  // fear: strength measured against their own, the trouble the realm has caused, its reach
  let fear = 45 * Math.min(1.6, ratio) + blameShare(ps, e.id) * 30;
  fear += ps.id === 'veil' ? (e.era ?? 0) * 6 : e.research.done.includes('ai_sentient') ? 15 : 0;
  if (borders(state, e.id, pe.id)) fear += 10;
  // admiration: conduct by their own measure
  let adm = 25 + (keepsTerms(state, e, ps.id) ? 12 : -15) + (ps.sponsored[e.id] ? 20 : 0) + reputation(state, e.id) * 0.3;
  for (const m of state.opinions[`${pe.id}>${e.id}`] ?? []) adm += m.value * 0.35;
  // those who fight the ancient power's enemies earn its approval
  const foes = new Set<number>();
  for (const w of state.wars) { if (w.attackers.includes(pe.id)) w.defenders.forEach((d) => foes.add(d)); else if (w.defenders.includes(pe.id)) w.attackers.forEach((a) => foes.add(a)); }
  for (const w of state.wars) {
    const side = w.attackers.includes(e.id) ? w.defenders : w.defenders.includes(e.id) ? w.attackers : null;
    if (side && side.some((f) => foes.has(f) && f !== e.id)) { adm += 20; respect += 20; break; }
  }
  const pledge = x.heaven.pledges[e.id];
  if (pledge === ps.id) adm += 20; else if (pledge) adm -= 30;
  if (ps.id === 'veil') adm += ((e.stats.avgStability || 50) - 50) * 0.4;
  else adm += Math.min(15, (e.research.done.length - 20) * 0.5);
  if (war) adm -= 40;
  const cl = (v: number) => Math.max(0, Math.min(100, v));
  return { respect: cl(respect), fear: cl(fear), admiration: cl(adm) };
}

function updateRegard(state: GameState) {
  const p = pol(state);
  for (const ps of activePrecursors(state)) {
    for (const e of state.empires) {
      if (!great(e)) continue;
      const k = `${ps.id}:${e.id}`;
      const t = regardTargets(state, ps, e);
      const r = p.regard[k] ?? { respect: 20, fear: 10, admiration: 25 };
      const mv = (a: number, b: number) => Math.round((a + (b - a) * 0.15) * 10) / 10;
      p.regard[k] = { respect: mv(r.respect, t.respect), fear: mv(r.fear, t.fear), admiration: mv(r.admiration, t.admiration) };
    }
  }
  for (const k of Object.keys(p.regard)) { const id = +k.split(':')[1]; if (!state.empires[id]?.alive) delete p.regard[k]; }
}

/** Lines the ancients' regard adds to their opinion of a younger realm (see ancients.ts). */
export function regardLines(state: GameState, ps: PrecursorState, id: number): [string, number][] {
  const out: [string, number][] = [];
  const r = pol(state).regard[`${ps.id}:${id}`];
  if (!r) return out;
  if (r.respect >= 40) out.push(['Respects your strength', Math.round((r.respect - 40) * 0.3)]);
  const a = Math.round((r.admiration - 35) * 0.45);
  if (Math.abs(a) >= 2) out.push([a > 0 ? 'Admires your conduct' : 'Disdains your conduct', a]);
  if (r.fear >= 60) out.push(['Wary of your power', -Math.round((r.fear - 60) * 0.25)]);
  return out;
}

// ------------------------------------------------------------------ threats and fears

export function crisisActive(state: GameState, crisis: 'omega' | 'devourer'): boolean {
  if (!state.expansion) return false;
  return crisis === 'omega' ? omegaActive(state) : state.expansion.devourer.status === 'roaming';
}

/** 0..60: how directly a cosmic crisis menaces a realm. */
export function crisisThreat(state: GameState, id: number, crisis: 'omega' | 'devourer'): number {
  const x = state.expansion;
  const e = state.empires[id];
  if (!x || !e?.alive || !crisisActive(state, crisis)) return 0;
  if (crisis === 'omega') {
    const o = x.omega;
    for (const k in o.corrupted) if (state.galaxy.systems[+k]?.owner === id) return 60;
    if (o.rift == null || e.capitalSystemId == null) return 10;
    const c = cache(state);
    if (!c.rift || c.rift.rift !== o.rift) c.rift = { rift: o.rift, d: jumpDistances(state.galaxy, [o.rift], undefined, 12) };
    const d = c.rift.d[e.capitalSystemId];
    return !Number.isFinite(d) ? 10 : d <= 6 ? 40 : d <= 10 ? 25 : 12;
  }
  const dv = x.devourer;
  const near = (sid: number | null) => sid != null && (state.galaxy.systems[sid]?.owner === id || adjacency(state.galaxy)[sid]?.some((v) => state.galaxy.systems[v].owner === id));
  if (near(dv.target)) return 45;
  if (dv.trail.slice(-3).some((s) => near(s))) return 30;
  return 5;
}

/** How much `v` fears `t`, and why (0 = not at all). */
export function fearOf(state: GameState, v: number, t: number): { w: number; why: string } {
  const ev = state.empires[v], et = state.empires[t];
  if (!ev?.alive || !et?.alive || v === t) return { w: 0, why: '' };
  let w = 0;
  const why: string[] = [];
  const war = warBetween(state, v, t);
  if (war) {
    const s = war.attackers.includes(v) ? war.score : -war.score;
    w += 30 + Math.max(0, -s) * 0.4;
    why.push(s < -20 ? 'losing a war to them' : 'at war with them');
  }
  if (et.kind === 'precursor') {
    const ps = ancient(state, t);
    if (ps) {
      const share = blameShare(ps, v);
      if (ps.status === 'awakened') { w += (borders(state, v, t) ? 25 : 12) + share * 50; why.push('an awakened ancient power'); }
      else if (ps.pressure >= 50 && share >= 0.2) { w += (ps.pressure - 40) * 0.3 + share * 30; why.push('an ancient power that blames them'); }
    }
  } else if (et.kind === 'major' || et.kind === 'minor') {
    const lead = hegemon(state);
    if (lead && lead.id === t) { w += 35 * lead.fear; why.push('its bid for supremacy'); }
    if (!et.isPlayer && et.aiPlan && (et.aiPlan.goal === 'arm' || et.aiPlan.goal === 'war') && et.aiPlan.target === v) { w += 28; why.push('it arms against them'); }
    const pv = power(state, v), pt = power(state, t);
    if (borders(state, v, t) && pt > pv * 1.5) { w += Math.min(30, 12 + (pt / pv - 1.5) * 10); why.push('a far stronger neighbour'); }
    if (pol(state).pacts.some((p) => p.kind === 'collusion' && p.target === v && p.members.includes(t) && p.knownBy.includes(v))) { w += 25; why.push('it conspires with the ancients against them'); }
  } else if (et.kind === 'cosmic' && state.expansion) {
    const crisis = t === state.expansion.omega.empireId ? 'omega' : t === state.expansion.devourer.empireId ? 'devourer' : null;
    if (crisis) { const c = crisisThreat(state, v, crisis); if (c) { w += c; why.push(crisis === 'omega' ? 'the Omega Incursion' : 'the Void Devourer'); } }
  }
  return { w: Math.round(w), why: why[0] ?? '' };
}

// ------------------------------------------------------------------ agendas

function computeAgenda(state: GameState, e: Empire, prev: Agenda | undefined): Agenda {
  const fears: Agenda['fears'] = [];
  for (const o of state.empires) {
    if (!o.alive || o.id === e.id || !(o.kind === 'major' || o.kind === 'minor' || o.kind === 'precursor' || o.kind === 'cosmic')) continue;
    if (e.kind === 'precursor' && o.kind === 'minor') continue;
    const f = e.kind === 'precursor' ? ancientFear(state, e, o) : fearOf(state, e.id, o.id);
    if (f.w >= 15) fears.push({ id: o.id, weight: f.w, why: f.why });
  }
  fears.sort((a, b) => b.weight - a.weight || a.id - b.id);
  fears.splice(3);
  const loyalties = new Set<number>();
  for (const t of state.treaties) {
    if (t.type !== 'alliance' && t.type !== 'defense' && t.type !== 'vassal') continue;
    if (t.a === e.id) loyalties.add(t.b); else if (t.b === e.id) loyalties.add(t.a);
  }
  for (const p of pol(state).pacts) if (p.members.includes(e.id)) p.members.forEach((m) => m !== e.id && loyalties.add(m));
  const sp = sponsorOf(state, e.id);
  if (sp) loyalties.add(sp.empireId);
  let priority: AgendaPriority;
  const interests: Agenda['interests'] = [];
  const top = fears[0]?.weight ?? 0;
  if (e.kind === 'precursor') {
    const ps = precursorOfEmpire(state, e.id);
    const atWar = state.wars.some((w) => w.attackers.includes(e.id) || w.defenders.includes(e.id));
    priority = ps?.status === 'awakened' && atWar ? 'dominion' : 'preservation';
    interests.push({ label: ps?.id === 'veil' ? 'Keep the sacred worlds unsettled' : 'Suppress forbidden machine minds', weight: 40 });
    if (top) interests.push({ label: `Humble ${state.empires[fears[0].id].name}`, weight: top });
  } else {
    const plan = planOf(e);
    if (top >= 60) priority = 'survival';
    else if (top >= 30) priority = 'containment';
    else if (plan.goal === 'arm' || plan.goal === 'war') priority = 'conquest';
    else if (plan.goal === 'ascend' || victoryAim(e) === 'ascension') priority = 'ascension';
    else if (plan.goal === 'expand') priority = 'expansion';
    else priority = 'prosperity';
    if (fears[0]) interests.push({ label: `Security against ${state.empires[fears[0].id].name}`, weight: top });
    if (plan.target != null && state.empires[plan.target]) interests.push({ label: `Land from ${state.empires[plan.target].name}`, weight: 30 + e.personality.aggression * 30 });
    interests.push({ label: victoryAim(e) === 'ascension' ? 'Reach the final era' : victoryAim(e) === 'supremacy' ? 'Make rivals kneel' : 'Rule by conquest', weight: 25 });
    if (e.personality.mercantile > 0.5) interests.push({ label: 'Open markets', weight: Math.round(e.personality.mercantile * 30) });
    interests.sort((a, b) => b.weight - a.weight);
  }
  let rival: number | null = null;
  const plan = e.aiPlan;
  if (e.kind === 'major' && plan && (plan.goal === 'arm' || plan.goal === 'war') && plan.target != null) rival = plan.target;
  else {
    let worst = -20;
    for (const o of state.empires) {
      if (!great(o) || o.id === e.id || !inContact(state, e.id, o.id)) continue;
      const v = op(state, e.id, o.id);
      if (v < worst) { worst = v; rival = o.id; }
    }
  }
  const aim = e.kind === 'major' ? victoryAim(e) : 'domination';
  const vision: Agenda['vision'] = e.kind === 'precursor' ? 'seal' : aim === 'ascension' && e.personality.aggression > 0.5 ? 'exploit' : e.personality.aggression > 0.6 ? 'destroy' : 'seal';
  return { priority, interests: interests.slice(0, 4), fears, loyalties: [...loyalties].sort((a, b) => a - b), rival, vision, since: prev && prev.priority === priority ? prev.since : state.tick };
}

/** An ancient power's fear of a realm: its regard, and the realms it blames. */
function ancientFear(state: GameState, a: Empire, o: Empire): { w: number; why: string } {
  const ps = precursorOfEmpire(state, a.id);
  if (!ps) return { w: 0, why: '' };
  if (o.kind === 'precursor') {
    const other = ancient(state, o.id);
    if (!other || hasAccord(state)) return { w: 0, why: '' };
    return { w: warBetween(state, a.id, o.id) ? 50 : other.status === 'awakened' ? 30 : 10, why: 'the rival ancient power' };
  }
  if (o.kind === 'cosmic') return fearOf(state, a.id, o.id);
  const r = regardOf(state, ps, o.id);
  const w = Math.max(0, r.fear - 35) + blameShare(ps, o.id) * 40 + (warBetween(state, a.id, o.id) ? 25 : 0);
  return { w: Math.round(w), why: blameShare(ps, o.id) > 0.3 ? 'it disturbed their slumber' : 'its growing power' };
}

export function agendaOf(state: GameState, id: number): Agenda | undefined {
  return pol(state).agendas[id];
}

function updateAgendas(state: GameState) {
  const p = pol(state);
  const me = state.playerId;
  for (const e of state.empires) {
    if (!(great(e) || (e.kind === 'precursor' && ancient(state, e.id)))) { delete p.agendas[e.id]; continue; }
    const prev = p.agendas[e.id];
    const next = computeAgenda(state, e, prev);
    p.agendas[e.id] = next;
    // the player hears when a realm it knows turns to war, survival or the hunt for allies
    if (prev && prev.priority !== next.priority && e.id !== me && (next.priority === 'survival' || next.priority === 'containment' || next.priority === 'conquest' || next.priority === 'dominion')
      && inContact(state, me, e.id) && state.tick - (p.noticed[e.id] ?? -1e9) >= 720) {
      p.noticed[e.id] = state.tick;
      const fear = next.fears[0] ? ` It fears ${state.empires[next.fears[0].id].name} (${next.fears[0].why}).` : '';
      log(state, { kind: 'politics', severity: next.fears[0]?.id === me ? 'warn' : 'info', title: `${e.name} turns to ${PRIORITY_LABEL[next.priority].toLowerCase()}`, text: `Envoys report that ${e.name} now ${PRIORITY_TEXT[next.priority]}.${fear}`, empires: [me] });
    }
  }
}

// ------------------------------------------------------------------ pacts

export function pactsOf(state: GameState, id: number): Pact[] {
  return state.expansion ? pol(state).pacts.filter((p) => p.members.includes(id)) : [];
}

/** Realms bound to `id` by a compact or concord (they do not plan war on one another). */
export function pactPartners(state: GameState, id: number): number[] {
  if (!state.expansion) return [];
  const out = new Set<number>();
  for (const p of pol(state).pacts) if ((p.kind === 'compact' || p.kind === 'concord') && p.members.includes(id)) p.members.forEach((m) => m !== id && out.add(m));
  return [...out];
}

export function accordPact(state: GameState): Pact | undefined {
  return state.expansion ? pol(state).pacts.find((p) => p.kind === 'accord') : undefined;
}
export function hasAccord(state: GameState): boolean { return !!accordPact(state); }

/** Collusion a realm is party to with an ancient power, against a target. */
export function collusionAgainst(state: GameState, target: number): Pact[] {
  return state.expansion ? pol(state).pacts.filter((p) => p.kind === 'collusion' && p.target === target) : [];
}

function dissolve(state: GameState, pact: Pact) {
  const p = pol(state);
  p.pacts = p.pacts.filter((x) => x !== pact);
  if (pact.kind === 'accord') {
    const [a, b] = pact.members;
    if (hasTreaty(state, a, b, 'alliance')) breakTreaty(state, a, b, 'alliance', true);
    if (hasTreaty(state, a, b, 'nap')) breakTreaty(state, a, b, 'nap', true);
  }
}

const names = (state: GameState, ids: number[]) => ids.map((i) => state.empires[i]?.name ?? '?').join(', ');
const theName = (state: GameState, id: number | null | undefined) => (id != null && state.empires[id] ? state.empires[id].name : 'no one');

function principalWar(state: GameState, a: number, b: number): War | undefined {
  return state.wars.find((w) => (w.attackers[0] === a && w.defenders[0] === b) || (w.attackers[0] === b && w.defenders[0] === a));
}

/** Two realms bound together: end any war between them first (only between its principals). */
function settleWarBetween(state: GameState, a: number, b: number) {
  const w = principalWar(state, a, b);
  if (w) makePeace(state, w, 'status_quo', w.attackers[0] === a ? 'attackers' : 'defenders');
}

// ------------------------------------------------------------------ desire: one scoring function

interface Roles { ps?: PrecursorState; anc?: number; young?: number }
function roles(state: GameState, d: Deal): Roles {
  const pa = ancient(state, d.from), pb = ancient(state, d.to);
  if (pa && !pb) return { ps: pa, anc: d.from, young: d.to };
  if (pb && !pa) return { ps: pb, anc: d.to, young: d.from };
  return {};
}

/** Is the deal well formed and possible as things stand? (null = yes) */
export function validateDeal(state: GameState, d: Deal): string | null {
  const a = state.empires[d.from], b = state.empires[d.to];
  if (!a?.alive || !b?.alive) return 'That realm is gone';
  if (d.from === d.to) return 'Not with yourself';
  if (!state.expansion) return 'The expansion is not active';
  const r = roles(state, d);
  const isYoung = (e: Empire) => isSovereign(e) && e.kind !== 'rebels';
  const p = pol(state);
  switch (d.kind) {
    case 'alliance': case 'protection': case 'gift': case 'submission': case 'clientage': case 'collusion': {
      if (r.anc == null || r.young == null || !isYoung(state.empires[r.young])) return 'Only between an ancient power and a younger realm';
      if (d.kind === 'gift' && d.from !== r.anc) return 'Only an ancient power bestows its knowledge';
      const ps = r.ps!;
      // a sleeping power makes no allies and takes no clients; it may shelter, share, conspire or kneel
      if ((d.kind === 'alliance' || d.kind === 'clientage') && ps.status !== 'awakened' && ps.status !== 'watchful') return 'They slumber and take no allies or clients';
      const at = warBetween(state, r.anc, r.young);
      if (at && (d.kind === 'alliance' || d.kind === 'protection' || d.kind === 'gift' || d.kind === 'collusion')) return 'You are at war';
      if (d.kind === 'alliance' && hasTreaty(state, r.anc, r.young, 'alliance')) return 'Already allied';
      if (d.kind === 'protection' && (hasTreaty(state, r.anc, r.young, 'defense') || hasTreaty(state, r.anc, r.young, 'alliance'))) return 'Already under their protection';
      if (d.kind === 'gift' && (exp(state).boons[r.young] ?? []).some((x) => ANCIENT_GIFTS[ps.id].some((g) => g.label === x.label))) return 'They have already shared it';
      if ((d.kind === 'submission' || d.kind === 'clientage') && state.treaties.some((t) => t.type === 'vassal' && (t.b === r.anc || t.b === r.young || t.a === r.young && t.b === r.anc || t.a === r.anc && t.b === r.young))) return 'A bond of vassalage already stands';
      const pledge = exp(state).heaven.pledges[r.young];
      if ((d.kind === 'alliance' || d.kind === 'protection' || d.kind === 'clientage') && pledge && pledge !== ps.id) return 'Pledged to their enemy in the War in Heaven';
      if ((d.kind === 'alliance' || d.kind === 'protection') && p.pacts.some((x) => x.kind === 'compact' && x.target === r.anc && x.members.includes(r.young!))) return 'Leagued in a compact against them';
      if (d.kind === 'collusion') {
        if (d.target == null || d.target === r.young || d.target === r.anc) return 'Choose a realm to conspire against';
        if (p.pacts.filter((x) => x.kind === 'collusion' && x.members.includes(r.young!)).length >= 1) return 'Already party to a conspiracy';
        if (p.pacts.filter((x) => x.kind === 'collusion' && x.members.includes(r.anc!)).length >= 2) return 'They keep enough confederates';
        const t = state.empires[d.target];
        if (!t?.alive || !isYoung(t)) return 'Only against a younger realm';
        for (const tt of ['alliance', 'defense', 'vassal'] as const) if (hasTreaty(state, r.young, d.target, tt) || hasTreaty(state, r.anc, d.target, tt)) return `Bound to ${t.name} by treaty`;
        if (p.pacts.some((x) => x.kind === 'collusion' && x.target === d.target && x.members.includes(r.young!) && x.members.includes(r.anc!))) return 'Already conspiring against them';
      }
      if (!inContact(state, r.anc, r.young)) return 'No contact';
      return null;
    }
    case 'compact': case 'concord': {
      if (!isYoung(a) || !isYoung(b)) return 'Only between younger realms';
      if (!inContact(state, d.from, d.to)) return 'No contact';
      const war = warBetween(state, d.from, d.to);
      if (war && !principalWar(state, d.from, d.to)) return 'Only the leaders of a war can set it aside';
      if (d.kind === 'compact') {
        if (d.target == null || d.target === d.from || d.target === d.to) return 'Choose a common foe';
        const t = state.empires[d.target];
        if (!t?.alive || !(t.kind === 'major' || t.kind === 'minor' || (t.kind === 'precursor' && ancient(state, t.id)))) return 'Not a foe a compact can stand against';
        for (const id of [d.from, d.to]) for (const tt of ['alliance', 'defense', 'vassal'] as const) if (hasTreaty(state, id, d.target, tt)) return `${state.empires[id].name} is bound to ${t.name} by treaty`;
        if (p.pacts.some((x) => x.kind === 'compact' && x.target === d.target && x.members.includes(d.from) && x.members.includes(d.to))) return 'Already in a compact against them';
        for (const id of [d.from, d.to]) {
          if ((p.cooldown[`${id}:rejoin:${d.target}`] ?? 0) > state.tick) return `${state.empires[id].name} left such a compact too recently`;
          const n = p.pacts.filter((x) => x.kind === 'compact' && x.members.includes(id) && x.target !== d.target).length;
          if (n >= MAX_COMPACTS) return `${state.empires[id].name} is in enough compacts`;
        }
      } else {
        if (!d.crisis || !crisisActive(state, d.crisis)) return 'There is no crisis to unite against';
        if (crisisThreat(state, d.from, d.crisis) < 15 || crisisThreat(state, d.to, d.crisis) < 15) return 'The crisis does not threaten you both';
        if (p.pacts.some((x) => x.kind === 'concord' && x.crisis === d.crisis && x.members.includes(d.from) && x.members.includes(d.to))) return 'Already in a concord';
      }
      return null;
    }
    case 'accord': {
      if (!ancient(state, d.from) || !ancient(state, d.to)) return 'Only between the two ancient powers';
      if (hasAccord(state)) return 'An accord already stands';
      return null;
    }
  }
  return 'Unknown overture';
}

/** How much `actor` wants the deal to happen, with reasons (positive = wants it). */
export function desire(state: GameState, actor: number, d: Deal, check = true): Evaluation {
  const reasons: [string, number][] = [];
  const add = (label: string, v: number) => { v = Math.round(v); if (v) reasons.push([label, v]); };
  const done = (): Evaluation => { const score = reasons.reduce((s, [, v]) => s + v, 0); return { accept: score >= 0, score, reasons }; };
  const err = check ? validateDeal(state, d) : null;
  if (err) { reasons.push([err, -1000]); return done(); }
  const other = actor === d.from ? d.to : d.from;
  const e = state.empires[actor];
  const r = roles(state, d);
  const x = exp(state);
  // an AI realm planning war on the other party will not tie its hands
  if (e.kind === 'major' && !e.isPlayer && e.aiPlan && (e.aiPlan.goal === 'arm' || e.aiPlan.goal === 'war') && e.aiPlan.target === other && d.kind !== 'collusion') add(d.kind === 'concord' ? 'We meant to conquer them' : 'We have other plans for you', d.kind === 'concord' ? -20 : -60);
  const trust = (by: number, of: number) => {
    let t = reputation(state, of) * 0.15;
    for (const m of state.opinions[`${by}>${of}`] ?? []) if (m.key === 'broke_treaty' || m.key === 'untrustworthy' || m.key.startsWith('betray') || m.key === 'abandoned_pact') t += m.value * 0.3;
    return t;
  };
  switch (d.kind) {
    case 'alliance': case 'protection': {
      const ps = r.ps!;
      const full = d.kind === 'alliance';
      if (actor === r.anc) {
        const g = regardOf(state, ps, r.young!);
        add('Admires their conduct', (g.admiration - (full ? 50 : 40)) * 0.9);
        // weakness is forgiven in a loyal friend, up to a point
        add(g.respect >= (full ? 45 : 35) ? 'Respects their strength' : 'They are weak', Math.max(-10, (g.respect - (full ? 45 : 35)) * 0.4));
        add('Opinion of them', op(state, actor, other) * 0.25);
        add('They disturbed our slumber', -blameShare(ps, r.young!) * 60);
        if (sharesFoe(state, actor, other)) add('A common foe', 20);
        if (sponsorOf(state, r.young!) && sponsorOf(state, r.young!)!.id !== ps.id) add('Client of our rival', -40);
        add('Ancient pride', full ? -15 : -10);
        if (ps.status !== 'awakened') add('We do not wake for the quarrels of the young', full ? -15 : -5);
      } else {
        const ratio = power(state, r.anc!) / power(state, actor);
        add('The shield of an ancient power', ps.status === 'awakened' ? 15 + Math.min(20, ratio * 6) : ps.status === 'watchful' ? 10 + Math.min(10, ratio * 3) : 5);
        if (sharesFoe(state, actor, other)) add('A common foe', 20);
        add('Opinion of them', op(state, actor, other) * 0.3);
        const wars = state.wars.filter((w) => w.attackers.includes(r.anc!) || w.defenders.includes(r.anc!)).length;
        if (full) add('Drawn into their wars', -8 - wars * 10);
        const rival = activePrecursors(state).find((p) => p.id !== ps.id);
        if (rival && !hasAccord(state)) add('The other ancient power will resent it', -10);
        const feared = fearOf(state, actor, r.anc!).w;
        // the weak bandwagon with the power they fear; the proud resist it
        if (feared >= 20) add(e.personality.aggression < 0.5 ? 'Better beside them than before them' : 'We will not bow to fear', e.personality.aggression < 0.5 ? feared * 0.4 : -feared * 0.3);
        const agenda = agendaOf(state, actor);
        if (agenda && agenda.fears.some((f) => f.id !== r.anc && f.weight >= 30)) add('We need protection', 15);
        add('Independence', full ? -15 : -5);
      }
      break;
    }
    case 'gift': {
      const ps = r.ps!;
      if (actor === r.anc) {
        const g = regardOf(state, ps, r.young!);
        add('Admires their conduct', (g.admiration - 55) * 0.8);
        add('Opinion of them', (op(state, actor, other) - 30) * 0.5);
        add('Our secrets are not lightly given', -10);
      } else {
        add('Knowledge no younger people holds', 40);
        if (activePrecursors(state).some((p) => p.id !== ps.id) && !hasAccord(state)) add('The other ancient power will resent it', -10);
      }
      break;
    }
    case 'submission': {
      const ps = r.ps!;
      if (actor === r.anc) {
        const g = regardOf(state, ps, r.young!);
        add('Fears their power', (g.fear - 55) * 0.8);
        add('Respects their strength', (g.respect - 50) * 0.3);
        const w = warBetween(state, r.anc!, r.young!);
        if (w) add('The war is lost', Math.max(0, -(w.attackers.includes(r.anc!) ? w.score : -w.score)) * 0.8);
        if (power(state, r.anc!) < power(state, r.young!) * 0.5) add('Our hosts are broken', 25);
        const pe = state.empires[r.anc!];
        const held = ps.sacred.filter((s) => state.galaxy.systems[s]?.owner === pe.id).length;
        add('Our enclave has fallen', (1 - held / Math.max(1, ps.sacred.length)) * 40);
        add('Ancient pride', -60);
      } else {
        add('An ancient power kneels', 50);
        const wars = state.wars.filter((w) => (w.attackers.includes(r.anc!) || w.defenders.includes(r.anc!)) && !w.attackers.includes(actor) && !w.defenders.includes(actor)).length;
        add('Their enemies become our concern', -wars * 10);
      }
      break;
    }
    case 'clientage': {
      const ps = r.ps!;
      if (actor === r.anc) {
        const g = regardOf(state, ps, r.young!);
        add('A loyal instrument', 20 + (g.admiration - 30) * 0.3);
        add('They disturbed our slumber', -blameShare(ps, r.young!) * 50);
        if (power(state, r.young!) * 2 > power(state, r.anc!)) add('Too strong to trust as a client', -30);
      } else {
        const lead = hegemon(state);
        if (lead?.id === actor) { add('We bow to no one', -1000); break; }
        const agenda = agendaOf(state, actor);
        const fearOthers = agenda?.fears.filter((f) => f.id !== r.anc && state.empires[f.id]?.kind !== 'cosmic').reduce((m, f) => Math.max(m, f.weight), 0) ?? 0;
        if (fearOthers >= 40) add('Seeks their protection', (fearOthers - 20) * 0.6);
        add('Their overwhelming strength', Math.min(30, Math.max(0, (power(state, r.anc!) / power(state, actor) - 2) * 10)));
        add('Opinion of them', op(state, actor, other) * 0.3);
        if (agenda?.priority === 'survival') add('Fighting for our survival', 20);
        // a realm winning its wars does not kneel
        for (const w of state.wars) { const s2 = w.attackers.includes(actor) ? w.score : w.defenders.includes(actor) ? -w.score : null; if (s2 != null && s2 > 0) { add('We are winning our wars', -20 - s2 * 0.5); break; } }
        add('Independence', -60 - e.personality.aggression * 25);
      }
      break;
    }
    case 'collusion': {
      const ps = r.ps!;
      const t = d.target!;
      if (actor === r.anc) {
        const g = regardOf(state, ps, t);
        add(`${theName(state, t)} troubles us`, blameShare(ps, t) * 60 + Math.max(0, g.fear - 40) * 0.5);
        add('Opinion of them', op(state, actor, other) * 0.3);
        add(`Opinion of ${theName(state, t)}`, -op(state, actor, t) * 0.2);
        add('Ancient pride', -15);
      } else {
        const o = op(state, actor, t);
        add(`Grudge against ${theName(state, t)}`, Math.max(0, -o) * 0.5);
        if (e.aiPlan && (e.aiPlan.goal === 'arm' || e.aiPlan.goal === 'war') && e.aiPlan.target === t) add('We mean to fight them', 20);
        add(`Fear of ${theName(state, t)}`, fearOf(state, actor, t).w * 0.4);
        add('Ancient backing', 12);
        add('The risk of exposure', -10 - e.personality.diplomacy * 25);
        if (hasTreaty(state, actor, t, 'nap')) add('A pact with them', -15);
      }
      break;
    }
    case 'compact': {
      const t = d.target!;
      const f = fearOf(state, actor, t);
      add(`Threat of ${theName(state, t)}`, Math.min(50, f.w));
      if (f.w >= 40) add('The enemy of our enemy', 10);
      add('Their strength against it', Math.min(25, 20 * power(state, other) / power(state, t)));
      add('Opinion of them', op(state, actor, other) * 0.3);
      add('Trust', trust(actor, other));
      if (warBetween(state, actor, other)) { add('Our war with them would end', -15 + e.warExhaustion * 0.3); }
      else if (!warBetween(state, actor, t) && (warBetween(state, other, t) || pol(state).pacts.some((x) => x.kind === 'compact' && x.target === t && x.members.includes(other) && x.members.some((m) => warBetween(state, m, t))))) {
        const busy = state.wars.filter((w) => w.attackers.includes(actor) || w.defenders.includes(actor)).length;
        add('We would be drawn into their war', -10 - e.warExhaustion * 0.5 - busy * 10 + (power(state, actor) + power(state, other) > power(state, t) * 1.2 ? 10 : 0));
      }
      if (state.empires[t]?.kind === 'precursor') { const ps = ancient(state, t)!; if (sponsorOf(state, actor)?.id === ps.id) add('They sponsor us', -40); }
      if (pol(state).pacts.some((p) => p.kind === 'collusion' && p.target === other && p.members.includes(actor))) add('We conspire against them', -40);
      add('Entanglement', -15);
      break;
    }
    case 'concord': {
      const c = d.crisis!;
      add('The crisis', crisisThreat(state, actor, c));
      add('Opinion of them', op(state, actor, other) * 0.2);
      const w = warBetween(state, actor, other);
      if (w) {
        const mine = w.attackers.includes(actor) ? w.score : -w.score;
        add(mine > 0 ? 'We are winning our war' : 'Our war goes badly', -mine * 0.6);
        add('War weariness', e.warExhaustion * 0.3);
      }
      add('Old grievances', -10);
      break;
    }
    case 'accord': {
      const ct = commonThreat(state);
      add('A common threat', ct.w);
      const h = x.heaven;
      const w = warBetween(state, d.from, d.to);
      if (w) {
        add('Weary of the War in Heaven', Math.min(40, ((state.tick - (h.startTick ?? w.startTick)) / 360) * 8));
        const mine = w.attackers.includes(actor) ? w.score : -w.score;
        add(mine > 0 ? 'We are winning the War in Heaven' : 'The War in Heaven goes against us', -mine * 0.5);
      }
      add('Ancient enmity', -30);
      add('Opinion of them', op(state, actor, other) * 0.2);
      break;
    }
  }
  return done();
}

/** Do two realms fight, or fear, the same enemy? */
function sharesFoe(state: GameState, a: number, b: number): boolean {
  for (const w of state.wars) {
    const fa = w.attackers.includes(a) ? w.defenders : w.defenders.includes(a) ? w.attackers : null;
    if (!fa) continue;
    for (const w2 of state.wars) {
      const fb = w2.attackers.includes(b) ? w2.defenders : w2.defenders.includes(b) ? w2.attackers : null;
      if (fb && fb.some((f) => fa.includes(f) && f !== a && f !== b)) return true;
    }
  }
  const fa = agendaOf(state, a)?.fears ?? [], fb = agendaOf(state, b)?.fears ?? [];
  return fa.some((f) => f.weight >= 30 && f.id !== b && fb.some((g) => g.id === f.id && g.weight >= 30));
}

/** What could drive the two ancient powers together, and how strongly (0..70). */
export function commonThreat(state: GameState): { w: number; why: string } {
  const [v, a] = [precursorById(state, 'veil'), precursorById(state, 'automata')];
  if (!v || !a || !ancient(state, v.empireId) || !ancient(state, a.empireId)) return { w: 0, why: '' };
  let w = 0;
  let why = '';
  if (omegaActive(state)) { w += 45; why = 'the Omega Incursion'; }
  if (state.expansion?.devourer.status === 'roaming') { w += 10; why ||= 'the Void Devourer'; }
  // a younger realm both blame, or both fear
  let best = 0, who = -1;
  for (const e of state.empires) {
    if (!great(e)) continue;
    const s = Math.min(blameShare(v, e.id), blameShare(a, e.id)) * 60 + Math.max(0, Math.min(regardOf(state, v, e.id).fear, regardOf(state, a, e.id).fear) - 55);
    if (s > best) { best = s; who = e.id; }
  }
  if (best > 0) { w += best; if (!why || best > 20) why = `the rise of ${state.empires[who].name}`; }
  // a compact of younger realms leagued against either of them
  const leagued = pol(state).pacts.filter((p) => p.kind === 'compact' && (p.target === v.empireId || p.target === a.empireId)).reduce((s, p) => s + p.members.reduce((m, id) => m + power(state, id), 0), 0);
  if (leagued > 0) { const s = Math.min(25, leagued / Math.max(1, power(state, v.empireId) + power(state, a.empireId)) * 25); w += s; if (!why) why = 'a league of younger realms'; }
  return { w: Math.round(Math.min(70, w)), why };
}

// ------------------------------------------------------------------ overtures (the command layer)

export function cooldownKey(d: Deal) { return `${d.from}:${d.kind}:${d.to}`; }

/** Make an overture (execute(): { type: 'politics', action: 'propose' }). */
export function proposeDeal(state: GameState, e: Empire, d: Deal): { error?: string; message?: string; evaluation?: Evaluation } {
  if (d.from !== e.id) return { error: 'Not your overture' };
  const err = validateDeal(state, d);
  if (err) return { error: err };
  const p = pol(state);
  const cost = state.empires[d.from].kind === 'precursor' ? 0 : OFFER_COST[d.kind];
  if (e.stock.influence < cost) return { error: `Requires ${cost} influence` };
  if ((p.cooldown[cooldownKey(d)] ?? 0) > state.tick) return { error: `They will not hear the same proposal again for ${Math.ceil((p.cooldown[cooldownKey(d)] - state.tick) / 30)} months` };
  const to = state.empires[d.to];
  if (to.isPlayer) {
    if (p.offers.some((o) => o.from === d.from && o.to === d.to && o.kind === d.kind)) return { error: 'An offer is already waiting' };
    const motives = desire(state, d.from, d);
    const offer: PoliticalOffer = { id: state.nextId++, kind: d.kind, from: d.from, to: d.to, target: d.target, crisis: d.crisis, tick: state.tick, expires: state.tick + OFFER_DAYS, motives: motives.reasons, text: offerText(state, d) };
    p.offers.push(offer);
    log(state, { kind: 'politics', severity: d.kind === 'collusion' || d.kind === 'clientage' ? 'warn' : 'info', title: `${e.name}: ${OFFER_LABEL[d.kind].toLowerCase()}`, text: `${offer.text} Answer in Diplomacy within ${Math.round(OFFER_DAYS / 30)} months.`, empires: [d.to] });
    return { message: 'Overture sent' };
  }
  const ev = desire(state, d.to, d);
  if (!ev.accept) {
    p.cooldown[cooldownKey(d)] = state.tick + OFFER_COOLDOWN;
    return { error: `${to.name} decline`, evaluation: ev };
  }
  enact(state, d);
  return { message: `${to.name} agree`, evaluation: ev };
}

export function respondOffer(state: GameState, e: Empire, offerId: number, accept: boolean): { error?: string; message?: string } {
  const p = pol(state);
  const o = p.offers.find((x) => x.id === offerId && x.to === e.id);
  if (!o) return { error: 'That overture has lapsed' };
  p.offers = p.offers.filter((x) => x !== o);
  const d: Deal = { kind: o.kind, from: o.from, to: o.to, target: o.target, crisis: o.crisis };
  if (!accept) {
    p.cooldown[cooldownKey(d)] = state.tick + OFFER_COOLDOWN;
    if (state.empires[o.from]?.alive) addMemory(state, o.from, e.id, 'rebuffed', -8, 0.3, 'Rebuffed our overture');
    if (ancient(state, o.from) && (o.kind === 'alliance' || o.kind === 'gift' || o.kind === 'protection')) record(state, 'refused', `${e.name} refuse ${state.empires[o.from].name}`, `The ${e.name} turn down the ${OFFER_LABEL[o.kind].toLowerCase()} offered by ${state.empires[o.from].name}.`, [e.id, o.from]);
    return { message: 'Declined' };
  }
  const err = validateDeal(state, d);
  if (err) return { error: err };
  const cost = state.empires[d.from].kind === 'precursor' ? 0 : OFFER_COST[d.kind];
  if (state.empires[d.from].stock.influence < cost) return { error: `${state.empires[d.from].name} can no longer afford it` };
  enact(state, d);
  return { message: 'Agreed' };
}

function offerText(state: GameState, d: Deal): string {
  const f = theName(state, d.from), t = theName(state, d.target);
  switch (d.kind) {
    case 'alliance': return `${f} offer an alliance: each will join the other's wars.`;
    case 'protection': return `${f} offer a mutual defence pact: an attack on one is an attack on both.`;
    case 'gift': return `${f} offer to share an exclusive technology (${ANCIENT_GIFTS[ancient(state, d.from)!.id].map((b) => b.label).join(', ')}). The other ancient power will resent it.`;
    case 'submission': return ancient(state, d.from) ? `${f} offer to submit as your vassal. An ancient power would follow you to war.` : `${f} demand that you submit to them as their vassal.`;
    case 'clientage': return ancient(state, d.from) ? `${f} demand that you become their client: their vassal and military partner, under their protection.` : `${f} offer to become your client and vassal.`;
    case 'compact': return `${f} propose a compact against ${t}: members join one another's wars against them and set aside their own quarrels.${warBetween(state, d.from, d.to) ? ' Your war with them would end in a white peace.' : ''}`;
    case 'collusion': return `${f} propose a secret collusion against ${t}. If it comes to light, the galaxy will not forgive it.`;
    case 'concord': return `${f} propose a concord against ${d.crisis === 'omega' ? 'the Omega Incursion' : 'the Void Devourer'}: ${warBetween(state, d.from, d.to) ? 'your war ends in a white peace, and ' : ''}neither will strike the other until the crisis is over.`;
    case 'accord': return `${f} propose an accord between the ancient powers.`;
  }
}

/** Carry out an agreed deal. */
function enact(state: GameState, d: Deal) {
  const p = pol(state);
  const from = state.empires[d.from], to = state.empires[d.to];
  if (from.kind !== 'precursor') from.stock.influence -= OFFER_COST[d.kind];
  delete p.cooldown[cooldownKey(d)];
  const r = roles(state, d);
  const x = exp(state);
  switch (d.kind) {
    case 'alliance': case 'protection': {
      const ps = r.ps!;
      signTreaty(state, r.anc!, r.young!, d.kind === 'alliance' ? 'alliance' : 'defense');
      addMemory(state, r.anc!, r.young!, 'ancient_bond', 15, 0.1, d.kind === 'alliance' ? 'Our ally' : 'Under our protection');
      addMemory(state, r.young!, r.anc!, 'ancient_bond', 15, 0.1, d.kind === 'alliance' ? 'Our ancient ally' : 'Our protector');
      const rival = activePrecursors(state).find((q) => q.id !== ps.id);
      if (rival && !hasAccord(state)) addPressure(state, rival, 4, `${state.empires[r.young!].name} allies with ${state.empires[r.anc!].name}`, r.young!);
      record(state, d.kind, `${state.empires[r.young!].name} and ${state.empires[r.anc!].name}: ${d.kind === 'alliance' ? 'an alliance' : 'a pact of protection'}`, `An ancient power binds itself to a younger realm. ${d.kind === 'alliance' ? 'Each will join the other\'s wars.' : 'An attack on either is an attack on both.'}`, [r.young!, r.anc!], { severity: r.young === state.playerId ? 'good' : 'warn' });
      break;
    }
    case 'gift': {
      const ps = r.ps!;
      for (const b of ANCIENT_GIFTS[ps.id]) addBoon(state, r.young!, b);
      addMemory(state, r.anc!, r.young!, 'shared_secrets', 10, 0.1, 'Shared our secrets');
      const rival = activePrecursors(state).find((q) => q.id !== ps.id);
      if (rival && !hasAccord(state)) addPressure(state, rival, 6, `${state.empires[r.young!].name} receives the secrets of ${state.empires[r.anc!].name}`, r.young!);
      record(state, 'gift', `${state.empires[r.anc!].name} share their secrets`, `The ${state.empires[r.young!].name} receive ${ANCIENT_GIFTS[ps.id].map((b) => b.label).join(' and ')}, knowledge no other younger people holds.`, [r.young!, r.anc!], { severity: 'good' });
      break;
    }
    case 'submission': {
      signTreaty(state, r.young!, r.anc!, 'vassal');
      addReputation(state, r.young!, 10);
      grantRelics(state, state.empires[r.young!], 2, `The submission of ${state.empires[r.anc!].name}`);
      record(state, 'submission', `${state.empires[r.anc!].name} kneel to the ${state.empires[r.young!].name}`, `An ancient power, older than the hyperlanes, swears fealty to a younger realm. Its hosts now follow the ${state.empires[r.young!].name} to war.`, [r.young!, r.anc!], { severity: 'danger' });
      break;
    }
    case 'clientage': {
      const ps = r.ps!;
      signTreaty(state, r.anc!, r.young!, 'vassal');
      ps.blame[r.young!] = 0;
      addMemory(state, r.anc!, r.young!, 'client', 20, 0.1, 'Our client');
      record(state, 'clientage', `The ${state.empires[r.young!].name} become clients of ${state.empires[r.anc!].name}`, `The ${state.empires[r.young!].name} kneel to an ancient power and will march in its wars, under its protection.`, [r.young!, r.anc!], { severity: 'warn' });
      break;
    }
    case 'compact': {
      settleWarBetween(state, d.from, d.to);
      let pact = p.pacts.find((x) => x.kind === 'compact' && x.target === d.target && (x.members.includes(d.from) || x.members.includes(d.to)));
      if (pact) { for (const id of [d.from, d.to]) if (!pact.members.includes(id)) { pact.members.push(id); pact.fighting[id] = !!warBetween(state, id, d.target!); } }
      else {
        pact = { id: state.nextId++, kind: 'compact', members: [d.from, d.to], target: d.target, secret: false, knownBy: [], founded: state.tick, fighting: { [d.from]: !!warBetween(state, d.from, d.target!), [d.to]: !!warBetween(state, d.to, d.target!) }, strain: 0, reason: agendaOf(state, d.from)?.fears.find((f) => f.id === d.target)?.why ?? '' };
        p.pacts.push(pact);
      }
      for (const a of pact.members) for (const b of pact.members) if (a !== b) addMemory(state, a, b, `compact_${pact.id}`, 15, 0.1, `Stands with us against ${theName(state, d.target)}`);
      for (const m of [d.from, d.to]) addMemory(state, d.target!, m, 'leagued', -15, 0.3, 'Leagued against us');
      const formerFoes = !!(state.opinions[`${d.from}>${d.to}`] ?? []).find((m) => m.key === 'declared_war' || m.key === 'joined_war');
      record(state, 'compact', `A compact against ${theName(state, d.target)}`, `${names(state, pact.members)} stand together against ${theName(state, d.target)}${formerFoes ? ', former enemies made allies by a greater fear' : ''}.`, [...pact.members, d.target!], { severity: d.target === state.playerId ? 'danger' : 'info' });
      honourCompact(state, pact);
      break;
    }
    case 'collusion': {
      const pact: Pact = { id: state.nextId++, kind: 'collusion', members: [r.young!, r.anc!], target: d.target, secret: true, knownBy: [r.young!, r.anc!], founded: state.tick, fighting: {}, strain: 0, reason: '' };
      p.pacts.push(pact);
      addMemory(state, r.anc!, r.young!, 'confederate', 15, 0.1, 'Our confederate');
      record(state, 'collusion', `A secret pact against ${theName(state, d.target)}`, `The ${state.empires[r.young!].name} and ${state.empires[r.anc!].name} conspire against the ${theName(state, d.target)}. No one else knows.`, [r.young!, r.anc!], { secret: true, severity: 'warn' });
      break;
    }
    case 'concord': {
      settleWarBetween(state, d.from, d.to);
      let pact = p.pacts.find((x) => x.kind === 'concord' && x.crisis === d.crisis && (x.members.includes(d.from) || x.members.includes(d.to)));
      if (pact) { for (const id of [d.from, d.to]) if (!pact.members.includes(id)) pact.members.push(id); }
      else { pact = { id: state.nextId++, kind: 'concord', members: [d.from, d.to], target: null, crisis: d.crisis, secret: false, knownBy: [], founded: state.tick, fighting: {}, strain: 0, reason: '' }; p.pacts.push(pact); }
      for (const a of [d.from, d.to]) for (const b of pact.members) if (a !== b) { addMemory(state, a, b, 'concord', 10, 0.1, 'Stands with us against the crisis'); addMemory(state, b, a, 'concord', 10, 0.1, 'Stands with us against the crisis'); }
      const crisisName = d.crisis === 'omega' ? 'the Omega Incursion' : 'the Void Devourer';
      record(state, 'concord', `A concord against ${crisisName}`, `${names(state, pact.members)} set their quarrels aside until ${crisisName} is ended.`, pact.members, { severity: 'good' });
      break;
    }
    case 'accord': {
      const w = warBetween(state, d.from, d.to);
      const ct = commonThreat(state);
      const depth: 'truce' | 'alliance' = ct.w >= 45 ? 'alliance' : 'truce';
      if (w) { makePeace(state, w, 'status_quo', w.attackers[0] === d.from ? 'attackers' : 'defenders'); endHeavenByAccord(state); }
      signTreaty(state, d.from, d.to, 'nap');
      if (depth === 'alliance') signTreaty(state, d.from, d.to, 'alliance');
      p.pacts.push({ id: state.nextId++, kind: 'accord', members: [d.from, d.to], target: null, depth, secret: false, knownBy: [], founded: state.tick, fighting: {}, strain: 0, reason: ct.why });
      record(state, 'accord', depth === 'alliance' ? 'The ancient powers ally' : 'The ancient powers make peace', `${from.name} and ${to.name} set aside an enmity older than the hyperlanes${ct.why ? `, drawn together by ${ct.why}` : ''}.${w ? ' The War in Heaven is over.' : ''}`, [d.from, d.to], { severity: 'danger' });
      break;
    }
  }
  dirty(state);
  void x;
}

// ------------------------------------------------------------------ actions on pacts

export type PoliticsAction = 'leave' | 'honour' | 'expose' | 'confront' | 'mediate' | 'sow_discord';
export const POLITICS_COST = { expose: 20, mediate: 30, sow_discord: 40 };

export function politicsAction(state: GameState, e: Empire, action: PoliticsAction, pactId?: number): { error?: string; message?: string; evaluation?: Evaluation } {
  const p = pol(state);
  const pact = pactId != null ? p.pacts.find((x) => x.id === pactId) : undefined;
  switch (action) {
    case 'leave': {
      if (!pact || !pact.members.includes(e.id) || pact.kind === 'accord') return { error: 'Not a member of that pact' };
      leavePact(state, pact, e.id, 'left');
      return { message: 'You have left the pact' };
    }
    case 'honour': {
      if (!pact || !pact.members.includes(e.id) || (pact.kind !== 'compact' && pact.kind !== 'collusion') || pact.target == null) return { error: 'Not a member of that pact' };
      if (warBetween(state, e.id, pact.target)) return { error: 'You are already at war with them' };
      const war = pactWar(state, pact, e.id);
      if (!war) return { error: 'No partner is at war with them' };
      const side = war.attackers.includes(pact.target) ? 'defenders' : 'attackers';
      if (!joinWar(state, war, e.id, side)) return { error: 'You cannot join that war' };
      pact.fighting[e.id] = true;
      if (pact.kind === 'collusion' && pact.secret) reveal(state, pact, 'by going to war beside its confederate');
      record(state, 'honour', `${e.name} honour the ${PACT_LABEL[pact.kind].toLowerCase()}`, `The ${e.name} go to war against the ${theName(state, pact.target)} beside their partners.`, [...pact.members, pact.target]);
      return { message: 'You join the war' };
    }
    case 'expose': {
      if (!pact || pact.kind !== 'collusion' || !pact.knownBy.includes(e.id) || pact.members.includes(e.id)) return { error: 'You know of no such conspiracy' };
      if (!pact.secret) return { error: 'It is already known' };
      if (e.stock.influence < POLITICS_COST.expose) return { error: `Requires ${POLITICS_COST.expose} influence` };
      e.stock.influence -= POLITICS_COST.expose;
      exposeCollusion(state, pact, e.id);
      return { message: 'The conspiracy is exposed' };
    }
    case 'confront': {
      if (!pact || pact.kind !== 'collusion' || pact.target !== e.id || !pact.knownBy.includes(e.id)) return { error: 'You know of no conspiracy against you' };
      const young = pact.members.find((m) => !ancient(state, m))!;
      const ev = confrontEval(state, young, e.id);
      if (ev.accept) {
        dissolve(state, pact);
        addMemory(state, e.id, young, 'backed_down', 10, 0.3, 'Ended its conspiracy when confronted');
        addMemory(state, pact.members.find((m) => m !== young)!, young, 'abandoned_pact', -20, 0.3, 'Abandoned our pact');
        record(state, 'confront', `${state.empires[young].name} back down`, `Confronted by the ${e.name}, the ${state.empires[young].name} end their conspiracy with the ancients.`, [young, e.id, ...pact.members]);
        return { message: `${state.empires[young].name} end the conspiracy`, evaluation: ev };
      }
      addMemory(state, e.id, young, 'defied', -20, 0.3, 'Defied us when confronted');
      addMemory(state, young, e.id, 'threatened', -10, 0.3, 'Threatened us');
      record(state, 'confront', `${state.empires[young].name} defy the ${e.name}`, `Confronted with proof of their conspiracy, the ${state.empires[young].name} refuse to end it.`, [young, e.id], { notify: [young, e.id, state.playerId] });
      return { error: `${state.empires[young].name} refuse`, evaluation: ev };
    }
    case 'mediate': {
      const [v, a] = activePrecursors(state);
      if (!v || !a) return { error: 'Two ancient powers must be awake in the galaxy to mediate between them' };
      if (hasAccord(state)) return { error: 'An accord already stands between them' };
      if (!isSovereign(e)) return { error: 'Only a sovereign realm may mediate' };
      if (e.stock.influence < POLITICS_COST.mediate) return { error: `Requires ${POLITICS_COST.mediate} influence` };
      const d: Deal = { kind: 'accord', from: v.empireId, to: a.empireId, target: null };
      const evs = [desire(state, v.empireId, d), desire(state, a.empireId, d)];
      const reasons: [string, number][] = [];
      let ok = true;
      for (const [i, ps] of [v, a].entries()) {
        const trust = Math.round(op(state, ps.empireId, e.id) * 0.4 + (regardOf(state, ps, e.id).admiration - 35) * 0.4);
        const score = evs[i].score + trust + 15;
        reasons.push([`${state.empires[ps.empireId].name} (trust in the mediator ${trust >= 0 ? '+' : ''}${trust})`, score]);
        if (score < 0) ok = false;
      }
      e.stock.influence -= POLITICS_COST.mediate;
      const ev = { accept: ok, score: Math.min(...reasons.map(([, s]) => s)), reasons };
      if (!ok) {
        record(state, 'mediation', `${e.name} fail to reconcile the ancients`, 'The ancient powers will not be reconciled.', [e.id, v.empireId, a.empireId], { notify: [e.id] });
        return { error: 'The ancients will not be reconciled', evaluation: ev };
      }
      enact(state, d);
      addReputation(state, e.id, 8);
      for (const ps of [v, a]) { addMemory(state, ps.empireId, e.id, 'mediator', 15, 0.1, 'Brokered our peace'); const g = pol(state).regard[`${ps.id}:${e.id}`]; if (g) g.admiration = Math.min(100, g.admiration + 10); }
      record(state, 'mediation', `${e.name} broker peace between the ancients`, `Through the ${e.name}'s envoys the ancient powers come to terms.`, [e.id, v.empireId, a.empireId], { severity: 'good' });
      return { message: 'The ancients come to terms', evaluation: ev };
    }
    case 'sow_discord': {
      const acc = accordPact(state);
      if (!acc) return { error: 'There is no accord between the ancients to break' };
      if (acc.members.includes(e.id)) return { error: 'You are party to it' };
      if (e.stock.influence < POLITICS_COST.sow_discord) return { error: `Requires ${POLITICS_COST.sow_discord} influence` };
      e.stock.influence -= POLITICS_COST.sow_discord;
      // the better a realm's envoys know the ancients, the subtler its lies
      const knowledge = Math.max(...acc.members.map((m) => intelLevel(state, e.id, m)));
      if (chance(state.rng, Math.min(0.85, 0.4 + knowledge / 250))) {
        acc.strain = Math.min(100, acc.strain + 45);
        record(state, 'discord', 'Discord sown between the ancients', `The ${e.name}'s agents feed each ancient power proof of the other's treachery. The accord is strained (${Math.round(acc.strain)} of 100).`, [e.id], { secret: true, notify: [e.id] });
        return { message: 'Discord sown' };
      }
      for (const m of acc.members) {
        addMemory(state, m, e.id, 'sowed_discord', -30, 0.2, 'Sowed discord between us');
        const ps = ancient(state, m);
        if (ps) addPressure(state, ps, 8, `${e.name} sowed discord between the ancients`, e.id);
      }
      acc.strain = Math.max(0, acc.strain - 15);
      record(state, 'discord', `${e.name} caught sowing discord`, `The ancient powers uncover the ${e.name}'s lies, and draw closer for it.`, [e.id, ...acc.members], { severity: 'danger' });
      return { error: 'Your agents were caught' };
    }
  }
  return { error: 'Unknown action' };
}

function confrontEval(state: GameState, young: number, target: number): Evaluation {
  const reasons: [string, number][] = [];
  const ratio = power(state, target) / power(state, young);
  reasons.push(['Fear of your fleets', Math.round(Math.min(40, (ratio - 0.8) * 25))]);
  reasons.push(['Opinion of you', Math.round(op(state, young, target) * 0.3)]);
  reasons.push(['Pride', -Math.round(10 + state.empires[young].personality.aggression * 20)]);
  if (borders(state, young, target)) reasons.push(['You are at our border', 8]);
  const score = reasons.reduce((s, [, v]) => s + v, 0);
  return { accept: score >= 0, score, reasons };
}

function leavePact(state: GameState, pact: Pact, id: number, why: 'left' | 'abandoned' | 'separate_peace') {
  pact.members = pact.members.filter((m) => m !== id);
  if (pact.target != null) pol(state).cooldown[`${id}:rejoin:${pact.target}`] = state.tick + REJOIN_DAYS;
  delete pact.fighting[id];
  for (const m of pact.members) addMemory(state, m, id, 'abandoned_pact', why === 'left' ? -15 : -25, 0.3, why === 'separate_peace' ? 'Made a separate peace' : 'Abandoned our pact');
  const label = PACT_LABEL[pact.kind].toLowerCase();
  if (pact.kind === 'collusion') {
    dissolve(state, pact);
    record(state, 'leave', `${state.empires[id].name} end a secret pact`, `The ${state.empires[id].name} walk away from their conspiracy.`, [id, ...pact.members], { secret: pact.secret });
    return;
  }
  record(state, 'leave', `${state.empires[id].name} ${why === 'left' ? 'leave' : 'abandon'} the ${label}${pact.target != null ? ` against ${theName(state, pact.target)}` : ''}`, why === 'separate_peace' ? `The ${state.empires[id].name} made a separate peace and left their partners to fight on.` : `The ${state.empires[id].name} no longer stand with ${names(state, pact.members)}.`, [id, ...pact.members], { severity: pact.members.includes(state.playerId) || id === state.playerId ? 'warn' : 'info' });
  if (pact.members.length < 2) dissolve(state, pact);
}

function pactWar(state: GameState, pact: Pact, except: number): War | undefined {
  if (pact.target == null) return undefined;
  return state.wars.find((w) => {
    const foes = w.attackers.includes(pact.target!) ? w.defenders : w.defenders.includes(pact.target!) ? w.attackers : null;
    return !!foes && foes.some((m) => m !== except && pact.members.includes(m));
  });
}

function reveal(state: GameState, pact: Pact, how: string) {
  if (!pact.secret) return;
  pact.secret = false;
  const young = pact.members.find((m) => !ancient(state, m))!;
  const anc = pact.members.find((m) => m !== young)!;
  for (const e of state.empires) if (great(e) && !pact.members.includes(e.id)) { if (!pact.knownBy.includes(e.id)) pact.knownBy.push(e.id); addMemory(state, e.id, young, 'conspired', e.id === pact.target ? -40 : -12, 0.2, 'Conspired with the ancients'); }
  addReputation(state, young, -12);
  record(state, 'collusion', `A conspiracy revealed`, `The ${state.empires[young].name} have been conspiring with ${state.empires[anc].name} against the ${theName(state, pact.target)} since ${Math.floor(pact.founded / 360) + 1}. It came to light ${how}.`, [young, anc, pact.target!], { severity: 'danger' });
}

function exposeCollusion(state: GameState, pact: Pact, by: number) {
  const young = pact.members.find((m) => !ancient(state, m))!;
  reveal(state, pact, `when the ${state.empires[by].name} laid the proof before the galaxy`);
  addReputation(state, young, -8);
  addReputation(state, by, 4);
  // shamed, the conspirator weighs whether the pact is still worth it
  if (!state.empires[young].isPlayer) {
    const d: Deal = { kind: 'collusion', from: young, to: pact.members.find((m) => m !== young)!, target: pact.target };
    const ev = desire(state, young, d, false);
    if (ev.score - 20 < 0 && pol(state).pacts.includes(pact)) leavePact(state, pact, young, 'left');
  }
}

// ------------------------------------------------------------------ monthly upkeep

function honourCompact(state: GameState, pact: Pact) {
  if (pact.target == null) return;
  for (const m of [...pact.members].sort((a, b) => a - b)) {
    if (!pol(state).pacts.includes(pact)) return;
    if (warBetween(state, m, pact.target)) continue;
    const war = pactWar(state, pact, m);
    if (!war) continue;
    const e = state.empires[m];
    if (e.isPlayer) continue; // the player is called on in the monthly upkeep and decides
    // honour weighed against the cost of the war
    const d: Deal = { kind: pact.kind === 'compact' ? 'compact' : 'collusion', from: m, to: pact.members.find((x) => x !== m)!, target: pact.target };
    const score = desire(state, m, d, false).score + 20 - e.warExhaustion * 0.5;
    const side = war.attackers.includes(pact.target) ? 'defenders' : 'attackers';
    // a realm bound by vassalage to the other side cannot answer, and is not blamed for it
    const foes = side === 'attackers' ? war.defenders : war.attackers;
    if (foes.some((f) => state.treaties.some((t) => t.type === 'vassal' && ((t.a === f && t.b === m) || (t.a === m && t.b === f))))) continue;
    if (score >= 0 && joinWar(state, war, m, side)) {
      pact.fighting[m] = true;
      if (pact.kind === 'collusion') reveal(state, pact, `when the ${e.name} went to war beside ${state.empires[pact.members.find((x) => x !== m)!].name}`);
      else record(state, 'honour', `${e.name} honour the compact`, `The ${e.name} join the war against the ${theName(state, pact.target)} beside ${names(state, pact.members.filter((x) => x !== m))}.`, [...pact.members, pact.target]);
    } else if (pact.kind === 'compact') leavePact(state, pact, m, 'abandoned');
  }
}

function upkeepCompact(state: GameState, pact: Pact) {
  const t = pact.target!;
  const te = state.empires[t];
  if (!te?.alive || (te.kind === 'precursor' && !ancient(state, t))) {
    dissolve(state, pact);
    record(state, 'compact_end', `The compact against ${te?.name ?? 'a fallen foe'} has served its purpose`, `${names(state, pact.members)} part ways; their common foe is no more.`, pact.members);
    return;
  }
  // betrayal: members at war with one another
  for (const a of pact.members) for (const b of pact.members) {
    if (a >= b) continue;
    const w = warBetween(state, a, b);
    if (!w) continue;
    const traitor = w.attackers.includes(a) && w.defenders.includes(b) ? a : b;
    betray(state, pact, traitor);
    return;
  }
  // a separate peace leaves the partners to fight alone
  const fightingNow = (id: number) => !!warBetween(state, id, t);
  const anyFighting = pact.members.some(fightingNow);
  for (const m of [...pact.members]) {
    const was = !!pact.fighting[m];
    const now = fightingNow(m);
    if (was && !now && anyFighting && pact.members.some((o) => o !== m && fightingNow(o))) { pact.strain += 35; leavePact(state, pact, m, 'separate_peace'); if (!pol(state).pacts.includes(pact)) return; continue; }
    pact.fighting[m] = now;
  }
  // a partner at war calls the others in
  honourCompact(state, pact);
  if (!pol(state).pacts.includes(pact)) return;
  // the player is called on and must answer
  const me = state.playerId;
  if (pact.members.includes(me) && !fightingNow(me) && pactWar(state, pact, me)) {
    const k = `honour:${pact.id}`;
    const months = (pol(state).cooldown[k] ?? 0) + 1;
    pol(state).cooldown[k] = months;
    if (months > HONOUR_MONTHS) { delete pol(state).cooldown[k]; leavePact(state, pact, me, 'abandoned'); return; }
    log(state, { kind: 'politics', severity: 'warn', title: `The compact calls on you (${months} of ${HONOUR_MONTHS})`, text: `Your partners are at war with the ${te.name}. Honour the compact in Diplomacy, or it will cast you out.`, empires: [me] });
  } else delete pol(state).cooldown[`honour:${pact.id}`];
  // interests drift: a receding threat, partners who quarrel
  const fears = pact.members.map((m) => fearOf(state, m, t).w);
  if (!anyFighting && Math.max(...fears) < 15) pact.strain += 6;
  else if (anyFighting) pact.strain = Math.max(0, pact.strain - 3);
  for (const a of pact.members) for (const b of pact.members) if (a < b && Math.min(op(state, a, b), op(state, b, a)) < -30) pact.strain += 5;
  // a collusion with the common foe, once known, poisons the compact
  for (const c of pol(state).pacts) if (c.kind === 'collusion' && c.members.includes(t) && pact.members.some((m) => c.members.includes(m) && pact.members.some((o) => o !== m && c.knownBy.includes(o)))) pact.strain += 30;
  // opportunism: an ambitious member turns on a partner worn down by the common war
  for (const m of [...pact.members].sort((a, b) => a - b)) {
    const e = state.empires[m];
    if (e.isPlayer || e.personality.aggression < 0.6 || e.personality.diplomacy > 0.5 || fightingNow(m)) continue;
    for (const v of pact.members) {
      if (v === m) continue;
      const w = warBetween(state, v, t);
      const losing = w ? (w.attackers.includes(v) ? w.score : -w.score) <= -25 : false;
      if (!(losing || power(state, v) < power(state, m) * 0.45) || !borders(state, m, v)) continue;
      if (!chance(state.rng, 0.12)) continue;
      if (execute(state, m, { type: 'declareWar', target: v }).ok) { betray(state, pact, m); return; }
    }
  }
  if (pact.strain >= 100) {
    dissolve(state, pact);
    for (const m of pact.members) pol(state).cooldown[`${m}:rejoin:${t}`] = state.tick + REJOIN_DAYS;
    for (const a of pact.members) for (const b of pact.members) if (a !== b) addMemory(state, a, b, 'compact_split', -10, 0.3, 'Our compact fell apart');
    record(state, 'fracture', `The compact against ${te.name} fractures`, `Diverging interests split ${names(state, pact.members)}. Each now goes its own way.`, [...pact.members, t], { severity: pact.members.includes(state.playerId) ? 'warn' : 'info' });
  }
}

function betray(state: GameState, pact: Pact, traitor: number) {
  const victims = pact.members.filter((m) => m !== traitor);
  for (const v of victims) addMemory(state, v, traitor, 'betrayed_pact', -50, 0.2, 'Betrayed our pact');
  for (const e of state.empires) if (great(e) && e.id !== traitor && !victims.includes(e.id)) addMemory(state, e.id, traitor, 'untrustworthy', -10, 0.3, 'Untrustworthy');
  addReputation(state, traitor, pact.kind === 'concord' ? -15 : -10);
  if (pact.target != null) pol(state).cooldown[`${traitor}:rejoin:${pact.target}`] = state.tick + REJOIN_DAYS * 2;
  pact.members = victims;
  delete pact.fighting[traitor];
  const label = PACT_LABEL[pact.kind].toLowerCase();
  // one betrayal, one entry, however many pacts it breaks
  const last = pol(state).history[pol(state).history.length - 1];
  if (last && last.tick === state.tick && last.kind === 'betrayal' && last.actors[0] === traitor) { if (pact.members.length < 2) dissolve(state, pact); return; }
  record(state, 'betrayal', `${state.empires[traitor].name} betray the ${label}`, `The ${state.empires[traitor].name} turn on ${names(state, victims)}${pact.target != null ? ` while the war against ${theName(state, pact.target)} rages` : pact.crisis ? ' in the midst of the crisis' : ''}.`, [traitor, ...victims], { severity: 'danger' });
  if (pact.members.length < 2) dissolve(state, pact);
}

function upkeepCollusion(state: GameState, pact: Pact) {
  const young = pact.members.find((m) => !ancient(state, m));
  const anc = pact.members.find((m) => m !== young);
  const t = pact.target!;
  const ps = anc != null ? ancient(state, anc) : undefined;
  if (young == null || anc == null || !ps || !state.empires[young]?.alive || !state.empires[t]?.alive) { dissolve(state, pact); return; }
  // whispers against the target turn the ancient power's eye on it
  if (!warBetween(state, anc, t)) {
    addPressure(state, ps, 0.8, `Whispers against the ${state.empires[t].name}`, t);
    addMemory(state, anc, t, 'whispers', -3, 0.3, 'Slandered by our confederates');
  }
  // the ancients tutor their confederate
  state.empires[young].research.progress += 40;
  // the war comes: the partner is called in
  if (warBetween(state, anc, t) && !warBetween(state, young, t)) {
    if (state.empires[young].isPlayer) {
      if (!pact.fighting[young]) log(state, { kind: 'politics', severity: 'warn', title: 'Your confederate goes to war', text: `${state.empires[anc].name} are at war with the ${state.empires[t].name}. Honour the pact in Diplomacy, or let it lapse.`, empires: [young] });
      pact.fighting[young] = true;
    } else honourCompact(state, pact);
  } else if (warBetween(state, young, t) && !warBetween(state, anc, t) && ps.status === 'awakened' && !state.treaties.some((x) => x.type === 'vassal' && x.b === anc)) {
    const war = state.wars.find((w) => (w.attackers.includes(young) && w.defenders.includes(t)) || (w.defenders.includes(young) && w.attackers.includes(t)));
    if (war && joinWar(state, war, anc, war.attackers.includes(young) ? 'attackers' : 'defenders')) reveal(state, pact, `when ${state.empires[anc].name} entered the war beside the ${state.empires[young].name}`);
  }
  if (!pol(state).pacts.includes(pact)) return;
  // discovery: the target's and the player's intelligence may find it out
  for (const v of [t, state.playerId]) {
    if (pact.knownBy.includes(v) || !state.empires[v]?.alive || pact.members.includes(v) || !pact.secret) continue;
    const p = Math.max(0, intelLevel(state, v, young) - 25) / 300;
    if (p > 0 && chance(state.rng, p)) {
      pact.knownBy.push(v);
      log(state, { kind: 'politics', severity: 'danger', title: 'A conspiracy uncovered', text: `Our agents have proof that the ${state.empires[young].name} conspire with ${state.empires[anc].name} against the ${state.empires[t].name}.${v === state.playerId ? ' Expose it before the galaxy, confront them, or keep the secret (Diplomacy).' : ''}`, empires: [v] });
      if (!state.empires[v].isPlayer) aiDiscovered(state, pact, v);
    }
  }
  // interests drift
  if (op(state, young, t) > 0) pact.strain += 10;
  if (op(state, anc, young) < 0) pact.strain += 10;
  if (pact.strain >= 100) { dissolve(state, pact); record(state, 'leave', 'A secret pact lapses', `The conspiracy of the ${state.empires[young].name} and ${state.empires[anc].name} against the ${state.empires[t].name} quietly ends.`, pact.members, { secret: pact.secret }); }
}

/** An AI realm that uncovers a conspiracy against itself answers it. */
function aiDiscovered(state: GameState, pact: Pact, v: number) {
  const e = state.empires[v];
  const young = pact.members.find((m) => !ancient(state, m))!;
  if (pact.target !== v) return;
  addMemory(state, v, young, 'conspired', -40, 0.2, 'Conspired with the ancients against us');
  if (e.personality.diplomacy >= 0.45 && e.stock.influence >= POLITICS_COST.expose) execute(state, v, { type: 'politics', action: 'expose', pactId: pact.id });
  else if (execute(state, v, { type: 'politics', action: 'confront', pactId: pact.id }).ok) return;
  if (!pol(state).pacts.includes(pact)) return;
  if (e.kind === 'major' && pol(state).pacts.includes(pact)) refusedUltimatum(state, e, young);
}

function upkeepConcord(state: GameState, pact: Pact) {
  if (!pact.crisis || !crisisActive(state, pact.crisis)) {
    dissolve(state, pact);
    for (const a of pact.members) for (const b of pact.members) if (a !== b) addMemory(state, a, b, 'stood_together', 15, 0.25, 'Stood with us in the crisis');
    record(state, 'concord_end', 'The concord dissolves', `With the crisis past, ${names(state, pact.members)} are free to pursue their old quarrels.`, pact.members, { severity: 'info' });
    return;
  }
  for (const a of pact.members) for (const b of pact.members) {
    if (a >= b) continue;
    const w = warBetween(state, a, b);
    if (w) { betray(state, pact, w.attackers.includes(a) ? a : b); return; }
  }
}

function upkeepAccord(state: GameState, pact: Pact) {
  const [a, b] = pact.members;
  if (!ancient(state, a) || !ancient(state, b)) { dissolve(state, pact); return; }
  const ct = commonThreat(state);
  // an enmity older than the hyperlanes reasserts itself when nothing holds them together
  pact.strain = Math.max(0, Math.min(100, pact.strain + 4 - ct.w / 10));
  // the young realms they protect drag them apart
  for (const w of state.wars) {
    const sa = w.attackers.includes(a) ? 0 : w.defenders.includes(a) ? 1 : -1;
    const sb = w.attackers.includes(b) ? 0 : w.defenders.includes(b) ? 1 : -1;
    if (sa !== -1 && sb !== -1 && sa !== sb) pact.strain = Math.min(100, pact.strain + 10);
  }
  if (pact.depth === 'truce' && ct.w >= 45) { pact.depth = 'alliance'; signTreaty(state, a, b, 'alliance'); record(state, 'accord', 'The ancient powers ally', `${state.empires[a].name} and ${state.empires[b].name} turn their truce into an alliance against ${ct.why || 'a common threat'}.`, [a, b], { severity: 'danger' }); }
  else if (pact.depth === 'alliance' && ct.w < 15) { pact.depth = 'truce'; if (hasTreaty(state, a, b, 'alliance')) breakTreaty(state, a, b, 'alliance', true); record(state, 'accord', 'The ancient alliance cools', `With ${pact.reason || 'the threat'} receding, ${state.empires[a].name} and ${state.empires[b].name} fall back to a wary truce.`, [a, b]); }
  if (pact.strain >= 100) {
    dissolve(state, pact);
    addMemory(state, a, b, 'accord_broken', -20, 0.2, 'Broke our accord');
    addMemory(state, b, a, 'accord_broken', -20, 0.2, 'Broke our accord');
    record(state, 'accord_end', 'The accord of the ancients breaks', `The understanding between ${state.empires[a].name} and ${state.empires[b].name} collapses. Their ancient enmity returns.`, [a, b], { severity: 'danger' });
    // the truce that the accord brought is repudiated with it
    state.truces = state.truces.filter((x) => !((x.a === a && x.b === b) || (x.a === b && x.b === a)));
    startHeavenIfRivals(state);
  }
}

/** The struggle against the Omega Incursion: a warden emerges, claimants contest, visions clash. */
function crisisPolitics(state: GameState) {
  const p = pol(state);
  const x = exp(state);
  if (!omegaActive(state)) { p.warden = null; p.claimant = null; return; }
  const ranked = Object.entries(x.omega.credit).map(([k, v]) => ({ id: +k, v })).filter((r) => great(state.empires[r.id]) && r.v >= 20).sort((a, b) => b.v - a.v || a.id - b.id);
  const top = ranked[0]?.id ?? null;
  if (top != null && top !== p.warden) {
    const prev = p.warden;
    p.warden = top;
    if (prev != null && great(state.empires[prev])) {
      p.claimant = prev;
      addMemory(state, prev, top, 'claimant', -15, 0.3, 'Usurped our leadership against Omega');
      addMemory(state, top, prev, 'claimant', -8, 0.3, 'Contests our leadership against Omega');
      record(state, 'claimant', `${state.empires[top].name} claim the lead against Omega`, `The ${state.empires[top].name} now lead the struggle against the Omega Incursion; the ${state.empires[prev].name} contest their claim.`, [top, prev], { severity: 'warn' });
    } else record(state, 'claimant', `${state.empires[top].name} lead the fight against Omega`, `The galaxy looks to the ${state.empires[top].name} to lead the struggle against the Omega Incursion.`, [top]);
  }
  if (p.warden != null) {
    const w = state.empires[p.warden];
    w.timedMods = w.timedMods.filter((t) => t.label !== 'Leads the crisis effort');
    w.timedMods.push({ key: 'acceptance', value: 10, until: state.tick + 45, label: 'Leads the crisis effort' });
  }
  // competing visions: those who would bind the rift for themselves and those who would end it
  const seated = state.empires.filter((e) => great(e) && x.conclave.seats[e.id] != null);
  for (const a of seated) for (const b of seated) {
    if (a.id >= b.id) continue;
    const va = p.agendas[a.id]?.vision, vb = p.agendas[b.id]?.vision;
    if (!va || !vb || (va === 'exploit') === (vb === 'exploit')) continue;
    addMemory(state, a.id, b.id, 'vision', -2, 0.5, vb === 'exploit' ? 'Would bind the rift for itself' : 'Would deny us the rift');
    addMemory(state, b.id, a.id, 'vision', -2, 0.5, va === 'exploit' ? 'Would bind the rift for itself' : 'Would deny us the rift');
  }
}

export function politicsMonthly(state: GameState) {
  if (!state.expansion) return;
  const p = pol(state);
  dirty(state);
  updateRegard(state);
  updateAgendas(state);
  for (const pact of [...p.pacts].sort((a, b) => a.id - b.id)) {
    if (!p.pacts.includes(pact)) continue;
    pact.members = pact.members.filter((m) => state.empires[m]?.alive);
    if (pact.members.length < 2) { dissolve(state, pact); continue; }
    if (pact.kind === 'compact') upkeepCompact(state, pact);
    else if (pact.kind === 'collusion') upkeepCollusion(state, pact);
    else if (pact.kind === 'concord') upkeepConcord(state, pact);
    else upkeepAccord(state, pact);
  }
  crisisPolitics(state);
  // overtures nobody answered
  for (const o of p.offers.filter((x) => x.expires <= state.tick || !state.empires[x.from]?.alive)) {
    p.offers = p.offers.filter((x) => x !== o);
    p.cooldown[cooldownKey({ kind: o.kind, from: o.from, to: o.to, target: o.target })] = state.tick + OFFER_COOLDOWN;
    if (state.empires[o.from]?.alive) addMemory(state, o.from, o.to, 'ignored', -5, 0.3, 'Ignored our overture');
  }
  for (const k of Object.keys(p.cooldown)) if (!k.startsWith('honour:') && p.cooldown[k] <= state.tick) delete p.cooldown[k];
  // the ancients make their own moves
  for (const ps of activePrecursors(state)) ancientInitiative(state, ps);
}

// ------------------------------------------------------------------ initiative: who proposes what

/** Try overtures in order; make the first the proposer wants enough (one per month). */
function tryOvertures(state: GameState, actor: number, deals: Deal[]): boolean {
  const p = pol(state);
  for (const d of deals) {
    if ((p.cooldown[cooldownKey(d)] ?? 0) > state.tick) continue;
    if (validateDeal(state, d)) continue;
    if (state.empires[d.to].isPlayer && p.offers.some((o) => o.from === d.from && o.to === d.to)) continue;
    const want = desire(state, actor, d);
    if (want.score < PROPOSE_THRESHOLD) continue;
    const r = execute(state, actor, { type: 'politics', action: 'propose', kind: d.kind, to: d.to, target: d.target, crisis: d.crisis });
    if (r.ok || state.empires[d.to].isPlayer) return true;
  }
  return false;
}

function ancientInitiative(state: GameState, ps: PrecursorState) {
  const me = ps.empireId;
  const deals: Deal[] = [];
  const other = activePrecursors(state).find((q) => q.id !== ps.id);
  if (other && !hasAccord(state)) deals.push({ kind: 'accord', from: me, to: other.empireId, target: null });
  const youngs = state.empires.filter((e) => great(e) && inContact(state, me, e.id)).sort((a, b) => a.id - b.id);
  for (const y of youngs) {
    deals.push({ kind: 'submission', from: me, to: y.id, target: null });
    deals.push({ kind: 'gift', from: me, to: y.id, target: null });
    deals.push({ kind: 'alliance', from: me, to: y.id, target: null });
    deals.push({ kind: 'protection', from: me, to: y.id, target: null });
    if (ps.status === 'awakened' && power(state, y.id) * 3 < power(state, me) && borders(state, y.id, me)) deals.push({ kind: 'clientage', from: me, to: y.id, target: null });
  }
  // recruit a confederate against the realm it fears most
  const feared = agendaOf(state, me)?.fears.find((f) => great(state.empires[f.id]));
  if (feared) for (const y of youngs) if (y.id !== feared.id && op(state, y.id, feared.id) < -25) deals.push({ kind: 'collusion', from: me, to: y.id, target: feared.id });
  tryOvertures(state, me, deals);
}

/** A great AI realm's political moves for the month (called from its turn; at most one overture). */
export function politicsAI(state: GameState, e: Empire) {
  if (!state.expansion || e.kind !== 'major' || e.isPlayer) return;
  if (pol(state).agendas[e.id] == null) return;
  const agenda = pol(state).agendas[e.id];
  const deals: Deal[] = [];
  const others = state.empires.filter((o) => (o.kind === 'major' || o.kind === 'minor') && o.alive && o.id !== e.id && inContact(state, e.id, o.id)).sort((a, b) => a.id - b.id);
  // crisis: set wars aside with those the crisis also threatens
  for (const crisis of ['omega', 'devourer'] as const) {
    if (crisisThreat(state, e.id, crisis) < 15) continue;
    for (const o of others) if (o.kind === 'major' && warBetween(state, e.id, o.id)) deals.push({ kind: 'concord', from: e.id, to: o.id, target: null, crisis });
    for (const o of others) if (o.kind === 'major' && !warBetween(state, e.id, o.id)) deals.push({ kind: 'concord', from: e.id, to: o.id, target: null, crisis });
  }
  // compacts against what it fears, with whoever fears it too (even an old enemy)
  for (const f of agenda.fears) {
    const fe = state.empires[f.id];
    if (f.weight < 30 || !(fe.kind === 'major' || fe.kind === 'precursor')) continue;
    const partners = others.filter((o) => o.id !== f.id && o.kind === 'major').map((o) => ({ o, w: fearOf(state, o.id, f.id).w + (warBetween(state, o.id, f.id) ? 20 : 0) })).filter((x) => x.w >= 20).sort((a, b) => b.w - a.w || a.o.id - b.o.id);
    for (const { o } of partners.slice(0, 3)) deals.push({ kind: 'compact', from: e.id, to: o.id, target: f.id });
  }
  // the ancients: protection when threatened, clientage when desperate, submission when winning
  for (const ps of activePrecursors(state)) {
    const pe = ps.empireId;
    if (!inContact(state, e.id, pe)) continue;
    if (warBetween(state, e.id, pe)) deals.push({ kind: 'submission', from: e.id, to: pe, target: null });
    if (agenda.fears.some((f) => f.id !== pe && f.weight >= 30)) { deals.push({ kind: 'protection', from: e.id, to: pe, target: null }); deals.push({ kind: 'alliance', from: e.id, to: pe, target: null }); }
    if (agenda.priority === 'survival') deals.push({ kind: 'clientage', from: e.id, to: pe, target: null });
    // conspire with an ancient power against a hated rival it also distrusts
    const rival = agenda.rival;
    if (rival != null && great(state.empires[rival]) && (blameShare(ps, rival) >= 0.2 || warBetween(state, pe, rival) || regardOf(state, ps, rival).fear >= 55)) deals.push({ kind: 'collusion', from: e.id, to: pe, target: rival });
  }
  if (tryOvertures(state, e.id, deals)) return;
  // a diplomatic realm tries to end a long War in Heaven that it fears will engulf it
  const h = exp(state).heaven;
  const k = `${e.id}:mediate`;
  if (h.active && e.personality.diplomacy >= 0.65 && state.tick - (h.startTick ?? state.tick) >= 360 * 3 && e.stock.influence >= POLITICS_COST.mediate + 40 && (pol(state).cooldown[k] ?? 0) <= state.tick
    && activePrecursors(state).some((ps) => fearOf(state, e.id, ps.empireId).w >= 20)) {
    pol(state).cooldown[k] = state.tick + 360 * 2;
    execute(state, e.id, { type: 'politics', action: 'mediate' });
  }
}
