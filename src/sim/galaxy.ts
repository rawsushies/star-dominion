// Procedural galaxy generation: spiral-disc star placement, a planar hyperlane
// graph (relative-neighbourhood graph + extra non-crossing links), star
// systems with planets/moons/belts/deposits and strategic features.

import { chance, int, next, pick, range, weighted, type RngState } from './rng';
import { PLANET_TYPES, STAR_TYPES } from './data/planets';
import { STAR_NAMES } from './data/names';
import type { Deposits, Galaxy, Planet, PlanetType, StarSystem, StarType, SystemFeature } from './types';

export const GALAXY_SIZES = { small: 30, medium: 60, large: 120 } as const;

export function generateGalaxy(rng: RngState, size: keyof typeof GALAXY_SIZES): { galaxy: Galaxy; planets: Planet[] } {
  const n = GALAXY_SIZES[size];
  const radius = Math.sqrt(n) * 68;
  const width = radius * 2 + 160;
  const height = width;
  const cx = width / 2;
  const cy = height / 2;
  const arms = n >= 90 ? 4 : 3;
  const minDist = 62;
  const pts: { x: number; y: number }[] = [];
  let guard = 0;
  while (pts.length < n && guard++ < n * 400) {
    // spiral arm distribution with a dense core falloff
    const t = Math.pow(next(rng), 0.75);
    const r = 70 + t * (radius - 70);
    const arm = Math.floor(next(rng) * arms);
    const twist = 3.0;
    const spread = 0.55 + 0.35 * (1 - t);
    const ang = (arm / arms) * Math.PI * 2 + t * twist + range(rng, -spread, spread);
    const x = cx + Math.cos(ang) * r + range(rng, -22, 22);
    const y = cy + Math.sin(ang) * r + range(rng, -22, 22);
    if (pts.every((p) => (p.x - x) ** 2 + (p.y - y) ** 2 > minDist * minDist)) pts.push({ x, y });
  }

  const names = shuffleNames(rng);
  const systems: StarSystem[] = pts.map((p, i) => ({
    id: i,
    name: names[i % names.length] + (i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : ''),
    x: Math.round(p.x),
    y: Math.round(p.y),
    star: weighted(rng, Object.keys(STAR_TYPES) as StarType[], (s) => STAR_TYPES[s].weight)!,
    planetIds: [],
    asteroidBelts: 0,
    owner: null,
    starbase: 0,
    starbaseDamage: 0,
    features: [],
    megastructures: [],
    outpostProject: null,
    starbaseUpgrade: null,
    ruinsSurveyed: false,
  }));

  const lanes = buildLanes(rng, systems);
  const planets: Planet[] = [];
  for (const sys of systems) generateBodies(rng, sys, planets);
  assignFeatures(rng, systems, lanes);
  return { galaxy: { width, height, systems, lanes }, planets };
}

function shuffleNames(rng: RngState): string[] {
  const arr = STAR_NAMES.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next(rng) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function segIntersect(a: StarSystem, b: StarSystem, c: StarSystem, d: StarSystem): boolean {
  if (a === c || a === d || b === c || b === d) return false;
  const o = (p: StarSystem, q: StarSystem, r: StarSystem) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function buildLanes(rng: RngState, s: StarSystem[]): [number, number][] {
  const n = s.length;
  const d2 = (i: number, j: number) => (s[i].x - s[j].x) ** 2 + (s[i].y - s[j].y) ** 2;
  const lanes: [number, number][] = [];
  // Relative neighbourhood graph: planar and always connected (superset of the MST).
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dij = d2(i, j);
      if (dij > 260 * 260) continue;
      let ok = true;
      for (let k = 0; k < n && ok; k++) {
        if (k === i || k === j) continue;
        if (Math.max(d2(i, k), d2(j, k)) < dij) ok = false;
      }
      if (ok) lanes.push([i, j]);
    }
  }
  // Guarantee connectivity even if the distance cap split the graph.
  connectComponents(s, lanes);
  // Sprinkle extra non-crossing links for route variety (keeps some chokepoints).
  const deg = new Array(n).fill(0);
  for (const [a, b] of lanes) { deg[a]++; deg[b]++; }
  const candidates: [number, number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const dd = d2(i, j);
    if (dd < 175 * 175) candidates.push([i, j, dd]);
  }
  candidates.sort((x, y) => x[2] - y[2]);
  for (const [i, j] of candidates) {
    if (lanes.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) continue;
    if (deg[i] >= 4 || deg[j] >= 4) continue;
    if (!chance(rng, 0.35)) continue;
    if (lanes.some(([a, b]) => segIntersect(s[a], s[b], s[i], s[j]))) continue;
    lanes.push([i, j]);
    deg[i]++; deg[j]++;
  }
  return lanes;
}

