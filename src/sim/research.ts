import { TECHS, TECH_BY_ID, techCost } from './data/techs';
import { log } from './util';
import type { Empire, GameState } from './types';
import { TIER_COST } from './data/techs';

export function canResearch(e: Empire, id: string): boolean {
  const t = TECH_BY_ID[id];
  if (!t || e.research.done.includes(id)) return false;
  if ((t.era ?? 0) > (e.era ?? 0)) return false;
  return t.requires.every((r) => e.research.done.includes(r));
}

export function availableTechs(e: Empire): string[] {
  return TECHS.filter((t) => canResearch(e, t.id)).map((t) => t.id);
}

/** Daily research progress; `perMonth` comes from the ledger. */
/** Output bonus per level of future studies (core outputs), see modifiers.ts. */
export const FUTURE_STEP = 0.02;
/** Research needed for the next level of future studies (grows with each level). */
export function futureStudyCost(level: number): number {
  return Math.round(TIER_COST[5] * (1 + level * 0.25));
}

export function progressResearch(state: GameState, e: Empire, perMonth: number) {
  const r = e.research;
  if (!r.current) {
    while (r.queue.length && !canResearch(e, r.queue[0])) {
      // drop invalid queue heads (already done); keep ones whose prereqs are queued earlier
      if (e.research.done.includes(r.queue[0])) r.queue.shift();
      else break;
    }
    if (r.queue.length && canResearch(e, r.queue[0])) r.current = r.queue.shift()!;
  }
  if (!r.current && availableTechs(e).length === 0) {
    // the tree is complete: research goes into open-ended future studies
    r.progress += Math.max(0, perMonth) / 30;
    const cost = futureStudyCost(r.future ?? 0);
    if (r.progress >= cost) {
      r.progress -= cost;
      r.future = (r.future ?? 0) + 1;
      if (e.id === state.playerId || r.future % 5 === 0) log(state, { kind: 'research', severity: e.id === state.playerId ? 'good' : 'info', title: `Future studies ${r.future}`, text: `The ${e.name} push past the known sciences (+${Math.round(FUTURE_STEP * 100)}% core output and +1% hull per level).`, empires: e.id === state.playerId ? [e.id] : [] });
    }
    return;
  }
  if (!r.current) {
    // bank a little progress so research is not wasted while idle
    r.progress = Math.min(r.progress + perMonth / 30, 200);
    return;
  }
  r.progress += Math.max(0, perMonth) / 30;
  const cost = techCost(r.current);
  if (r.progress >= cost) {
    const done = r.current;
    r.done.push(done);
    r.progress -= cost;
    r.current = null;
    const def = TECH_BY_ID[done];
    log(state, {
      kind: 'research', severity: 'good', title: `Research complete: ${def.name}`, text: def.description,
      empires: [e.id],
    });
    if (r.queue.length && canResearch(e, r.queue[0])) r.current = r.queue.shift()!;
  }
}
