// Galactic map renderer (Canvas 2D). Territory is a Voronoi partition over
// all *known* systems limited by an influence radius, so borders follow real
// ownership and respect fog of war. Layers are cached and rebuilt only when
// their inputs change.

import { STAR_TYPES } from '../../sim/data/planets';
import { SHIPS } from '../../sim/data/ships';
import { visibleSystems, supplyNetwork, armed } from '../../sim/territory';
import { laneLength, adjacency } from '../../sim/galaxy';
import { fleetPower } from '../../sim/fleets';
import { hash2 } from '../../sim/rng';
import type { Fleet, GameState } from '../../sim/types';
import type { MapMode } from '../store';
import { hexA } from './planetRenderer';

export interface Camera { x: number; y: number; zoom: number }

export interface GalaxyDrawOpts {
  w: number; h: number; dpr: number;
  cam: Camera;
  selectedSystem: number | null;
  selectedFleet: number | null;
  hoverSystem: number | null;
  mode: MapMode;
  routes?: { path: number[]; status: string }[];
  time: number;
}

const INFLUENCE = 120;

let bgCache: { key: string; cv: HTMLCanvasElement } | null = null;
let terrCache: { key: string; cells: Cell[] } | null = null;

export function worldToScreen(cam: Camera, w: number, h: number, x: number, y: number): [number, number] {
  return [(x - cam.x) * cam.zoom + w / 2, (y - cam.y) * cam.zoom + h / 2];
}
export function screenToWorld(cam: Camera, w: number, h: number, sx: number, sy: number): [number, number] {
  return [(sx - w / 2) / cam.zoom + cam.x, (sy - h / 2) / cam.zoom + cam.y];
}

function background(state: GameState): HTMLCanvasElement {
  const g = state.galaxy;
  const key = `${state.settings.seed}:${g.width}`;
  if (bgCache?.key === key) return bgCache.cv;
  const S = 2; // world units per pixel
  const W = Math.ceil(g.width / S);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = W;
  const ctx = cv.getContext('2d')!;
  // nebula: low-res noise upscaled
  const N = 96;
  const small = document.createElement('canvas');
  small.width = N; small.height = N;
  const sctx = small.getContext('2d')!;
  const img = sctx.createImageData(N, N);
  const seed = state.settings.seed;
  const noise = (x: number, y: number) => {
    let v = 0, a = 0.5, f = 1;
    for (let o = 0; o < 4; o++) {
      const xi = Math.floor(x * f), yi = Math.floor(y * f);
      const xf = x * f - xi, yf = y * f - yi;
      const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
      const h = (i: number, j: number) => hash2(xi + i, yi + j, seed + o);
      v += a * ((h(0, 0) * (1 - u) + h(1, 0) * u) * (1 - w) + (h(0, 1) * (1 - u) + h(1, 1) * u) * w);
      a *= 0.5; f *= 2;
    }
    return v / 0.9375;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x / N - 0.5, dy = y / N - 0.5;
    const r = Math.hypot(dx, dy) * 2;
    const ang = Math.atan2(dy, dx);
    const arm = 0.5 + 0.5 * Math.sin(ang * 3 - r * 9);
    const n1 = noise(x / 14, y / 14);
    const n2 = noise(x / 9 + 40, y / 9 + 40);
    const falloff = Math.max(0, 1 - r);
    const dens = Math.max(0, n1 * 0.9 + arm * 0.35 - 0.55) * falloff * 1.8;
    const i = (y * N + x) * 4;
    // two-tone nebula: indigo and a dusty teal, warm near the core
    const core = Math.max(0, 1 - r * 2.2);
    img.data[i] = 40 * dens + 120 * core * dens + 30 * n2 * dens;
    img.data[i + 1] = 46 * dens + 80 * core * dens + 55 * (1 - n2) * dens;
    img.data[i + 2] = 92 * dens + 40 * core * dens + 40 * (1 - n2) * dens;
    img.data[i + 3] = Math.min(255, 255 * dens * 0.9);
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, W, W);
  // galactic core glow
  const c = ctx.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W * 0.32);
  c.addColorStop(0, 'rgba(255,226,170,0.16)');
  c.addColorStop(0.4, 'rgba(160,140,190,0.06)');
  c.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = c;
  ctx.fillRect(0, 0, W, W);
  // faint background stars
  for (let i = 0; i < W * 2.2; i++) {
    const x = hash2(i, 1, seed) * W, y = hash2(i, 2, seed) * W;
    const b = hash2(i, 3, seed);
    ctx.fillStyle = `rgba(220,215,200,${0.08 + b * 0.32})`;
    const s = b > 0.97 ? 1.4 : 0.8;
    ctx.fillRect(x, y, s, s);
  }
  bgCache = { key, cv };
  return cv;
}

