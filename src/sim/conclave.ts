// The High Conclave: a persistent galactic institution with influence but not unlimited authority.
//
// Seats. Founding Sovereigns hold permanent seats (the three leading great realms when the Conclave
// forms). Great Powers qualify by reaching the Stellar Ascendancy and holding a meaningful share of
// claimed space or people, with a reputation that is not disgraced. Sponsored Sovereigns sit while
// an ancient power sponsors them. Regional Delegates rotate among the remaining realms every five
// years. Everyone else observes without a vote.
//
// Weights. Political standing, territory, military strength and reputation, each as a share of the
// chamber, square-rooted (diminishing returns), scaled by seat and capped at a third of the chamber.
// Stockpiles never count, so hoarding buys no votes; a single dominant navy buys only so much.
// Weights freeze when a session opens.
//
// Sessions. One motion at a time. Ordinary sessions run 60 days and can be vetoed by a Founding
// Sovereign (rarely: it costs influence, reputation and a five-year wait). Emergency sessions,
// tabled by a Founder or Great Power against an ancient power at war with a member or a cosmic
// threat, run 20 days, need two thirds of the votes cast and cannot be vetoed. A motion needs a
// quorum of 40% of the chamber voting yea or nay. Members may lobby AI delegates. A directive binds
// every seated member except its target and those who openly defy it; defiance costs reputation,
// goodwill and stability, and repeated defiance suspends a seat.

import { execute } from './commands';
import { addMemory, canDeclareWar, declareWar, joinWar, opinion } from './diplomacy';
import { hegemon } from './victory';
import { log, nextId, pay, canAfford } from './util';
import { warBetween } from './territory';
import { MAX_ERA } from './data/eras';
import {
  DIRECTIVES, EMERGENCY_DAYS, FOUNDING, INJUNCTION_LABEL, LOBBY_COST, MOTION_COOLDOWN, ORDINARY_GAP, QUORUM, SEAT_FACTOR, SEAT_LABEL, SESSION_DAYS,
  SUSPENSION_DAYS, VETO_COOLDOWN, VETO_COST, VOTING_TIERS, WEIGHT_CAP,
} from './data/expansion';
import type { Empire, GameState } from './types';
import type { ConclaveSession, Directive, Resolution, SeatTier, Vote } from './expansionTypes';
import { addReputation, exp, isSovereign, reputation, sponsorOf } from './expansion';

// ------------------------------------------------------------------ seats

function shares(state: GameState) {
  let sys = 0, pop = 0;
  for (const e of state.empires) if (isSovereign(e)) { sys += e.stats.systems || 0; pop += e.stats.population || 0; }
  return { sys: Math.max(1, sys), pop: Math.max(1, pop) };
}

function standingScore(state: GameState, e: Empire, sh = shares(state)): number {
  return (e.stats.systems || 0) / sh.sys * 0.4 + (e.stats.population || 0) / sh.pop * 0.3 + (e.era ?? 0) / MAX_ERA * 0.3;
}

/** Does a great realm qualify as a Great Power? (several conditions, not one threshold) */
export function greatPowerTest(state: GameState, e: Empire): { ok: boolean; reasons: string[] } {
  const sh = shares(state);
  const sysShare = (e.stats.systems || 0) / sh.sys;
  const popShare = (e.stats.population || 0) / sh.pop;
  const reasons: string[] = [];
  if (e.kind !== 'major') reasons.push('Only a great realm');
  if ((e.era ?? 0) < 2) reasons.push('Reach the Stellar Ascendancy (era 2)');
  if (sysShare < 0.06 && popShare < 0.08) reasons.push(`Hold 6% of claimed space (now ${Math.round(sysShare * 100)}%) or 8% of the galaxy's people (now ${Math.round(popShare * 100)}%)`);
  if (reputation(state, e.id) <= -50) reasons.push('A reputation better than disgraced (-50)');
  return { ok: reasons.length === 0, reasons };
}

