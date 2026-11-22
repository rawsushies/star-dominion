import { describe, expect, it } from 'vitest';
import { roadNetwork, route, Traffic, Crowd, signalFor, walkAcross, legGeometry, roadHalf, edgeBetween, JUNCTION, VEHICLE_LENGTH, LINES, type Vehicle } from '../src/ui/render/cityRoads';
import { megacityLayout, CELL, PLOT } from '../src/ui/render/megacityLayout';

const net = roadNetwork();
const L = megacityLayout();
const plots = [...L.slots.map((s) => ({ x: s.x, z: s.z, half: s.plot === 8 ? CELL - 2 : PLOT / 2 })), ...L.districts.map((d) => ({ x: d.x, z: d.z, half: PLOT / 2 }))];
const walkable = plots.filter((p) => p.half < CELL - 2); // the Citadel plaza is a pedestrian square
const onBuildingPlot = (x: number, z: number) => walkable.some((p) => Math.abs(x - p.x) < p.half - 0.05 && Math.abs(z - p.z) < p.half - 0.05);
const onPlot = (x: number, z: number) => plots.some((p) => Math.abs(x - p.x) < p.half - 0.05 && Math.abs(z - p.z) < p.half - 0.05);
/** Distance from a point to the nearest street centre line segment, and that street. */
function nearestStreet(x: number, z: number) {
  let best = Infinity, edge = net.edges[0];
  for (const e of net.edges) {
    const A = net.nodes[e.a], B = net.nodes[e.b];
    const d = e.axis === 'x' ? (x >= Math.min(A.x, B.x) - 3 && x <= Math.max(A.x, B.x) + 3 ? Math.abs(z - A.z) : Infinity) : (z >= Math.min(A.z, B.z) - 3 && z <= Math.max(A.z, B.z) + 3 ? Math.abs(x - A.x) : Infinity);
    if (d < best) { best = d; edge = e; }
  }
  return { d: best, edge };
}

