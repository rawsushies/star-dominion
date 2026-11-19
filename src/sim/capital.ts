// The imperial capital city: Citadel levels, plots, the construction queue
// and the modifiers the city grants. Validation lives in canQueueCapital so
// the command layer, the AI and the UI share one set of rules.

import { CAPITAL_BUILDINGS, CAPITAL_BY_ID, COST_GROWTH, CITADEL_PLOT, PLOT_COLS, PLOT_ROWS, plotsUnlocked, type CapitalBuildingDef } from './data/capital';
import { empireMods, mod } from './modifiers';
import { log } from './util';
import type { CapitalState, Empire, GameState } from './types';

export function ensureCapital(e: Empire) {
  if (e.capital || !(e.kind === 'major' || e.kind === 'minor')) return;
  e.capital = { buildings: { citadel: { level: 1, plot: CITADEL_PLOT } }, queue: [] };
}

export function capLevel(e: Empire, id: string): number {
  return e.capital?.buildings[id]?.level ?? 0;
}

/** Plot order: outward from the Citadel, nearest first, ties by index. */
export const PLOT_ORDER: number[] = (() => {
  const cr = Math.floor(CITADEL_PLOT / PLOT_COLS), cc = CITADEL_PLOT % PLOT_COLS;
  const all = Array.from({ length: PLOT_COLS * PLOT_ROWS }, (_, i) => i);
  return all.sort((a, b) => {
    const da = Math.hypot(Math.floor(a / PLOT_COLS) - cr, (a % PLOT_COLS) - cc);
    const db = Math.hypot(Math.floor(b / PLOT_COLS) - cr, (b % PLOT_COLS) - cc);
    return da - db || a - b;
  });
})();

export function openPlots(e: Empire): number[] {
  return PLOT_ORDER.slice(0, plotsUnlocked(capLevel(e, 'citadel')));
}

export function plotOccupant(cap: CapitalState, plot: number): string | null {
  for (const [id, b] of Object.entries(cap.buildings)) if (b.plot === plot) return id;
  for (const j of cap.queue) if (j.plot === plot && !cap.buildings[j.building]) return j.building;
  return null;
}

export function capitalCost(def: CapitalBuildingDef, level: number): Record<string, number> {
  const out: Record<string, number> = {};
  const m = Math.pow(COST_GROWTH, level - 1);
  for (const [k, v] of Object.entries(def.cost)) out[k] = Math.round(v * m);
  return out;
}

export function capitalDays(state: GameState, e: Empire, def: CapitalBuildingDef, level: number): number {
  const base = def.days * (1 + 0.12 * (level - 1));
  return Math.max(5, Math.round(base / Math.max(0.3, 1 + mod(empireMods(state, e), 'buildSpeed'))));
}

/** Highest level a building has reached or is queued to reach. */
export function plannedLevel(e: Empire, id: string): number {
  let l = capLevel(e, id);
  for (const j of e.capital?.queue ?? []) if (j.building === id) l = Math.max(l, j.toLevel);
  return l;
}

/** What the Citadel needs before it can rise to level L. */
export function citadelRequirements(level: number): { otherLevels: number; throneHall: number } {
  if (level <= 2) return { otherLevels: 0, throneHall: 0 };
  return { otherLevels: (level - 2) * 2, throneHall: Math.floor(level / 2) };
}

export function maxQueue(e: Empire): number {
  return capLevel(e, 'citadel') >= 15 ? 3 : 2;
}
export function builders(e: Empire): number {
  return capLevel(e, 'citadel') >= 12 ? 2 : 1;
}

/** Why the next level of a building cannot be queued (null if it can). */
export function canQueueCapital(state: GameState, e: Empire, id: string, plot?: number): string | null {
  const def = CAPITAL_BY_ID[id];
  if (!def) return 'Unknown building';
  const cap = e.capital;
  if (!cap) return 'This realm has no capital city';
  if (e.capitalPlanetId == null || state.planets[e.capitalPlanetId]?.colony?.ownerId !== e.id) return 'The capital world is not in your hands';
  if (cap.queue.length >= maxQueue(e)) return `The builders' queue is full (${maxQueue(e)})`;
  const next = plannedLevel(e, id) + 1;
  if (next > def.maxLevel) return 'Already at its highest level';
  const citadel = plannedLevel(e, 'citadel');
  if (id === 'citadel') {
    const req = citadelRequirements(next);
    let others = 0;
    for (const [bid, b] of Object.entries(cap.buildings)) if (bid !== 'citadel') others += b.level;
    if (others < req.otherLevels) return `Citadel ${next} needs ${req.otherLevels} levels of other buildings (have ${others})`;
    if (capLevel(e, 'throne_hall') < req.throneHall) return `Citadel ${next} needs a level ${req.throneHall} throne hall`;
  } else {
    if (capLevel(e, 'citadel') < def.citadel) return `Requires Citadel level ${def.citadel}`;
    if (next > Math.max(1, citadel)) return `Cannot exceed the Citadel's level (${citadel})`;
    for (const [rid, lv] of Object.entries(def.requires ?? {})) if (capLevel(e, rid) < lv) return `Requires ${CAPITAL_BY_ID[rid].label} level ${lv}`;
    if (next === 1 && !cap.queue.some((j) => j.building === id)) {
      if (plot == null) return 'Choose a plot';
      if (!openPlots(e).includes(plot)) return 'That plot is not yet open. Raise the Citadel to open more.';
      if (plotOccupant(cap, plot)) return 'That plot is taken';
    }
  }
  for (const [k, v] of Object.entries(capitalCost(def, next))) if ((e.stock[k as keyof typeof e.stock] ?? 0) < v) return `Requires ${v} ${k}`;
  return null;
}