// Exact territory: each known system owns its Voronoi cell clipped to a disc of
// radius INFLUENCE. Every polygon edge remembers which neighbour (or the disc,
// -1) produced it, so borders are drawn only where ownership actually changes.
interface Cell { owner: number; pts: [number, number][]; tags: number[] }

function clipCell(pts: [number, number][], tags: number[], ax: number, ay: number, bx: number, by: number, tag: number) {
  // keep the half-plane closer to (ax, ay) than to (bx, by)
  const nx = bx - ax, ny = by - ay, mx = (ax + bx) / 2, my = (ay + by) / 2;
  const side = (p: [number, number]) => (p[0] - mx) * nx + (p[1] - my) * ny;
  const op: [number, number][] = [], ot: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const sa = side(a), sb = side(b);
    const cut = (): [number, number] => { const t = sa / (sa - sb); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
    if (sa <= 0 && sb <= 0) { op.push(a); ot.push(tags[i]); }
    else if (sa <= 0) { op.push(a); ot.push(tags[i]); op.push(cut()); ot.push(tag); }
    else if (sb <= 0) { op.push(cut()); ot.push(tags[i]); }
  }
  return { pts: op, tags: ot };
}

function territory(state: GameState, known: Set<number>): Cell[] {
  const g = state.galaxy;
  let sig = 0;
  for (const s of g.systems) sig = (sig * 31 + (known.has(s.id) ? (s.owner ?? -1) + 2 : 0)) | 0;
  const key = `${g.width}:${g.systems.length}:${sig}`;
  if (terrCache?.key === key) return terrCache.cells;
  const sys = g.systems;
  const cells: Cell[] = [];
  const SEG = 48;
  for (const s of sys) {
    if (!known.has(s.id) || s.owner == null) continue;
    let pts: [number, number][] = [], tags: number[] = [];
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      pts.push([s.x + Math.cos(a) * INFLUENCE, s.y + Math.sin(a) * INFLUENCE]);
      tags.push(-1);
    }
    for (const o of sys) {
      if (o.id === s.id) continue;
      const d2 = (o.x - s.x) ** 2 + (o.y - s.y) ** 2;
      if (d2 > 4 * INFLUENCE * INFLUENCE) continue;
      ({ pts, tags } = clipCell(pts, tags, s.x, s.y, o.x, o.y, o.id));
      if (pts.length < 3) break;
    }
    if (pts.length >= 3) cells.push({ owner: s.owner, pts, tags });
  }
  terrCache = { key, cells };
  return cells;
}

function borderOwner(state: GameState, known: Set<number>, tag: number): number {
  if (tag < 0 || !known.has(tag)) return -1;
  return state.galaxy.systems[tag].owner ?? -1;
}

function drawTerritory(ctx: CanvasRenderingContext2D, state: GameState, known: Set<number>, W2S: (x: number, y: number) => [number, number], zoom: number, strength: number) {
  const cells = territory(state, known);
  const byOwner = new Map<number, Cell[]>();
  for (const c of cells) (byOwner.get(c.owner) ?? byOwner.set(c.owner, []).get(c.owner)!).push(c);
  for (const [owner, list] of byOwner) {
    const col = state.empires[owner]?.color ?? '#808080';
    const region = new Path2D();
    for (const c of list) {
      c.pts.forEach((p, i) => { const [x, y] = W2S(p[0], p[1]); if (i) region.lineTo(x, y); else region.moveTo(x, y); });
      region.closePath();
    }
    const edges = new Path2D();
    for (const c of list) {
      for (let i = 0; i < c.pts.length; i++) {
        if (borderOwner(state, known, c.tags[i]) === owner) continue;
        const a = W2S(c.pts[i][0], c.pts[i][1]);
        const b = W2S(c.pts[(i + 1) % c.pts.length][0], c.pts[(i + 1) % c.pts.length][1]);
        edges.moveTo(a[0], a[1]); edges.lineTo(b[0], b[1]);
      }
    }
    ctx.save();
    ctx.globalAlpha = 0.11 * strength;
    ctx.fillStyle = col;
    ctx.fill(region);
    // inner wash along the frontier, clipped to the realm
    ctx.clip(region);
    ctx.globalAlpha = 0.22 * strength;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(6, 16 * zoom);
    ctx.lineJoin = 'round';
    ctx.stroke(edges);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.85 * strength;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.stroke(edges);
    ctx.restore();
  }
}

