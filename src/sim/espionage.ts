// Covert operations. A spymaster in your service runs one operation at a time against a rival:
//   gather intel   — plants a network: +30 intel on that realm for two years
//   steal tech     — lifts research the rival has and you lack
//   sabotage       — wrecks a factory on one of their worlds, or knocks out its batteries
//   incite unrest  — stirs a world against its ruler (stability falls sharply)
// Success depends on the agent's cunning against the rival's counter-intelligence (their council
// spymaster and intelligence bonuses). Operations can be discovered — the victim remembers — and
// a failed, discovered agent may be taken prisoner (the usual ransom and pardon rules apply).

import { charById, unassign } from './characters';
import { addMemory } from './diplomacy';
import { empireMods, mod } from './modifiers';
import { canResearch } from './research';
import { TECH_BY_ID, techCost } from './data/techs';
import { BUILDINGS } from './data/buildings';
import { chance, next, pick } from './rng';
import { log, nextId } from './util';
import type { BuildingId, CovertKind, CovertOp, Empire, GameState } from './types';

export interface CovertDef { label: string; days: number; cost: { credits: number; influence: number }; base: number; needsPlanet: boolean; description: string }

export const COVERT: Record<CovertKind, CovertDef> = {
  gather_intel: { label: 'Gather intelligence', days: 60, cost: { credits: 40, influence: 0 }, base: 0.85, needsPlanet: false, description: 'Plant a network: +30 intel on this realm for two years.' },
  steal_tech: { label: 'Steal technology', days: 150, cost: { credits: 120, influence: 15 }, base: 0.45, needsPlanet: false, description: 'Lift research they have and you lack.' },
  sabotage: { label: 'Sabotage', days: 120, cost: { credits: 100, influence: 10 }, base: 0.5, needsPlanet: true, description: 'Wreck a factory on one of their worlds, or knock out its orbital batteries.' },
  incite_unrest: { label: 'Incite unrest', days: 90, cost: { credits: 80, influence: 15 }, base: 0.55, needsPlanet: true, description: 'Stir a world against its ruler: stability falls sharply.' },
};
export const COVERT_KINDS = Object.keys(COVERT) as CovertKind[];
const NETWORK_DAYS = 720;
const INDUSTRY: BuildingId[] = ['refinery', 'electronics_fab', 'component_works', 'shipyard', 'fusion_plant'];

export function covertOps(state: GameState): CovertOp[] { return state.covert ?? []; }
export function opsBy(state: GameState, empireId: number): CovertOp[] { return covertOps(state).filter((o) => o.ownerId === empireId); }

/** Counter-intelligence of a realm: its council spymaster's cunning and intelligence bonuses. */
export function counterIntel(state: GameState, e: Empire): number {
  const spy = charById(state, e.council?.spymaster);
  return (spy && spy.status === 'active' ? spy.attrs.cunning * 0.025 : 0) + mod(empireMods(state, e), 'intel') / 200;
}

export function successChance(state: GameState, owner: Empire, target: Empire, kind: CovertKind, agentId: number): number {
  const agent = charById(state, agentId);
  const skill = agent ? agent.attrs.cunning * 0.025 + agent.level * 0.01 : 0;
  return Math.max(0.1, Math.min(0.95, COVERT[kind].base + skill - counterIntel(state, target)));
}

/** Intel bonus from a live network in `target`. */
export function networkBonus(state: GameState, viewer: number, target: number): number {
  const until = state.empires[viewer]?.intelNetworks?.[target];
  return until != null && until > state.tick ? 30 : 0;
}

export function validateOp(state: GameState, e: Empire, targetId: number, kind: CovertKind, agentId: number, planetId: number | null): string | null {
  const def = COVERT[kind];
  if (!def) return 'Unknown operation';
  const t = state.empires[targetId];
  if (!t || !t.alive || t.id === e.id || (t.kind !== 'major' && t.kind !== 'minor')) return 'Choose a rival realm';
  const agent = charById(state, agentId);
  if (!agent || agent.ownerId !== e.id || agent.status !== 'active' || agent.role !== 'spymaster') return 'Only one of your spymasters can run an operation';
  if (covertOps(state).some((o) => o.agentId === agentId)) return `${agent.name} is already running an operation`;
  if (def.needsPlanet) {
    const p = planetId != null ? state.planets[planetId] : null;
    if (!p?.colony || p.colony.ownerId !== t.id) return 'Choose one of their worlds';
  }
  if (kind === 'steal_tech' && !t.research.done.some((id) => !e.research.done.includes(id))) return 'They know nothing you do not';
  if (e.stock.credits < def.cost.credits || e.stock.influence < def.cost.influence) return `Needs ${def.cost.credits} credits${def.cost.influence ? ` and ${def.cost.influence} influence` : ''}`;
  return null;
}

export function launchOp(state: GameState, e: Empire, targetId: number, kind: CovertKind, agentId: number, planetId: number | null): string | null {
  const err = validateOp(state, e, targetId, kind, agentId, planetId);
  if (err) return err;
  const def = COVERT[kind];
  e.stock.credits -= def.cost.credits;
  e.stock.influence -= def.cost.influence;
  (state.covert ??= []).push({ id: nextId(state), ownerId: e.id, targetId, kind, agentId, planetId: def.needsPlanet ? planetId : null, progress: 0, total: def.days, started: state.tick });
  return null;
}

