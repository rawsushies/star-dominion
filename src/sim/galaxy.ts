// Procedural 3D galaxy: a Milky Way-like barred spiral (bulge, bar, two major
// and two minor logarithmic arms, flared thin disk, open clusters in the arms
// and globular clusters in the halo) with real XYZ coordinates, named sectors,
// a hyperlane graph, and star systems with planets, moons, belts and features.
// Galaxies of LAZY_BODIES_AT systems or more generate planets on first
// exploration so a 10,000-system galaxy stays light to save and simulate.

import { chance, int, makeRng, next, pick, range, weighted, type RngState } from './rng';
import { SpatialGrid } from './spatial';
import { PLANET_TYPES, STAR_TYPES } from './data/planets';
import { STAR_NAMES } from './data/names';
import type { Deposits, Galaxy, Planet, PlanetType, Sector, StarSystem, StarType, SystemFeature } from './types';

export const GALAXY_SIZES = { small: 30, medium: 60, large: 120, milky: 10000 } as const;
export type GalaxySize = keyof typeof GALAXY_SIZES;
export const GALAXY_LABELS: Record<GalaxySize, string> = { small: '30 systems', medium: '60 systems', large: '120 systems', milky: 'Milky Way · 10,000' };
/** Galaxies at or above this size generate planets lazily, when first explored. */
export const LAZY_BODIES_AT = 400;
/** Approximate number of stars in the Milky Way, shared across simulated systems. */
export const GALACTIC_STARS = 1e11;

const SECTOR_SLICES = ['Perseus', 'Orion', 'Sagittarius', 'Scutum', 'Norma', 'Cygnus', 'Carina', 'Centaurus', 'Lyra', 'Draco', 'Aquila', 'Vela', 'Hydra', 'Crux', 'Lupus', 'Pavo'];
const RING_NAMES = ['Core', 'Inner', 'Mid', 'Outer', 'Rim'];

