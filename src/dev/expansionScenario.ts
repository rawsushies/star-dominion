// Development only: put a game into a late-expansion state for browser tests and screenshots.
// Everything happens through the simulation's own systems (step, execute, the expansion modules).
import type { GameState } from '../sim/types';
import { runDays } from '../sim/engine';
import { exp } from '../sim/expansion';
import { addPressure, awaken } from '../sim/ancients';
import { addMemory } from '../sim/diplomacy';
import { execute } from '../sim/commands';
import { jumpDistances } from '../sim/galaxy';

export function expansionScenario(g: GameState, what: 'conclave' | 'ancients' | 'omega' | 'devourer' | 'politics') {
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
  if (what === 'politics') {
    // Automata Prime, stirring and close to waking, are at war with a rival over a trespass and blame the
    // player too. The rival, though it bears the player an old grudge, seeks a compact against them.
    // (A stirring power only defends its enclave, so nobody is overrun in the first months.)
    const me = g.empires[g.playerId];
    const auto = x.precursors.find((p) => p.id === 'automata')!;
    // the rival farthest from the enclave, so the war does not end before the politics begin
    const d = jumpDistances(g.galaxy, [g.empires[auto.empireId].capitalSystemId ?? auto.sacred[0]], undefined, 64);
    const far = (id: number | null) => (id != null && Number.isFinite(d[id]) ? d[id] : 99);
    const rival = g.empires.filter((e) => e.kind === 'major' && e.alive && !e.isPlayer).sort((a, b) => far(b.capitalSystemId) - far(a.capitalSystemId) || a.id - b.id)[0];
    for (const e of g.empires) if (e.kind === 'major' && e.alive) {
      for (const o of g.empires) if (o.capitalSystemId != null && !e.explored.includes(o.capitalSystemId)) e.explored.push(o.capitalSystemId);
      for (const p of x.precursors) for (const s of p.sacred) if (!e.explored.includes(s)) e.explored.push(s);
      e.stock.influence = Math.max(e.stock.influence, 300);
    }
    addMemory(g, rival.id, me.id, 'old_feud', -40, 0, 'An old feud');
    auto.blame = { [rival.id]: 60, [me.id]: 40 };
    auto.pressure = 85;
    auto.warned = 75;
    auto.status = 'stirring';
    g.empires[auto.empireId].stock.influence = Math.max(g.empires[auto.empireId].stock.influence, 100);
    execute(g, auto.empireId, { type: 'declareWar', target: rival.id });
    for (let i = 0; i < 6 && !x.politics.offers.some((o) => o.to === me.id); i++) runDays(g, 30);
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
