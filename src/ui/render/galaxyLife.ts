// The living galaxy on the map: merchant routes and their convoys, migrants in
// transit, diplomatic couriers, construction, military concentrations, war fronts,
// blockades, sieges and the condition of every settled system. Everything drawn
// here is read from simulation state (sim/life.ts, fleets, wars, politics): a cargo
// ship is a convoy of a real route on its schedule, a transport carries real
// migrants, a courier carries a real overture. Only the placement between days is
// interpolated. Drawn on the 2D overlay with distance-based level of detail.

import type { GameState, StarSystem } from '../../sim/types';
import type { TradeRoute } from '../../sim/lifeTypes';
import { convoyPositions, routeVolume, worldCondition, fleetsAt, type WorldCondition } from '../../sim/life';
import { armed, isHostile } from '../../sim/territory';
import { fleetPower } from '../../sim/fleets';
import { laneLength } from '../../sim/galaxy';
import { civStyle, drawShip } from './civStyle';
import { hexA } from './planet3d';

export interface Projector {
  /** screen position and depth of a system */
  sys(id: number): [number, number, number] | null;
  /** screen position of a point in sim coordinates */
  pt(x: number, y: number, z: number): [number, number, number] | null;
  /** pixels per world unit at a depth */
  ppu(depth: number): number;
  R: number;
  dist: number;
  w: number;
  h: number;
}

export interface LifeOpts {
  /** wall-clock ms (ambient animation) */
  time: number;
  /** simulation time in fractional days */
  t: number;
  known: (sid: number) => boolean;
  vis: Set<number>;
  reduced: boolean;
  /** share of real traffic to draw */
  traffic: number;
  mode: string;
}

export const CONDITION_COLOR: Record<WorldCondition, string> = {
  thriving: '#ffd98a', prosperous: '#efe0b4', developing: '#b9cde3', struggling: '#c9a46a', declining: '#b8743c',
  devastated: '#d4472a', occupied: '#c46ad4', besieged: '#ff5a3c', frontier: '#8fb8a8',
};
export const CONDITION_LABEL: Record<WorldCondition, string> = {
  thriving: 'Thriving', prosperous: 'Prosperous', developing: 'Developing', struggling: 'Struggling', declining: 'Declining',
  devastated: 'Devastated', occupied: 'Occupied', besieged: 'Under siege', frontier: 'Frontier settlement',
};

/** counts of what was drawn last frame (for tests and the inspector) */
export const lifeStats = { routes: 0, convoys: 0, migrants: 0, couriers: 0, fronts: 0, builders: 0, concentrations: 0 };

// ------------------------------------------------------------------ per-tick caches

interface SystemLook { cond: WorldCondition; pops: number; dev: number; yards: number; owner: number }
const lookCache = new WeakMap<GameState, { tick: number; looks: Map<number, SystemLook> }>();
/** The dominant condition of each settled system (its most populous world sets the tone; ruin and siege override). */
export function systemLooks(state: GameState): Map<number, SystemLook> {
  const hit = lookCache.get(state);
  if (hit && hit.tick === state.tick) return hit.looks;
  const looks = new Map<number, SystemLook>();
  const rank: Record<WorldCondition, number> = { besieged: 9, devastated: 8, occupied: 7, declining: 4, struggling: 3, thriving: 2, prosperous: 2, developing: 1, frontier: 0 };
  for (const p of state.planets) {
    const c = p.colony;
    if (!c) continue;
    const cond = worldCondition(state, p);
    const l = looks.get(p.systemId);
    const yards = (c.buildings.shipyard ?? 0) + (c.buildings.spaceport ?? 0);
    if (!l) { looks.set(p.systemId, { cond, pops: c.pops, dev: c.dev ?? 0, yards, owner: c.ownerId }); continue; }
    if (rank[cond] >= 7 && rank[cond] > rank[l.cond]) l.cond = cond;
    else if (rank[l.cond] < 7 && c.pops > l.pops) l.cond = cond;
    l.pops += c.pops; l.dev = Math.max(l.dev, c.dev ?? 0); l.yards += yards;
  }
  lookCache.set(state, { tick: state.tick, looks });
  return looks;
}