export function fleetWorldPos(state: GameState, f: Fleet): [number, number] {
  const s = state.galaxy.systems[f.systemId];
  if (f.progress > 0 && f.path.length && Number.isFinite(f.progress)) {
    const n = state.galaxy.systems[f.path[0]];
    const t = Math.min(1, f.progress / laneLength(state.galaxy, f.systemId, f.path[0]));
    return [s.x + (n.x - s.x) * t, s.y + (n.y - s.y) * t];
  }
  return [s.x, s.y];
}

export interface FleetMark { id: number; x: number; y: number }

export function drawGalaxy(ctx: CanvasRenderingContext2D, state: GameState, o: GalaxyDrawOpts): FleetMark[] {
  const { w, h, cam } = o;
  const pid = state.playerId;
  const player = state.empires[pid];
  const explored = new Set(player.explored);
  const visible = visibleSystems(state, pid);
  const g = state.galaxy;
  const W2S = (x: number, y: number) => worldToScreen(cam, w, h, x, y);

  // backdrop
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, w, h);
  const bg = background(state);
  {
    const [x0, y0] = W2S(0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bg, x0, y0, g.width * cam.zoom, g.height * cam.zoom);
  }
  // territory
  drawTerritory(ctx, state, explored, W2S, cam.zoom, o.mode === 'political' ? 1 : 0.5);
  // supply overlay
  if (o.mode === 'supply') {
    const net = supplyNetwork(state, pid);
    ctx.fillStyle = 'rgba(95,167,154,0.10)';
    for (const sid of net) {
      const s = g.systems[sid];
      const [x, y] = W2S(s.x, s.y);
      ctx.beginPath(); ctx.arc(x, y, 60 * cam.zoom, 0, Math.PI * 2); ctx.fill();
    }
  }
  // lanes
  ctx.lineWidth = Math.max(0.6, 1 * Math.min(1.4, cam.zoom));
  for (const [a, b] of g.lanes) {
    const known = explored.has(a) || explored.has(b);
    const sa = g.systems[a], sb = g.systems[b];
    const [x1, y1] = W2S(sa.x, sa.y);
    const [x2, y2] = W2S(sb.x, sb.y);
    if (Math.max(x1, x2) < -20 || Math.min(x1, x2) > w + 20 || Math.max(y1, y2) < -20 || Math.min(y1, y2) > h + 20) continue;
    ctx.strokeStyle = known ? 'rgba(214,204,180,0.22)' : 'rgba(214,204,180,0.06)';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  // trade routes
  if (o.mode === 'trade' && o.routes) {
    for (const r of o.routes) {
      ctx.strokeStyle = r.status === 'disrupted' ? 'rgba(210,96,74,0.9)' : r.status === 'raided' ? 'rgba(217,164,65,0.85)' : 'rgba(200,163,90,0.85)';
      ctx.lineWidth = 2.2;
      ctx.setLineDash(r.status === 'disrupted' ? [4, 4] : []);
      ctx.beginPath();
      r.path.forEach((sid, i) => { const s = g.systems[sid]; const [x, y] = W2S(s.x, s.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // selected fleet path
  const sf = o.selectedFleet != null ? state.fleets[o.selectedFleet] : null;
  if (sf && sf.path.length) {
    const [fx, fy] = fleetWorldPos(state, sf);
    ctx.strokeStyle = 'rgba(224,192,126,0.9)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    let [px, py] = W2S(fx, fy);
    ctx.moveTo(px, py);
    for (const sid of sf.path) { const s = g.systems[sid]; [px, py] = W2S(s.x, s.y); ctx.lineTo(px, py); }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // systems
  const showNames = cam.zoom > 0.55;
  const nameAlpha = Math.min(1, (cam.zoom - 0.55) / 0.25);
  const battles = new Set(state.battles.filter((b) => b.ongoing).map((b) => b.systemId));
  for (const s of g.systems) {
    const [x, y] = W2S(s.x, s.y);
    if (x < -60 || x > w + 60 || y < -60 || y > h + 60) continue;
    const isExplored = explored.has(s.id);
    const st = STAR_TYPES[s.star];
    const base = isExplored ? (s.star === 'blue' ? 3.6 : s.star === 'red' ? 2.4 : s.star === 'black_hole' ? 3.2 : 3) : 2;
    const r = base * Math.max(0.9, Math.min(1.8, cam.zoom * 1.1));
    if (isExplored) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 4.5);
      glow.addColorStop(0, hexA(st.glow, 0.55));
      glow.addColorStop(1, hexA(st.glow, 0));
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x, y, r * 4.5, 0, Math.PI * 2); ctx.fill();
      if (s.star === 'black_hole') {
        ctx.strokeStyle = hexA(st.glow, 0.9); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = st.color;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      ctx.fillStyle = 'rgba(160,160,170,0.35)';
      ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, Math.PI * 2); ctx.fill();
    }
    const owner = isExplored && s.owner != null ? state.empires[s.owner] : null;
    // capital marker: a small crown-like diamond ring
    const isCapital = owner && owner.capitalSystemId === s.id;
    if (isCapital) {
      ctx.strokeStyle = owner!.color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      const k = r + 6;
      ctx.moveTo(x, y - k); ctx.lineTo(x + k, y); ctx.lineTo(x, y + k); ctx.lineTo(x - k, y); ctx.closePath();
      ctx.stroke();
    }
    // starbase tick
    if (isExplored && s.starbase >= 2) {
      ctx.fillStyle = owner?.color ?? '#999';
      ctx.fillRect(x + r + 3, y - r - 5, 3, 3);
      if (s.starbase >= 3) ctx.fillRect(x + r + 7, y - r - 5, 3, 3);
    }
    // megastructure mark
    if (isExplored && s.megastructures.length) {
      ctx.strokeStyle = '#e0c07e'; ctx.lineWidth = 1;
      const hx = x - r - 9, hy = y - r - 4;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; const px = hx + Math.cos(a) * 4, py = hy + Math.sin(a) * 4; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.closePath(); ctx.stroke();
    }
    // map mode: resources
    if (o.mode === 'resources' && isExplored) {
      let min = s.asteroidBelts * 2.5, en = 0, rare = s.features.includes('rare_cluster') ? 2 : 0, hab = 0;
      for (const pid2 of s.planetIds) {
        const p = state.planets[pid2];
        min += p.deposits.minerals; en += p.deposits.energy; rare += p.deposits.rare;
        if (['temperate', 'ocean', 'jungle', 'gaia', 'desert', 'arid', 'tundra', 'frozen'].includes(p.type) && !p.colony) hab++;
      }
      const bars: [number, string][] = [[min / 12, '#b8ae98'], [en / 12, '#e3c95a'], [rare / 4, '#a98fd6'], [hab / 3, '#5fa79a']];
      bars.forEach(([v, c], i) => {
        const bh = Math.min(18, v * 18);
        ctx.fillStyle = c;
        ctx.fillRect(x + 8 + i * 4, y + 6 - bh, 3, bh);
      });
    }
    if (battles.has(s.id) && isExplored && visible.has(s.id)) {
      const pulse = 0.5 + 0.5 * Math.sin(o.time / 160);
      ctx.strokeStyle = `rgba(210,96,74,${0.5 + pulse * 0.5})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, y, r + 9 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
    }
    if (o.selectedSystem === s.id || o.hoverSystem === s.id) {
      ctx.strokeStyle = o.selectedSystem === s.id ? '#e0c07e' : 'rgba(224,192,126,0.5)';
      ctx.lineWidth = 1.2;
      const k = r + 11;
      // corner-tick reticle (echoes the chart frame motif)
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(x + sx * k, y + sy * (k - 5)); ctx.lineTo(x + sx * k, y + sy * k); ctx.lineTo(x + sx * (k - 5), y + sy * k);
        ctx.stroke();
      }
    }
    if ((showNames && isExplored) || isCapital || o.selectedSystem === s.id) {
      const a = isCapital || o.selectedSystem === s.id ? 1 : nameAlpha;
      if (isCapital) {
        ctx.font = `600 ${Math.round(13 + Math.min(4, cam.zoom * 2))}px 'Cormorant Garamond', serif`;
      } else {
        ctx.font = `500 ${Math.round(11 + Math.min(3, cam.zoom * 1.5))}px 'Barlow Condensed', sans-serif`;
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const label = isExplored ? s.name : 'Uncharted';
      ctx.fillStyle = `rgba(7,11,20,${0.8 * a})`;
      const ly = y + r + (o.selectedSystem === s.id ? 14 : 6);
      ctx.fillText(label, x + 1, ly + 1);
      ctx.fillStyle = owner ? blend(owner.color, a) : `rgba(214,204,180,${(isExplored ? 0.75 : 0.35) * a})`;
      ctx.fillText(label, x, ly);
    }
  }

  // fleets
  const marks: FleetMark[] = [];
  const perSys = new Map<number, number>();
  const fleets = Object.values(state.fleets).sort((a, b) => a.id - b.id);
  for (const f of fleets) {
    const own = f.ownerId === pid;
    const seen = own || visible.has(f.systemId) && (f.progress === 0 || visible.has(f.path[0] ?? -1));
    if (!seen || !f.ships.length) continue;
    const [wx, wy] = fleetWorldPos(state, f);
    let [x, y] = W2S(wx, wy);
    if (f.progress === 0) {
      const k = perSys.get(f.systemId) ?? 0;
      perSys.set(f.systemId, k + 1);
      x += -14 - (k % 3) * 11;
      y += -10 + Math.floor(k / 3) * 11;
    }
    if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;
    const e = state.empires[f.ownerId];
    const civ = f.ships.every((s) => SHIPS[s.cls].civilian);
    const size = civ ? 4 : Math.min(8, 4 + Math.log2(1 + fleetPower(state, f) / 40));
    let angle = 0;
    if (f.path.length) {
      const n = state.galaxy.systems[f.path[0]];
      angle = Math.atan2(n.y - wy, n.x - wx);
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = e.color;
    ctx.strokeStyle = '#070b14';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (civ) { ctx.rect(-size / 2, -size / 2, size, size); }
    else { ctx.moveTo(size, 0); ctx.lineTo(-size * 0.8, -size * 0.7); ctx.lineTo(-size * 0.35, 0); ctx.lineTo(-size * 0.8, size * 0.7); ctx.closePath(); }
    ctx.fill(); ctx.stroke();
    if (o.selectedFleet === f.id) {
      ctx.strokeStyle = '#e0c07e'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 0, size + 4, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    if (o.mode === 'military' && armed(f)) {
      const p = fleetPower(state, f);
      ctx.strokeStyle = hexA(e.color, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, Math.sqrt(p) * 1.2 * Math.min(1.5, cam.zoom), 0, Math.PI * 2); ctx.stroke();
      if (cam.zoom > 0.7) {
        ctx.font = "500 11px 'Barlow Condensed', sans-serif";
        ctx.fillStyle = hexA(e.color, 0.95);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(p), x - 9, y);
      }
    }
    marks.push({ id: f.id, x, y });
  }
  void adjacency;
  return marks;
}

function blend(hex: string, a: number) {
  return hexA(hex, a);
}

export function hitSystem(state: GameState, cam: Camera, w: number, h: number, sx: number, sy: number): number | null {
  let best: number | null = null;
  let bd = 16 * 16;
  for (const s of state.galaxy.systems) {
    const [x, y] = worldToScreen(cam, w, h, s.x, s.y);
    const d = (x - sx) ** 2 + (y - sy) ** 2;
    if (d < bd) { bd = d; best = s.id; }
  }
  return best;
}
