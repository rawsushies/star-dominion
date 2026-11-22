// Strategic AI: long-term goals for each AI realm, fair difficulty presets, intelligence-limited
// estimates of rivals and coordinated war plans. The tactical layer in ai.ts carries the goals
// out with the same validated commands a player issues; nothing here grants resources or reads
// what the realm could not know (rival strength comes through the same fuzzed intelligence the
// player sees).

import { prologueActive, protectedPrey } from './prologue';
import { sendLetter } from './envoys';
import { fuzz, intelLevel, opinion, systemValue, hasContact, canDeclareWar } from './diplomacy';
import { bordering, hasTreaty, ownedSystems, warBetween } from './territory';
import { adjacency, jumpDistances } from './galaxy';
import { getLedger } from './engine';
import { hegemon } from './victory';
import { log } from './util';
import { execute } from './commands';
import type { AIGoal, AIPlan, Empire, GameState } from './types';

/**
 * Difficulty changes how well the rivals play, never what they are given. Every preset obeys the
 * same rules, costs and information limits as the player.
 */
export interface AIPreset {
  /** days between a realm's turns (reaction speed) */
  turnDays: number;
  /** days between strategic reviews */
  reviewDays: number;
  /** military strength ratio (own + allies vs theirs + allies) needed before declaring war */
  warRatio: number;
  /** concurrent offensive wars allowed */
  maxWars: number;
  /** years before an AI will plan a war against the player */
  playerGraceYears: number;
  /** may break a non-aggression pact to strike at once (low-diplomacy, aggressive temperaments only) */
  betrayal: boolean;
  /** may formally renounce a non-aggression pact, then arm (no war for at least six months) */
  renounce: boolean;
  /** independent battle groups in war: 1 = one doom-stack, 2+ adds raiding groups */
  battleGroups: number;
  /** 0..1 how strongly realms gang up on a runaway leader */
  coalition: number;
  /** multiplier on peacetime fleet size */
  militaryFill: number;
  /** chance a building decision is merely adequate rather than the best one */
  sloppiness: number;
  /** spends with a smaller safety margin (better economic tempo) */
  tightReserves: boolean;
  /** extra strength ratio wanted before going to war with the player (negative: presses the player harder) */
  playerBias: number;
}

export const AI_PRESETS: Record<GameState['settings']['difficulty'], AIPreset> = {
  relaxed: { playerBias: 0.6, turnDays: 8, reviewDays: 180, warRatio: 1.6, maxWars: 1, playerGraceYears: 15, betrayal: false, renounce: false, battleGroups: 1, coalition: 0.5, militaryFill: 0.8, sloppiness: 0.35, tightReserves: false },
  standard: { playerBias: 0, turnDays: 5, reviewDays: 120, warRatio: 1.5, maxWars: 1, playerGraceYears: 8, betrayal: false, renounce: true, battleGroups: 2, coalition: 0.8, militaryFill: 1, sloppiness: 0.1, tightReserves: false },
  hard: { playerBias: -0.2, turnDays: 3, reviewDays: 90, warRatio: 1.25, maxWars: 2, playerGraceYears: 4, betrayal: true, renounce: true, battleGroups: 3, coalition: 1, militaryFill: 1.15, sloppiness: 0, tightReserves: true },
};

export const DIFFICULTY_TEXT: Record<GameState['settings']['difficulty'], string> = {
  relaxed: 'Rivals react slowly, wage one war at a time, leave you alone for 15 years and make imperfect choices. They never betray treaties.',
  standard: 'Rivals plan wars, coordinate two battle groups, ally against a runaway leader and leave you alone for 8 years.',
  hard: 'Rivals act quickly, run tight economies, field several battle groups, fight two wars at once, may betray pacts and gang up on the leader. Same rules as you: no hidden bonuses.',
};

/** The preset an AI realm plays at. The player's own realm, when AI-driven in tests, plays at standard. */
export function aiPreset(state: GameState, e: Empire): AIPreset {
  if (e.id === state.playerId) return AI_PRESETS.standard;
  return AI_PRESETS[state.settings.difficulty] ?? AI_PRESETS.standard;
}

