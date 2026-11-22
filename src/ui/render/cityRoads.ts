// The capital's street network and what moves on it. Pure data and simulation (no Three.js), so
// it can be tested; capitalLife.ts draws it with sourced models.
//
// Streets follow the megacity grid's avenues (cell boundaries, every CELL units):
//   - major avenues (four lanes, two each way): the ceremonial axes x = 0 and z = 0 from the
//     Citadel plaza to the gates, and the ring road at ±3 cells;
//   - local streets (one lane each way) on every other grid line, including the street round
//     the plaza and the perimeter road inside the wall;
//   - intersections at every crossing, with traffic signals where three or more streets meet.
// Vehicles drive on the right, follow lanes and junction curves, stop for red signals and keep
// their distance from the vehicle ahead. Pedestrians walk the sidewalks between street corners
// and cross only on crosswalks, while the walk signal is lit.

import { CELL } from './megacityLayout';

/** Scene units per metre (a 4.3 m car is about 1.8 units, a person about 0.7). */
export const M = 0.4;
/** Square left free at each intersection (the junction pavement). */
export const JUNCTION = 6;
export const LINES = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((k) => k * CELL);
const MAJOR_LINES = new Set([-3 * CELL, 0, 3 * CELL]);
const PLAZA = CELL; // the central block (|x| < 16 and |z| < 16) is the Citadel plaza: no streets

export type Axis = 'x' | 'z';
export interface RoadNode { id: number; x: number; z: number; edges: number[]; signal: boolean }
export interface RoadEdge { id: number; a: number; b: number; axis: Axis; major: boolean; length: number }

/** Half-widths: carriageway and the sidewalk centre line. */
/** Matched to the street pieces: tevy's 12 m four-lane road (4.8 units) for avenues, Kenney's
 *  street tile scaled to the 6-unit avenue for local streets (its carriageway is ~3.9 units). */
export function roadHalf(major: boolean) { return major ? 2.4 : 1.95; }
export function sidewalkOffset(major: boolean) { return major ? 2.7 : 2.6; }
/** Lane centre offsets to the right of travel (major: two lanes each way). */
export function laneOffsets(major: boolean): number[] { return major ? [0.6, 1.8] : [0.98]; }

export interface RoadNetwork { nodes: RoadNode[]; edges: RoadEdge[]; nodeAt: Map<string, number> }

const key = (x: number, z: number) => `${Math.round(x)},${Math.round(z)}`;
const inPlaza = (x: number, z: number) => Math.abs(x) < PLAZA - 0.5 && Math.abs(z) < PLAZA - 0.5;

export function roadNetwork(): RoadNetwork {
  const nodes: RoadNode[] = [];
  const nodeAt = new Map<string, number>();
  for (const x of LINES) for (const z of LINES) {
    if (inPlaza(x, z)) continue;
    nodeAt.set(key(x, z), nodes.length);
    nodes.push({ id: nodes.length, x, z, edges: [], signal: false });
  }
  const edges: RoadEdge[] = [];
  const link = (a: number, b: number, axis: Axis, major: boolean) => {
    const A = nodes[a], B = nodes[b];
    // a segment crossing the plaza does not exist
    if (inPlaza((A.x + B.x) / 2, (A.z + B.z) / 2)) return;
    const e: RoadEdge = { id: edges.length, a, b, axis, major, length: Math.hypot(B.x - A.x, B.z - A.z) };
    edges.push(e); A.edges.push(e.id); B.edges.push(e.id);
  };
  for (let i = 0; i < LINES.length; i++) for (let j = 0; j < LINES.length; j++) {
    const here = nodeAt.get(key(LINES[i], LINES[j]));
    if (here == null) continue;
    const east = i + 1 < LINES.length ? nodeAt.get(key(LINES[i + 1], LINES[j])) : undefined;
    const south = j + 1 < LINES.length ? nodeAt.get(key(LINES[i], LINES[j + 1])) : undefined;
    if (east != null) link(here, east, 'x', MAJOR_LINES.has(LINES[j]));
    if (south != null) link(here, south, 'z', MAJOR_LINES.has(LINES[i]));
  }
  for (const n of nodes) n.signal = n.edges.length >= 3;
  return { nodes, edges, nodeAt };
}

