// Uniform-grid spatial index over 3D points. Used by galaxy generation (local
// neighbour searches for hyperlanes and spacing), the AI and the renderer's
// region queries. O(1) insertion, near-O(k) radius queries for well-spread data.

export interface P3 { x: number; y: number; z?: number }

export class SpatialGrid {
  private cells = new Map<string, number[]>();
  constructor(private pts: P3[], readonly cell: number) {
    for (let i = 0; i < pts.length; i++) this.insertIndex(i);
  }

  private key(cx: number, cy: number, cz: number) { return `${cx},${cy},${cz}`; }
  private cellOf(p: P3): [number, number, number] {
    return [Math.floor(p.x / this.cell), Math.floor(p.y / this.cell), Math.floor((p.z ?? 0) / this.cell)];
  }

  insertIndex(i: number) {
    const [cx, cy, cz] = this.cellOf(this.pts[i]);
    const k = this.key(cx, cy, cz);
    const arr = this.cells.get(k);
    if (arr) arr.push(i); else this.cells.set(k, [i]);
  }

  /** Indices within `r` of point p (squared-distance test). */
  within(p: P3, r: number, out: number[] = []): number[] {
    const r2 = r * r;
    const span = Math.ceil(r / this.cell);
    const [cx, cy, cz] = this.cellOf(p);
    const pz = p.z ?? 0;
    for (let dx = -span; dx <= span; dx++) for (let dy = -span; dy <= span; dy++) for (let dz = -span; dz <= span; dz++) {
      const arr = this.cells.get(this.key(cx + dx, cy + dy, cz + dz));
      if (!arr) continue;
      for (const i of arr) {
        const q = this.pts[i];
        const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + ((q.z ?? 0) - pz) ** 2;
        if (d <= r2) out.push(i);
      }
    }
    return out;
  }

  /** True if any indexed point lies within r of p. */
  anyWithin(p: P3, r: number): boolean {
    const r2 = r * r;
    const span = Math.ceil(r / this.cell);
    const [cx, cy, cz] = this.cellOf(p);
    const pz = p.z ?? 0;
    for (let dx = -span; dx <= span; dx++) for (let dy = -span; dy <= span; dy++) for (let dz = -span; dz <= span; dz++) {
      const arr = this.cells.get(this.key(cx + dx, cy + dy, cz + dz));
      if (!arr) continue;
      for (const i of arr) {
        const q = this.pts[i];
        if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 + ((q.z ?? 0) - pz) ** 2 <= r2) return true;
      }
    }
    return false;
  }

  /** The k nearest indices to p (excluding `exclude`), searching outward up to maxR. */
  nearest(p: P3, k: number, maxR: number, exclude = -1): number[] {
    let r = this.cell;
    for (;;) {
      const cand = this.within(p, r).filter((i) => i !== exclude);
      if (cand.length >= k || r >= maxR) {
        const pz = p.z ?? 0;
        return cand
          .map((i) => [i, (this.pts[i].x - p.x) ** 2 + (this.pts[i].y - p.y) ** 2 + ((this.pts[i].z ?? 0) - pz) ** 2] as const)
          .sort((a, b) => a[1] - b[1])
          .slice(0, k)
          .map((x) => x[0]);
      }
      r = Math.min(maxR, r * 2);
    }
  }
}

export function dist3(a: P3, b: P3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}