// ---------------------------------------------------------------- intelligence

/** What a realm believes a rival's military strength to be (null: no contact, no idea). */
export function estimatePower(state: GameState, viewer: number, target: number): number | null {
  if (viewer === target) return state.empires[viewer].stats.militaryPower || 1;
  const intel = intelLevel(state, viewer, target);
  if (intel <= 0) return null;
  // the estimate drifts yearly, as the player's does
  return Math.max(1, fuzz(state.empires[target].stats.militaryPower || 1, intel, viewer * 131 + target * 17 + Math.floor(state.tick / 360)).value);
}

/** Estimated strength of a realm plus the partners who would fight beside it in a defensive war. */
export function estimateBloc(state: GameState, viewer: number, target: number, exclude = -1): number {
  let p = estimatePower(state, viewer, target) ?? (state.empires[target].stats.militaryPower || 1);
  for (const t of state.treaties) {
    if (!(t.type === 'defense' || t.type === 'alliance' || t.type === 'vassal') || (t.a !== target && t.b !== target)) continue;
    const ally = t.a === target ? t.b : t.a;
    if (ally === viewer || ally === exclude || !state.empires[ally].alive) continue;
    p += (estimatePower(state, viewer, ally) ?? state.empires[ally].stats.militaryPower) * (t.type === 'vassal' ? 0.8 : 0.7);
  }
  return p;
}

/** Our strength plus allies who are already fighting the same enemy or are bound to us by alliance. */
function ownBloc(state: GameState, e: Empire, against: number): number {
  let p = e.stats.militaryPower || 1;
  // the enemy of my enemy: realms already at war with the target fight beside us in all but name
  for (const w of state.wars) {
    const side = w.attackers.includes(against) ? w.defenders : w.defenders.includes(against) ? w.attackers : null;
    if (!side) continue;
    for (const id of side) if (id !== e.id && state.empires[id]?.alive) p += (estimatePower(state, e.id, id) ?? state.empires[id].stats.militaryPower) * 0.5;
  }
  for (const t of state.treaties) {
    if (t.type !== 'alliance' || (t.a !== e.id && t.b !== e.id)) continue;
    const ally = t.a === e.id ? t.b : t.a;
    if (ally === against || hasTreaty(state, ally, against, 'alliance')) continue;
    p += (state.empires[ally].stats.militaryPower || 0) * 0.5;
  }
  return p;
}

// ---------------------------------------------------------------- plans

export function atWarCount(state: GameState, id: number, offensiveOnly = false): number {
  return state.wars.filter((w) => (offensiveOnly ? w.attackers[0] === id : w.attackers.includes(id) || w.defenders.includes(id))).length;
}

export function planOf(e: Empire): AIPlan {
  return (e.aiPlan ??= { goal: 'expand', since: 0, target: null, review: 0, peakSystems: 0 });
}

function setGoal(state: GameState, e: Empire, goal: AIGoal, target: number | null = null) {
  const plan = planOf(e);
  if (plan.goal === goal && plan.target === target) return;
  const was = plan.goal;
  plan.goal = goal; plan.target = target; plan.since = state.tick;
  // telegraph a build-up against the player when the player can see it
  if (goal === 'arm' && target === state.playerId && intelLevel(state, state.playerId, e.id) >= 30) {
    sendLetter(state, e, 'threat');
    log(state, { kind: 'threat', severity: 'warn', title: `${e.name} is arming`, text: `Envoys report ${e.adjective} shipyards working day and night, and ${e.adjective} fleets gathering near our border. A war may be coming. Strengthen the border, seek allies, or offer a pact.`, empires: [state.playerId] });
  }
  if (was === 'arm' && goal !== 'war' && plan.target == null && target == null) { /* stood down */ }
}

interface WarCandidate { id: number; score: number; ratio: number }