/** The node nearest a point (a building's entrance, a gate, a station). */
export function nearestNode(net: RoadNetwork, x: number, z: number): number {
  let best = 0, bd = Infinity;
  for (const n of net.nodes) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = n.id; } }
  return best;
}

/** Shortest path (node ids) by Dijkstra over street length; ≤ 80 nodes, so a plain scan is fine. */
export function route(net: RoadNetwork, from: number, to: number): number[] {
  const dist = new Array(net.nodes.length).fill(Infinity), prev = new Array(net.nodes.length).fill(-1), done = new Array(net.nodes.length).fill(false);
  dist[from] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0 || u === to) break;
    done[u] = true;
    for (const eid of net.nodes[u].edges) {
      const e = net.edges[eid]; const v = e.a === u ? e.b : e.a;
      const w = dist[u] + e.length * (e.major ? 0.8 : 1); // prefer the avenues
      if (w < dist[v]) { dist[v] = w; prev[v] = u; }
    }
  }
  if (from !== to && prev[to] < 0) return [from];
  const path = [to];
  while (path[0] !== from) path.unshift(prev[path[0]]);
  return path;
}

export function edgeBetween(net: RoadNetwork, a: number, b: number): RoadEdge | undefined {
  return net.nodes[a].edges.map((id) => net.edges[id]).find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}

// ---------------------------------------------------------------- signals

/** Signal cycle, seconds: traffic on x-axis streets green, amber, then z-axis green, amber. */
export const CYCLE = { green: 9, amber: 2.5 };
const PERIOD = 2 * (CYCLE.green + CYCLE.amber);

export type Light = 'green' | 'amber' | 'red';
/** The light facing traffic that travels along `axis` at a node (offset per node so the city is not in lockstep). */
export function signalFor(node: RoadNode, axis: Axis, time: number): Light {
  if (!node.signal) return 'green';
  const t = ((time + ((node.x * 7 + node.z * 13) % 23 + 23) % 23 * 0.37) % PERIOD + PERIOD) % PERIOD;
  const xPhase = t < CYCLE.green ? 'green' : t < CYCLE.green + CYCLE.amber ? 'amber' : 'red';
  const zPhase = t < CYCLE.green + CYCLE.amber ? 'red' : t < 2 * CYCLE.green + CYCLE.amber ? 'green' : 'amber';
  return axis === 'x' ? xPhase : zPhase;
}

/** Pedestrians may cross a street along `axis` (i.e. walk across it) only while its traffic is red. */
export function walkAcross(node: RoadNode, streetAxis: Axis, time: number): boolean {
  return !node.signal || signalFor(node, streetAxis, time) === 'red';
}

// ---------------------------------------------------------------- vehicles

export type VehicleKind = 'car' | 'taxi' | 'hover' | 'van' | 'bus' | 'police' | 'ambulance';
export const VEHICLE_LENGTH: Record<VehicleKind, number> = { car: 4.7 * M, taxi: 4.7 * M, hover: 4.6 * M, van: 5.8 * M, bus: 12.4 * M, police: 5.2 * M, ambulance: 7.3 * M };
const SPEED: Record<VehicleKind, number> = { car: 6.5, taxi: 6.5, hover: 7, van: 5, bus: 4.2, police: 7.5, ambulance: 8 };

export interface Vehicle {
  id: number; kind: VehicleKind;
  path: number[]; leg: number; // travelling from path[leg] to path[leg + 1]
  s: number;                   // distance along the current leg (stop line to stop line), or along the turn
  lane: number;                // lane index on the current leg
  nextLane: number;            // lane on the next leg (used through the junction)
  turning: boolean;            // inside a junction, on the curve to the next leg
  speed: number;
  amber: 'stop' | 'go' | null; // the decision taken when the light ahead turned amber
  dwell: number;               // seconds parked at a destination (pulled into the building: not drawn)
  x: number; z: number; ry: number;
}

/** Where a vehicle's leg starts and ends (stop lines, JUNCTION/2 from the nodes), in its lane. */
export function legGeometry(net: RoadNetwork, from: number, to: number, lane: number) {
  const A = net.nodes[from], B = net.nodes[to];
  const e = edgeBetween(net, from, to)!;
  const dx = Math.sign(B.x - A.x), dz = Math.sign(B.z - A.z);
  const off = laneOffsets(e.major)[Math.min(lane, laneOffsets(e.major).length - 1)];
  // right of travel: (dx, dz) turned clockwise seen from above (+y): right = (-dz, dx)
  const rx = -dz * off, rz = dx * off;
  const h = JUNCTION / 2;
  return {
    sx: A.x + dx * h + rx, sz: A.z + dz * h + rz, ex: B.x - dx * h + rx, ez: B.z - dz * h + rz,
    length: e.length - JUNCTION, dx, dz, axis: e.axis, major: e.major,
  };
}

