// Development only: put a game into a late-expansion state for browser tests and screenshots.
// Everything happens through the simulation's own systems (step, execute, the expansion modules).
import type { GameState } from '../sim/types';
import { runDays } from '../sim/engine';
import { exp } from '../sim/expansion';
import { addPressure, awaken } from '../sim/ancients';

export function expansionScenario(g: GameState, what: 'conclave' | 'ancients' | 'omega' | 'devourer') {
  const x = exp(g);
  if (what === 'conclave' || what === 'omega') {
    // the rival realms reach the Imperium (the player's own era is left alone: no splash in the way)
    for (const e of g.empires) if (e.kind === 'major') { if (!e.isPlayer) e.era = Math.max(e.era, 1); e.stock.influence = Math.max(e.stock.influence, 300); }
    if (g.tick < 360 * 3) g.tick = 360 * 3 - 1;
    runDays(g, 31);
    x.conclave.nextOrdinary = g.tick;
  }
  if (what === 'ancients') {
    const [veil, auto] = x.precursors;
    addPressure(g, veil, 55, 'A test of the Archons\' patience', g.playerId);
    awaken(g, auto);
    for (const s of veil.sacred) if (!g.empires[g.playerId].explored.includes(s)) g.empires[g.playerId].explored.push(s);
    runDays(g, 31);
  }
  if (what === 'devourer') {
    x.devourer.spawnAt = g.tick + 1;
    runDays(g, 31);
  }
  if (what === 'omega') {
    const me = g.empires[g.playerId];
    me.research.done.push('era_dimensional', 'era_omega');
    runDays(g, 30 * 18);
  }
}