export function queueCapital(state: GameState, e: Empire, id: string, plot?: number) {
  const def = CAPITAL_BY_ID[id];
  const cap = e.capital!;
  const next = plannedLevel(e, id) + 1;
  const cost = capitalCost(def, next);
  for (const [k, v] of Object.entries(cost)) (e.stock as Record<string, number>)[k] -= v;
  const where = cap.buildings[id]?.plot ?? cap.queue.find((j) => j.building === id)?.plot ?? (id === 'citadel' ? CITADEL_PLOT : plot!);
  cap.queue.push({ building: id, toLevel: next, plot: where, progress: 0, total: capitalDays(state, e, def, next) });
}

/** Cancel a queued job; 75% of its cost is returned. Later levels of the same building are cancelled with it. */
export function cancelCapital(e: Empire, index: number): boolean {
  const cap = e.capital;
  const job = cap?.queue[index];
  if (!cap || !job) return false;
  const drop = cap.queue.filter((j, i) => i === index || (j.building === job.building && j.toLevel > job.toLevel));
  for (const j of drop) for (const [k, v] of Object.entries(capitalCost(CAPITAL_BY_ID[j.building], j.toLevel))) (e.stock as Record<string, number>)[k] += Math.floor(v * 0.75);
  cap.queue = cap.queue.filter((j) => !drop.includes(j));
  return true;
}

/** Daily: the builders work on the first jobs in the queue. */
export function progressCapitals(state: GameState) {
  for (const e of state.empires) {
    const cap = e.capital;
    if (!cap || !cap.queue.length || !e.alive) continue;
    if (e.capitalPlanetId == null || state.planets[e.capitalPlanetId]?.colony?.ownerId !== e.id) continue;
    const n = Math.min(builders(e), cap.queue.length);
    const done: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = cap.queue[i];
      // a later level waits for the earlier one
      if (cap.queue.slice(0, i).some((x) => x.building === j.building)) continue;
      j.progress++;
      if (j.progress >= j.total) done.push(i);
    }
    for (const i of done.reverse()) {
      const j = cap.queue[i];
      cap.queue.splice(i, 1);
      cap.buildings[j.building] = { level: j.toLevel, plot: j.plot };
      if (e.isPlayer) log(state, { kind: 'capital', severity: 'good', title: `${CAPITAL_BY_ID[j.building].label} ${j.toLevel > 1 ? `raised to level ${j.toLevel}` : 'completed'}`, text: j.building === 'citadel' ? `The Citadel rises. ${plotsUnlocked(j.toLevel)} plots are now open in the capital.` : CAPITAL_BY_ID[j.building].description, empires: [e.id], planetId: e.capitalPlanetId ?? undefined });
    }
  }
}

/** When the capital world falls, the city is sacked: every building loses a level and the queue is lost. */
export function sackCapital(state: GameState, e: Empire, by: string) {
  const cap = e.capital;
  if (!cap) return;
  cap.queue = [];
  for (const [id, b] of Object.entries(cap.buildings)) {
    b.level -= 1;
    if (b.level <= 0 && id !== 'citadel') delete cap.buildings[id];
    if (id === 'citadel' && b.level < 1) b.level = 1;
  }
  log(state, { kind: 'capital', severity: 'danger', title: `The capital of the ${e.name} is sacked`, text: `${by} has taken the capital world. Every great building of the city has lost a level.`, empires: [] });
}

export function capitalMods(e: Empire): Record<string, number> {
  const out: Record<string, number> = {};
  if (!e.capital) return out;
  for (const [id, b] of Object.entries(e.capital.buildings)) {
    const def = CAPITAL_BY_ID[id];
    if (!def) continue;
    for (const [k, v] of Object.entries(def.perLevel)) out[k] = (out[k] ?? 0) + v * b.level;
  }
  return out;
}

export function capitalSig(e: Empire): string {
  if (!e.capital) return '';
  let s = '';
  for (const id in e.capital.buildings) s += id + e.capital.buildings[id].level;
  return s;
}

export { CAPITAL_BUILDINGS };
