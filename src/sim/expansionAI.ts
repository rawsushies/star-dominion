// How AI realms take part in the Grand Expansion. Every decision goes through execute(), the same
// command layer the player uses: tabling, voting on and lobbying for Conclave motions, defying
// directives that cost them too much, paying or withholding tribute to the ancients, seeking
// knowledge and sponsorship, choosing a side (or none) in the War in Heaven, salvaging ancient
// worlds, contributing to the crisis effort, and sending fleets against the Omega rift.

import { execute } from './commands';
import { opinion } from './diplomacy';
import { fleetPower } from './fleets';
import { jumpDistances } from './galaxy';
import { chance } from './rng';
import { armed, ownedSystems, warBetween } from './territory';
import { hegemon } from './victory';
import { victoryAim } from './strategy';
import { canAfford } from './util';
import { KNOWLEDGE_OPINION, OMEGA, PRECURSORS, SPONSOR_COST, SPONSOR_OPINION, CONTRIBUTIONS } from './data/expansion';
import type { Empire, Fleet, GameState } from './types';
import type { ConclaveSession, Resolution } from './expansionTypes';
import { boundBy, directives, exp, injunctionBlocks, isSovereign, reputation, sponsorOf } from './expansion';
import { activePrecursors, blameShare, precursorEmpire, tributeCost } from './ancients';
import { aiLean, canVote, computeWeights, motionCost, validateMotion } from './conclave';
import { omegaActive, omegaFleets, riftHeldBy } from './omega';

/** Monthly expansion decisions of an AI realm (called from runAI). */
export function expansionAI(state: GameState, e: Empire) {
  if (!state.expansion || !isSovereign(e) || e.isPlayer) return;
  conclaveAI(state, e);
  ancientsAI(state, e);
  if (e.kind === 'major') contributionsAI(state, e);
}

// ------------------------------------------------------------------ Conclave

function estimate(state: GameState, e: Empire, r: Resolution, emergency: boolean): boolean {
  const weights = computeWeights(state);
  const s: ConclaveSession = { id: -1, resolution: r, proposer: e.id, emergency, opened: state.tick, deadline: state.tick, weights, votes: { [e.id]: 'yea' }, lobby: {}, lobbied: [] };
  let yea = 0, nay = 0, total = 0;
  for (const [k, w] of Object.entries(weights)) {
    const v = state.empires[+k];
    total += w;
    const lean = v.id === e.id ? 1 : v.isPlayer ? 0 : aiLean(state, v, s);
    if (lean > 0.15) yea += w; else if (lean < -0.15) nay += w;
  }
  if (yea + nay < total * 0.4) return false;
  return emergency ? yea >= (yea + nay) * 2 / 3 : yea > nay;
}

function conclaveAI(state: GameState, e: Empire) {
  const x = exp(state);
  const c = x.conclave;
  if (c.founded == null || !canVote(state, e.id)) return;
  const s = c.session;
  if (s) {
    // the proposer courts a waverer with weight
    if (s.proposer === e.id && e.stock.influence > 40 && e.stock.credits > 400) {
      const waverer = Object.entries(s.weights).map(([k, w]) => ({ v: state.empires[+k], w })).filter(({ v }) => v && !v.isPlayer && v.id !== e.id && !s.lobbied.includes(`${e.id}:${v.id}`))
        .map(({ v, w }) => ({ v, w, lean: aiLean(state, v, s) })).filter((o) => o.lean > -0.5 && o.lean <= 0.15).sort((a, b) => b.w - a.w || a.v.id - b.v.id)[0];
      if (waverer) execute(state, e.id, { type: 'conclave', action: 'lobby', target: waverer.v.id, toward: 'yea' });
    }
    return;
  }
  defianceAI(state, e);
  if (!chance(state.rng, 0.3)) return;
  for (const [r, emergency] of motionIdeas(state, e)) {
    if (e.stock.influence < motionCost(r, emergency) + 5) continue;
    if (validateMotion(state, e, r, emergency)) continue;
    if (!estimate(state, e, r, emergency)) continue;
    if (execute(state, e.id, { type: 'conclave', action: 'propose', resolution: r, emergency }).ok) return;
  }
}