export function placeVehicle(net: RoadNetwork, v: Vehicle) {
  const g = legGeometry(net, v.path[v.leg], v.path[v.leg + 1], v.lane);
  if (!v.turning) {
    const t = Math.min(1, Math.max(0, v.s / g.length));
    v.x = g.sx + (g.ex - g.sx) * t; v.z = g.sz + (g.ez - g.sz) * t;
    v.ry = Math.atan2(g.dx, g.dz);
    return;
  }
  // a quadratic curve through the junction from this leg's stop line to the next leg's start
  const n = legGeometry(net, v.path[v.leg + 1], v.path[v.leg + 2], v.nextLane);
  const p0 = [g.ex, g.ez], p2 = [n.sx, n.sz];
  const straight = g.dx === n.dx && g.dz === n.dz;
  const c = straight ? [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2] : g.dx !== 0 ? [p2[0], p0[1]] : [p0[0], p2[1]];
  const len = turnLength(g, n);
  const t = Math.min(1, v.s / len);
  const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, cc = t * t;
  v.x = a * p0[0] + b * c[0] + cc * p2[0]; v.z = a * p0[1] + b * c[1] + cc * p2[1];
  const tx = 2 * (1 - t) * (c[0] - p0[0]) + 2 * t * (p2[0] - c[0]), tz = 2 * (1 - t) * (c[1] - p0[1]) + 2 * t * (p2[1] - c[1]);
  v.ry = Math.atan2(tx, tz);
}

/** Braking: the highest speed from which a vehicle can still stop within `d` (units/s²). */
const DECEL = 12;
function brake(d: number) { return d <= 0 ? 0 : Math.sqrt(2 * DECEL * 0.7 * d); }

function turnLength(g: { ex: number; ez: number }, n: { sx: number; sz: number }) {
  return Math.max(1, Math.hypot(n.sx - g.ex, n.sz - g.ez) * 1.15);
}

export interface TrafficOptions { destinations: Partial<Record<VehicleKind, number[]>>; seed?: number }

/**
 * The traffic simulation. Each vehicle drives a route between destinations meaningful to its
 * kind (vans between industry, the port gates and building sites; taxis and cars between homes
 * and the civic centre; the bus between its stops; police on patrol; ambulances on calls),
 * parks for a moment, then sets off for the next one.
 */
export class Traffic {
  vehicles: Vehicle[] = [];
  private rng: () => number;
  constructor(readonly net: RoadNetwork, private opts: TrafficOptions, counts: Partial<Record<VehicleKind, number>>) {
    let s = opts.seed ?? 7;
    this.rng = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    let id = 0;
    for (const [kind, n] of Object.entries(counts) as [VehicleKind, number][]) {
      for (let i = 0; i < n; i++) {
        const v: Vehicle = { id: id++, kind, path: [], leg: 0, s: 0, lane: 0, nextLane: 0, amber: null, turning: false, speed: 0, dwell: this.rng() * 4, x: 0, z: 0, ry: 0 };
        this.newTrip(v, this.pick(kind));
        // spread starting vehicles along their first street without overlapping; one that finds
        // no room starts parked (inside a building) and sets off later
        const len = legGeometry(net, v.path[0], v.path[1], v.lane).length;
        let placed = false;
        for (let k = 0; k < 8 && !placed; k++) {
          v.s = this.rng() * len * 0.85;
          placed = !this.vehicles.some((o) => o.path[o.leg] === v.path[0] && o.path[o.leg + 1] === v.path[1] && o.lane === v.lane && Math.abs(o.s - v.s) < (VEHICLE_LENGTH[o.kind] + VEHICLE_LENGTH[v.kind]) / 2 + 0.6);
        }
        if (!placed) { v.s = 0; v.dwell = 2 + this.rng() * 10; } else v.dwell = 0;
        placeVehicle(net, v);
        this.vehicles.push(v);
      }
    }
  }