function gauss(rng: RngState): number {
  const u = Math.max(1e-9, next(rng)), v = next(rng);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface GalaxyShape { R: number; barAngle: number; barLen: number; pitch: number; rMin: number; arms: { theta: number; weight: number }[] }

/** Barred-spiral model shared by the generator and the renderer's visual starfield. */
export function galaxyShape(n: number, rng: RngState): GalaxyShape {
  const R = n <= 200 ? Math.sqrt(n) * 68 : Math.sqrt(n) * 62;
  const barAngle = range(rng, 0, Math.PI);
  return {
    R, barAngle, barLen: 0.27 * R, pitch: (13 * Math.PI) / 180, rMin: 0.2 * R,
    // two major arms from the bar ends, two minor arms between them
    arms: [
      { theta: barAngle, weight: 0.32 }, { theta: barAngle + Math.PI, weight: 0.32 },
      { theta: barAngle + Math.PI / 2, weight: 0.18 }, { theta: barAngle + (3 * Math.PI) / 2, weight: 0.18 },
    ],
  };
}

export function armAngle(shape: GalaxyShape, armTheta: number, r: number): number {
  return armTheta + Math.log(Math.max(r, shape.rMin) / shape.rMin) / Math.tan(shape.pitch);
}

type Region = 'bulge' | 'bar' | 'arm' | 'disk' | 'cluster' | 'halo';

/** Sample one point (galaxy-centred coordinates) from the barred-spiral density model. */
export function sampleGalaxyPoint(rng: RngState, g: GalaxyShape, region?: Region): { x: number; y: number; z: number; region: Region } {
  const R = g.R;
  const roll = next(rng);
  const reg: Region = region ?? (roll < 0.12 ? 'bulge' : roll < 0.21 ? 'bar' : roll < 0.8 ? 'arm' : 'disk');
  if (reg === 'bulge') {
    return { x: gauss(rng) * 0.085 * R, y: gauss(rng) * 0.085 * R, z: gauss(rng) * 0.06 * R, region: reg };
  }
  if (reg === 'bar') {
    const t = range(rng, -1, 1) * g.barLen, w = gauss(rng) * 0.045 * R;
    const c = Math.cos(g.barAngle), s = Math.sin(g.barAngle);
    return { x: t * c - w * s, y: t * s + w * c, z: gauss(rng) * 0.03 * R, region: reg };
  }
  if (reg === 'arm') {
    let pick = next(rng), arm = g.arms[0];
    for (const a of g.arms) { if (pick < a.weight) { arm = a; break; } pick -= a.weight; }
    const r = g.rMin + (R - g.rMin) * Math.pow(next(rng), 0.8);
    const th = armAngle(g, arm.theta, r);
    const off = gauss(rng) * (0.035 + 0.035 * (r / R)) * R;
    const along = gauss(rng) * 0.04 * R;
    const cx = Math.cos(th) * r, cy = Math.sin(th) * r;
    // offset perpendicular and along the arm
    const tx = -Math.sin(th), ty = Math.cos(th);
    return { x: cx + tx * along + Math.cos(th) * off, y: cy + ty * along + Math.sin(th) * off, z: gauss(rng) * (0.012 + 0.022 * (r / R)) * R, region: reg };
  }
  // exponential thin disk between the arms
  const r = Math.min(R * 1.05, -Math.log(Math.max(1e-6, next(rng))) * 0.34 * R + 0.12 * R);
  const th = range(rng, 0, Math.PI * 2);
  return { x: Math.cos(th) * r, y: Math.sin(th) * r, z: gauss(rng) * (0.01 + 0.02 * (r / R)) * R, region: 'disk' };
}

export function generateGalaxy(rng: RngState, size: GalaxySize, seed = 0): { galaxy: Galaxy; planets: Planet[] } {
  const n = GALAXY_SIZES[size];
  const shape = galaxyShape(n, rng);
  const R = shape.R;
  const width = R * 2 + 160;
  const height = width;
  const cx = width / 2, cy = height / 2;
  const minDist = n <= 200 ? 62 : 52;
  const pts: { x: number; y: number; z: number; region: string }[] = [];
  const grid = new SpatialGrid(pts, minDist * 2);
  const accept = (p: { x: number; y: number; z: number; region: string }) => {
    const q = { ...p, x: p.x + cx, y: p.y + cy };
    if (Math.hypot(p.x, p.y) > R * 1.08) return false;
    if (grid.anyWithin(q, minDist)) return false;
    pts.push(q);
    grid.insertIndex(pts.length - 1);
    return true;
  };
  // Clusters first: globular clusters in the halo, open clusters along the arms.
  if (n >= 2000) {
    const globulars = Math.round(n / 1200);
    for (let c = 0; c < globulars; c++) {
      const th = range(rng, 0, Math.PI * 2), r = range(rng, 0.25, 0.85) * R;
      const centre = { x: Math.cos(th) * r, y: Math.sin(th) * r, z: (chance(rng, 0.5) ? 1 : -1) * range(rng, 0.12, 0.32) * R };
      const members = int(rng, 25, 45);
      for (let k = 0, tries = 0; k < members && tries < members * 30; tries++) {
        if (accept({ x: centre.x + gauss(rng) * 0.02 * R, y: centre.y + gauss(rng) * 0.02 * R, z: centre.z + gauss(rng) * 0.02 * R, region: 'halo' })) k++;
      }
    }
    const opens = Math.round(n / 250);
    for (let c = 0; c < opens; c++) {
      const centre = sampleGalaxyPoint(rng, shape, 'arm');
      const members = int(rng, 8, 16);
      for (let k = 0, tries = 0; k < members && tries < members * 30; tries++) {
        if (accept({ x: centre.x + gauss(rng) * 0.012 * R, y: centre.y + gauss(rng) * 0.012 * R, z: centre.z + gauss(rng) * 0.006 * R, region: 'cluster' })) k++;
      }
    }
  }
  let guard = 0;
  while (pts.length < n && guard++ < n * 60) accept(sampleGalaxyPoint(rng, shape));

  const names = systemNames(rng, pts.length);
  const systems: StarSystem[] = pts.map((p, i) => ({
    id: i,
    name: names[i],
    x: Math.round(p.x),
    y: Math.round(p.y),
    z: Math.round(p.z),
    star: weighted(rng, Object.keys(STAR_TYPES) as StarType[], (s) => STAR_TYPES[s].weight * (p.region === 'bulge' || p.region === 'halo' ? (s === 'red' || s === 'orange' ? 1.6 : s === 'blue' ? 0.3 : 1) : p.region === 'arm' || p.region === 'cluster' ? (s === 'blue' || s === 'white' ? 1.8 : 1) : 1))!,
    planetIds: [],
    asteroidBelts: chance(rng, 0.45) ? int(rng, 1, 2) : 0,
    owner: null,
    starbase: 0,
    starbaseDamage: 0,
    features: [],
    megastructures: [],
    outpostProject: null,
    starbaseUpgrade: null,
    ruinsSurveyed: false,
  }));
  const sectors = assignSectors(systems, cx, cy, R, n, pts.map((p) => p.region));
  const lanes = buildLanes(rng, systems, n <= 200 ? 260 : 190);
  const lazy = n >= LAZY_BODIES_AT;
  const planets: Planet[] = [];
  if (!lazy) for (const sys of systems) { generateBodies(rng, sys, planets); sys.bodiesReady = true; }
  assignFeatures(rng, systems, lanes);
  return {
    galaxy: { width, height, systems, lanes, sectors, lazyBodies: lazy || undefined, starsPerSystem: GALACTIC_STARS / systems.length, shape: { R, barAngle: shape.barAngle, seed } },
    planets,
  };
}

/** Backfill 3D-era galaxy metadata for saves written before it existed. */
export function upgradeGalaxy(g: Galaxy) {
  for (const s of g.systems) if (s.z == null) s.z = 0;
  if (!g.sectors) {
    const R = (g.width - 160) / 2;
    g.sectors = assignSectors(g.systems, g.width / 2, g.height / 2, R, g.systems.length, g.systems.map(() => 'disk'));
  }
  if (!g.starsPerSystem) g.starsPerSystem = GALACTIC_STARS / g.systems.length;
  if (!g.shape) g.shape = { R: (g.width - 160) / 2, barAngle: 0, seed: 0 };
}

/** Partition into named sectors: concentric rings split into angular slices; halo clusters stand alone. */
function assignSectors(systems: StarSystem[], cx: number, cy: number, R: number, n: number, regions: string[]): Sector[] {
  const big = n >= 2000;
  const ringEdges = big ? [0.16, 0.36, 0.56, 0.78, 9] : n >= 100 ? [0.3, 0.65, 9] : [0.45, 9];
  const slicesPer = big ? [1, 4, 8, 12, 16] : n >= 100 ? [1, 4, 6] : [1, 3];
  const sectors: Sector[] = [];
  const index = new Map<string, number>();
  const sectorFor = (key: string, name: string) => {
    let id = index.get(key);
    if (id == null) { id = sectors.length; index.set(key, id); sectors.push({ id, name, x: 0, y: 0, z: 0, systems: 0 }); }
    return id;
  };
  let haloN = 0;
  const haloIds = new Map<string, number>();
  for (const s of systems) {
    const dx = s.x - cx, dy = s.y - cy;
    const r = Math.hypot(dx, dy) / R;
    let id: number;
    if (regions[s.id] === 'halo') {
      // halo clusters: group by coarse 3D cell
      const key = `${Math.round(dx / (0.08 * R))},${Math.round(dy / (0.08 * R))},${Math.round((s.z ?? 0) / (0.08 * R))}`;
      let h = haloIds.get(key);
      if (h == null) { h = haloN++; haloIds.set(key, h); }
      id = sectorFor(`halo${h}`, `${SECTOR_SLICES[(h * 5) % SECTOR_SLICES.length]} Globular ${roman(h % 10 + 1)}`);
    } else {
      const ring = ringEdges.findIndex((edge) => r < edge);
      const slices = slicesPer[ring];
      const ang = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
      const slice = Math.floor((ang / (Math.PI * 2)) * slices) % slices;
      const ringName = ring === 0 ? 'Galactic Core' : `${RING_NAMES[Math.min(RING_NAMES.length - 1, big ? ring : ring + 1)]} ${SECTOR_SLICES[(slice * 16) / slices | 0]}`;
      id = sectorFor(`${ring}:${slice}`, ring === 0 ? 'Galactic Core' : ringName);
    }
    s.sector = id;
    const sec = sectors[id];
    sec.x += s.x; sec.y += s.y; sec.z += s.z ?? 0; sec.systems++;
  }
  for (const sec of sectors) { sec.x = Math.round(sec.x / sec.systems); sec.y = Math.round(sec.y / sec.systems); sec.z = Math.round(sec.z / sec.systems); }
  return sectors;
}

const SYL_A = ['Ae', 'Al', 'Ar', 'Bel', 'Cal', 'Cor', 'Da', 'Dra', 'El', 'Er', 'Fa', 'Gal', 'Hal', 'Ib', 'Il', 'Ka', 'Kor', 'Lu', 'Ma', 'Mir', 'Na', 'Ny', 'Or', 'Pa', 'Pyr', 'Qu', 'Ra', 'Sa', 'Sel', 'Ta', 'Thal', 'Ul', 'Va', 'Vel', 'Xa', 'Ys', 'Za', 'Zor'];
const SYL_B = ['', 'a', 'e', 'i', 'o', 'u', 'ar', 'en', 'is', 'or', 'an', 'ath', 'el', 'ir', 'on', 'ys'];
const SYL_C = ['ra', 'nos', 'lis', 'thea', 'dor', 'vax', 'ria', 'mon', 'tus', 'rin', 'des', 'nax', 'ven', 'lon', 'cia', 'ros', 'mir', 'gard', 'zen', 'phis', 'ka', 'th', 'ne', 'ris'];

/** Unique names: the hand-written list first, then generated three-part names, then catalogue codes. */
function systemNames(rng: RngState, count: number): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  for (const nm of shuffleNames(rng)) { if (out.length >= count) break; used.add(nm); out.push(nm); }
  let tries = 0;
  while (out.length < count && tries++ < count * 20) {
    const nm = pick(rng, SYL_A) + pick(rng, SYL_B) + pick(rng, SYL_C);
    if (used.has(nm)) continue;
    used.add(nm);
    out.push(nm);
  }
  let k = 1;
  while (out.length < count) out.push(`SD-${String(k++).padStart(5, '0')}`);
  return out;
}

