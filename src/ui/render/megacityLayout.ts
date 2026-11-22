// Layout of the capital megacity (capital laboratory, variant D). Pure data, no Three.js, so it can
// be tested. The city is a grid of 16-unit cells (a 10-unit plot and a 6-unit avenue):
//   - the Imperial Citadel stands on the central 2 x 2 cell block;
//   - ring 1 (the 12 cells around it) takes the first twelve plots in the game's unlock order
//     (PLOT_ORDER), ring 2 the remaining eleven, so unlocking still moves outward;
//   - every other cell of rings 2 and 3 is a district block of the wider city (residential,
//     industrial or energy), which appears as the Citadel rises;
//   - elevated highways run along the avenues that bound each ring, with radial arteries.
// The simulation's 24 plot ids are unchanged, so saves and gameplay are unaffected.

import { PLOT_ORDER } from '../../sim/capital';
import { CITADEL_PLOT } from '../../sim/data/capital';

export const CELL = 16;
export const PLOT = 10;
export const AVENUE = CELL - PLOT;
/** cells per side (centre block is 2 x 2 at indices 3 and 4) */
export const GRID = 8;

export function hash(n: number): number { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

export type DistrictKind = 'residential' | 'industrial' | 'energy' | 'civic' | 'plaza';

export interface MegaSlot { plot: number; x: number; z: number; ring: 1 | 2; cell: [number, number] }
export interface DistrictBlock { x: number; z: number; ring: 2 | 3; kind: DistrictKind; /** Citadel level from which it is built */ from: number; seed: number }
export interface HighwaySeg { x: number; z: number; dir: 'x' | 'z'; cross: boolean }

const centre = (i: number) => (i - GRID / 2 + 0.5) * CELL;
/** Chebyshev ring of a cell around the 2 x 2 centre block (0 = the block itself). */
export function ringOf(i: number, j: number): number {
  const d = (k: number) => (k < 3 ? 3 - k : k > 4 ? k - 4 : 0);
  return Math.max(d(i), d(j));
}
const angleOf = (i: number, j: number) => {
  const a = Math.atan2(centre(j), centre(i));
  return (a + Math.PI * 2.5) % (Math.PI * 2); // 0 = north (−z), clockwise
};

function cellsOfRing(r: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) if (ringOf(i, j) === r) out.push([i, j]);
  return out.sort((a, b) => angleOf(...a) - angleOf(...b));
}

/** District character by compass sector: industry to the east, energy to the north, homes south and west. */
export function districtFor(i: number, j: number): DistrictKind {
  const a = angleOf(i, j) / (Math.PI * 2);
  if (a < 0.12 || a >= 0.88) return 'energy';
  if (a < 0.38) return 'industrial';
  if (a < 0.62) return 'residential';
  return a < 0.75 ? 'civic' : 'residential';
}

