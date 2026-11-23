// How a world looks, read from its simulated state: settlement density and maturity
// light its night side; refineries and foundries draw industrial belts; farms lay
// fields; arcologies and dense housing spread cities; war damage scorches the ground.

import type { GameState, Planet } from '../../sim/types';
import type { WorldLook } from './planet3d';

export function worldLook(state: GameState, p: Planet): WorldLook {
  const c = p.colony;
  if (!c) return { lights: 0, industry: 0, farm: 0, urban: 0, scar: 0 };
  const b = c.buildings;
  const dev = (c.dev ?? Math.min(100, c.pops * 2)) / 100;
  const scar = Math.min(1, (c.devastation ?? 0) / 80);
  const lights = Math.min(1, (c.pops / 25) * (0.55 + dev * 0.6)) * (1 - scar * 0.5);
  const industry = Math.min(1, ((b.refinery ?? 0) * 1.2 + (b.component_works ?? 0) * 1.5 + (b.electronics_fab ?? 0) + (b.mining ?? 0) * 0.25 + (b.fusion_plant ?? 0) * 0.5) / 7);
  const farm = Math.min(1, ((b.agri ?? 0) + (b.hydroponics ?? 0) * 0.5) / 5);
  const urban = Math.min(1, Math.max(0, ((b.residential ?? 0) * 0.6 + (b.arcology ?? 0) * 4 + c.pops / 15 - 3) / 10));
  void state;
  return { lights, industry, farm, urban, scar };
}

/** A key that changes when the look of a world changes visibly (for rebuild checks). */
export function worldLookKey(state: GameState, p: Planet): string {
  const w = worldLook(state, p);
  const q = (v: number) => Math.round(v * 10);
  return `${q(w.lights)}${q(w.industry)}${q(w.farm)}${q(w.urban)}${q(w.scar)}`;
}