interface Front { a: number; b: number }
const frontCache = new WeakMap<GameState, { tick: number; fronts: Front[] }>();
/** Lanes where realms at war face each other. */
function warFronts(state: GameState): Front[] {
  const hit = frontCache.get(state);
  if (hit && hit.tick === state.tick) return hit.fronts;
  const fronts: Front[] = [];
  if (state.wars.length) {
    const sys = state.galaxy.systems;
    for (const [a, b] of state.galaxy.lanes) {
      const oa = sys[a].owner, ob = sys[b].owner;
      if (oa == null || ob == null || oa === ob) continue;
      if (!['major', 'minor', 'rebels', 'precursor'].includes(state.empires[oa].kind)) continue;
      if (isHostile(state, oa, ob) && state.empires[ob].kind !== 'guardian' && state.empires[oa].kind !== 'guardian') fronts.push({ a, b });
    }
  }
  frontCache.set(state, { tick: state.tick, fronts });
  return fronts;
}

const lens = new Map<number, { sig: string; cum: number[] }>();
function routeLens(state: GameState, r: TradeRoute): number[] {
  const sig = r.path.join(',');
  const hit = lens.get(r.id);
  if (hit && hit.sig === sig) return hit.cum;
  const cum = [0];
  for (let i = 1; i < r.path.length; i++) cum.push(cum[i - 1] + laneLength(state.galaxy, r.path[i - 1], r.path[i]));
  if (lens.size > 6000) lens.clear();
  lens.set(r.id, { sig, cum });
  return cum;
}

/** Where along its path (in fractional system indices) a convoy at fraction `u` is. */
export function routeIndexAt(state: GameState, r: TradeRoute, u: number): number {
  if (r.path.length < 2) return 0;
  const cum = routeLens(state, r);
  const L = cum[cum.length - 1] * u;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < L) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  return i - 1 + Math.max(0, Math.min(1, (L - cum[i - 1]) / seg));
}

function along(state: GameState, r: TradeRoute, u: number): { x: number; y: number; z: number; dx: number; dy: number } {
  const sys = state.galaxy.systems;
  if (r.path.length < 2) { const s = sys[r.path[0]]; return { x: s.x, y: s.y, z: s.z ?? 0, dx: 1, dy: 0 }; }
  const cum = routeLens(state, r);
  const L = cum[cum.length - 1] * u;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < L) i++;
  const a = sys[r.path[i - 1]], b = sys[r.path[i]];
  const seg = cum[i] - cum[i - 1] || 1;
  const k = Math.max(0, Math.min(1, (L - cum[i - 1]) / seg));
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * k, dx: b.x - a.x, dy: b.y - a.y };
}

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// ------------------------------------------------------------------ drawing