export function refreshSeats(state: GameState) {
  const c = exp(state).conclave;
  if (c.founded == null) return;
  const seats: Record<number, SeatTier> = {};
  const sovereigns = state.empires.filter(isSovereign);
  for (const id of c.founders) if (isSovereign(state.empires[id])) seats[id] = 'founder';
  for (const e of sovereigns) if (seats[e.id] == null && greatPowerTest(state, e).ok) seats[e.id] = 'great';
  for (const e of sovereigns) if (seats[e.id] == null && sponsorOf(state, e.id)) seats[e.id] = 'sponsored';
  const rest = sovereigns.filter((e) => seats[e.id] == null).map((e) => e.id).sort((a, b) => a - b);
  const k = rest.length ? Math.max(1, Math.ceil(rest.length / 3)) : 0;
  for (let i = 0; i < k; i++) seats[rest[(c.delegateCursor + i) % rest.length]] = 'delegate';
  for (const id of rest) if (seats[id] == null) seats[id] = 'observer';
  c.seats = seats;
}

export function seatOf(state: GameState, id: number): SeatTier | null {
  return state.expansion?.conclave.seats[id] ?? null;
}

/** Can the realm vote right now (voting seat, not suspended)? */
export function canVote(state: GameState, id: number): boolean {
  const c = state.expansion?.conclave;
  const seat = c?.seats[id];
  return !!c && !!seat && VOTING_TIERS.includes(seat) && (c.suspended[id] ?? 0) <= state.tick && isSovereign(state.empires[id]);
}

/** Current voting weights (what a session opened now would freeze), summing to 100. */
export function computeWeights(state: GameState): Record<number, number> {
  const c = exp(state).conclave;
  const voters = Object.keys(c.seats).map(Number).filter((id) => canVote(state, id)).sort((a, b) => a - b);
  const out: Record<number, number> = {};
  if (!voters.length) return out;
  const comps = voters.map((id) => {
    const e = state.empires[id];
    return {
      id,
      standing: 1 + (e.era ?? 0) + Math.min(5, e.warsWon ?? 0) * 0.2 + (e.ambitions?.length ?? 0) * 0.1,
      territory: Math.max(0, e.stats.systems || 0) + 1,
      military: Math.max(0, e.stats.militaryPower || 0) + 1,
      rep: (reputation(state, id) + 100) / 200 + 0.05,
    };
  });
  const norm = (k: 'standing' | 'territory' | 'military' | 'rep') => {
    const sum = comps.reduce((a, x) => a + x[k], 0) || 1;
    const roots = comps.map((x) => Math.sqrt(x[k] / sum));
    const rs = roots.reduce((a, v) => a + v, 0) || 1;
    return roots.map((v) => v / rs);
  };
  const st = norm('standing'), te = norm('territory'), mi = norm('military'), re = norm('rep');
  let raw = comps.map((x, i) => (0.3 * st[i] + 0.25 * te[i] + 0.2 * mi[i] + 0.25 * re[i]) * SEAT_FACTOR[c.seats[x.id]]);
  const total = raw.reduce((a, v) => a + v, 0) || 1;
  raw = raw.map((v) => v / total);
  // cap any single member, handing the excess to the others in proportion
  if (raw.length > 2) {
    for (let it = 0; it < 6; it++) {
      const over = raw.reduce((a, v) => a + Math.max(0, v - WEIGHT_CAP), 0);
      if (over < 1e-9) break;
      const free = raw.reduce((a, v) => a + (v < WEIGHT_CAP ? v : 0), 0) || 1;
      raw = raw.map((v) => (v >= WEIGHT_CAP ? WEIGHT_CAP : v + over * (v / free)));
    }
  }
  comps.forEach((x, i) => { out[x.id] = Math.round(raw[i] * 1000) / 10; });
  return out;
}

// ------------------------------------------------------------------ founding and upkeep