function shuffleNames(rng: RngState): string[] {
  const arr = STAR_NAMES.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next(rng) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Hyperlanes: a local relative-neighbourhood graph over each system's nearest
 * neighbours (sparse, few redundant links, natural chokepoints), made connected
 * with union-find, plus a few extra short links for route variety.
 */
function buildLanes(rng: RngState, s: StarSystem[], maxLen: number): [number, number][] {
  const n = s.length;
  const grid = new SpatialGrid(s, maxLen / 2);
  const d2 = (i: number, j: number) => (s[i].x - s[j].x) ** 2 + (s[i].y - s[j].y) ** 2 + ((s[i].z ?? 0) - (s[j].z ?? 0)) ** 2;
  const cand: number[][] = s.map((p, i) => grid.nearest(p, 8, maxLen, i).filter((j) => d2(i, j) <= maxLen * maxLen));
  const seen = new Set<number>();
  const lanes: [number, number][] = [];
  const add = (i: number, j: number) => {
    const key = i < j ? i * n + j : j * n + i;
    if (seen.has(key)) return false;
    seen.add(key);
    lanes.push(i < j ? [i, j] : [j, i]);
    return true;
  };
  for (let i = 0; i < n; i++) {
    for (const j of cand[i]) {
      if (j < i && cand[j].includes(i)) continue; // evaluate each mutual pair once
      const dij = d2(i, j);
      let ok = true;
      for (const k of cand[i]) if (k !== j && Math.max(d2(i, k), d2(j, k)) < dij) { ok = false; break; }
      if (ok) for (const k of cand[j]) if (k !== i && Math.max(d2(i, k), d2(j, k)) < dij) { ok = false; break; }
      if (ok) add(i, j);
    }
  }
  // union-find connectivity
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const unite = (a: number, b: number) => { parent[find(a)] = find(b); };
  for (const [a, b] of lanes) unite(a, b);
  for (;;) {
    const comps = new Map<number, number[]>();
    for (let i = 0; i < n; i++) { const r = find(i); (comps.get(r) ?? comps.set(r, []).get(r)!).push(i); }
    if (comps.size <= 1) break;
    // join every component except the largest to its nearest foreign system
    const largest = [...comps.values()].sort((a, b) => b.length - a.length)[0];
    const lr = find(largest[0]);
    for (const [root, members] of comps) {
      if (root === lr && comps.size > 1 && members === largest) continue;
      let best: [number, number, number] | null = null;
      for (let r = maxLen; !best; r *= 2) {
        for (const i of members) {
          for (const j of grid.within(s[i], r)) {
            if (find(j) === find(i)) continue;
            const dd = d2(i, j);
            if (!best || dd < best[2]) best = [i, j, dd];
          }
        }
        if (r > 1e7) break;
      }
      if (best) { add(best[0], best[1]); unite(best[0], best[1]); }
    }
  }
  // extra short links for route variety
  const deg = new Array(n).fill(0);
  for (const [a, b] of lanes) { deg[a]++; deg[b]++; }
  for (let i = 0; i < n; i++) {
    if (deg[i] >= 3) continue;
    for (const j of cand[i]) {
      if (deg[j] >= 4 || !chance(rng, 0.45)) continue;
      if (add(i, j)) { deg[i]++; deg[j]++; break; }
    }
  }
  return lanes;
}

/** Materialise a system's planets (lazy galaxies) with a per-system RNG so the result does not depend on discovery order. */
export function ensureBodies(state: { galaxy: Galaxy; planets: Planet[]; settings: { seed: number } }, sysId: number) {
  const g = state.galaxy;
  const sys = g.systems[sysId];
  if (!g.lazyBodies || sys.bodiesReady) return;
  const rng = makeRng(Math.imul(state.settings.seed ^ 0x5bd1e995, 2654435761) ^ Math.imul(sysId + 1, 40503));
  generateBodies(rng, sys, state.planets);
  sys.bodiesReady = true;
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
  return Math.hypot(s[a].x - s[b].x, s[a].y - s[b].y, (s[a].z ?? 0) - (s[b].z ?? 0));
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

/** Jump distances from sources, stopping after `maxJumps` (cheap local BFS). */
export function jumpsWithin(g: Galaxy, source: number, maxJumps: number): Map<number, number> {
  const adj = adjacency(g);
  const out = new Map<number, number>([[source, 0]]);
  let frontier = [source];
  for (let d = 1; d <= maxJumps && frontier.length; d++) {
    const nextF: number[] = [];
    for (const u of frontier) for (const v of adj[u]) if (!out.has(v)) { out.set(v, d); nextF.push(v); }
    frontier = nextF;
  }
  return out;
}

/** A* shortest path by lane length (straight-line distance is an admissible heuristic). Returns the systems after `from` up to `to`. */
export function findPath(g: Galaxy, from: number, to: number, passable?: (id: number) => boolean): number[] | null {
  if (from === to) return [];
  const n = g.systems.length;
  const adj = adjacency(g);
  const sys = g.systems;
  const T = sys[to];
  const h = (i: number) => Math.hypot(sys[i].x - T.x, sys[i].y - T.y, (sys[i].z ?? 0) - (T.z ?? 0));
  const gScore = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  gScore[from] = 0;
  heap.push(from, h(from));
  while (heap.size) {
    const u = heap.pop();
    if (u === to) break;
    if (closed[u]) continue;
    closed[u] = 1;
    for (const v of adj[u]) {
      if (closed[v]) continue;
      if (passable && v !== to && !passable(v)) continue;
      const nd = gScore[u] + laneLength(g, u, v);
      if (nd < gScore[v]) { gScore[v] = nd; prev[v] = u; heap.push(v, nd + h(v)); }
    }
  }
  if (prev[to] < 0) return null;
  const path: number[] = [];
  for (let v = to; v !== from; v = prev[v]) path.push(v);
  return path.reverse();
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p]; i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!, lastKey = keys.pop()!;
    if (ids.length) {
      let i = 0;
      const len = ids.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lastKey;
        if (l < len && keys[l] < mk) { m = l; mk = keys[l]; }
        if (r < len && keys[r] < mk) { m = r; mk = keys[r]; }
        if (m === i) break;
        ids[i] = ids[m]; keys[i] = keys[m]; i = m;
      }
      ids[i] = lastId; keys[i] = lastKey;
    }
    return top;
  }
}