function connectComponents(s: StarSystem[], lanes: [number, number][]) {
  const n = s.length;
  for (;;) {
    const comp = new Array(n).fill(-1);
    let c = 0;
    const adj: number[][] = Array.from({ length: n }, () => []);
    for (const [a, b] of lanes) { adj[a].push(b); adj[b].push(a); }
    for (let i = 0; i < n; i++) {
      if (comp[i] >= 0) continue;
      const stack = [i];
      comp[i] = c;
      while (stack.length) {
        const u = stack.pop()!;
        for (const v of adj[u]) if (comp[v] < 0) { comp[v] = c; stack.push(v); }
      }
      c++;
    }
    if (c <= 1) return;
    let best: [number, number, number] | null = null;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (comp[i] !== 0 || comp[j] === 0) continue;
      const dd = (s[i].x - s[j].x) ** 2 + (s[i].y - s[j].y) ** 2;
      if (!best || dd < best[2]) best = [i, j, dd];
    }
    if (!best) return;
    lanes.push([best[0], best[1]]);
  }
}

const INNER: PlanetType[] = ['volcanic', 'desert', 'arid', 'toxic', 'barren'];
const MIDDLE: PlanetType[] = ['temperate', 'ocean', 'jungle', 'arid', 'desert', 'tundra', 'toxic', 'barren'];
const OUTER: PlanetType[] = ['frozen', 'tundra', 'gas_giant', 'gas_giant', 'barren', 'toxic'];

function rollDeposits(rng: RngState, type: PlanetType): Deposits {
  const d: Deposits = { minerals: 0, energy: 0, food: 0, rare: 0, research: 0 };
  const def = PLANET_TYPES[type];
  d.minerals = Math.round(def.yield.minerals * range(rng, 1, 4));
  d.energy = Math.round((type === 'gas_giant' ? 4 : def.yield.energy) * range(rng, 0.5, 3));
  d.food = Math.round(def.yield.food * range(rng, 0, 3));
  if (chance(rng, type === 'volcanic' || type === 'toxic' || type === 'gas_giant' ? 0.35 : 0.12)) d.rare = int(rng, 1, 3);
  if (chance(rng, 0.15)) d.research = int(rng, 2, 5);
  return d;
}

function generateBodies(rng: RngState, sys: StarSystem, planets: Planet[]) {
  const isBH = sys.star === 'black_hole' || sys.star === 'neutron';
  const count = isBH ? int(rng, 0, 2) : int(rng, 1, 6);
  for (let o = 0; o < count; o++) {
    const frac = count === 1 ? 0.5 : o / (count - 1);
    let pool = frac < 0.3 ? INNER : frac < 0.75 ? MIDDLE : OUTER;
    if (sys.star === 'blue' || sys.star === 'white') pool = frac < 0.5 ? INNER : MIDDLE;
    if (sys.star === 'red') pool = frac < 0.5 ? MIDDLE : OUTER;
    if (isBH) pool = ['barren', 'toxic', 'frozen'];
    let type = pick(rng, pool);
    if (chance(rng, 0.012) && !isBH) type = 'gaia';
    const size = type === 'gas_giant' ? int(rng, 20, 30) : int(rng, 7, 22);
    const p: Planet = {
      id: planets.length,
      systemId: sys.id,
      name: `${sys.name} ${roman(o + 1)}`,
      type,
      size,
      orbit: o,
      moonOf: null,
      deposits: rollDeposits(rng, type),
      colony: null,
      station: null,
      colonizing: null,
    };
    planets.push(p);
    sys.planetIds.push(p.id);
    const moons = type === 'gas_giant' ? int(rng, 0, 2) : chance(rng, 0.15) ? 1 : 0;
    for (let m = 0; m < moons; m++) {
      const mt: PlanetType = pick(rng, ['barren', 'frozen', 'barren', 'toxic', 'tundra'] as PlanetType[]);
      const moon: Planet = {
        id: planets.length,
        systemId: sys.id,
        name: `${p.name}${String.fromCharCode(97 + m)}`,
        type: mt,
        size: int(rng, 4, 10),
        orbit: o,
        moonOf: p.id,
        deposits: rollDeposits(rng, mt),
        colony: null,
        station: null,
        colonizing: null,
      };
      planets.push(moon);
      sys.planetIds.push(moon.id);
    }
  }
  sys.asteroidBelts = chance(rng, 0.45) ? int(rng, 1, 2) : 0;
}

