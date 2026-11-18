import { TECHS, TECH_BY_ID, techCost } from './data/techs';
import { log } from './util';
import type { Empire, GameState } from './types';

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