function motionIdeas(state: GameState, e: Empire): [Resolution, boolean][] {
  const x = exp(state);
  const seat = x.conclave.seats[e.id];
  const high = seat === 'founder' || seat === 'great';
  const out: [Resolution, boolean][] = [];
  const o = x.omega;
  if (omegaActive(state)) out.push([{ kind: 'containment', cosmic: 'omega' }, high]);
  if (x.devourer.status === 'roaming') {
    const near = x.devourer.target != null && state.galaxy.systems[x.devourer.target].owner === e.id;
    if (near) out.push([{ kind: 'containment', cosmic: 'devourer' }, high]);
  }
  for (const ps of activePrecursors(state)) if (ps.status === 'awakened' && warBetween(state, e.id, ps.empireId)) out.push([{ kind: 'containment', target: ps.empireId }, high]);
  if (o.exploiter != null && o.exploiter !== e.id && isSovereign(state.empires[o.exploiter])) out.push([{ kind: 'containment', target: o.exploiter }, false]);
  // regulate a rival racing for ascension
  const racer = state.empires.find((r) => r.alive && r.kind === 'major' && r.id !== e.id && ((r.era ?? 0) >= 4 || state.galaxy.systems.some((sys) => sys.megastructures.some((m) => m.ownerId === r.id && m.id === 'continuum_engine'))));
  const mineEngine = state.galaxy.systems.some((sys) => sys.megastructures.some((m) => m.ownerId === e.id && m.id === 'continuum_engine'));
  if (racer && !mineEngine && (e.era ?? 0) < 4) out.push([{ kind: 'ascension_injunction', project: (racer.era ?? 0) >= 4 ? 'omega_theorem' : 'continuum_engine' }, false]);
  const lead = hegemon(state);
  const topNavy = state.empires.filter((r) => r.alive && r.kind === 'major' && r.id !== e.id).sort((a, b) => (b.stats.militaryPower || 0) - (a.stats.militaryPower || 0))[0];
  if ((lead && lead.id !== e.id && lead.fear > 0.4 && (e.stats.militaryPower || 0) < (state.empires[lead.id].stats.militaryPower || 0)) || (topNavy && (topNavy.stats.militaryPower || 0) > (e.stats.militaryPower || 1) * 1.6 && e.personality.aggression < 0.6)) out.push([{ kind: 'naval_accords' }, false]);
  for (const t of state.empires) {
    if (!isSovereign(t) || t.id === e.id) continue;
    const op = opinion(state, e.id, t.id);
    if ((op < -40 && (reputation(state, t.id) < -15 || lead?.id === t.id)) || (op < -30 && warBetween(state, e.id, t.id))) out.push([{ kind: 'embargo', target: t.id }, false]);
    if (op < -50 && e.personality.aggression > 0.5 && reputation(state, t.id) < -25) out.push([{ kind: 'containment', target: t.id }, false]);
  }
  // repeal what hurts us
  for (const d of x.conclave.directives) {
    if (d.defiant.includes(e.id) || d.resolution.kind === 'containment') continue;
    const fake: ConclaveSession = { id: -1, resolution: d.resolution, proposer: -1, emergency: false, opened: 0, deadline: 0, weights: {}, votes: {}, lobby: {}, lobbied: [] };
    if (aiLean(state, e, fake) < -0.6) out.push([{ kind: 'repeal', directiveId: d.id }, false]);
  }
  return out;
}

