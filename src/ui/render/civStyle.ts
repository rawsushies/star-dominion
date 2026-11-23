// Visual identity of civilisations and the ship silhouettes drawn on the galaxy map.
// A realm's style follows from its government and temperament (not its colour), so its
// warships, stations and settlements read differently from its neighbours'. Display only.

import type { Empire, Fleet } from '../../sim/types';
import { SHIPS } from '../../sim/data/ships';
import { armed } from '../../sim/territory';

/** angular: martial chevrons; crystalline: faceted lattices; industrial: blocky hulls; organic: curved, swept forms; ancient: vast rings */
export type CivStyle = 'angular' | 'crystalline' | 'industrial' | 'organic' | 'ancient';

export function civStyle(e: Empire | undefined): CivStyle {
  if (!e) return 'industrial';
  if (e.kind === 'precursor' || e.kind === 'cosmic' || e.kind === 'guardian') return 'ancient';
  switch (e.government) {
    case 'junta': return 'angular';
    case 'technocracy': return 'crystalline';
    case 'corporate': return 'industrial';
    case 'republic': return 'organic';
    default: return e.personality.aggression > 0.55 ? 'angular' : e.personality.science > 0.6 ? 'crystalline' : e.personality.mercantile > 0.6 ? 'industrial' : 'organic';
  }
}

export type ShipRole = 'warfleet' | 'armada' | 'scout' | 'colony' | 'constructor' | 'transport' | 'cargo' | 'courier' | 'settlers' | 'refugees';

/** What a fleet is, read from its ships. */
export function fleetRole(f: Fleet, power: number): ShipRole {
  const cls = f.ships.map((s) => s.cls);
  if (cls.every((c) => c === 'scout')) return 'scout';
  if (cls.includes('colony')) return 'colony';
  if (cls.includes('constructor') && !armed(f)) return 'constructor';
  if (cls.every((c) => c === 'transport' || SHIPS[c].civilian)) return 'transport';
  return power > 120 || f.ships.length >= 12 ? 'armada' : 'warfleet';
}

/** Hull outlines (unit scale, nose at +x) per style for warships. */
const HULLS: Record<CivStyle, number[][]> = {
  angular: [[1, 0], [-0.6, -0.75], [-0.25, 0], [-0.6, 0.75]],
  crystalline: [[1, 0], [0.1, -0.55], [-0.7, -0.2], [-0.45, 0], [-0.7, 0.2], [0.1, 0.55]],
  industrial: [[0.9, -0.3], [0.9, 0.3], [-0.2, 0.45], [-0.75, 0.45], [-0.75, -0.45], [-0.2, -0.45]],
  organic: [[1, 0], [0.3, -0.5], [-0.5, -0.6], [-0.75, -0.15], [-0.75, 0.15], [-0.5, 0.6], [0.3, 0.5]],
  ancient: [[1, 0], [0.5, -0.7], [-0.5, -0.7], [-1, 0], [-0.5, 0.7], [0.5, 0.7]],
};

function poly(ctx: CanvasRenderingContext2D, pts: number[][], x: number, y: number, s: number, ang: number) {
  const c = Math.cos(ang), sn = Math.sin(ang);
  ctx.beginPath();
  pts.forEach(([px, py], i) => {
    const X = x + (px * c - py * sn) * s, Y = y + (px * sn + py * c) * s;
    if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
  });
  ctx.closePath();
}

/**
 * Draw one ship (or fleet) silhouette. `size` is the half-length in pixels; `ang` the heading.
 * Warships take their realm's hull style; civilian craft have role shapes everyone shares.
 */
export function drawShip(ctx: CanvasRenderingContext2D, role: ShipRole, style: CivStyle, x: number, y: number, ang: number, size: number, color: string, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = 1;
  switch (role) {
    case 'warfleet':
    case 'armada':
      poly(ctx, HULLS[style], x, y, size, ang);
      ctx.fill(); ctx.stroke();
      if (role === 'armada') {
        // escorts flying in formation on the flanks
        const c = Math.cos(ang), s = Math.sin(ang);
        for (const k of [-1, 1]) {
          poly(ctx, HULLS[style], x + (-0.9 * c - k * 1.1 * s) * size, y + (-0.9 * s + k * 1.1 * c) * size, size * 0.5, ang);
          ctx.fill(); ctx.stroke();
        }
      }
      break;
    case 'scout': {
      poly(ctx, [[1.2, 0], [0, -0.3], [-0.8, 0], [0, 0.3]], x, y, size, ang);
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'colony':
      ctx.beginPath(); ctx.ellipse(x, y, size, size * 0.55, ang, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = color; ctx.globalAlpha = alpha * 0.8;
      ctx.beginPath(); ctx.arc(x, y, size * 1.5, 0, Math.PI * 2); ctx.stroke();
      break;
    case 'constructor':
      poly(ctx, [[0.8, -0.6], [0.8, 0.6], [-0.8, 0.6], [-0.8, -0.6]], x, y, size * 0.8, ang);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang - 1.2) * size * 1.6, y + Math.sin(ang - 1.2) * size * 1.6); ctx.stroke();
      break;
    case 'transport':
    case 'settlers':
    case 'refugees':
      poly(ctx, [[0.9, -0.35], [0.9, 0.35], [-0.9, 0.35], [-0.9, -0.35]], x, y, size, ang);
      ctx.fill(); ctx.stroke();
      break;
    case 'cargo':
      poly(ctx, [[1, 0], [0.4, -0.4], [-0.9, -0.4], [-0.9, 0.4], [0.4, 0.4]], x, y, size, ang);
      ctx.fill();
      break;
    case 'courier':
      poly(ctx, [[1.3, 0], [0, -0.45], [-0.6, 0], [0, 0.45]], x, y, size, ang);
      ctx.fill(); ctx.stroke();
      break;
  }
  ctx.globalAlpha = 1;
}