function maybeFound(state: GameState) {
  const c = exp(state).conclave;
  if (c.founded != null) return;
  const majors = state.empires.filter((e) => e.alive && e.kind === 'major');
  if (majors.length < 2) return;
  const imperial = majors.some((e) => (e.era ?? 0) >= 1);
  if (!(state.tick >= FOUNDING.latest || (imperial && state.tick >= FOUNDING.earliest))) return;
  const sh = shares(state);
  const ranked = majors.slice().sort((a, b) => standingScore(state, b, sh) - standingScore(state, a, sh) || a.id - b.id);
  c.founded = state.tick;
  c.founders = ranked.slice(0, Math.min(3, ranked.length)).map((e) => e.id);
  c.nextRotation = state.tick + 360 * 5;
  c.nextOrdinary = state.tick + 60;
  refreshSeats(state);
  log(state, { kind: 'conclave', severity: 'info', title: 'The High Conclave is founded', text: `The great realms bind themselves into a galactic assembly. Founding Sovereigns: ${c.founders.map((id) => state.empires[id].name).join(', ')}. Its directives carry weight, but no realm is forced to obey.`, empires: [] });
}

export function conclaveMonthly(state: GameState) {
  const c = exp(state).conclave;
  maybeFound(state);
  if (c.founded == null) return;
  if (state.tick >= c.nextRotation) { c.delegateCursor += 1; c.nextRotation = state.tick + 360 * 5; refreshSeats(state); }
  else if (state.tick % 360 === 0 || !c.session) refreshSeats(state);
  for (const k of Object.keys(c.suspended)) if (c.suspended[+k] <= state.tick) delete c.suspended[+k];
  for (const k of Object.keys(c.motionCooldown)) if (c.motionCooldown[k] <= state.tick) delete c.motionCooldown[k];
  // directives lapse when their term ends or their purpose is gone
  for (const d of c.directives.slice()) {
    const why = lapse(state, d);
    if (!why) continue;
    c.directives = c.directives.filter((x) => x !== d);
    log(state, { kind: 'conclave', severity: 'info', title: `${directiveLabel(state, d.resolution)} lapses`, text: why, empires: [] });
  }
  if (c.history.length > 40) c.history.splice(0, c.history.length - 40);
}

function lapse(state: GameState, d: Directive): string | null {
  if (state.tick >= d.expires) return 'Its term has ended.';
  const r = d.resolution;
  if (r.kind === 'containment') {
    if (r.cosmic === 'omega') { const o = state.expansion!.omega; if (o.stage === 'resolved' || o.stage === 'dormant') return 'The Omega Incursion is over.'; return null; }
    if (r.cosmic === 'devourer') { if (state.expansion!.devourer.status !== 'roaming') return 'The Void Devourer is gone.'; return null; }
    if (r.target != null && !state.empires[r.target]?.alive) return `${state.empires[r.target].name} has fallen.`;
    if (r.target != null && state.tick - d.enacted > 60 && !d.supporters.some((s) => warBetween(state, s, r.target!))) return 'Its coalition has made peace.';
  }
  if ((r.kind === 'embargo') && r.target != null && !state.empires[r.target]?.alive) return `${state.empires[r.target].name} has fallen.`;
  return null;
}

// ------------------------------------------------------------------ motions

export function directiveLabel(state: GameState, r: Resolution): string {
  const def = DIRECTIVES[r.kind];
  if (r.kind === 'containment') return `${def.label} against ${r.cosmic === 'omega' ? 'the Omega Incursion' : r.cosmic === 'devourer' ? 'the Void Devourer' : state.empires[r.target ?? -1]?.name ?? 'an unknown realm'}`;
  if (r.kind === 'embargo') return `${def.label} on ${state.empires[r.target ?? -1]?.name ?? 'an unknown realm'}`;
  if (r.kind === 'ascension_injunction') return `${def.label} on ${INJUNCTION_LABEL[r.project ?? 'continuum_engine']}`;
  if (r.kind === 'repeal') { const d = state.expansion?.conclave.directives.find((x) => x.id === r.directiveId); return d ? `Repeal of the ${directiveLabel(state, d.resolution)}` : 'Repeal'; }
  return def.label;
}

/** Is this an emergency the Conclave may meet on at once? */
export function emergencyGrounds(state: GameState, r: Resolution): string | null {
  const x = exp(state);
  if (r.kind !== 'containment') return 'Only a containment war can be an emergency';
  if (r.cosmic === 'omega') return x.omega.stage === 'rift' || x.omega.stage === 'incursion' ? null : 'The Omega Incursion has not broken through';
  if (r.cosmic === 'devourer') return x.devourer.status === 'roaming' ? null : 'The Void Devourer is not in the galaxy';
  const t = r.target != null ? state.empires[r.target] : undefined;
  if (t?.kind === 'precursor' && Object.keys(x.conclave.seats).some((id) => warBetween(state, +id, t.id))) return null;
  return 'Emergencies are for cosmic threats and ancient powers at war with a member';
}

