// Guidance state. Lesson progress, first-visit cards and hint snoozes are saved with the game
// (GameState.guidance) so they survive refreshes, saves and loads; the player's preferences
// (guidance on or off) belong to the browser, so an experienced player turns them off once.

import type { GameState, GuidanceState } from '../sim/types';
import { ownedSystems } from '../sim/territory';
import { charactersOf } from '../sim/characters';

export function emptyGuidance(): GuidanceState {
  return { active: null, step: 0, paused: false, done: [], skipped: [], offered: [], seen: [], snoozed: {}, base: {} };
}

/** The game's guidance record, created on first use (older saves have none). */
export function guidanceOf(g: GameState): GuidanceState {
  if (!g.guidance) g.guidance = emptyGuidance();
  const s = g.guidance;
  s.done ??= []; s.skipped ??= []; s.offered ??= []; s.seen ??= []; s.snoozed ??= {}; s.base ??= {};
  return s;
}

// ---------------------------------------------------------------- preferences

export interface GuidancePrefs {
  /** offer lessons and show first-visit cards */
  lessons: boolean;
  /** advisor hints about real problems (shortages, idle research, ...) */
  hints: boolean;
  /** explanatory tooltips on terms, resources and controls */
  tooltips: boolean;
}

const PREFS_KEY = 'sd.guidance.v1';
export const DEFAULT_PREFS: GuidancePrefs = { lessons: true, hints: true, tooltips: true };
let prefs: GuidancePrefs | null = null;
const listeners = new Set<() => void>();

export function guidancePrefs(): GuidancePrefs {
  if (prefs) return prefs;
  prefs = { ...DEFAULT_PREFS };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) Object.assign(prefs, JSON.parse(raw));
  } catch { /* storage unavailable: defaults */ }
  return prefs;
}

export function setGuidancePrefs(p: Partial<GuidancePrefs>) {
  prefs = { ...guidancePrefs(), ...p };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* not persisted */ }
  for (const l of listeners) l();
}

export function onPrefsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// ---------------------------------------------------------------- counters

const mine = (g: GameState) => g.planets.filter((p) => p.colony?.ownerId === g.playerId);

/** Counters that lesson objectives compare against the moment a step began. */
export function counters(g: GameState): Record<string, number> {
  const e = g.empires[g.playerId];
  const cols = mine(g);
  const cap = e.capital;
  return {
    explored: e.explored.length,
    buildings: cols.reduce((a, p) => a + Object.values(p.colony!.buildings).reduce((x, n) => x + (n ?? 0), 0) + p.colony!.queue.length, 0),
    ships: Object.values(g.fleets).filter((f) => f.ownerId === g.playerId).reduce((a, f) => a + f.ships.length, 0) + cols.reduce((a, p) => a + p.colony!.shipQueue.length, 0),
    systems: ownedSystems(g, g.playerId).length,
    colonies: cols.length + g.planets.filter((p) => p.colonizing?.empireId === g.playerId).length,
    capitalWork: cap ? Object.values(cap.buildings).reduce((a, b) => a + b.level, 0) + cap.queue.length : 0,
    researchQueued: e.research.queue.length + (e.research.current ? 1 : 0),
    researchDone: e.research.done.length,
    characters: charactersOf(g, g.playerId).length,
    assigned: charactersOf(g, g.playerId).filter((c) => c.assignment).length,
    decrees: e.decrees?.length ?? 0,
    designations: cols.filter((p) => p.colony!.designation && p.colony!.designation !== 'balanced').length,
    stances: Object.values(g.fleets).filter((f) => f.ownerId === g.playerId && f.stance !== 'aggressive').length,
    market: Object.values(g.market.volume).reduce((a, v) => a + v, 0),
    treaties: g.treaties.filter((t) => t.a === g.playerId || t.b === g.playerId).length,
    proposals: g.proposals.filter((p) => p.from === g.playerId).length,
    covert: (g.covert ?? []).filter((o) => o.ownerId === g.playerId).length,
    heir: e.heirId != null ? 1 : 0,
  };
}