function defianceAI(state: GameState, e: Empire) {
  if (reputation(state, e.id) < -40) return;
  for (const d of directives(state)) {
    if (!boundBy(state, d, e.id)) continue;
    const r = d.resolution;
    let defy = false;
    if (r.kind === 'ascension_injunction') {
      const close = victoryAim(e) === 'ascension' && ((e.era ?? 0) >= 4 || state.galaxy.systems.some((s) => s.megastructures.some((m) => m.ownerId === e.id && m.id === r.project)));
      defy = close && injunctionBlocks(state, e.id, r.project!);
    } else if (r.kind === 'embargo' && r.target != null) {
      defy = state.treaties.some((t) => (t.type === 'alliance' || t.type === 'vassal') && ((t.a === e.id && t.b === r.target) || (t.b === e.id && t.a === r.target)));
    } else if (r.kind === 'naval_accords') {
      defy = e.personality.aggression > 0.65 && state.wars.some((w) => w.attackers[0] === e.id) && (e.stats.navalUsed || 0) >= (e.stats.navalCap || 1) * 0.9;
    }
    if (defy) { execute(state, e.id, { type: 'conclave', action: 'defy', directiveId: d.id }); return; }
  }
}

// ------------------------------------------------------------------ ancients

function ancientsAI(state: GameState, e: Empire) {
  const x = exp(state);
  for (const ps of activePrecursors(state)) {
    const pe = precursorEmpire(state, ps)!;
    const def = PRECURSORS[ps.id];
    const atWar = !!warBetween(state, e.id, pe.id);
    if (atWar) continue;
    // tribute: when it is demanded, or when the power is close to waking and blames us
    const demanded = ps.demands[e.id] != null;
    const worried = ps.pressure >= 65 && blameShare(ps, e.id) >= 0.3;
    if (demanded || (worried && (ps.tributeCooldown[e.id] ?? 0) <= state.tick)) {
      const cost = tributeCost(state, ps, e);
      const reserve = Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, (v ?? 0) * 1.3]));
      if (canAfford(e, reserve) && (!def.tributeResearch || e.research.progress >= 100)) { execute(state, e.id, { type: 'ancients', precursor: ps.id, action: 'tribute' }); continue; }
    }
    const op = opinion(state, pe.id, e.id);
    if ((ps.knowledgeCooldown[e.id] ?? 0) <= state.tick && (op >= KNOWLEDGE_OPINION || ps.sponsored[e.id]) && e.stock.influence >= 90) {
      execute(state, e.id, { type: 'ancients', precursor: ps.id, action: 'knowledge' });
      continue;
    }
    if (!sponsorOf(state, e.id) && op >= SPONSOR_OPINION && e.stock.influence >= SPONSOR_COST + 40 && (e.personality.science > 0.5 || e.kind !== 'major') && keepsTerms(state, e, ps.id)) {
      execute(state, e.id, { type: 'ancients', precursor: ps.id, action: 'sponsor' });
    }
  }
  // the War in Heaven: pledge, band together, or stay out
  const h = x.heaven;
  if (h.active && !h.pledges[e.id] && !h.coalition.includes(e.id) && chance(state.rng, 0.5)) {
    const sp = sponsorOf(state, e.id);
    const sides = activePrecursors(state).map((ps) => ({ ps, op: opinion(state, ps.empireId, e.id) })).sort((a, b) => b.op - a.op);
    // at war with one power already: fight for the other
    const foe = sides.find((x) => warBetween(state, e.id, x.ps.empireId));
    const friend = foe ? sides.find((x) => x.ps.id !== foe.ps.id && !warBetween(state, e.id, x.ps.empireId)) : undefined;
    if (sp) execute(state, e.id, { type: 'ancients', precursor: sp.id, action: 'pledge' });
    else if (friend) execute(state, e.id, { type: 'ancients', precursor: friend.ps.id, action: 'pledge' });
    else if (sides[0] && sides[0].op > 0 && e.personality.aggression > 0.45) execute(state, e.id, { type: 'ancients', precursor: sides[0].ps.id, action: 'pledge' });
    else if (e.personality.diplomacy > 0.55 || (h.coalition.length > 0 && e.personality.diplomacy > 0.35 && chance(state.rng, 0.3))) execute(state, e.id, { type: 'ancients', precursor: activePrecursors(state)[0]?.id ?? 'veil', action: 'coalition' });
    // otherwise it stays out of it
  }
}