export function validateMotion(state: GameState, e: Empire, r: Resolution, emergency: boolean): string | null {
  const c = exp(state).conclave;
  if (c.founded == null) return 'The High Conclave has not been founded';
  if (!canVote(state, e.id)) return (c.suspended[e.id] ?? 0) > state.tick ? 'Your seat is suspended' : 'Only members with a vote may table a motion';
  if (c.session) return 'A session is already in progress';
  if (!DIRECTIVES[r.kind]) return 'Unknown motion';
  const cd = c.motionCooldown[`${e.id}:${r.kind}`];
  if (cd && cd > state.tick) return `You tabled this motion recently; wait ${Math.ceil((cd - state.tick) / 30)} months`;
  if (emergency) {
    const seat = c.seats[e.id];
    if (seat !== 'founder' && seat !== 'great') return 'Only a Founding Sovereign or Great Power may call an emergency session';
    const why = emergencyGrounds(state, r);
    if (why) return why;
  } else if (state.tick < c.nextOrdinary) return `The chamber reconvenes in ${Math.ceil((c.nextOrdinary - state.tick) / 30)} months (emergencies excepted)`;
  const active = c.directives;
  switch (r.kind) {
    case 'containment': {
      if (r.cosmic) {
        if (active.some((d) => d.resolution.kind === 'containment' && d.resolution.cosmic === r.cosmic)) return 'Already in force';
        const x = exp(state);
        if (r.cosmic === 'omega' && !(x.omega.stage === 'rift' || x.omega.stage === 'incursion')) return 'The Omega Incursion has not broken through';
        if (r.cosmic === 'devourer' && x.devourer.status !== 'roaming') return 'The Void Devourer is not in the galaxy';
        return null;
      }
      const t = r.target != null ? state.empires[r.target] : undefined;
      if (!t?.alive || (!isSovereign(t) && t.kind !== 'precursor')) return 'Choose a realm or an ancient power';
      if (t.id === e.id) return 'You cannot target yourself';
      if (active.some((d) => d.resolution.kind === 'containment' && d.resolution.target === t.id)) return 'Already in force';
      if (t.kind !== 'precursor' && reputation(state, t.id) > -25 && !(c.defiance[t.id]?.some((tk) => state.tick - tk < 360 * 10))) return 'A containment war needs a disgraced target (reputation below -25) or one that defied the Conclave';
      return null;
    }
    case 'embargo': {
      const t = r.target != null ? state.empires[r.target] : undefined;
      if (!t?.alive || !isSovereign(t)) return 'Choose a realm';
      if (t.id === e.id) return 'You cannot target yourself';
      if (active.some((d) => d.resolution.kind === 'embargo' && d.resolution.target === t.id)) return 'Already in force';
      return null;
    }
    case 'naval_accords': return active.some((d) => d.resolution.kind === 'naval_accords') ? 'Already in force' : null;
    case 'ascension_injunction': {
      if (!r.project || !INJUNCTION_LABEL[r.project]) return 'Choose a project';
      return active.some((d) => d.resolution.kind === 'ascension_injunction' && d.resolution.project === r.project) ? 'Already in force' : null;
    }
    case 'repeal': return active.some((d) => d.id === r.directiveId) ? null : 'No such directive';
  }
  return 'Unknown motion';
}

export function motionCost(r: Resolution, emergency: boolean): number {
  return emergency ? 15 : DIRECTIVES[r.kind].cost;
}