export function megacityLayout(): { slots: MegaSlot[]; districts: DistrictBlock[]; highways: HighwaySeg[]; citadel: { x: number; z: number } } {
  const order = PLOT_ORDER.filter((p) => p !== CITADEL_PLOT);
  const ring1 = cellsOfRing(1), ring2 = cellsOfRing(2), ring3 = cellsOfRing(3);
  const slots: MegaSlot[] = [{ plot: CITADEL_PLOT, x: 0, z: 0, ring: 1, cell: [3, 3] }];
  order.slice(0, ring1.length).forEach((p, k) => {
    const [i, j] = ring1[k];
    slots.push({ plot: p, x: centre(i), z: centre(j), ring: 1, cell: [i, j] });
  });
  // the remaining plots spread evenly round ring 2
  const rest = order.slice(ring1.length);
  const used = new Set<number>();
  rest.forEach((p, k) => {
    let idx = Math.round((k * ring2.length) / rest.length) % ring2.length;
    while (used.has(idx)) idx = (idx + 1) % ring2.length;
    used.add(idx);
    const [i, j] = ring2[idx];
    slots.push({ plot: p, x: centre(i), z: centre(j), ring: 2, cell: [i, j] });
  });
  const districts: DistrictBlock[] = [];
  ring2.forEach(([i, j], idx) => { if (!used.has(idx)) districts.push({ x: centre(i), z: centre(j), ring: 2, kind: districtFor(i, j), from: 4 + (idx % 4), seed: i * 31 + j * 7 }); });
  ring3.forEach(([i, j], idx) => districts.push({ x: centre(i), z: centre(j), ring: 3, kind: districtFor(i, j), from: 8 + (idx % 6) * 2, seed: i * 31 + j * 7 }));
  // two public squares in ring 2, the blocks nearest the ceremonial axes: market plazas
  const squares = districts.filter((d) => d.ring === 2).sort((a, b) => Math.min(Math.abs(a.x), Math.abs(a.z)) - Math.min(Math.abs(b.x), Math.abs(b.z)) || a.seed - b.seed).slice(0, 2);
  for (const d of squares) { d.kind = 'plaza'; d.from = 1; }
  // elevated highways: square loops on the avenues bounding ring 1 and ring 2, and four radials
  const highways: HighwaySeg[] = [];
  const step = 6;
  // one elevated expressway ring over the ring road (3 cells out); the ceremonial axes and the
  // street round the plaza stay open boulevards
  for (const lineAt of [3 * CELL]) { // avenue centre lines lie on cell boundaries
    for (let t = -lineAt; t < lineAt; t += step) {
      highways.push({ x: t + step / 2, z: -lineAt, dir: 'x', cross: false }, { x: t + step / 2, z: lineAt, dir: 'x', cross: false });
      highways.push({ x: -lineAt, z: t + step / 2, dir: 'z', cross: false }, { x: lineAt, z: t + step / 2, dir: 'z', cross: false });
    }
  }
  return { slots, districts, highways, citadel: { x: 0, z: 0 } };
}

// ------------------------------------------------------------ the wider city and its traffic

export type SkylineModel = 'spire_a' | 'spire_b' | 'truss_a' | 'res_a' | 'res_b' | 'res_c' | 'hall_b' | 'vault';
/** Avenues that carry street traffic (cell boundaries; the central one crosses the Citadel plaza). */
/** Sky photograph (Poly Haven, Kloppenheim 06): where its sun lies, as a fraction of the image width. */
export const SKY_SUN_U = 0.613;
export const SUN = { elevation: 28, azimuth: -58 };

/** Models that make up the distant skyline beyond the walls (the kit's lighter towers). */
export const SKYLINE_MODELS: SkylineModel[] = ['spire_a', 'spire_b', 'truss_a', 'res_a', 'res_b', 'res_c', 'hall_b', 'vault'];

export interface SkylineTower { model: SkylineModel; x: number; z: number; ry: number; sx: number; sy: number; from: number }

/**
 * The wider metropolis beyond the walls: towers on concentric bands, leaving the four gate
 * approaches clear, with the farthest ones raised first. Each tower has the Citadel level from
 * which it stands, so the skyline thickens as the capital grows.
 */
export function skylineLayout(count: number, exclude?: (x: number, z: number) => boolean): SkylineTower[] {
  const out: SkylineTower[] = [];
  for (let i = 0; out.length < count && i < count * 4; i++) {
    const a = hash(i * 3.1) * Math.PI * 2;
    const r = 4 * CELL + 22 + Math.pow(hash(i * 7.7), 0.8) * 230;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 12 || Math.abs(z) < 12) continue; // gate approaches
    if (exclude?.(x, z)) continue; // outer districts, cargo road
    if (out.some((t) => Math.hypot(t.x - x, t.z - z) < 11)) continue;
    const model = SKYLINE_MODELS[Math.floor(hash(i * 1.9) * SKYLINE_MODELS.length) % SKYLINE_MODELS.length];
    const tall = model.startsWith('spire') || model === 'truss_a';
    const sx = 0.9 + hash(i * 5.3) * 0.5;
    const sy = sx * (tall ? 1 + hash(i * 2.2) * 0.9 : 1 + hash(i * 4.4) * 1.6);
    // more than half the outer city stands from the start, so even a young capital sits in a metropolis
    const f = hash(i * 6.6);
    out.push({ model, x, z, ry: Math.floor(hash(i * 9.1) * 4) * Math.PI / 2, sx, sy, from: f < 0.55 ? 1 : 2 + Math.floor(((f - 0.55) / 0.45) * 18) });
  }
  return out;
}

