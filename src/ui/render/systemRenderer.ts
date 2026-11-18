// Star system view: star, orbits, planets and moons (procedural sprites),
// asteroid belts, starbase, orbital stations, megastructures and fleets.

import { STAR_TYPES } from '../../sim/data/planets';
import { SHIPS } from '../../sim/data/ships';
import { visibleSystems } from '../../sim/territory';
import { fleetPower } from '../../sim/fleets';
import { hash2 } from '../../sim/rng';
import type { GameState, StarSystem } from '../../sim/types';
import { drawPlanet, hexA } from './planetRenderer';

export interface SysHit { kind: 'planet' | 'fleet' | 'starbase'; id: number; x: number; y: number; r: number }

export function drawSystem(ctx: CanvasRenderingContext2D, state: GameState, sys: StarSystem, w: number, h: number, time: number, selPlanet: number | null, selFleet: number | null): SysHit[] {
  const hits: SysHit[] = [];
  const st = STAR_TYPES[sys.star];
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, w, h);
  // starfield
  for (let i = 0; i < 260; i++) {
    const x = hash2(i, 11, sys.id) * w, y = hash2(i, 12, sys.id) * h, b = hash2(i, 13, sys.id);
    ctx.fillStyle = `rgba(220,214,200,${0.06 + b * 0.3})`;
    ctx.fillRect(x, y, b > 0.95 ? 1.5 : 1, b > 0.95 ? 1.5 : 1);
  }
  const cx = w * 0.5 - 40;
  const cy = h * 0.53;
  const top = state.planets.filter((p) => p.systemId === sys.id && p.moonOf == null);
  const maxOrbit = Math.max(1, ...top.map((p) => p.orbit + 1)) + (sys.asteroidBelts ? 1 : 0);
  const span = Math.min(w * 0.42, h * 0.75);
  const step = Math.max(42, (span - 70) / maxOrbit);
  const tilt = 0.42;
  // star
  const sr = sys.star === 'blue' ? 30 : sys.star === 'red' ? 18 : sys.star === 'black_hole' ? 20 : 24;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, sr * 7);
  glow.addColorStop(0, hexA(st.glow, 0.5));
  glow.addColorStop(0.3, hexA(st.glow, 0.12));
  glow.addColorStop(1, hexA(st.glow, 0));
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(cx, cy, sr * 7, 0, Math.PI * 2); ctx.fill();
  const dyson = sys.megastructures.find((m) => m.id === 'dyson_swarm');
  if (sys.star === 'black_hole') {
    ctx.strokeStyle = hexA(st.glow, 0.85);
    for (let i = 0; i < 3; i++) { ctx.lineWidth = 2 - i * 0.5; ctx.beginPath(); ctx.ellipse(cx, cy, sr * (1.6 + i * 0.5), sr * (0.5 + i * 0.15), -0.3, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(cx, cy, sr, 0, Math.PI * 2); ctx.fill();
  } else {
    const core = ctx.createRadialGradient(cx - sr * 0.2, cy - sr * 0.2, 0, cx, cy, sr);
    core.addColorStop(0, '#ffffff');
    core.addColorStop(0.5, st.color);
    core.addColorStop(1, st.glow);
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(cx, cy, sr, 0, Math.PI * 2); ctx.fill();
  }
  if (dyson) {
    const frac = (dyson.stage + (dyson.building ? dyson.progress / 360 : 0)) / 4;
    const n = Math.round(220 * frac);
    for (let i = 0; i < n; i++) {
      const a = hash2(i, 1, 7) * Math.PI * 2 + time / 40000;
      const rr = sr * (1.5 + hash2(i, 2, 7) * 0.9);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.55;
      ctx.fillStyle = 'rgba(224,192,126,0.8)';
      ctx.fillRect(x, y, 1.4, 1.4);
    }
  }
  // orbits & planets
  const visible = visibleSystems(state, state.playerId).has(sys.id);
  for (const p of top) {
    const R = 70 + (p.orbit + 0.5) * step;
    ctx.strokeStyle = 'rgba(214,204,180,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(cx, cy, R, R * tilt, 0, 0, Math.PI * 2); ctx.stroke();
    const speed = 0.00004 / Math.sqrt(p.orbit + 1);
    const a = hash2(p.id, 5, 3) * Math.PI * 2 + time * speed;
    const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R * tilt;
    const d = p.type === 'gas_giant' ? 34 : 14 + p.size * 0.9;
    const lights = p.colony ? Math.min(1, p.colony.pops / 30) : 0;
    if (p.colony) {
      const owner = state.empires[p.colony.ownerId];
      ctx.strokeStyle = hexA(owner.color, 0.8);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, d / 2 + 5, 0, Math.PI * 2); ctx.stroke();
    }
    drawPlanet(ctx, p.type, p.id * 7919 + 13, x, y, d, { lights });
    if (p.type === 'gas_giant') {
      ctx.strokeStyle = 'rgba(230,214,190,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y, d * 0.85, d * 0.22, -0.25, 0, Math.PI * 2); ctx.stroke();
    }
    const ring = sys.megastructures.find((m) => m.id === 'orbital_ring' && p.colony?.ownerId === m.ownerId && (p.colony?.buildings.shipyard ?? 0) > 0);
    if (ring) {
      ctx.strokeStyle = `rgba(224,192,126,${ring.stage ? 0.9 : 0.4})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(ring.stage ? [] : [3, 3]);
      ctx.beginPath(); ctx.ellipse(x, y, d * 0.95, d * 0.3, 0.2, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (p.station) {
      ctx.fillStyle = p.station === 'mining' ? '#b8ae98' : p.station === 'energy' ? '#e3c95a' : '#a98fd6';
      ctx.fillRect(x + d / 2 + 3, y - d / 2 - 3, 4, 4);
    }
    if (p.colonizing) {
      ctx.strokeStyle = 'rgba(95,167,154,0.9)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.arc(x, y, d / 2 + 7, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (selPlanet === p.id) reticle(ctx, x, y, d / 2 + 10);
    ctx.font = p.colony ? "600 15px 'Cormorant Garamond', serif" : "500 12px 'Barlow Condensed', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = p.colony ? state.empires[p.colony.ownerId].color : 'rgba(214,204,180,0.7)';
    ctx.fillText(p.name, x, y + d / 2 + 8);
    hits.push({ kind: 'planet', id: p.id, x, y, r: d / 2 + 6 });
    // moons
    const moons = state.planets.filter((m) => m.moonOf === p.id);
    moons.forEach((m, i) => {
      const ma = time * 0.0002 + i * 2.4 + hash2(m.id, 1, 1) * 6;
      const mr = d / 2 + 14 + i * 9;
      const mx = x + Math.cos(ma) * mr, my = y + Math.sin(ma) * mr * 0.6;
      drawPlanet(ctx, m.type, m.id * 7919 + 13, mx, my, 9, { lights: m.colony ? 0.5 : 0 });
      if (m.colony) { ctx.strokeStyle = hexA(state.empires[m.colony.ownerId].color, 0.8); ctx.beginPath(); ctx.arc(mx, my, 8, 0, Math.PI * 2); ctx.stroke(); }
      if (selPlanet === m.id) reticle(ctx, mx, my, 10);
      hits.push({ kind: 'planet', id: m.id, x: mx, y: my, r: 8 });
    });
  }
  // asteroid belts
  for (let b = 0; b < sys.asteroidBelts; b++) {
    const R = 70 + (maxOrbit - 0.4 + b * 0.35) * step;
    for (let i = 0; i < 160; i++) {
      const a = hash2(i, b, sys.id) * Math.PI * 2 + time * 0.000004;
      const rr = R + (hash2(i, b + 9, sys.id) - 0.5) * 16;
      ctx.fillStyle = `rgba(184,174,152,${0.25 + hash2(i, 4, b) * 0.4})`;
      ctx.fillRect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * tilt, 1.4, 1.4);
    }
  }
  // starbase
  if (sys.starbase > 0 && sys.owner != null) {
    const owner = state.empires[sys.owner];
    const x = cx + sr + 34, y = cy - sr - 26;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = owner.color;
    ctx.fillStyle = '#0e1626';
    ctx.lineWidth = 1.4;
    const k = 6 + sys.starbase * 3;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = (Math.PI / 4) * i + Math.PI / 8; const px = Math.cos(a) * k, py = Math.sin(a) * k; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = owner.color;
    ctx.fillRect(-2, -2, 4, 4);
    if (sys.starbaseDamage > 0.01) {
      ctx.fillStyle = 'rgba(210,96,74,0.9)';
      ctx.fillRect(-k, k + 4, 2 * k * sys.starbaseDamage, 2);
    }
    ctx.restore();
    const bastion = sys.megastructures.find((m) => m.id === 'bastion');
    if (bastion) {
      ctx.strokeStyle = `rgba(224,192,126,${bastion.stage ? 0.9 : 0.4})`;
      ctx.strokeRect(x - 24, y - 6, 12, 12);
    }
    hits.push({ kind: 'starbase', id: sys.id, x, y, r: 14 });
  }
  const gate = sys.megastructures.find((m) => m.id === 'hypergate');
  if (gate) {
    const x = cx - span * 0.75, y = cy - span * 0.35;
    ctx.strokeStyle = `rgba(224,192,126,${gate.stage ? 0.95 : 0.35})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(x, y, 18, 26, 0.3, 0, Math.PI * 2); ctx.stroke();
  }
  for (const m of sys.megastructures.filter((m) => m.id === 'grand_archive' || m.id === 'lattice' || m.id === 'stellar_collector')) {
    const x = cx + span * 0.65, y = cy + span * 0.38 * (m.id === 'lattice' ? -1 : 1);
    ctx.strokeStyle = `rgba(224,192,126,${m.stage ? 0.9 : 0.35})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; i ? ctx.lineTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12) : ctx.moveTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12); }
    ctx.closePath(); ctx.stroke();
  }
  // fleets (only if visible to the player)
  if (visible) {
    const fleets = Object.values(state.fleets).filter((f) => f.systemId === sys.id && f.progress === 0 && f.ships.length);
    fleets.forEach((f, i) => {
      const e = state.empires[f.ownerId];
      // roster in the lower-left corner: icon cluster, then a left-aligned label
      const perCol = Math.max(3, Math.floor((h * 0.32) / 30));
      const x = 40 + Math.floor(i / perCol) * 230;
      const y = h - 34 - (perCol - 1 - (i % perCol)) * 30;
      const civ = f.ships.every((s) => SHIPS[s.cls].civilian);
      const n = Math.min(9, f.ships.length);
      for (let k = 0; k < n; k++) {
        const ox = (k % 3) * 9 - 9, oy = Math.floor(k / 3) * 7 - 7;
        ctx.fillStyle = e.color;
        ctx.beginPath();
        if (civ) ctx.rect(x + ox - 2.5, y + oy - 2.5, 5, 5);
        else { ctx.moveTo(x + ox + 5, y + oy); ctx.lineTo(x + ox - 4, y + oy - 3.5); ctx.lineTo(x + ox - 2, y + oy); ctx.lineTo(x + ox - 4, y + oy + 3.5); ctx.closePath(); }
        ctx.fill();
      }
      if (selFleet === f.id) reticle(ctx, x, y, 18);
      ctx.font = "500 11px 'Barlow Condensed', sans-serif";
      ctx.fillStyle = hexA(e.color, 0.9);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(civ ? f.name : `${f.name} · ${fleetPower(state, f)}`, x + 22, y);
      hits.push({ kind: 'fleet', id: f.id, x, y, r: 16 });
    });
  }
  return hits;
}

function reticle(ctx: CanvasRenderingContext2D, x: number, y: number, k: number) {
  ctx.strokeStyle = '#e0c07e';
  ctx.lineWidth = 1.2;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.beginPath();
    ctx.moveTo(x + sx * k, y + sy * (k - 5)); ctx.lineTo(x + sx * k, y + sy * k); ctx.lineTo(x + sx * (k - 5), y + sy * k);
    ctx.stroke();
  }
}