/** Rivals worth fighting: reachable, not protected by a pact, and valuable to us. */
export function warCandidates(state: GameState, e: Empire): WarCandidate[] {
  const preset = aiPreset(state, e);
  const pers = e.personality;
  const years = state.tick / 360;
  const lead = hegemon(state);
  const out: WarCandidate[] = [];
  const mine = new Set(ownedSystems(state, e.id));
  const adj = adjacency(state.galaxy);
  for (const o of state.empires) {
    if (!o.alive || o.id === e.id || !(o.kind === 'major' || o.kind === 'minor' || o.kind === 'rebels')) continue;
    if (!hasContact(state, e.id, o.id) || warBetween(state, e.id, o.id)) continue;
    if (o.id === state.playerId && (years < preset.playerGraceYears || prologueActive(state))) continue;
    if (protectedPrey(state, o.id)) continue;
    if (hasTreaty(state, e.id, o.id, 'alliance') || hasTreaty(state, e.id, o.id, 'defense') || hasTreaty(state, e.id, o.id, 'vassal')) continue;
    const nap = hasTreaty(state, e.id, o.id, 'nap');
    if (nap && !preset.renounce && !(preset.betrayal && pers.diplomacy < 0.4 && pers.aggression > 0.6)) continue;
    const truce = canDeclareWar(state, e.id, o.id);
    if (!truce.ok && !/influence/i.test(truce.reason ?? '')) continue;
    const border = bordering(state, e.id, o.id);
    if (!border) continue;
    // value: their systems that touch ours (what a war could actually take)
    let value = 0;
    for (const sid of ownedSystems(state, o.id)) if (adj[sid].some((v) => mine.has(v))) value += systemValue(state, sid);
    const ratio = ownBloc(state, e, o.id) / estimateBloc(state, e.id, o.id);
    const op = opinion(state, e.id, o.id);
    let score = value / 100 * Math.min(2.5, ratio) * (0.5 + pers.aggression) - op * 0.05;
    if (o.kind !== 'major') score *= 0.6 + pers.expansion * 0.6; // easy prey for expansionists
    if (lead && lead.id === o.id) score *= 1 + preset.coalition * lead.fear; // cut a runaway leader down
    if (nap) score *= 0.6 + (1 - pers.diplomacy) * 0.3; // pacts restrain the honourable more
    // opportunism: a realm already worn down by another war is easier prey
    const busy = state.wars.find((w) => w.attackers.includes(o.id) || w.defenders.includes(o.id));
    if (busy) { const theirs = busy.attackers.includes(o.id) ? busy.score : -busy.score; score *= 1 + Math.max(0, -theirs) / 100 + Math.min(0.4, o.warExhaustion / 100) + (1 - pers.diplomacy) * 0.2; }
    out.push({ id: o.id, score, ratio });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** A rival whose ultimatum was refused starts arming against the realm that refused it. */
export function refusedUltimatum(state: GameState, e: Empire, target: number) {
  if (target === state.playerId && prologueActive(state)) return;
  const plan = planOf(e);
  if (plan.goal === 'war' || plan.goal === 'recover') return;
  setGoal(state, e, 'arm', target);
  plan.review = state.tick + 120;
}

export type VictoryAim = 'domination' | 'supremacy' | 'ascension';
export const AIM_TEXT: Record<VictoryAim, string> = {
  domination: 'Wants to rule by conquest: takes land in its wars.',
  supremacy: 'Wants every realm to kneel: presses weaker neighbours to swear fealty and makes vassals of the defeated.',
  ascension: 'Wants to transcend: pours its wealth into research and the eras, and keeps a smaller fleet.',
};
/** The road to victory a realm's temperament inclines it toward. */
export function victoryAim(e: Empire): VictoryAim {
  const p = e.personality;
  if (p.science >= 0.7) return 'ascension';
  if (p.diplomacy >= 0.65 && p.aggression < 0.5) return 'supremacy';
  return 'domination';
}

/** The strategic review: pick the realm's goal for the coming months. */
export function reviewStrategy(state: GameState, e: Empire) {
  const plan = planOf(e);
  const preset = aiPreset(state, e);
  if (state.tick < plan.review) return;
  plan.review = state.tick + preset.reviewDays;
  if (e.stats.systems > plan.peakSystems || plan.grewTick == null) plan.grewTick = state.tick;
  plan.peakSystems = Math.max(plan.peakSystems, e.stats.systems);
  const L = getLedger(state, e);
  const pers = e.personality;
  const fighting = atWarCount(state, e.id) > 0;
  // 1) Recover when the realm is hurting: shortages, unrest, exhaustion or heavy losses.
  const hurt = L.shortages.length >= 2 || (e.stats.avgStability || 50) < 33 || e.warExhaustion > 70 || e.stats.systems < plan.peakSystems * 0.7;
  if (fighting) { setGoal(state, e, 'war', plan.target); return; }
  // a vassal that has regained its strength, or whose overlord is busy elsewhere, breaks free
  const bond = state.treaties.find((t) => t.type === 'vassal' && t.b === e.id);
  if (bond && e.kind === 'major' && state.tick - bond.since > 360 * 5) {
    const lord = state.empires[bond.a];
    const lordP = estimatePower(state, e.id, lord.id) ?? lord.stats.militaryPower;
    const distracted = atWarCount(state, lord.id) > 0;
    // a well-treated vassal stays loyal; a resentful one waits for its chance
    const content = opinion(state, e.id, lord.id) >= 25;
    if (!content && (e.stats.militaryPower || 1) >= lordP * (distracted ? 0.5 : 0.8) * (1.2 - pers.aggression * 0.4)) {
      execute(state, e.id, { type: 'breakTreaty', target: lord.id, treaty: 'vassal' });
      setGoal(state, e, 'war', lord.id);
      return;
    }
  }
  if (hurt) {
    setGoal(state, e, 'recover');
    if (e.stats.systems < plan.peakSystems * 0.7) plan.peakSystems = e.stats.systems; // accept the new borders once recovering
    return;
  }
  // 2) Arming against a chosen rival: strike when ready, or stand down after three years.
  if (plan.goal === 'arm' && plan.target != null) {
    const c = warCandidates(state, e).find((x) => x.id === plan.target);
    const ready = state.tick - plan.since >= 180 && (L.navalUsed >= L.navalCap * 0.85 || (c && c.ratio >= preset.warRatio + 0.4));
    const leadNow = hegemon(state);
    const needRatio = preset.warRatio + (plan.target === state.playerId ? preset.playerBias : 0) - pers.aggression * 0.3 - (leadNow && leadNow.id === plan.target ? 0.6 * leadNow.fear * preset.coalition : 0);
    if (c && c.ratio >= needRatio && ready && atWarCount(state, e.id, true) < preset.maxWars) {
      startWar(state, e, plan.target);
      return;
    }
    if (!c || state.tick - plan.since > 360 * 3 || c.ratio < 0.6) setGoal(state, e, 'develop');
    else return;
  }
  // 3) Plan a war when a worthwhile rival is within reach and the temperament allows.
  if (e.kind === 'major' && state.tick > 360 * 4 && e.warExhaustion < 20 && atWarCount(state, e.id, true) < preset.maxWars) {
    const best = warCandidates(state, e)[0];
    // restlessness: a realm that has stopped growing looks outward (scholars find other outlets)
    const stalledYears = (state.tick - (planOf(e).grewTick ?? state.tick)) / 360;
    const restless = Math.min(0.6, Math.max(0, stalledYears - 4) * 0.08) * (victoryAim(e) === 'ascension' ? 0.4 : 1);
    const appetite = pers.aggression * 0.7 + pers.expansion * 0.3 + (freeSystemsNear(state, e) === 0 ? 0.25 : 0) + restless;
    // against a runaway leader the bar is lower: everyone else is a potential ally
    const lead = hegemon(state);
    const minRatio = (lead && best && lead.id === best.id ? 0.8 - 0.35 * lead.fear * preset.coalition : 0.8) + (best?.id === state.playerId ? preset.playerBias * 0.5 : 0);
    if (best && best.score > 2 - appetite * 1.5 && best.ratio > minRatio) {
      const betray = preset.betrayal && pers.diplomacy < 0.4 && pers.aggression > 0.6;
      if (hasTreaty(state, e.id, best.id, 'nap') && !betray) {
        // the honest road to war: renounce the pact openly, then arm
        execute(state, e.id, { type: 'breakTreaty', target: best.id, treaty: 'nap' });
        if (best.id === state.playerId) log(state, { kind: 'threat', severity: 'danger', title: `${e.name} renounces our pact`, text: `${e.name} has ended its non-aggression pact with us. Expect war within months.`, empires: [state.playerId] });
      }
      setGoal(state, e, 'arm', best.id);
      return;
    }
  }
  // 4) Peaceful goals.
  if (freeSystemsNear(state, e) > 0 && e.stats.systems < (L.adminCap ?? 0) + 3 + pers.expansion * 4) setGoal(state, e, 'expand');
  else if ((e.era ?? 0) >= 2 || (e.era ?? 0) >= 1 && e.research.done.length >= (victoryAim(e) === 'ascension' ? 14 : 24)) setGoal(state, e, 'ascend');
  else setGoal(state, e, 'develop');
}

function freeSystemsNear(state: GameState, e: Empire): number {
  const owned = ownedSystems(state, e.id);
  if (!owned.length) return 0;
  const d = jumpDistances(state.galaxy, owned, undefined, 2);
  let n = 0;
  for (const s of state.galaxy.systems) if (s.owner == null && d[s.id] <= 2 && !s.features.includes('guardian')) n++;
  return n;
}

function startWar(state: GameState, e: Empire, target: number) {
  const nap = hasTreaty(state, e.id, target, 'nap');
  if (e.stock.influence < 40) return; // wait for the casus belli to be affordable
  const t = state.empires[target];
  // declared through the same command path as the player's
  if (!execute(state, e.id, { type: 'declareWar', target }).ok) return;
  setGoal(state, e, 'war', target);
  if (t.isPlayer) sendLetter(state, e, 'war', undefined, 0);
  if (nap) log(state, { kind: 'betrayal', severity: 'danger', title: `${e.name} betrays ${t.name}`, text: `${e.name} tore up its non-aggression pact and attacked. Other realms will remember.`, empires: [] });
}

// ---------------------------------------------------------------- budget

/** Share of naval capacity the realm keeps filled in its current situation. */
export function militaryFill(state: GameState, e: Empire): number {
  const preset = aiPreset(state, e);
  if (e.kind !== 'major') return atWarCount(state, e.id) ? 0.8 : 0.35;
  const plan = planOf(e);
  const a = e.personality.aggression;
  const threatened = state.wars.some((w) => w.defenders.includes(e.id));
  let fill: number;
  switch (plan.goal) {
    case 'war': fill = 1.05; break;
    case 'arm': fill = 1.0; break;
    case 'recover': fill = threatened ? 0.9 : 0.35; break;
    case 'ascend': fill = (victoryAim(e) === 'ascension' ? 0.35 : 0.45) + a * 0.3; break;
    default: fill = 0.4 + a * 0.4;
  }
  // a runaway neighbour is cause for more ships
  const lead = hegemon(state);
  if (lead && lead.id !== e.id && bordering(state, e.id, lead.id)) fill += 0.15 * preset.coalition * lead.fear;
  return Math.min(1.1, fill * (plan.goal === 'war' ? 1 : preset.militaryFill));
}

/** Coalition-building: realms threatened by a runaway leader seek defensive pacts with one another. */
export function coalitionWanted(state: GameState, e: Empire, partner: number): boolean {
  const lead = hegemon(state);
  if (!lead || lead.id === e.id || lead.id === partner) return false;
  const preset = aiPreset(state, e);
  if (lead.fear * preset.coalition < 0.35) return false;
  return bordering(state, e.id, lead.id) > 0 || bordering(state, partner, lead.id) > 0;
}
