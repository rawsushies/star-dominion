// Where the current objective is, for the gold quest beacon on the galaxy map: the Pretender's
// world, free systems to claim, or the world the war lesson is about.
import type { GameState } from '../sim/types';
import { currentStage, pretenderOf } from '../sim/prologue';
import { guidanceOf } from './state';

export function questBeacons(g: GameState): number[] {
  const me = g.empires[g.playerId];
  if (!me?.alive) return [];
  const s = guidanceOf(g);
  // the war lesson's target comes first
  if (s.active === 'conquest' && !s.paused && s.focus) {
    const p = g.planets[s.focus.planetId];
    if (p && me.explored.includes(p.systemId) && p.colony?.ownerId !== g.playerId) return [p.systemId];
  }
  const stage = currentStage(g);
  if (!stage) return [];
  if (stage.id === 'borders') {
    const owned = new Set(g.galaxy.systems.filter((x) => x.owner === g.playerId).map((x) => x.id));
    const out: number[] = [];
    for (const [a, b] of g.galaxy.lanes) {
      const n = owned.has(a) ? b : owned.has(b) ? a : null;
      if (n == null || out.includes(n)) continue;
      const sys = g.galaxy.systems[n];
      if (sys.owner == null && !sys.outpostProject && !sys.features.includes('guardian') && me.explored.includes(n)) out.push(n);
      if (out.length >= 3) break;
    }
    return out;
  }
  const pr = pretenderOf(g);
  if ((stage.id === 'find' || stage.id === 'fleet' || stage.id === 'crown') && pr?.alive && pr.capitalSystemId != null) {
    // before it is found, point at the nearest unexplored system toward it
    if (me.explored.includes(pr.capitalSystemId)) return [pr.capitalSystemId];
    return stage.id === 'find' ? [] : [pr.capitalSystemId];
  }
  return [];
}