export function tableMotion(state: GameState, e: Empire, r: Resolution, emergency: boolean): string | null {
  const why = validateMotion(state, e, r, emergency);
  if (why) return why;
  const cost = motionCost(r, emergency);
  if (!pay(e, { influence: cost })) return `Tabling this motion costs ${cost} influence`;
  const c = exp(state).conclave;
  refreshSeats(state);
  const clean: Resolution = { kind: r.kind };
  if (r.target != null) clean.target = r.target;
  if (r.cosmic) clean.cosmic = r.cosmic;
  if (r.project) clean.project = r.project;
  if (r.directiveId != null) clean.directiveId = r.directiveId;
  const s: ConclaveSession = { id: nextId(state), resolution: clean, proposer: e.id, emergency, opened: state.tick, deadline: state.tick + (emergency ? EMERGENCY_DAYS : SESSION_DAYS), weights: computeWeights(state), votes: { [e.id]: 'yea' }, lobby: {}, lobbied: [] };
  c.session = s;
  log(state, { kind: 'conclave', severity: emergency ? 'danger' : 'info', title: `${emergency ? 'Emergency session' : 'The Conclave convenes'}: ${directiveLabel(state, clean)}`, text: `Tabled by the ${e.name}. The vote closes in ${emergency ? EMERGENCY_DAYS : SESSION_DAYS} days.${emergency ? ' Two thirds of the votes cast are needed; there is no veto.' : ''}`, empires: [] });
  return null;
}

export function castVote(state: GameState, e: Empire, v: Vote): string | null {
  const c = exp(state).conclave;
  const s = c.session;
  if (!s) return 'No session is in progress';
  if (s.weights[e.id] == null || !canVote(state, e.id)) return 'You have no vote in this session';
  if (!['yea', 'nay', 'abstain', 'veto'].includes(v)) return 'Unknown vote';
  if (v === 'veto') {
    if (s.emergency) return 'Emergency resolutions cannot be vetoed';
    if (!c.founders.includes(e.id)) return 'Only a Founding Sovereign holds a veto';
    const last = c.vetoUsed[e.id];
    if (last != null && state.tick - last < VETO_COOLDOWN) return `Your veto is spent for ${Math.ceil((VETO_COOLDOWN - (state.tick - last)) / 360)} more years`;
    if (s.proposer === e.id) return 'You cannot veto your own motion';
    if (!pay(e, { influence: VETO_COST })) return `A veto costs ${VETO_COST} influence`;
    c.vetoUsed[e.id] = state.tick;
    addReputation(state, e.id, -8);
    s.votes[e.id] = 'veto';
    concludeSession(state);
    return null;
  }
  if (s.votes[e.id] === 'veto') return 'Your veto stands';
  s.votes[e.id] = v;
  return null;
}

export function lobbyMember(state: GameState, e: Empire, target: number, toward: 'yea' | 'nay'): string | null {
  const c = exp(state).conclave;
  const s = c.session;
  if (!s) return 'No session is in progress';
  if (c.seats[e.id] == null) return 'Only Conclave members may lobby';
  const t = state.empires[target];
  if (!t || target === e.id || s.weights[target] == null) return 'Choose a voting member';
  if (t.isPlayer) return 'Another sovereign decides their own vote';
  if (s.votes[target] && s.votes[target] !== 'yea' && target === s.proposer) return 'The proposer will not change its mind';
  if (s.lobbied.includes(`${e.id}:${target}`)) return 'You have already lobbied them this session';
  if (!canAfford(e, LOBBY_COST)) return `Lobbying costs ${LOBBY_COST.influence} influence and ${LOBBY_COST.credits} credits`;
  pay(e, LOBBY_COST);
  const sway = (0.25 + Math.max(0, opinion(state, target, e.id)) / 200) * (toward === 'yea' ? 1 : -1);
  s.lobby[target] = (s.lobby[target] ?? 0) + sway;
  s.lobbied.push(`${e.id}:${target}`);
  addMemory(state, target, e.id, 'lobbied', 5, 0.5, 'Courted our vote');
  return null;
}

export function withdrawMotion(state: GameState, e: Empire): string | null {
  const c = exp(state).conclave;
  const s = c.session;
  if (!s) return 'No session is in progress';
  if (s.proposer !== e.id) return 'Only the proposer may withdraw a motion';
  record(state, s, 'withdrawn', 0, 0, 0);
  c.session = null;
  c.motionCooldown[`${e.id}:${s.resolution.kind}`] = state.tick + MOTION_COOLDOWN / 2;
  return null;
}