  private pick(kind: VehicleKind): number {
    const d = this.opts.destinations[kind];
    const list = d && d.length ? d : this.net.nodes.map((n) => n.id);
    return list[Math.floor(this.rng() * list.length) % list.length];
  }

  private newTrip(v: Vehicle, from: number) {
    let to = this.pick(v.kind), guard = 0;
    while ((to === from || route(this.net, from, to).length < 2) && guard++ < 12) to = this.pick(v.kind);
    if (to === from) { const n = this.net.nodes[from]; const e = this.net.edges[n.edges[0]]; to = e.a === from ? e.b : e.a; }
    v.path = route(this.net, from, to); v.leg = 0; v.s = 0; v.turning = false;
    const g = edgeBetween(this.net, v.path[0], v.path[1])!;
    v.lane = g.major ? Math.floor(this.rng() * 2) : 0;
  }

  /** Free distance ahead in the same lane on the same leg (Infinity when clear). */
  private gapAhead(v: Vehicle): number {
    let gap = Infinity;
    const a = v.path[v.leg], b = v.path[v.leg + 1];
    for (const o of this.vehicles) {
      if (o === v || o.dwell > 0) continue;
      if (!o.turning && o.path[o.leg] === a && o.path[o.leg + 1] === b && o.lane === v.lane && o.s > v.s && !v.turning) gap = Math.min(gap, o.s - v.s - (VEHICLE_LENGTH[o.kind] + VEHICLE_LENGTH[v.kind]) / 2);
      // vehicles in the junction ahead, or already on the start of our next leg
      if (!v.turning && o.turning && o.path[o.leg + 1] === b && Math.hypot(o.x - v.x, o.z - v.z) < 4) gap = Math.min(gap, legGeometry(this.net, a, b, v.lane).length - v.s + 0.5);
    }
    return gap;
  }

  /** Is anything at (or turning into) the start of this vehicle's first street lane? */
  private entranceBusy(v: Vehicle): boolean {
    const a = v.path[v.leg], b = v.path[v.leg + 1];
    for (const o of this.vehicles) {
      if (o === v || o.dwell > 0) continue;
      if (!o.turning && o.path[o.leg] === a && o.path[o.leg + 1] === b && o.lane === v.lane && o.s < VEHICLE_LENGTH[o.kind] + VEHICLE_LENGTH[v.kind] + 0.8) return true;
      if (o.turning && o.path[o.leg + 1] === a && o.path[o.leg + 2] === b && o.nextLane === v.lane) return true;
    }
    return false;
  }

  /** Distance from a turning vehicle's nose to the tail of the nearest vehicle on its next street. */
  private roomAtEntry(v: Vehicle): number {
    const b = v.path[v.leg + 1], c = v.path[v.leg + 2];
    const g = legGeometry(this.net, v.path[v.leg], b, v.lane), n = legGeometry(this.net, b, c, v.nextLane);
    const left = turnLength(g, n) - v.s;
    let room = Infinity;
    for (const o of this.vehicles) {
      if (o === v || o.dwell > 0 || o.turning) continue;
      if (o.path[o.leg] === b && o.path[o.leg + 1] === c && o.lane === v.nextLane) room = Math.min(room, left + o.s - (VEHICLE_LENGTH[o.kind] + VEHICLE_LENGTH[v.kind]) / 2);
    }
    return room;
  }

  /** Would entering the next leg run into the back of a queue there? */
  private blockedAhead(v: Vehicle, margin: number): boolean {
    const b = v.path[v.leg + 1], c = v.path[v.leg + 2];
    if (c == null) return false;
    const ne = edgeBetween(this.net, b, c);
    const lane = ne?.major ? Math.min(v.lane, 1) : 0;
    for (const o of this.vehicles) {
      if (o === v || o.dwell > 0) continue;
      if (!o.turning && o.path[o.leg] === b && o.path[o.leg + 1] === c && o.lane === lane && o.s < VEHICLE_LENGTH[o.kind] + VEHICLE_LENGTH[v.kind] + margin) return true;
      // junction reservation: one vehicle at a time turns into a given exit lane
      if (o.turning && o.path[o.leg + 1] === b && o.path[o.leg + 2] === c && o.nextLane === lane) return true;
    }
    return false;
  }

