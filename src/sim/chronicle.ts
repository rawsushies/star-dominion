// The chronicle: a yearly record of every sovereign realm's standing and the
// headlines of the year, kept separately from the capped event log so the
// whole history of a reign survives. Read by the Chronicle screen.

import type { ChronicleYear, GameState } from './types';

const HEADLINE_KINDS = new Set(['war', 'peace', 'victory', 'gameover', 'fall', 'rebellion', 'government', 'capital', 'era', 'megastructure', 'capture', 'character', 'guardian', 'treaty', 'conclave', 'ancients', 'devourer', 'omega', 'politics', 'history']);

/** Record the year that has just ended. Called on each new year (and at game start). */
export function recordYear(state: GameState) {
  state.chronicle ??= [];
  const last = state.chronicle[state.chronicle.length - 1];
  const since = last ? last.tick : -1;
  const stats = state.empires.filter((e) => e.kind === 'major' || e.kind === 'minor').map((e) => ({
    id: e.id, k: Math.round((e.stats?.kardashev ?? 0) * 1000) / 1000, pop: Math.round(e.stats?.population ?? 0), systems: e.stats?.systems ?? 0,
    colonies: e.stats?.colonies ?? 0, military: Math.round(e.stats?.militaryPower ?? 0), citadel: e.capital?.buildings.citadel?.level ?? 0, era: e.era ?? 0, alive: e.alive,
  }));
  const headlines = state.events
    .filter((ev) => ev.tick > since && ev.tick <= state.tick && (HEADLINE_KINDS.has(ev.kind) || ev.severity === 'danger') && ev.kind !== 'shortage')
    .slice(-16)
    .map((ev) => ({ tick: ev.tick, title: ev.title, kind: ev.kind, empires: ev.empires }));
  const entry: ChronicleYear = { tick: state.tick, stats, headlines };
  if (last && last.tick === state.tick) state.chronicle[state.chronicle.length - 1] = entry;
  else state.chronicle.push(entry);
}