// ------------------------------------------------------------------ AI judgement

/** How an AI member leans on the motion in session: + yea, - nay (lobbying included). */
export function aiLean(state: GameState, v: Empire, s: ConclaveSession): number {
  return judge(state, v, s.resolution, s.proposer) + (s.lobby[v.id] ?? 0);
}

function judge(state: GameState, v: Empire, r: Resolution, proposer: number): number {
  let lean = 0;
  const x = exp(state);
  const lead = hegemon(state);
  switch (r.kind) {
    case 'containment': {
      if (r.cosmic) { lean = x.omega.exploiter === v.id ? -1 : 0.9; break; }
      const t = state.empires[r.target!];
      if (!t) break;
      if (warBetween(state, v.id, t.id)) { lean = 1; break; }
      if (state.treaties.some((tr) => (tr.type === 'alliance' || tr.type === 'vassal' || tr.type === 'defense') && ((tr.a === v.id && tr.b === t.id) || (tr.b === v.id && tr.a === t.id)))) { lean = -1; break; }
      if (t.kind === 'precursor' && sponsorOf(state, v.id)?.empireId === t.id) { lean = -1; break; }
      lean = -opinion(state, v.id, t.id) / 80 - 0.2 + v.personality.aggression * 0.3;
      if ((t.stats.militaryPower || 0) > (v.stats.militaryPower || 1) * 2) lean -= 0.25;
      break;
    }
    case 'embargo': {
      const t = state.empires[r.target!];
      if (!t) break;
      lean = -opinion(state, v.id, t.id) / 100 - 0.05;
      if (state.treaties.some((tr) => tr.type === 'trade' && ((tr.a === v.id && tr.b === t.id) || (tr.b === v.id && tr.a === t.id)))) lean -= 0.4;
      if (state.tradeDeals.some((d) => (d.a === v.id && d.b === t.id) || (d.b === v.id && d.a === t.id))) lean -= 0.3;
      if (lead?.id === t.id) lean += 0.4 * lead.fear + 0.2;
      break;
    }
    case 'naval_accords': {
      const strongest = state.empires.filter((o) => o.alive && o.kind === 'major').sort((a, b) => (b.stats.militaryPower || 0) - (a.stats.militaryPower || 0))[0];
      lean = 0.2 - v.personality.aggression * 0.5;
      if (strongest?.id === v.id) lean -= 0.8;
      else if (lead && lead.id !== v.id) lean += 0.5 * lead.fear;
      break;
    }
    case 'ascension_injunction': {
      const own = r.project === 'omega_theorem' ? v.research.current === 'era_omega' || (v.era ?? 0) >= 4
        : state.galaxy.systems.some((sys) => sys.megastructures.some((m) => m.ownerId === v.id && m.id === r.project));
      if (own) { lean = -1; break; }
      const racing = state.empires.some((o) => o.alive && o.kind === 'major' && o.id !== v.id && (o.era ?? 0) >= 3);
      lean = (racing ? 0.5 : 0.05) - v.personality.science * 0.3 + (lead && lead.id !== v.id ? 0.2 : 0);
      break;
    }
    case 'repeal': {
      const d = x.conclave.directives.find((dd) => dd.id === r.directiveId);
      lean = d ? -judge(state, v, d.resolution, proposer) : 0;
      break;
    }
  }
  if (proposer !== v.id) lean += opinion(state, v.id, proposer) / 250;
  else lean = 1;
  return Math.max(-1.5, Math.min(1.5, lean));
}

export function aiVote(state: GameState, v: Empire, s: ConclaveSession): Vote {
  const lean = aiLean(state, v, s);
  if (!s.emergency && lean < -0.7 && state.expansion!.conclave.founders.includes(v.id) && s.proposer !== v.id) {
    const last = state.expansion!.conclave.vetoUsed[v.id];
    if ((last == null || state.tick - last >= VETO_COOLDOWN) && v.stock.influence >= VETO_COST + 20 && tallyEstimate(state, s).yea > tallyEstimate(state, s).nay) return 'veto';
  }
  return lean > 0.15 ? 'yea' : lean < -0.15 ? 'nay' : 'abstain';
}

