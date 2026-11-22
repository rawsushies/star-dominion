// Ambitions: optional milestones that mark the road from one vulnerable world to an interstellar
// civilisation. They never force a playstyle: each phase offers several, any of which can be
// pursued or ignored, and each pays a modest one-time reward when met. Only the player's realm
// tracks them (the AI follows its own plans in strategy.ts).

import { opsOf } from './operations';
import { hasTreaty } from './territory';
import { log } from './util';
import { dominationShares } from './victory';
import type { Empire, GameState } from './types';

export type Phase = 'early' | 'mid' | 'late';
export const PHASE_LABEL: Record<Phase, string> = { early: 'A foothold among the stars', mid: 'A realm among realms', late: 'A civilisation of the galaxy' };

export interface AmbitionDef {
  id: string;
  phase: Phase;
  title: string;
  /** what to do, in plain words */
  how: string;
  progress: (s: GameState, e: Empire) => { have: number; need: number };
  reward: { stock?: Record<string, number>; timed?: { days: number; mods: Record<string, number>; label: string } };
  rewardText: string;
}

const megaStages = (s: GameState, e: Empire) => { let n = 0; for (const sys of s.galaxy.systems) for (const m of sys.megastructures) if (m.ownerId === e.id) n += m.stage; return n; };
const colonies = (e: Empire) => e.stats.colonies ?? 0;

export const AMBITIONS: AmbitionDef[] = [
  // early: survival, scouting, expansion, first contact
  { id: 'chart', phase: 'early', title: 'Chart the neighbourhood', how: 'Send scouts to explore 12 systems.', progress: (s, e) => ({ have: e.explored.length, need: 12 }), reward: { stock: { influence: 30 } }, rewardText: '+30 influence' },
  { id: 'second_world', phase: 'early', title: 'A second world', how: 'Found a colony with a colony ship.', progress: (s, e) => ({ have: colonies(e), need: 2 }), reward: { stock: { minerals: 200, food: 100 } }, rewardText: '+200 minerals, +100 food' },
  { id: 'claims', phase: 'early', title: 'Stake our claims', how: 'Hold 6 systems with outposts and colonies.', progress: (s, e) => ({ have: e.stats.systems, need: 6 }), reward: { stock: { alloys: 100, influence: 20 } }, rewardText: '+100 alloys, +20 influence' },
  { id: 'contact', phase: 'early', title: 'Open relations', how: 'Sign any treaty with another great realm (a non-aggression pact is the easiest) in Diplomacy.', progress: (s, e) => ({ have: s.treaties.some((t) => (t.a === e.id || t.b === e.id) && s.empires[t.a === e.id ? t.b : t.a]?.kind === 'major') ? 1 : 0, need: 1 }), reward: { stock: { influence: 25 } }, rewardText: '+25 influence' },
  { id: 'scholars', phase: 'early', title: 'Halls of learning', how: 'Research 8 technologies.', progress: (s, e) => ({ have: e.research.done.length, need: 8 }), reward: { timed: { days: 720, mods: { 'output.research': 0.1 }, label: 'Halls of learning' } }, rewardText: '+10% research for 2 years' },
  { id: 'navy', phase: 'early', title: 'A navy worth the name', how: 'Field warships with a combined strength of 150.', progress: (s, e) => ({ have: Math.round(e.stats.militaryPower), need: 150 }), reward: { stock: { alloys: 120 } }, rewardText: '+120 alloys' },
  // mid: specialisation, logistics, diplomacy, war
  { id: 'provinces', phase: 'mid', title: 'Specialised provinces', how: 'Give 3 colonies a designation (agrarian, mining, forge and so on) in Planets.', progress: (s, e) => ({ have: s.planets.filter((p) => p.colony?.ownerId === e.id && p.colony.designation && p.colony.designation !== 'balanced').length, need: 3 }), reward: { stock: { influence: 40 } }, rewardText: '+40 influence' },
  { id: 'supply', phase: 'mid', title: 'Lines of supply', how: 'Run 4 resource operations.', progress: (s, e) => ({ have: opsOf(s, e.id).length, need: 4 }), reward: { stock: { credits: 400 } }, rewardText: '+400 credits' },
  { id: 'pact', phase: 'mid', title: 'Friends in the dark', how: 'Sign a mutual defence pact or an alliance.', progress: (s, e) => ({ have: s.empires.some((o) => o.id !== e.id && (hasTreaty(s, e.id, o.id, 'defense') || hasTreaty(s, e.id, o.id, 'alliance'))) ? 1 : 0, need: 1 }), reward: { stock: { influence: 50 } }, rewardText: '+50 influence' },
  { id: 'victor', phase: 'mid', title: 'Victor in war', how: 'End a war on favourable terms: tribute, ceded systems or vassalage.', progress: (s, e) => ({ have: e.warsWon ?? 0, need: 1 }), reward: { timed: { days: 1080, mods: { stability: 4 }, label: 'Glory of victory' } }, rewardText: '+4 stability for 3 years' },
  { id: 'imperium', phase: 'mid', title: 'Proclaim the Imperium', how: 'Reach the Interstellar Imperium era (10 technologies, 4 systems, 60 population).', progress: (s, e) => ({ have: Math.min(1, e.era ?? 0), need: 1 }), reward: { stock: { alloys: 200, credits: 300 } }, rewardText: '+200 alloys, +300 credits' },
  { id: 'citadel', phase: 'mid', title: 'A capital to awe the galaxy', how: 'Raise the Citadel to level 6.', progress: (s, e) => ({ have: e.capital?.buildings.citadel?.level ?? 0, need: 6 }), reward: { stock: { influence: 40 } }, rewardText: '+40 influence' },
  // late: blocs, great works, civilisation
  { id: 'stellar', phase: 'late', title: 'Harness a star', how: 'Reach the Stellar Ascendancy era.', progress: (s, e) => ({ have: Math.min(2, e.era ?? 0), need: 2 }), reward: { timed: { days: 1800, mods: { 'output.energy': 0.1 }, label: 'Stellar confidence' } }, rewardText: '+10% energy for 5 years' },
  { id: 'great_work', phase: 'late', title: 'A great work', how: 'Complete 3 megastructure stages.', progress: (s, e) => ({ have: megaStages(s, e), need: 3 }), reward: { stock: { influence: 60 } }, rewardText: '+60 influence' },
  { id: 'bloc', phase: 'late', title: 'Head of a bloc', how: 'Hold a vassal, or be allied with two realms at once.', progress: (s, e) => ({ have: Math.max(s.treaties.some((t) => t.type === 'vassal' && t.a === e.id) ? 2 : 0, s.treaties.filter((t) => t.type === 'alliance' && (t.a === e.id || t.b === e.id)).length), need: 2 }), reward: { stock: { influence: 60, credits: 500 } }, rewardText: '+60 influence, +500 credits' },
  { id: 'type_one', phase: 'late', title: 'Type I civilisation', how: 'Reach Kardashev 1.0 from usable power.', progress: (s, e) => ({ have: Math.floor((e.stats.kardashev ?? 0) * 100) / 100, need: 1 }), reward: { timed: { days: 1800, mods: { 'output.research': 0.1 }, label: 'Type I civilisation' } }, rewardText: '+10% research for 5 years' },
  { id: 'quarter', phase: 'late', title: 'A quarter of the galaxy', how: 'Hold a quarter of all claimed systems.', progress: (s, e) => ({ have: Math.floor(dominationShares(s, e).systems * 100), need: 25 }), reward: { stock: { influence: 50 } }, rewardText: '+50 influence' },
];

