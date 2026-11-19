// Pure layout for the diorama capital: where each plot stands on the terraced island.
// Plot IDs are the simulation's (0..PLOT_COLS*PLOT_ROWS-1); only their 3D placement changes.
// Plots open outward from the Citadel in PLOT_ORDER, so unlock order maps to terraces:
// the Citadel crowns the central plateau, the next plots ring the upper terrace, and so on.

import { PLOT_COLS, PLOT_ROWS, CITADEL_PLOT } from '../../sim/data/capital';
import { PLOT_ORDER } from '../../sim/capital';

export type District = 'crown' | 'government' | 'research' | 'military' | 'industry' | 'residential';

export interface Terrace { level: number; inner: number; outer: number; height: number; wobble: number }

/** Terraces from the central plateau outward. Radii are nominal; edges wobble by `wobble`. */
export const TERRACES: Terrace[] = [
  { level: 0, inner: 0, outer: 8.5, height: 13.5, wobble: 0.35 },
  { level: 1, inner: 8.5, outer: 19, height: 9.6, wobble: 0.9 },
  { level: 2, inner: 19, outer: 30.5, height: 6.0, wobble: 1.4 },
  { level: 3, inner: 30.5, outer: 44.5, height: 2.8, wobble: 2.6 },
];
export const SEA_LEVEL = 0;
/** The canal ring on the outer terrace, crossed by the radial avenues. */
export const CANAL = { radius: 32.4, width: 2.0, level: 1.9 };
/** Radial avenues (radians), diagonal so they fan out towards a south-facing camera. */
export const AVENUES = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
export const PLOT_RADIUS = 3.4;

export interface PlotSlot { plot: number; x: number; z: number; y: number; terrace: number; angle: number; radius: number; district: District }

/** District by compass sector (angle measured from +x towards +z; the camera looks from +z). */
export function districtAt(angle: number, terrace: number): District {
  if (terrace === 0) return 'crown';
  const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const sector = Math.floor(a / (Math.PI / 3)); // six sectors of 60°
  return (['industry', 'residential', 'residential', 'military', 'government', 'research'] as District[])[sector];
}

/** Deterministic smooth wobble for terrace edges. */
export function edgeNoise(angle: number, seed: number): number {
  return Math.sin(angle * 3 + seed * 1.7) * 0.5 + Math.sin(angle * 7 + seed * 3.1) * 0.3 + Math.sin(angle * 13 + seed * 5.3) * 0.2;
}

export function terraceEdge(t: Terrace, angle: number): number {
  return t.outer + edgeNoise(angle, t.level + 1) * t.wobble;
}

/** Height of the walkable ground at (x, z), or null over open sea. */
export function groundHeight(x: number, z: number): number | null {
  const r = Math.hypot(x, z), a = Math.atan2(z, x);
  for (const t of TERRACES) if (r <= terraceEdge(t, a)) return t.height;
  return null;
}

/**
 * Slot for every plot. Slots on a terrace are spread evenly and kept off the avenues; the
 * upper terrace has eight places for seven plots, the spare one becomes a memorial plaza.
 */
export function dioramaLayout(): PlotSlot[] {
  const total = PLOT_COLS * PLOT_ROWS;
  const rank = new Map<number, number>();
  PLOT_ORDER.forEach((p, i) => rank.set(p, i));
  const rings = [
    { terrace: 1, radius: 13.6, count: 8, first: 1 },
    { terrace: 2, radius: 24.6, count: 8, first: 8 },
    { terrace: 3, radius: 38.2, count: 8, first: 16 },
  ];
  const slots: PlotSlot[] = [];
  for (let plot = 0; plot < total; plot++) {
    const r = plot === CITADEL_PLOT ? 0 : rank.get(plot)!;
    if (r === 0) { slots.push({ plot, x: 0, z: 0, y: TERRACES[0].height, terrace: 0, angle: 0, radius: 0, district: 'crown' }); continue; }
    const ring = rings.find((g, i) => r >= g.first && (i === rings.length - 1 || r < rings[i + 1].first))!;
    const k = r - ring.first;
    // between avenues: avenues sit on odd multiples of 45°, slots on 22.5° offsets either side
    const angle = Math.PI / 8 + (k * Math.PI * 2) / ring.count;
    const radius = ring.radius;
    const t = TERRACES[ring.terrace];
    slots.push({ plot, x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, y: t.height, terrace: ring.terrace, angle, radius, district: districtAt(angle, ring.terrace) });
  }
  return slots;
}

/** Angle of the upper-terrace place left free for the memorial plaza. */
export function memorialAngle(): number {
  return Math.PI / 8 + (7 * Math.PI * 2) / 8;
}