/** Expected tally with AI members voting their current lean (for the UI and AI proposers). */
export function tallyEstimate(state: GameState, s: ConclaveSession): { yea: number; nay: number; abstain: number } {
  const t = { yea: 0, nay: 0, abstain: 0 };
  for (const [k, w] of Object.entries(s.weights)) {
    const id = +k;
    const e = state.empires[id];
    if (!e?.alive) continue;
    let v = s.votes[id];
    if (!v) v = e.isPlayer ? 'abstain' : (() => { const l = aiLean(state, e, s); return l > 0.15 ? 'yea' : l < -0.15 ? 'nay' : 'abstain'; })();
    if (v === 'veto') v = 'nay';
    t[v] += w;
  }
  return t;
}

// ------------------------------------------------------------------ resolution

export function conclaveDaily(state: GameState) {
  const s = state.expansion?.conclave.session;
  if (!s || state.tick < s.deadline) return;
  // AI members who have not voted decide now, through the command layer like any other vote
  for (const k of Object.keys(s.weights).map(Number).sort((a, b) => a - b)) {
    const e = state.empires[k];
    if (!e?.alive || e.isPlayer || s.votes[k]) continue;
    execute(state, k, { type: 'conclave', action: 'vote', vote: aiVote(state, e, s) });
    if (!state.expansion!.conclave.session) return; // a veto ended it
  }
  concludeSession(state);
}

function concludeSession(state: GameState) {
  const c = exp(state).conclave;
  const s = c.session;
  if (!s) return;
  c.session = null;
  let yea = 0, nay = 0, abstain = 0, total = 0;
  let vetoedBy: number | undefined;
  for (const [k, w] of Object.entries(s.weights)) {
    const id = +k;
    if (!state.empires[id]?.alive) continue;
    total += w;
    const v = s.votes[id] ?? 'abstain';
    if (v === 'veto') { vetoedBy = id; nay += w; } else if (v === 'yea') yea += w; else if (v === 'nay') nay += w; else abstain += w;
  }
  const label = directiveLabel(state, s.resolution);
  if (!s.emergency) c.nextOrdinary = state.tick + ORDINARY_GAP;
  const round = (n: number) => Math.round(n * 10) / 10;
  if (vetoedBy != null) {
    record(state, s, 'vetoed', yea, nay, abstain, vetoedBy);
    c.motionCooldown[`${s.proposer}:${s.resolution.kind}`] = state.tick + MOTION_COOLDOWN;
    log(state, { kind: 'conclave', severity: 'warn', title: `Vetoed: ${label}`, text: `The ${state.empires[vetoedBy].name} used its founding veto.`, empires: [] });
    return;
  }
  if (yea + nay < total * QUORUM) {
    record(state, s, 'no_quorum', yea, nay, abstain);
    c.motionCooldown[`${s.proposer}:${s.resolution.kind}`] = state.tick + MOTION_COOLDOWN / 2;
    log(state, { kind: 'conclave', severity: 'info', title: `No quorum: ${label}`, text: `Too few members took a side (${round(yea + nay)} of ${round(total)} votes; ${Math.round(QUORUM * 100)}% needed).`, empires: [] });
    return;
  }
  const passed = s.emergency ? yea >= (yea + nay) * 2 / 3 : yea > nay;
  if (!passed) {
    record(state, s, 'failed', yea, nay, abstain);
    c.motionCooldown[`${s.proposer}:${s.resolution.kind}`] = state.tick + MOTION_COOLDOWN;
    log(state, { kind: 'conclave', severity: 'info', title: `Rejected: ${label}`, text: `Yea ${round(yea)}, nay ${round(nay)}, abstained ${round(abstain)}.`, empires: [] });
    return;
  }
  record(state, s, 'passed', yea, nay, abstain);
  enact(state, s);
  log(state, { kind: 'conclave', severity: 'warn', title: `Resolved: ${label}`, text: `Yea ${round(yea)}, nay ${round(nay)}, abstained ${round(abstain)}. ${DIRECTIVES[s.resolution.kind].summary}`, empires: [] });
}

