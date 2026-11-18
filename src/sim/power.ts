// Civilisation power and the Kardashev index.
//
// P is the usable power of a realm in watts, built up from real infrastructure:
//   - the planetary grid: every energy job, collector station and capital power
//     plant, whose output (in game energy units per month) is converted to watts
//     and raised by energy technology;
//   - stellar harvesting: collectors and Dyson swarms capture a fraction of their
//     host star's luminosity;
//   - galactic harvesting: sector-scale arrays capture the aggregated starlight
//     of the stars a simulated sector stands for;
//   - the Continuum Engine (speculative vacuum-energy tap).
// Usable power is the total multiplied by grid efficiency.
//
// Kardashev index (Sagan's interpolation):  K = (log10(P) - 6) / 10
//   Type I   = 1e16 W  (K = 1)  planetary
//   Type II  = 1e26 W  (K = 2)  stellar
//   Type III = 1e36 W  (K = 3)  galactic
//   Type IV / V (1e46 / 1e56 W) are speculative extensions beyond Kardashev's
//   original scale and are labelled as such everywhere they appear.
//
// This is a scientific energy rating. Political eras (data/eras.ts) are separate;
// some eras merely list a minimum K among their requirements.

import { STAR_TYPES } from './data/planets';
import { MEGA_BY_ID } from './data/megastructures';
import { getLedger } from './engine';
import type { Empire, GameState } from './types';

export const SOLAR_LUMINOSITY_W = 3.828e26;
/** One game energy unit per month of grid output, expressed as sustained watts. */
export const WATTS_PER_ENERGY_UNIT = 3e11;
/** Stars represented by each simulated system when a galaxy model reports none. */
export const DEFAULT_STARS_PER_SYSTEM = 1;

/** Fraction of the host star's luminosity captured per completed stage. */
const STELLAR_CAPTURE: Record<string, number> = {
  stellar_collector: 1e-5,
  dyson_swarm: 0.2,
};
/** Fraction of a sector's aggregated starlight captured per stage. */
const SECTOR_CAPTURE: Record<string, number> = { sector_array: 0.05 };
/** Speculative vacuum-energy output per Continuum Engine stage, in watts. */
const CONTINUUM_W = [0, 1e42, 1e44, 1e46];

export interface PowerSource { label: string; watts: number }
export interface PowerReport {
  /** usable power in watts */
  watts: number;
  /** gross power before grid losses */
  gross: number;
  efficiency: number;
  /** grid draw: energy consumed by the realm (watts) */
  consumption: number;
  sources: PowerSource[];
  k: number;
}

export function kardashevIndex(watts: number): number {
  if (!(watts > 0)) return 0;
  return (Math.log10(watts) - 6) / 10;
}

export function kardashevType(k: number): { label: string; speculative: boolean } {
  if (k >= 5) return { label: 'Type V', speculative: true };
  if (k >= 4) return { label: 'Type IV', speculative: true };
  if (k >= 3) return { label: 'Type III', speculative: false };
  if (k >= 2) return { label: 'Type II', speculative: false };
  if (k >= 1) return { label: 'Type I', speculative: false };
  return { label: 'Sub-Type I', speculative: false };
}

/** Watts for a given K (inverse of the index). */
export function wattsForK(k: number): number { return 10 ** (k * 10 + 6); }

/** Technology raises how much useful power each unit of grid output represents. */
export function gridTechMultiplier(e: Empire): number {
  const done = new Set(e.research.done);
  let m = 1;
  if (done.has('en_grid')) m *= 1.5;
  if (done.has('en_fusion')) m *= 4;
  if (done.has('en_capacitors')) m *= 1.3;
  if (done.has('en_zero_point')) m *= 12;
  if (done.has('era_stellar_engineering')) m *= 2;
  return m;
}

export function gridEfficiency(e: Empire): number {
  const done = new Set(e.research.done);
  let eff = 0.7;
  if (done.has('en_grid')) eff += 0.1;
  if (done.has('en_capacitors')) eff += 0.05;
  if (done.has('en_zero_point')) eff += 0.08;
  return Math.min(0.97, eff);
}

const megaLabels = new Set(Object.values(MEGA_BY_ID).map((m) => m.label));

export function civilisationPower(state: GameState, e: Empire): PowerReport {
  const L = getLedger(state, e);
  const sources: PowerSource[] = [];
  const mult = gridTechMultiplier(e);
  // Planetary grid: every positive energy line except megastructure flat outputs.
  let gridUnits = 0, drawUnits = 0;
  for (const l of L.lines) {
    if (l.key !== 'energy') continue;
    if (l.amount > 0 && !megaLabels.has(l.label)) gridUnits += l.amount;
    else if (l.amount < 0) drawUnits -= l.amount;
  }
  if (gridUnits > 0) sources.push({ label: 'Planetary grid', watts: gridUnits * WATTS_PER_ENERGY_UNIT * mult });
  const starsPer = state.galaxy.starsPerSystem ?? DEFAULT_STARS_PER_SYSTEM;
  const sectorStars = new Map<number, number>();
  for (const s of state.galaxy.systems) {
    const sec = s.sector ?? 0;
    sectorStars.set(sec, (sectorStars.get(sec) ?? 0) + starsPer);
  }
  let stellar = 0, galactic = 0, vacuum = 0;
  for (const s of state.galaxy.systems) {
    if (!s.megastructures.length) continue;
    for (const m of s.megastructures) {
      if (m.ownerId !== e.id || m.stage <= 0) continue;
      const lum = STAR_TYPES[s.star].luminosity * SOLAR_LUMINOSITY_W;
      if (STELLAR_CAPTURE[m.id]) stellar += lum * STELLAR_CAPTURE[m.id] * m.stage;
      if (SECTOR_CAPTURE[m.id]) galactic += (sectorStars.get(s.sector ?? 0) ?? starsPer) * SOLAR_LUMINOSITY_W * SECTOR_CAPTURE[m.id] * m.stage;
      if (m.id === 'continuum_engine') vacuum += CONTINUUM_W[Math.min(3, m.stage)];
    }
  }
  if (stellar > 0) sources.push({ label: 'Stellar harvesting', watts: stellar });
  if (galactic > 0) sources.push({ label: 'Galactic sector arrays', watts: galactic });
  if (vacuum > 0) sources.push({ label: 'Continuum Engine (speculative)', watts: vacuum });
  const gross = sources.reduce((a, x) => a + x.watts, 0);
  const efficiency = gridEfficiency(e);
  const watts = gross * efficiency;
  return { watts, gross, efficiency, consumption: drawUnits * WATTS_PER_ENERGY_UNIT * mult, sources, k: kardashevIndex(watts) };
}

/** Human-readable watts, e.g. "3.2 TW", "4.1e26 W". */
export function formatWatts(w: number): string {
  if (!(w > 0)) return '0 W';
  const units: [number, string][] = [[1e24, 'YW'], [1e21, 'ZW'], [1e18, 'EW'], [1e15, 'PW'], [1e12, 'TW'], [1e9, 'GW'], [1e6, 'MW']];
  if (w >= 1e27) return `${(w / 10 ** Math.floor(Math.log10(w))).toFixed(1)}e${Math.floor(Math.log10(w))} W`;
  for (const [v, u] of units) if (w >= v) return `${(w / v).toFixed(w / v >= 100 ? 0 : 1)} ${u}`;
  return `${w.toFixed(0)} W`;
}