export const AMBITION_BY_ID: Record<string, AmbitionDef> = Object.fromEntries(AMBITIONS.map((a) => [a.id, a]));

/** The phase a realm is in: mid after three early ambitions or the first era; late after the second era or six mid ambitions. */
export function phaseOf(e: Empire): Phase {
  const done = new Set(e.ambitions ?? []);
  const count = (p: Phase) => AMBITIONS.filter((a) => a.phase === p && done.has(a.id)).length;
  if ((e.era ?? 0) >= 2 || count('mid') >= 4) return 'late';
  if ((e.era ?? 0) >= 1 || count('early') >= 3) return 'mid';
  return 'early';
}

export function ambitionList(state: GameState, e: Empire) {
  const done = new Set(e.ambitions ?? []);
  return AMBITIONS.map((a) => { const p = a.progress(state, e); return { def: a, done: done.has(a.id), have: p.have, need: p.need, frac: Math.max(0, Math.min(1, p.have / p.need)) }; });
}

/** Monthly: pay out ambitions the player has met (any phase may be met early). */
export function ambitionsMonthly(state: GameState) {
  const e = state.empires[state.playerId];
  if (!e?.alive) return;
  e.ambitions ??= [];
  for (const a of AMBITIONS) {
    if (e.ambitions.includes(a.id)) continue;
    const p = a.progress(state, e);
    if (p.have < p.need) continue;
    e.ambitions.push(a.id);
    for (const [k, v] of Object.entries(a.reward.stock ?? {})) (e.stock as Record<string, number>)[k] += v;
    if (a.reward.timed) for (const [k, v] of Object.entries(a.reward.timed.mods)) e.timedMods.push({ key: k, value: v, until: state.tick + a.reward.timed.days, label: a.reward.timed.label });
    log(state, { kind: 'ambition', severity: 'good', title: `Ambition fulfilled: ${a.title}`, text: `${a.rewardText}.`, empires: [e.id] });
  }
}