function record(state: GameState, s: ConclaveSession, result: 'passed' | 'failed' | 'vetoed' | 'withdrawn' | 'no_quorum', yea: number, nay: number, abstain: number, vetoedBy?: number) {
  exp(state).conclave.history.push({ id: s.id, resolution: s.resolution, proposer: s.proposer, tick: state.tick, emergency: s.emergency, result, yea: Math.round(yea * 10) / 10, nay: Math.round(nay * 10) / 10, abstain: Math.round(abstain * 10) / 10, ...(vetoedBy != null ? { vetoedBy } : {}) });
}

function enact(state: GameState, s: ConclaveSession) {
  const c = exp(state).conclave;
  const r = s.resolution;
  if (r.kind === 'repeal') {
    c.directives = c.directives.filter((d) => d.id !== r.directiveId);
    return;
  }
  const supporters = Object.keys(s.votes).map(Number).filter((id) => s.votes[id] === 'yea' && state.empires[id]?.alive).sort((a, b) => a - b);
  const d: Directive = { id: s.id, resolution: r, enacted: state.tick, expires: state.tick + DIRECTIVES[r.kind].years * 360, supporters, defiant: [] };
  c.directives.push(d);
  for (const id of supporters) addReputation(state, id, 1);
  if (r.kind === 'containment' && r.target != null) {
    // the members who voted for it go to war together; the Conclave funds the declarations
    const target = r.target;
    let war = state.wars.find((w) => (w.attackers.includes(target) || w.defenders.includes(target)) && supporters.some((id) => w.attackers.includes(id) || w.defenders.includes(id)));
    for (const id of supporters) {
      if (warBetween(state, id, target)) continue;
      if (war) {
        const side = war.attackers.includes(target) ? 'defenders' : 'attackers';
        joinWar(state, war, id, side);
        continue;
      }
      const e = state.empires[id];
      e.stock.influence += 40;
      if (canDeclareWar(state, id, target).ok) war = declareWar(state, id, target) ?? undefined;
      else e.stock.influence -= 40;
    }
    if (war) war.name = `Conclave Containment of ${state.empires[target].name}`;
  }
}

// ------------------------------------------------------------------ defiance

export function defyDirective(state: GameState, e: Empire, directiveId: number): string | null {
  const c = exp(state).conclave;
  const d = c.directives.find((x) => x.id === directiveId);
  if (!d) return 'No such directive';
  if (d.defiant.includes(e.id)) return 'You already defy it';
  if (d.resolution.target === e.id) return 'It is aimed at you; there is nothing to defy';
  const seat = c.seats[e.id];
  if (!seat || seat === 'observer') return 'Observers are not bound by directives';
  d.defiant.push(e.id);
  addReputation(state, e.id, -15);
  for (const s of d.supporters) if (s !== e.id && state.empires[s]?.alive) addMemory(state, s, e.id, 'defied_conclave', -15, 0.3, 'Defied the Conclave');
  e.timedMods.push({ key: 'stability', value: -4, until: state.tick + 360 * 3, label: 'Conclave censure' });
  const list = (c.defiance[e.id] ??= []);
  list.push(state.tick);
  c.defiance[e.id] = list.filter((t) => state.tick - t < 360 * 10);
  let suspended = false;
  if (c.defiance[e.id].length >= 2 && !c.founders.includes(e.id)) { c.suspended[e.id] = state.tick + SUSPENSION_DAYS; suspended = true; }
  log(state, { kind: 'conclave', severity: 'warn', title: `${e.name} defies the Conclave`, text: `The ${e.name} refuses the ${directiveLabel(state, d.resolution)}. Its reputation suffers and the directive's supporters take note.${suspended ? ' Its seat is suspended for five years.' : ''}`, empires: [] });
  return null;
}

export function complyDirective(state: GameState, e: Empire, directiveId: number): string | null {
  const d = exp(state).conclave.directives.find((x) => x.id === directiveId);
  if (!d || !d.defiant.includes(e.id)) return 'You are not defying that directive';
  d.defiant = d.defiant.filter((id) => id !== e.id);
  addReputation(state, e.id, 3);
  return null;
}

export function seatLabel(t: SeatTier | null | undefined): string { return t ? SEAT_LABEL[t] : 'No seat'; }
