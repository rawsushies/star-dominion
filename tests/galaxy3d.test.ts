import { describe, expect, it } from 'vitest';
import { generateGalaxy, findPath, laneLength, adjacency, jumpDistances, ensureBodies } from '../src/sim/galaxy';
import { newGame, runDays } from '../src/sim/engine';
import { makeRng } from '../src/sim/rng';
import { serialize, deserialize } from '../src/sim/save';

function dijkstraLen(g: ReturnType<typeof generateGalaxy>['galaxy'], a: number, b: number): number {
  const n = g.systems.length, adj = adjacency(g);
  const d = new Array(n).fill(Infinity), done = new Array(n).fill(false);
  d[a] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && d[i] < best) { best = d[i]; u = i; }
    if (u < 0 || u === b) break;
    done[u] = true;
    for (const v of adj[u]) d[v] = Math.min(d[v], d[u] + laneLength(g, u, v));
  }
  return d[b];
}

describe('3D galaxy', () => {
  it('generates a connected 10,000-system barred spiral with real 3D structure and sectors', () => {
    const t0 = performance.now();
    const { galaxy, planets } = generateGalaxy(makeRng(99), 'milky', 99);
    const ms = performance.now() - t0;
    console.log(`milky generation: ${galaxy.systems.length} systems, ${galaxy.lanes.length} lanes, ${galaxy.sectors!.length} sectors in ${ms.toFixed(0)}ms`);
    expect(galaxy.systems.length).toBe(10000);
    expect(galaxy.lazyBodies).toBe(true);
    expect(planets.length).toBe(0);
    const d = jumpDistances(galaxy, [0]);
    expect(d.every(Number.isFinite)).toBe(true);
    const zs = galaxy.systems.map((s) => s.z ?? 0);
    const zSpread = Math.max(...zs) - Math.min(...zs);
    expect(zSpread).toBeGreaterThan(galaxy.shape!.R * 0.2); // disk thickness + halo clusters
    expect(new Set(galaxy.systems.map((s) => s.name)).size).toBe(10000);
    expect(galaxy.sectors!.length).toBeGreaterThanOrEqual(40);
    expect(galaxy.sectors!.reduce((a, s) => a + s.systems, 0)).toBe(10000);
    expect(galaxy.sectors!.some((s) => s.name === 'Galactic Core')).toBe(true);
    // the bulge is denser than the outer disk
    const cx = galaxy.width / 2, R = galaxy.shape!.R;
    const inner = galaxy.systems.filter((s) => Math.hypot(s.x - cx, s.y - cx) < 0.2 * R).length / (Math.PI * 0.04);
    const outer = galaxy.systems.filter((s) => { const r = Math.hypot(s.x - cx, s.y - cx); return r > 0.8 * R && r < R; }).length / (Math.PI * 0.36);
    expect(inner).toBeGreaterThan(outer * 2);
    const deg = adjacency(galaxy).map((a) => a.length);
    expect(deg.reduce((a, b) => a + b, 0) / deg.length).toBeGreaterThan(2);
  });

  it('finds optimal paths with A*', () => {
    const { galaxy } = generateGalaxy(makeRng(5), 'large', 5);
    for (const [a, b] of [[0, 77], [12, 101], [40, 3]]) {
      const p = findPath(galaxy, a, b)!;
      let len = 0, prev = a;
      for (const v of p) { len += laneLength(galaxy, prev, v); prev = v; }
      expect(len).toBeCloseTo(dijkstraLen(galaxy, a, b), 6);
    }
    const big = generateGalaxy(makeRng(7), 'milky', 7).galaxy;
    const t0 = performance.now();
    const path = findPath(big, 0, 9999);
    expect(path && path.length).toBeGreaterThan(5);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('materialises planets lazily and deterministically regardless of discovery order', () => {
    const a = newGame({ seed: 41, galaxySize: 'milky', aiCount: 3 });
    const b = deserialize(serialize(a));
    const far = a.galaxy.systems.filter((s) => !s.bodiesReady).slice(0, 3).map((s) => s.id);
    expect(far.length).toBe(3);
    for (const id of far) ensureBodies(a, id);
    for (const id of far.slice().reverse()) ensureBodies(b, id);
    for (const id of far) {
      const pa = a.galaxy.systems[id].planetIds.map((p) => [a.planets[p].type, a.planets[p].size, a.planets[p].name]);
      const pb = b.galaxy.systems[id].planetIds.map((p) => [b.planets[p].type, b.planets[p].size, b.planets[p].name]);
      expect(pa).toEqual(pb);
    }
  });

  it('simulates a 10,000-system galaxy at playable speed', () => {
    const t0 = performance.now();
    const s = newGame({ seed: 2026, galaxySize: 'milky', aiCount: 4 });
    const setup = performance.now() - t0;
    const t1 = performance.now();
    runDays(s, 720);
    const perDay = (performance.now() - t1) / 720;
    const json = serialize(s);
    console.log(`milky: setup ${setup.toFixed(0)}ms, ${perDay.toFixed(2)} ms/day, ${s.planets.length} planets materialised, save ${(json.length / 1e6).toFixed(2)} MB`);
    expect(s.empires.filter((e) => e.kind === 'major' && e.alive).length).toBeGreaterThanOrEqual(4);
    expect(s.empires.filter((e) => e.kind === 'minor').length).toBeGreaterThanOrEqual(10);
    // at 15 days per second the fastest game speed needs well under 66 ms per day
    expect(perDay).toBeLessThan(20);
    expect(s.empires[1].explored.length).toBeGreaterThan(5);
    expect(deserialize(json).galaxy.systems.length).toBe(10000);
  });
});