  step(dt: number, time: number) {
    for (const v of this.vehicles) {
      if (v.dwell > 0) {
        v.dwell -= dt;
        // pull out of the building only when the street entrance is clear
        if (v.dwell <= 0 && this.entranceBusy(v)) v.dwell = 0.5;
        if (v.dwell <= 0) placeVehicle(this.net, v);
        continue;
      }
      const g = legGeometry(this.net, v.path[v.leg], v.path[v.leg + 1], v.lane);
      const max = SPEED[v.kind] * (g.major ? 1.15 : 1);
      let target = max;
      if (!v.turning) {
        const toLine = g.length - v.s;
        const node = this.net.nodes[v.path[v.leg + 1]];
        const light = signalFor(node, g.axis, time);
        const last = v.leg + 1 === v.path.length - 1;
        // stop for red (and for amber when there is room to), and before a queue in the next leg
        // amber: decide once, when it appears: stop if the vehicle can still stop before the line,
        // otherwise clear the junction while the light is still amber
        if (light === 'green') v.amber = null;
        else if (light === 'amber' && v.amber == null) v.amber = (v.speed * v.speed) / (2 * DECEL * 0.7) <= toLine - 0.4 ? 'stop' : 'go';
        if (v.amber === 'go' && v.speed < 1) v.amber = 'stop'; // held at the line: it no longer has the amber
        const mustStop = !last && ((light === 'red' && v.amber !== 'go') || (light === 'amber' && v.amber === 'stop') || this.blockedAhead(v, 0.5));
        if (mustStop) target = Math.min(target, brake(toLine - 0.4));
        if (last) target = Math.min(target, Math.max(0.6, toLine * 1.2)); // pulling in at the destination
        const gap = this.gapAhead(v);
        if (gap < Infinity) target = Math.min(target, brake(gap - 0.7));
      } else {
        target = Math.min(max, 3.5); // slow through the turn
        // and for anything at the start of the street being entered
        const room = this.roomAtEntry(v);
        if (room < Infinity) target = Math.min(target, brake(room - 0.7));
      }
      v.speed += Math.max(-DECEL * dt, Math.min(5 * dt, target - v.speed));
      v.s += v.speed * dt;
      if (!v.turning && v.s >= g.length) {
        if (v.leg + 1 >= v.path.length - 1) {
          // arrived: park at the kerb for a while, then set off for the next destination
          v.s = g.length; placeVehicle(this.net, v);
          v.dwell = 3 + this.rng() * 6; v.speed = 0;
          const here = v.path[v.leg + 1];
          this.newTrip(v, here);
          continue;
        }
        v.turning = true; v.s = 0; v.amber = null;
        // the lane to take on the next street (a local street has one each way)
        const ne = edgeBetween(this.net, v.path[v.leg + 1], v.path[v.leg + 2])!;
        v.nextLane = ne.major ? Math.min(v.lane, 1) : 0;
      } else if (v.turning) {
        const n = legGeometry(this.net, v.path[v.leg + 1], v.path[v.leg + 2], v.nextLane);
        if (v.s >= turnLength(g, n)) { v.turning = false; v.leg++; v.s = 0; v.lane = v.nextLane; }
      }
      placeVehicle(this.net, v);
    }
  }
}

// ---------------------------------------------------------------- pedestrians

/** A street corner: the sidewalk point at a node's quadrant (sx, sz = ±1). */
export interface Corner { node: number; sx: number; sz: number }
export function cornerPos(net: RoadNetwork, c: Corner): { x: number; z: number } {
  const n = net.nodes[c.node];
  const majX = net.edges.some((e) => e.axis === 'x' && (e.a === n.id || e.b === n.id) && e.major);
  const majZ = net.edges.some((e) => e.axis === 'z' && (e.a === n.id || e.b === n.id) && e.major);
  // the corner sits outside both carriageways (x-axis streets bound it in z, and vice versa)
  return { x: n.x + c.sx * sidewalkOffset(majZ), z: n.z + c.sz * sidewalkOffset(majX) };
}

export interface Walker {
  id: number; variant: number;
  from: { x: number; z: number }; to: { x: number; z: number }; t: number; len: number;
  at: Corner; next: Corner | null; crossing: Axis | null; // street being crossed (its axis)
  wait: number; speed: number; x: number; z: number; ry: number; walking: boolean;
  /** height above the street (metro platforms); street level when absent */
  y?: number;
  /** not drawn (boarded a train, gone inside) */
  hidden?: boolean;
}