/** Would the realm keep a power's terms of sponsorship as things stand? */
export function keepsTerms(state: GameState, e: Empire, id: 'veil' | 'automata'): boolean {
  const ps = exp(state).precursors.find((p) => p.id === id);
  if (!ps) return false;
  if (id === 'veil') return !ps.sacredWorlds.some((pid) => state.planets[pid]?.colony?.ownerId === e.id) && !state.galaxy.systems.some((s) => s.megastructures.some((m) => m.id === 'dyson_swarm' && m.ownerId === e.id));
  return !e.research.done.includes('ai_sentient') && e.research.current !== 'ai_sentient';
}

/** AI restraint around the ancients: what it will not research, build or settle. */
export function aiAvoidsTech(state: GameState, e: Empire, tech: string): boolean {
  if (tech !== 'ai_sentient' || !state.expansion) return false;
  const auto = activePrecursors(state).find((p) => p.id === 'automata');
  if (!auto) return false;
  return sponsorOf(state, e.id)?.id === 'automata' || (auto.pressure >= 60 && e.personality.aggression < 0.6);
}
export function aiAvoidsMega(state: GameState, e: Empire, mega: string): boolean {
  if (!state.expansion) return false;
  if (mega === 'dyson_swarm') {
    const veil = activePrecursors(state).find((p) => p.id === 'veil');
    return !!veil && (sponsorOf(state, e.id)?.id === 'veil' || (veil.pressure >= 70 && e.personality.aggression < 0.5));
  }
  return false;
}
export function aiAvoidsWorld(state: GameState, e: Empire, planetId: number): boolean {
  const veil = state.expansion?.precursors.find((p) => p.id === 'veil' && p.status !== 'fallen' && p.status !== 'absent');
  if (!veil || !veil.sacredWorlds.includes(planetId)) return false;
  return sponsorOf(state, e.id)?.id === 'veil' || e.personality.aggression < 0.75;
}

// ------------------------------------------------------------------ crisis contributions and fleets

function contributionsAI(state: GameState, e: Empire) {
  const x = exp(state);
  if (!omegaActive(state) || x.conclave.seats[e.id] == null) return;
  const o = x.omega;
  const rich = (c: Record<string, number | undefined>) => canAfford(e, Object.fromEntries(Object.entries(c).map(([k, v]) => [k, (v ?? 0) * 2.5])));
  if (!Object.values(o.intel).some((t) => t > state.tick) && rich(CONTRIBUTIONS.intel.cost)) { execute(state, e.id, { type: 'conclave', action: 'contribute', kind: 'intel' }); return; }
  if (rich(CONTRIBUTIONS.resources.cost) && chance(state.rng, 0.4)) { execute(state, e.id, { type: 'conclave', action: 'contribute', kind: 'resources' }); return; }
  const threatened = ownedSystems(state, e.id).some((sid) => o.corrupted[sid] != null);
  if (threatened && o.lattice <= state.tick && rich(CONTRIBUTIONS.infrastructure.cost)) execute(state, e.id, { type: 'conclave', action: 'contribute', kind: 'infrastructure' });
}

/**
 * Fleet duty against cosmic threats and for salvage, run inside the AI's fleet operations after
 * home defence. Fleets it commits are removed from `free` so the war logic leaves them be.
 */