/** Under the systems: routes, fronts, concentrations, the look of settled systems. */
export function drawLifeUnder(ctx: CanvasRenderingContext2D, state: GameState, P: Projector, o: LifeOpts) {
  lifeStats.routes = 0; lifeStats.fronts = 0; lifeStats.concentrations = 0;
  const far = P.dist / P.R;
  const L = state.life;
  const pulse = o.reduced ? 0.6 : 0.5 + 0.5 * Math.sin(o.time / 300);
  // merchant routes: brighter with volume; interstellar routes stand out; cut routes show red
  if (L && far < 1.8) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const r of L.routes) {
      const inter = r.a !== r.b;
      if (!inter && far > 0.9 && o.mode !== 'trade') continue;
      const v = routeVolume(r);
      if (v <= 0) continue;
      const cut = r.status === 'blockaded' || r.status === 'severed';
      const col = cut ? 'rgba(226,84,64,' : r.status === 'raided' ? 'rgba(232,160,74,' : inter ? 'rgba(236,214,160,' : `${hexA(state.empires[r.a]?.color ?? '#888', 1).slice(0, -2)}`;
      const base = Math.min(0.55, 0.1 + Math.sqrt(v) * 0.05) * (o.mode === 'trade' ? 1.6 : 1) * (far > 1 ? 0.6 : 1);
      ctx.lineWidth = Math.min(3.2, 0.6 + Math.sqrt(v) * 0.18) * (inter ? 1.3 : 1);
      if (cut) ctx.setLineDash([4, 4]); else ctx.setLineDash([]);
      ctx.strokeStyle = `${col}${base.toFixed(3)})`;
      ctx.beginPath();
      let started = false, any = false;
      for (const sid of r.path) {
        if (!o.known(sid)) { started = false; continue; }
        const sp = P.sys(sid);
        if (!sp) { started = false; continue; }
        if (started) { ctx.lineTo(sp[0], sp[1]); any = true; } else { ctx.moveTo(sp[0], sp[1]); started = true; }
      }
      if (any) { ctx.stroke(); lifeStats.routes++; }
      // where a route is cut, mark the blocker's position
      if (cut && r.blocker != null && far < 0.9) {
        const at = r.path.find((sid) => (fleetsAt(state).get(sid) ?? []).some((f) => f.ownerId === r.blocker));
        const sp = at != null && o.known(at) ? P.sys(at) : null;
        if (sp) {
          ctx.setLineDash([]); ctx.strokeStyle = `rgba(226,84,64,${0.6 + pulse * 0.4})`; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(sp[0] - 5, sp[1] - 5); ctx.lineTo(sp[0] + 5, sp[1] + 5); ctx.moveTo(sp[0] + 5, sp[1] - 5); ctx.lineTo(sp[0] - 5, sp[1] + 5); ctx.stroke();
        }
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }
  // war fronts: where hostile realms' territories touch
  const fronts = warFronts(state);
  if (fronts.length) {
    ctx.save();
    ctx.strokeStyle = `rgba(232,90,66,${0.35 + pulse * 0.35})`;
    ctx.lineWidth = far > 1 ? 2.5 : 2;
    for (const f of fronts) {
      if (!o.known(f.a) || !o.known(f.b)) continue;
      const a = P.sys(f.a), b = P.sys(f.b);
      if (!a || !b) continue;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len, k = Math.min(10, Math.max(4, len * 0.25));
      ctx.beginPath(); ctx.moveTo(mx - nx * k, my - ny * k); ctx.lineTo(mx + nx * k, my + ny * k); ctx.stroke();
      lifeStats.fronts++;
    }
    ctx.restore();
  }
  // military concentrations: armed strength gathered at a system (visible fleets only)
  const at = fleetsAt(state);
  ctx.save();
  for (const [sid, fs] of at) {
    if (!o.vis.has(sid)) continue;
    const by = new Map<number, number>();
    for (const f of fs) if (armed(f) && state.empires[f.ownerId]?.kind !== 'guardian') by.set(f.ownerId, (by.get(f.ownerId) ?? 0) + fleetPower(state, f));
    for (const [owner, pw] of by) {
      if (pw < 25) continue;
      const sp = P.sys(sid);
      if (!sp) continue;
      const rad = Math.min(46, 8 + Math.sqrt(pw) * (far > 1 ? 0.9 : 1.4));
      const g = ctx.createRadialGradient(sp[0], sp[1], 0, sp[0], sp[1], rad);
      const col = state.empires[owner]?.color ?? '#888';
      g.addColorStop(0, hexA(col, 0.32)); g.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sp[0], sp[1], rad, 0, Math.PI * 2); ctx.fill();
      lifeStats.concentrations++;
    }
  }
  ctx.restore();
  // the look of each settled system: settlement rings by maturity, coloured by condition; stations; ruins
  if (far < 0.9) {
    const looks = systemLooks(state);
    ctx.save();
    for (const [sid, l] of looks) {
      if (!o.known(sid)) continue;
      const sp = P.sys(sid);
      if (!sp || sp[0] < -30 || sp[0] > P.w + 30 || sp[1] < -30 || sp[1] > P.h + 30) continue;
      const near = P.ppu(sp[2]);
      const r = Math.max(5, Math.min(12, 30 * near)) + 3;
      const col = CONDITION_COLOR[l.cond];
      const rings = 1 + Math.min(4, Math.floor(l.dev / 22));
      const broken = l.cond === 'devastated' || l.cond === 'declining';
      const flick = l.cond === 'devastated' && !o.reduced ? 0.55 + 0.45 * Math.abs(Math.sin(o.time / 170 + sid)) : 1;
      ctx.strokeStyle = hexA(col, 0.55 * flick);
      ctx.lineWidth = 1;
      // a settled system wears arcs of light: more and fuller arcs as it matures
      const span = Math.min(Math.PI * 2, (Math.PI * 2 * (0.25 + Math.sqrt(l.pops) / 12)));
      for (let k = 0; k < rings; k++) {
        const rr = r + k * 2.2;
        const segs = broken ? 3 : 1;
        for (let s = 0; s < segs; s++) {
          const a0 = -Math.PI / 2 + (s * span) / segs + k * 0.6;
          ctx.beginPath(); ctx.arc(sp[0], sp[1], rr, a0, a0 + span / segs - (broken ? 0.35 : 0)); ctx.stroke();
        }
      }
      // orbital stations and yards circle the star
      const sys = state.galaxy.systems[sid];
      const stations = Math.min(6, sys.starbase + Math.min(3, l.yards));
      if (near > 0.012 && stations) {
        const rot = o.reduced ? 0 : o.time / 9000;
        ctx.fillStyle = hexA(state.empires[l.owner]?.color ?? '#999', 0.95);
        for (let k = 0; k < stations; k++) {
          const a = rot + (k / stations) * Math.PI * 2 + sid;
          const rr = r + rings * 2.6 + 4;
          ctx.fillRect(sp[0] + Math.cos(a) * rr - 1.5, sp[1] + Math.sin(a) * rr * 0.6 - 1.5, 3, 3);
        }
      }
      if (l.cond === 'besieged' && o.vis.has(sid)) {
        const k = r + 10 + pulse * 4;
        ctx.strokeStyle = `rgba(255,90,60,${0.55 + pulse * 0.45})`; ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(sp[0] - k, sp[1]); ctx.lineTo(sp[0] - k + 6, sp[1]); ctx.moveTo(sp[0] + k, sp[1]); ctx.lineTo(sp[0] + k - 6, sp[1]);
        ctx.moveTo(sp[0], sp[1] - k); ctx.lineTo(sp[0], sp[1] - k + 6); ctx.moveTo(sp[0], sp[1] + k); ctx.lineTo(sp[0], sp[1] + k - 6);
        ctx.stroke();
      }
    }
    if (L) {
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = 'rgba(150,150,150,0.6)';
      ctx.fillStyle = 'rgba(170,165,155,0.75)';
      ctx.font = "500 10px 'Saira Semi Condensed', sans-serif";
      ctx.textAlign = 'center';
      for (const k in L.ruins) {
        const sid = +k;
        if (!o.known(sid)) continue;
        const sp = P.sys(sid);
        if (!sp) continue;
        ctx.beginPath(); ctx.arc(sp[0], sp[1], 10, 0, Math.PI * 2); ctx.stroke();
        ctx.fillText('ruins', sp[0], sp[1] - 13);
      }
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
}

/** Over the systems: convoys, migrants, couriers, construction, blockades. */
export function drawLifeOver(ctx: CanvasRenderingContext2D, state: GameState, P: Projector, o: LifeOpts) {
  lifeStats.convoys = 0; lifeStats.migrants = 0; lifeStats.couriers = 0; lifeStats.builders = 0;
  const far = P.dist / P.R;
  const L = state.life;
  const sys = state.galaxy.systems;
  if (L && far < 0.95) {
    const big = far < 0.45;
    for (const r of L.routes) {
      const inter = r.a !== r.b;
      const style = civStyle(state.empires[r.a]);
      const col = inter ? '#f0dcae' : (state.empires[r.a]?.color ?? '#aaa');
      const pos = convoyPositions(r, o.t);
      for (let k = 0; k < pos.length; k++) {
        if (hash(r.id, k) > o.traffic) continue;
        const c = pos[k];
        const w = along(state, r, c.u);
        const sid = r.path[Math.min(r.path.length - 1, Math.round(c.u * (r.path.length - 1)))];
        if (!o.known(sid)) continue;
        const sp = P.pt(w.x, w.y, w.z);
        if (!sp || sp[0] < -10 || sp[0] > P.w + 10 || sp[1] < -10 || sp[1] > P.h + 10) continue;
        lifeStats.convoys++;
        if (c.docked) {
          // held in port while the lane is closed
          ctx.fillStyle = 'rgba(226,84,64,0.85)';
          ctx.fillRect(sp[0] + 6 + k * 3, sp[1] + 6, 2, 2);
          continue;
        }
        const ang = Math.atan2(w.dy, w.dx) + (c.laden ? 0 : Math.PI);
        if (big) {
          // heading on screen
          const ahead = P.pt(w.x + (c.laden ? w.dx : -w.dx) * 0.01, w.y + (c.laden ? w.dy : -w.dy) * 0.01, w.z);
          const sang = ahead ? Math.atan2(ahead[1] - sp[1], ahead[0] - sp[0]) : ang;
          drawShip(ctx, 'cargo', style, sp[0], sp[1], sang, inter ? 4 : 3.2, col, c.laden ? 0.95 : 0.55);
        } else {
          ctx.fillStyle = hexA(col, c.laden ? 0.95 : 0.55);
          ctx.beginPath(); ctx.arc(sp[0], sp[1], c.laden ? 1.8 : 1.3, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    // migrants: settlers, workers and refugees aboard transports
    for (const m of L.migrations) {
      if (hash(m.id, 7) > Math.max(0.5, o.traffic)) continue;
      const a = sys[state.planets[m.from].systemId], b = sys[state.planets[m.to].systemId];
      if (!o.known(a.id) && !o.known(b.id)) continue;
      const u = Math.max(0, Math.min(1, (o.t - m.depart) / Math.max(1, m.arrive - m.depart)));
      const sp = P.pt(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * u);
      const tp = P.sys(b.id);
      if (!sp || !tp) continue;
      lifeStats.migrants++;
      const col = m.kind === 'refugees' ? '#e7a08f' : m.kind === 'settlers' ? '#a7dcae' : '#a9c8ea';
      const ang = Math.atan2(tp[1] - sp[1], tp[0] - sp[0]);
      drawShip(ctx, m.kind === 'refugees' ? 'refugees' : 'settlers', 'industrial', sp[0], sp[1], ang, big ? 3.5 + Math.min(2, m.pops) : 2.2, col, 0.9);
    }
  }
  // diplomatic couriers carry real overtures and proposals between capitals (about 24 days on the road)
  const couriers: { from: number; to: number; tick: number; id: number }[] = [];
  for (const p of state.proposals) couriers.push({ from: p.from, to: p.to, tick: p.tick, id: p.id });
  for (const p of state.expansion?.politics.offers ?? []) couriers.push({ from: p.from, to: p.to, tick: p.tick, id: p.id });
  for (const c of couriers) {
    const u = (o.t - c.tick) / 24;
    if (u < 0 || u > 1) continue;
    const fa = state.empires[c.from]?.capitalSystemId, ta = state.empires[c.to]?.capitalSystemId;
    if (fa == null || ta == null || !o.known(fa) || !o.known(ta)) continue;
    const a = sys[fa], b = sys[ta];
    const sp = P.pt(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * u);
    const tp = P.sys(ta);
    if (!sp || !tp) continue;
    lifeStats.couriers++;
    ctx.strokeStyle = 'rgba(240,236,220,0.25)'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    const s0 = P.sys(fa);
    if (s0) { ctx.beginPath(); ctx.moveTo(s0[0], s0[1]); ctx.lineTo(sp[0], sp[1]); ctx.stroke(); }
    ctx.setLineDash([]);
    drawShip(ctx, 'courier', civStyle(state.empires[c.from]), sp[0], sp[1], Math.atan2(tp[1] - sp[1], tp[0] - sp[0]), far < 0.3 ? 4.5 : 3, '#f4eedc', 0.95);
  }
  // construction: outposts, starbase upgrades, megastructures and colonies under way
  if (far < 0.6) {
    const rot = o.reduced ? 0 : o.time / 1400;
    const busy = (s: StarSystem) => (s.outpostProject ? 1 : 0) + (s.starbaseUpgrade ? 1 : 0) + s.megastructures.filter((m) => m.building).length + s.planetIds.filter((pid) => state.planets[pid].colonizing).length;
    for (const s of sys) {
      if (!s.outpostProject && !s.starbaseUpgrade && !s.megastructures.length && !s.planetIds.length) continue;
      const n = busy(s);
      if (!n || !o.known(s.id)) continue;
      const sp = P.sys(s.id);
      if (!sp) continue;
      lifeStats.builders++;
      for (let k = 0; k < Math.min(4, n * 2); k++) {
        const a = rot + (k / Math.min(4, n * 2)) * Math.PI * 2;
        drawShip(ctx, 'constructor', 'industrial', sp[0] + Math.cos(a) * 15, sp[1] + Math.sin(a) * 9, a + Math.PI / 2, 2.6, '#e8c77a', 0.9);
      }
    }
  }
  // blockades: warships holding a system closed
  const pulse = o.reduced ? 0.6 : 0.5 + 0.5 * Math.sin(o.time / 260);
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.order.type !== 'blockade' || f.progress > 0 || !o.vis.has(f.systemId)) continue;
    const sp = P.sys(f.systemId);
    if (!sp) continue;
    ctx.save();
    ctx.strokeStyle = hexA(state.empires[f.ownerId]?.color ?? '#c44', 0.6 + pulse * 0.4);
    ctx.lineWidth = 1.8; ctx.setLineDash([3, 3]);
    ctx.lineDashOffset = o.reduced ? 0 : -o.time / 80;
    ctx.beginPath(); ctx.arc(sp[0], sp[1], 20, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    if (far < 0.4) {
      ctx.font = "600 10px 'Saira Semi Condensed', sans-serif"; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText('BLOCKADE', sp[0] + 1, sp[1] + 33);
      ctx.fillStyle = '#f08a76'; ctx.fillText('BLOCKADE', sp[0], sp[1] + 32);
    }
  }
  void isHostile;
}