/** Corners reachable from a corner: along a sidewalk to the next node, or across a street here. */
export function cornerMoves(net: RoadNetwork, c: Corner): { to: Corner; cross: Axis | null }[] {
  const n = net.nodes[c.node];
  const out: { to: Corner; cross: Axis | null }[] = [];
  for (const eid of n.edges) {
    const e = net.edges[eid]; const other = e.a === n.id ? e.b : e.a; const o = net.nodes[other];
    const dx = Math.sign(o.x - n.x), dz = Math.sign(o.z - n.z);
    // walk along this street on our side: the street runs along x (dx≠0) and we keep sz, or along z and we keep sx
    if (dx !== 0 && c.sx === dx) out.push({ to: { node: other, sx: -dx, sz: c.sz }, cross: null });
    if (dz !== 0 && c.sz === dz) out.push({ to: { node: other, sx: c.sx, sz: -dz }, cross: null });
    // cross this street at the node: an x-axis street to our side (dx = sx) is crossed by changing sz
    if (dx !== 0 && c.sx === dx) out.push({ to: { node: n.id, sx: c.sx, sz: -c.sz }, cross: 'x' });
    if (dz !== 0 && c.sz === dz) out.push({ to: { node: n.id, sx: -c.sx, sz: c.sz }, cross: 'z' });
  }
  return out;
}

/** Sidewalk walkers. Speed is the walk clip's 1.3 m/s; they wait at the kerb for the walk signal. */
export class Crowd {
  walkers: Walker[] = [];
  private rng: () => number;
  constructor(readonly net: RoadNetwork, count: number, variants: number, seed = 3) {
    let s = seed;
    this.rng = () => { s = (s * 48271) % 2147483647; return (s - 1) / 2147483646; };
    for (let i = 0; i < count; i++) {
      const node = Math.floor(this.rng() * net.nodes.length) % net.nodes.length;
      const at: Corner = { node, sx: this.rng() < 0.5 ? -1 : 1, sz: this.rng() < 0.5 ? -1 : 1 };
      const p = cornerPos(net, at);
      const w: Walker = { id: i, variant: i % variants, from: p, to: p, t: 0, len: 0, at, next: null, crossing: null, wait: this.rng() * 3, speed: 1.3 * M * (0.85 + this.rng() * 0.3), x: p.x, z: p.z, ry: 0, walking: false };
      this.choose(w);
      w.t = this.rng() * w.len;
      this.walkers.push(w);
    }
  }

  private choose(w: Walker) {
    const moves = cornerMoves(this.net, w.at);
    if (!moves.length) { w.next = null; w.wait = 2; return; }
    // prefer walking on; cross about a third of the time
    const along = moves.filter((m) => !m.cross), across = moves.filter((m) => m.cross);
    const pool = across.length && (this.rng() < 0.35 || !along.length) ? across : along;
    const m = pool[Math.floor(this.rng() * pool.length) % pool.length];
    w.next = m.to; w.crossing = m.cross;
    w.from = cornerPos(this.net, w.at); w.to = cornerPos(this.net, m.to);
    w.len = Math.hypot(w.to.x - w.from.x, w.to.z - w.from.z); w.t = 0;
  }

  step(dt: number, time: number) {
    for (const w of this.walkers) {
      if (w.wait > 0) { w.wait -= dt; w.walking = false; continue; }
      if (!w.next) { this.choose(w); continue; }
      // at the kerb before a crossing: wait for the walk signal
      if (w.crossing && w.t === 0 && !walkAcross(this.net.nodes[w.at.node], w.crossing, time)) { w.walking = false; w.ry = Math.atan2(w.to.x - w.from.x, w.to.z - w.from.z); continue; }
      w.walking = true;
      w.t = Math.min(w.len, w.t + w.speed * dt * (w.crossing ? 1.15 : 1));
      const k = w.len ? w.t / w.len : 1;
      w.x = w.from.x + (w.to.x - w.from.x) * k; w.z = w.from.z + (w.to.z - w.from.z) * k;
      w.ry = Math.atan2(w.to.x - w.from.x, w.to.z - w.from.z);
      if (w.t >= w.len) {
        w.at = w.next; w.next = null;
        if (this.rng() < 0.15) w.wait = 1 + this.rng() * 4; // pause: look around, chat
        this.choose(w);
      }
    }
  }
}