function assignFeatures(rng: RngState, systems: StarSystem[], lanes: [number, number][]) {
  const deg = new Array(systems.length).fill(0);
  for (const [a, b] of lanes) { deg[a]++; deg[b]++; }
  for (const sys of systems) {
    const f: SystemFeature[] = [];
    if (chance(rng, 0.07)) f.push('ancient_ruins');
    if (chance(rng, 0.09) || sys.asteroidBelts >= 2) f.push('rare_cluster');
    if (chance(rng, 0.08)) f.push('nebula');
    if (chance(rng, 0.06)) f.push('derelict');
    if (sys.star === 'neutron' || chance(rng, 0.02)) f.push('pulsar');
    // Jump nexus: well-connected hubs become strategic chokepoints / crossroads.
    if (deg[sys.id] >= 4 && chance(rng, 0.45)) f.push('jump_nexus');
    sys.features = f;
  }
}

export function roman(n: number): string {
  return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n - 1] ?? String(n);
}

/** Adjacency list from lanes. Pure helper, cheap enough to rebuild on demand and cache by reference. */
const adjCache = new WeakMap<Galaxy, number[][]>();
export function adjacency(g: Galaxy): number[][] {
  let a = adjCache.get(g);
  if (a && a.length === g.systems.length) return a;
  a = Array.from({ length: g.systems.length }, () => []);
  for (const [x, y] of g.lanes) { a[x].push(y); a[y].push(x); }
  adjCache.set(g, a);
  return a;
}

export function laneLength(g: Galaxy, a: number, b: number): number {
  const s = g.systems;
  return Math.hypot(s[a].x - s[b].x, s[a].y - s[b].y);
}

/** Jump distances from a set of source systems (BFS). */
export function jumpDistances(g: Galaxy, sources: number[], passable?: (id: number) => boolean): number[] {
  const adj = adjacency(g);
  const dist = new Array(g.systems.length).fill(Infinity);
  const q: number[] = [];
  for (const s of sources) { dist[s] = 0; q.push(s); }
  for (let h = 0; h < q.length; h++) {
    const u = q[h];
    for (const v of adj[u]) {
      if (dist[v] !== Infinity) continue;
      if (passable && !passable(v)) continue;
      dist[v] = dist[u] + 1;
      q.push(v);
    }
  }
  return dist;
}

/** Dijkstra shortest path by lane length. Returns the list of systems after `from` up to `to`. */
export function findPath(g: Galaxy, from: number, to: number, passable?: (id: number) => boolean): number[] | null {
  if (from === to) return [];
  const n = g.systems.length;
  const adj = adjacency(g);
  const dist = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1);
  const done = new Array(n).fill(false);
  dist[from] = 0;
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0) return null;
    if (u === to) break;
    done[u] = true;
    for (const v of adj[u]) {
      if (passable && v !== to && !passable(v)) continue;
      const nd = dist[u] + laneLength(g, u, v);
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; }
    }
  }
  const path: number[] = [];
  for (let v = to; v !== from; v = prev[v]) path.unshift(v);
  return path;
}