describe('capital road network', () => {
  it('is one connected grid of avenues and streets that never crosses the Citadel plaza or a plot', () => {
    expect(net.nodes.length).toBe(LINES.length * LINES.length - 1);
    const seen = new Set([0]); const stack = [0];
    while (stack.length) { const n = stack.pop()!; for (const e of net.nodes[n].edges.map((i) => net.edges[i])) { const o = e.a === n ? e.b : e.a; if (!seen.has(o)) { seen.add(o); stack.push(o); } } }
    expect(seen.size).toBe(net.nodes.length);
    for (const e of net.edges) {
      const A = net.nodes[e.a], B = net.nodes[e.b];
      for (let t = 0.1; t < 1; t += 0.1) expect(onPlot(A.x + (B.x - A.x) * t, A.z + (B.z - A.z) * t)).toBe(false);
      expect(Math.abs((A.x + B.x) / 2) < CELL - 1 && Math.abs((A.z + B.z) / 2) < CELL - 1).toBe(false);
    }
    expect(net.edges.some((e) => e.major) && net.edges.some((e) => !e.major)).toBe(true);
    expect(net.nodes.filter((n) => n.signal).length).toBeGreaterThan(40);
  });

  it('routes follow streets between any two nodes', () => {
    for (const [a, b] of [[0, net.nodes.length - 1], [5, 70], [33, 34]]) {
      const p = route(net, a, b);
      expect(p[0]).toBe(a); expect(p[p.length - 1]).toBe(b);
      for (let i = 0; i + 1 < p.length; i++) expect(edgeBetween(net, p[i], p[i + 1])).toBeTruthy();
    }
  });

  it('signals never give crossing streets green together; walkers cross only on red for that street', () => {
    const n = net.nodes.find((x) => x.signal)!;
    for (let t = 0; t < 60; t += 0.25) {
      const x = signalFor(n, 'x', t), z = signalFor(n, 'z', t);
      expect(x !== 'red' && z !== 'red').toBe(false);
      expect(walkAcross(n, 'x', t)).toBe(x === 'red');
    }
  });

  it('vehicles stay in their lanes, stop for red, keep their distance and reach their destinations', () => {
    const traffic = new Traffic(net, { destinations: {}, seed: 11 }, { car: 40, taxi: 15, van: 15, bus: 4, police: 3, ambulance: 2 });
    let arrivals = 0;
    const dt = 1 / 20;
    for (let step = 0; step < 20 * 120; step++) {
      const t = step * dt;
      const before = new Map(traffic.vehicles.map((v) => [v.id, { turning: v.turning, leg: v.leg, dwell: v.dwell, path: v.path }]));
      traffic.step(dt, t);
      for (const v of traffic.vehicles) {
        const b = before.get(v.id)!;
        if (v.dwell > 0 && b.dwell <= 0) arrivals++;
        if (v.dwell > 0) continue;
        if (!v.turning) {
          // inside the carriageway of its street, on the right-hand side of travel
          const g = legGeometry(net, v.path[v.leg], v.path[v.leg + 1], v.lane);
          const off = g.axis === 'x' ? (v.z - net.nodes[v.path[v.leg]].z) * g.dx : -(v.x - net.nodes[v.path[v.leg]].x) * g.dz;
          expect(off, `vehicle ${v.id} on the right`).toBeGreaterThan(0);
          expect(Math.abs(off)).toBeLessThan(roadHalf(g.major));
        }
        // entering a junction (stop line to turn) only on green or amber
        if (v.turning && !b.turning && b.path === v.path) {
          const g = legGeometry(net, v.path[v.leg], v.path[v.leg + 1], v.lane);
          expect(signalFor(net.nodes[v.path[v.leg + 1]], g.axis, t), `vehicle ${v.id} ran a red`).not.toBe('red');
        }
        expect(onPlot(v.x, v.z), `vehicle ${v.id} on a plot`).toBe(false);
      }
      // no two vehicles overlap in a lane
      const groups = new Map<string, Vehicle[]>();
      for (const v of traffic.vehicles) if (!v.turning && v.dwell <= 0) { const k = `${v.path[v.leg]}-${v.path[v.leg + 1]}-${v.lane}`; groups.set(k, [...(groups.get(k) ?? []), v]); }
      for (const g of groups.values()) { g.sort((a, b) => a.s - b.s); for (let i = 1; i < g.length; i++) expect(g[i].s - g[i - 1].s, 'bumper gap').toBeGreaterThan((VEHICLE_LENGTH[g[i].kind] + VEHICLE_LENGTH[g[i - 1].kind]) / 2 - 0.35); }
    }
    expect(arrivals).toBeGreaterThan(40);
  });

  it('pedestrians keep to sidewalks and crosswalks, never on plots or in the carriageway, and cross on the walk signal', () => {
    const crowd = new Crowd(net, 120, 4, 5);
    const dt = 1 / 15;
    let crossings = 0;
    for (let step = 0; step < 15 * 90; step++) {
      const t = step * dt;
      const startedCross = crowd.walkers.filter((w) => w.crossing && w.t === 0).map((w) => w.id);
      crowd.step(dt, t);
      for (const w of crowd.walkers) {
        expect(onBuildingPlot(w.x, w.z), `walker ${w.id} on a plot`).toBe(false);
        const s = nearestStreet(w.x, w.z);
        // off the carriageway unless on a crosswalk, which lies within the junction pavement
        const nearNode = net.nodes.some((n) => Math.abs(n.x - w.x) < JUNCTION / 2 + 0.8 && Math.abs(n.z - w.z) < JUNCTION / 2 + 0.8);
        if (!nearNode) expect(s.d, `walker ${w.id} in the road`).toBeGreaterThan(roadHalf(s.edge.major) - 0.01);
        if (startedCross.includes(w.id) && w.t > 0) { crossings++; expect(walkAcross(net.nodes[w.at.node], w.crossing!, t)).toBe(true); }
      }
    }
    expect(crossings).toBeGreaterThan(10);
  });
});

describe('public squares', () => {
  it('crowds stroll, gather and idle without walking through furniture or leaving the square', async () => {
    const { SquareCrowd } = await import('../src/ui/render/cityRoads');
    const squares = L.districts.filter((d) => d.kind === 'plaza').map((d) => ({ x: d.x, z: d.z, half: 5.4, obstacles: [{ x: d.x - 3.2, z: d.z - 3.2, r: 0.75 }, { x: d.x, z: d.z, r: 0.4 }, { x: d.x + 3, z: d.z + 3.6, r: 1.3 }], gather: [{ x: d.x - 2.2, z: d.z - 2.2 }] }));
    expect(squares.length).toBe(2);
    const crowd = new SquareCrowd(squares, 30, 4, 3);
    let idle = 0, moving = 0;
    for (let step = 0; step < 20 * 60; step++) {
      crowd.step(1 / 20);
      for (const w of crowd.walkers) {
        const sq = squares[(w as unknown as { sq: number }).sq];
        expect(Math.abs(w.x - sq.x)).toBeLessThanOrEqual(sq.half);
        expect(Math.abs(w.z - sq.z)).toBeLessThanOrEqual(sq.half);
        for (const o of sq.obstacles) expect(Math.hypot(w.x - o.x, w.z - o.z), 'inside furniture').toBeGreaterThan(o.r);
        if (w.walking) moving++; else idle++;
      }
    }
    expect(moving).toBeGreaterThan(1000); expect(idle).toBeGreaterThan(1000);
  });
});
