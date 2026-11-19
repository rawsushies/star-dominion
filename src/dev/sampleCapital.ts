// A fixed, mid-game imperial capital used by the capital laboratory, its screenshots and tests,
// so every variant renders exactly the same city.

import { newGame } from '../sim/engine';
import { openPlots } from '../sim/capital';
import { CAPITAL_BY_ID } from '../sim/data/capital';
import type { Empire, GameState } from '../sim/types';
import type { CapitalLabel } from '../ui/render/capital3d';

/** Buildings in placement order with their levels; the last two are under construction. */
const BUILDINGS: [string, number][] = [
  ['throne_hall', 11], ['treasury', 8], ['research_institute', 13], ['imperial_shipyards', 9], ['hall_of_heroes', 6],
  ['grand_market', 9], ['military_academy', 7], ['arcology', 12], ['refinery_complex', 8], ['diplomatic_quarter', 5],
  ['bastion', 6], ['stellar_observatory', 5], ['intelligence_bureau', 4], ['stellar_forge', 3],
];

export function sampleCapital(): { state: GameState; empire: Empire } {
  const state = newGame({ seed: 11 });
  const empire = state.empires[state.playerId];
  empire.capital = { buildings: { citadel: { level: 14, plot: empire.capital!.buildings.citadel.plot } }, queue: [] };
  const plots = openPlots(empire).filter((p) => p !== empire.capital!.buildings.citadel.plot);
  BUILDINGS.forEach(([id, level], i) => {
    if (i < BUILDINGS.length - 2) empire.capital!.buildings[id] = { level, plot: plots[i] };
  });
  // an upgrade in progress and a new building rising on an open plot
  empire.capital.queue.push({ building: 'arcology', toLevel: 13, plot: empire.capital.buildings.arcology.plot, progress: 40, total: 120 });
  empire.capital.queue.push({ building: 'intelligence_bureau', toLevel: 1, plot: plots[BUILDINGS.length - 2], progress: 18, total: 60 });
  return { state, empire };
}

/** The same labels the Capital screen builds. */
export function capitalLabels(e: Empire): CapitalLabel[] {
  const cap = e.capital!;
  const labels: CapitalLabel[] = [];
  const seen = new Set<string>();
  for (const [id, b] of Object.entries(cap.buildings)) {
    const job = cap.queue.find((j) => j.building === id);
    labels.push({ plot: b.plot, name: CAPITAL_BY_ID[id].label, level: b.level, building: !!job, progress: job ? job.progress / job.total : 0, days: job ? job.total - job.progress : 0 });
    seen.add(id);
  }
  for (const j of cap.queue) if (!seen.has(j.building)) { seen.add(j.building); labels.push({ plot: j.plot, name: CAPITAL_BY_ID[j.building].label, level: 0, building: true, progress: j.progress / j.total, days: j.total - j.progress }); }
  return labels;
}