// ---------------------------------------------------------------- squares

export interface Square { x: number; z: number; half: number; obstacles: { x: number; z: number; r: number }[]; gather: { x: number; z: number }[] }

function segmentClear(sq: Square, ax: number, az: number, bx: number, bz: number, pad: number) {
  for (const o of sq.obstacles) {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((o.x - ax) * dx + (o.z - az) * dz) / L2));
    if (Math.hypot(ax + dx * t - o.x, az + dz * t - o.z) < o.r + pad) return false;
  }
  return true;
}

/**
 * People in a public square: they stroll between free points, stop at stalls and gathering
 * points, idle and look around, and never walk through furniture or leave the square.
 */
export class SquareCrowd {
  walkers: Walker[] = [];
  private rng: () => number;
  private target: { x: number; z: number }[] = [];
  constructor(readonly squares: Square[], perSquare: number, variants: number, seed = 13, idOffset = 10000, fixedVariant?: number) {
    let s = seed;
    this.rng = () => { s = (s * 48271) % 2147483647; return (s - 1) / 2147483646; };
    squares.forEach((sq, si) => {
      for (let i = 0; i < perSquare; i++) {
        const p = this.freePoint(sq);
        const corner: Corner = { node: si, sx: 1, sz: 1 }; // unused for squares
        const w: Walker = { id: idOffset + si * 1000 + i, variant: fixedVariant ?? (i + si) % variants, from: p, to: p, t: 0, len: 0, at: corner, next: null, crossing: null, wait: this.rng() * 6, speed: 1.1 * M * (0.8 + this.rng() * 0.3), x: p.x, z: p.z, ry: this.rng() * Math.PI * 2, walking: false };
        this.walkers.push(w); this.target.push(p);
        (w as Walker & { sq: number }).sq = si;
      }
    });
  }

  freePoint(sq: Square): { x: number; z: number } {
    for (let k = 0; k < 40; k++) {
      // a third of the time head for a gathering point (a stall, a sign, a bench)
      const g = sq.gather.length && this.rng() < 0.35 ? sq.gather[Math.floor(this.rng() * sq.gather.length) % sq.gather.length] : null;
      const x = g ? g.x + (this.rng() - 0.5) * 1.6 : sq.x + (this.rng() * 2 - 1) * (sq.half - 0.4);
      const z = g ? g.z + (this.rng() - 0.5) * 1.6 : sq.z + (this.rng() * 2 - 1) * (sq.half - 0.4);
      if (Math.abs(x - sq.x) > sq.half - 0.3 || Math.abs(z - sq.z) > sq.half - 0.3) continue;
      if (sq.obstacles.every((o) => Math.hypot(x - o.x, z - o.z) > o.r + 0.3)) return { x, z };
    }
    return { x: sq.x + sq.half - 0.5, z: sq.z + sq.half - 0.5 };
  }

  step(dt: number) {
    this.walkers.forEach((w) => {
      const sq = this.squares[(w as Walker & { sq: number }).sq];
      if (w.wait > 0) { w.wait -= dt; w.walking = false; return; }
      if (w.t >= w.len) {
        // pick a new destination reachable in a straight line past the furniture
        let p = this.freePoint(sq), guard = 0;
        while (!segmentClear(sq, w.x, w.z, p.x, p.z, 0.25) && guard++ < 12) p = this.freePoint(sq);
        if (!segmentClear(sq, w.x, w.z, p.x, p.z, 0.25)) { w.wait = 1; return; }
        w.from = { x: w.x, z: w.z }; w.to = p; w.len = Math.hypot(p.x - w.x, p.z - w.z); w.t = 0;
      }
      w.walking = true;
      w.t = Math.min(w.len, w.t + w.speed * dt);
      const k = w.len ? w.t / w.len : 1;
      w.x = w.from.x + (w.to.x - w.from.x) * k; w.z = w.from.z + (w.to.z - w.from.z) * k;
      w.ry = Math.atan2(w.to.x - w.from.x, w.to.z - w.from.z);
      if (w.t >= w.len) w.wait = 1.5 + this.rng() * 7; // stop: browse, chat, look around
    });
  }
}