export function cancelOp(state: GameState, e: Empire, opId: number): string | null {
  const op = covertOps(state).find((o) => o.id === opId);
  if (!op || op.ownerId !== e.id) return 'No such operation';
  state.covert = covertOps(state).filter((o) => o !== op);
  return null;
}

/** Advance operations by `days`; resolve the finished ones. */
export function espionageTick(state: GameState, days: number) {
  if (!state.covert?.length) return;
  const done: CovertOp[] = [];
  for (const op of state.covert) {
    const agent = charById(state, op.agentId);
    const owner = state.empires[op.ownerId], target = state.empires[op.targetId];
    // the agent died, defected or was captured, or a side fell: the operation collapses
    if (!agent || agent.status !== 'active' || agent.ownerId !== op.ownerId || !owner.alive || !target.alive) { done.push(op); continue; }
    if (op.planetId != null && state.planets[op.planetId].colony?.ownerId !== op.targetId) { done.push(op); continue; }
    op.progress += days;
    if (op.progress >= op.total) { resolve(state, op); done.push(op); }
  }
  state.covert = state.covert.filter((o) => !done.includes(o));
}

function resolve(state: GameState, op: CovertOp) {
  const owner = state.empires[op.ownerId], target = state.empires[op.targetId];
  const agent = charById(state, op.agentId)!;
  const def = COVERT[op.kind];
  const ok = next(state.rng) < successChance(state, owner, target, op.kind, op.agentId);
  const discovered = chance(state.rng, ok ? 0.15 : 0.6);
  let outcome = '';
  if (ok) {
    if (op.kind === 'gather_intel') {
      (owner.intelNetworks ??= {})[target.id] = state.tick + NETWORK_DAYS;
      outcome = `A network now reports from inside the ${target.name}.`;
    } else if (op.kind === 'steal_tech') {
      const known = target.research.done.filter((id) => !owner.research.done.includes(id) && TECH_BY_ID[id]);
      const usable = known.filter((id) => canResearch(owner, id));
      const goal = owner.research.current && known.includes(owner.research.current) ? owner.research.current : usable.sort((a, b) => techCost(a) - techCost(b))[0];
      if (goal) {
        if (!owner.research.current) owner.research.current = goal;
        const gain = techCost(goal) * (owner.research.current === goal ? 0.6 : 0.3);
        owner.research.progress += gain;
        outcome = `Plans for ${TECH_BY_ID[goal].name} were copied (${Math.round(gain)} research).`;
      } else {
        owner.research.progress += 120;
        outcome = 'Fragments of their research were recovered.';
      }
    } else if (op.kind === 'sabotage') {
      const c = state.planets[op.planetId!].colony!;
      const hit = INDUSTRY.filter((b) => (c.buildings[b] ?? 0) > 0);
      if (hit.length) {
        const b = pick(state.rng, hit);
        c.buildings[b] = (c.buildings[b] ?? 1) - 1;
        if (!c.buildings[b]) delete c.buildings[b];
        outcome = `A ${BUILDINGS[b].label.toLowerCase()} on ${state.planets[op.planetId!].name} was destroyed.`;
      } else {
        c.defenseDamage = 1;
        outcome = `The orbital batteries of ${state.planets[op.planetId!].name} were knocked out.`;
      }
    } else {
      const c = state.planets[op.planetId!].colony!;
      c.stability = Math.max(0, c.stability - 25);
      outcome = `Riots break out on ${state.planets[op.planetId!].name}.`;
    }
    agent.xp += 40;
  } else outcome = 'The operation failed.';

  let captured = false;
  if (discovered) {
    addMemory(state, target.id, owner.id, 'espionage', -25, 1, 'Caught spying on us');
    if (!ok && chance(state.rng, 0.35)) {
      unassign(state, agent);
      agent.status = 'captive'; agent.captorId = target.id; agent.capturedTick = state.tick; agent.assignment = null;
      agent.bio.push({ tick: state.tick, text: `Captured by the ${target.name} while on a covert mission.` });
      captured = true;
    }
  }
  agent.bio.push({ tick: state.tick, text: `${def.label} against the ${target.name}: ${ok ? 'success' : 'failure'}.` });
  const mine = owner.id === state.playerId, theirs = target.id === state.playerId;
  if (mine) log(state, { kind: 'espionage', severity: ok ? 'good' : 'warn', title: `${def.label}: ${ok ? 'success' : 'failure'}`, text: `${outcome}${discovered ? ` The ${target.name} discovered our hand.` : ''}${captured ? ` ${agent.name} was taken prisoner.` : ''}`, empires: [owner.id] });
  if (theirs && (discovered || (ok && op.kind !== 'gather_intel'))) log(state, { kind: 'espionage', severity: 'danger', title: discovered ? `${owner.name} spies caught` : 'Sabotage suspected', text: `${outcome}${discovered ? ` The ${owner.name} were behind it.` : ' The culprit is unknown.'}${captured ? ` Their agent ${agent.name} is our prisoner.` : ''}`, empires: [target.id] });
}