export function crisisFleetOps(state: GameState, e: Empire, fleets: Fleet[], free: Set<number>) {
  if (!state.expansion || e.kind !== 'major') return;
  const x = state.expansion;
  const o = x.omega;
  const avail = fleets.filter((f) => free.has(f.id));
  if (!avail.length) return;
  if (omegaActive(state) && o.rift != null) {
    const mine = new Set(ownedSystems(state, e.id));
    const d = jumpDistances(state.galaxy, [o.rift], undefined, 10);
    const near = [...mine].some((sid) => Number.isFinite(d[sid]) && d[sid] <= 6) || [...mine].some((sid) => o.corrupted[sid] != null);
    // garrison duty: a corrupted world with no fleet of ours is lost within months
    for (const sid of [...mine].filter((s) => o.corrupted[s] != null && state.galaxy.systems[s].planetIds.some((pid) => state.planets[pid].colony?.ownerId === e.id)).sort((a, b) => a - b)) {
      if (Object.values(state.fleets).some((f) => f.ownerId === e.id && armed(f) && (f.systemId === sid || (f.order.type === 'move' && (f.order as { target: number }).target === sid)))) continue;
      const g = avail.filter((f) => free.has(f.id)).sort((a, b) => fleetPower(state, a) - fleetPower(state, b) || a.id - b.id)[0];
      if (!g) break;
      execute(state, e.id, { type: 'moveFleet', fleetId: g.id, target: sid });
      free.delete(g.id);
    }
    const duty = near || x.conclave.directives.some((dd) => dd.resolution.cosmic === 'omega' && dd.supporters.includes(e.id));
    if (duty) {
      const defenders = omegaFleets(state).filter((f) => f.systemId === o.rift).reduce((a, f) => a + fleetPower(state, f), 0);
      const group = avail.filter((f) => free.has(f.id) && f.supply > 30);
      const power = group.reduce((a, f) => a + fleetPower(state, f), 0);
      const atRift = group.filter((f) => f.systemId === o.rift && f.progress === 0);
      if (power > Math.max(150, defenders * 1.3)) {
        for (const f of group) { free.delete(f.id); if (f.systemId !== o.rift && !(f.order.type === 'move' && (f.order as { target: number }).target === o.rift)) execute(state, e.id, { type: 'moveFleet', fleetId: f.id, target: o.rift }); }
        if (atRift.length && riftHeldBy(state, e.id)) riftChoice(state, e, power);
      }
    }
  }
  // the War in Heaven: an opportunist picks over an undefended ancient world
  const h = x.heaven;
  if (h.active && !h.pledges[e.id] && e.personality.aggression > 0.6 && !state.wars.some((w) => w.attackers[0] === e.id || w.defenders[0] === e.id)) {
    const main = avail.find((f) => free.has(f.id) && armed(f));
    if (!main) return;
    for (const ps of activePrecursors(state)) {
      const pe = precursorEmpire(state, ps)!;
      const here = state.galaxy.systems[main.systemId];
      if (here.owner === pe.id && main.progress === 0) {
        execute(state, e.id, { type: 'ancients', precursor: ps.id, action: 'salvage', systemId: here.id });
        free.delete(main.id);
        return;
      }
      const d = jumpDistances(state.galaxy, [main.systemId], undefined, 5);
      const target = ps.sacred.filter((sid) => state.galaxy.systems[sid].owner === pe.id && Number.isFinite(d[sid]) && (ps.salvaged[`${e.id}:${sid}`] ?? 0) <= state.tick && !Object.values(state.fleets).some((f) => f.ownerId === pe.id && f.systemId === sid)).sort((a, b) => d[a] - d[b] || a - b)[0];
      if (target != null) { execute(state, e.id, { type: 'moveFleet', fleetId: main.id, target }); free.delete(main.id); return; }
    }
  }
}

function riftChoice(state: GameState, e: Empire, power: number) {
  const o = exp(state).omega;
  if (o.project) return;
  const engine = state.galaxy.systems.some((s) => s.megastructures.some((m) => m.id === 'continuum_engine' && m.ownerId === e.id && m.stage >= 1));
  if (o.integrity <= OMEGA.exploitIntegrity && ((e.era ?? 0) >= 4 || engine) && victoryAim(e) === 'ascension' && e.personality.aggression > 0.55 && e.stock.influence >= 120) {
    if (execute(state, e.id, { type: 'omega', action: 'exploit' }).ok) return;
  }
  const typical = omegaFleets(state).reduce((a, f) => Math.max(a, fleetPower(state, f)), 200);
  if (o.integrity <= OMEGA.breachIntegrity && power > typical * 2.5) { if (execute(state, e.id, { type: 'omega', action: 'breach' }).ok) return; }
  if (o.integrity <= OMEGA.sealIntegrity) execute(state, e.id, { type: 'omega', action: 'seal' });
}
