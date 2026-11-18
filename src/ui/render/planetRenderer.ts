// Procedural planet sprites: value-noise textured spheres with lighting,
// atmosphere rims and night-side city lights. Cached per (type, seed, size).

import { PLANET_TYPES } from '../../sim/data/planets';
import type { PlanetType } from '../../sim/types';

function hash(x: number, y: number, z: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise3(x: number, y: number, z: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz, s);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

function fbm(x: number, y: number, z: number, s: number, oct = 4): number {
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += a * noise3(x * f, y * f, z * f, s + i * 17); norm += a; a *= 0.5; f *= 2.07; }
  return sum / norm;
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const cache = new Map<string, HTMLCanvasElement>();

export interface PlanetLook { lights?: number; ring?: boolean }

export function planetSprite(type: PlanetType, seed: number, size: number, look: PlanetLook = {}): HTMLCanvasElement {
  const px = Math.max(8, Math.round(size));
  const lights = Math.min(1, look.lights ?? 0);
  const key = `${type}:${seed}:${px}:${Math.round(lights * 10)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pad = Math.ceil(px * 0.12);
  const W = px + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = W;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(W, W);
  const def = PLANET_TYPES[type];
  const [deep, mid, hi] = def.palette.map(hex);
  const r = px / 2;
  const cx = W / 2, cy = W / 2;
  const L = [-0.62, -0.45, 0.64];
  const ln = Math.hypot(...L);
  const light = L.map((v) => v / ln);
  const rot = (seed % 628) / 100;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - cx) / r, dy = (y + 0.5 - cy) / r;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const dz = Math.sqrt(1 - d2);
      // rotate around Y for variety
      const nx = dx * Math.cos(rot) + dz * Math.sin(rot);
      const nz = -dx * Math.sin(rot) + dz * Math.cos(rot);
      const ny = dy;
      const sc = 2.2;
      let col: number[];
      const n = fbm(nx * sc + 10, ny * sc + 10, nz * sc + 10, seed);
      const lat = Math.abs(ny);
      switch (type) {
        case 'gas_giant': {
          const band = Math.sin(ny * 11 + fbm(nx * 2, ny * 6, nz * 2, seed) * 5);
          col = mix(mix(deep, mid, 0.5 + band * 0.5), hi, Math.max(0, band - 0.55) * 1.6);
          break;
        }
        case 'ocean': case 'temperate': case 'jungle': case 'gaia': {
          const seaLevel = type === 'ocean' ? 0.6 : type === 'temperate' ? 0.5 : type === 'gaia' ? 0.47 : 0.42;
          if (n < seaLevel) col = mix(deep, mix(deep, [60, 120, 170], 0.5), (n / seaLevel) ** 2);
          else col = mix(mid, hi, Math.min(1, (n - seaLevel) * 3.2));
          const ice = type === 'jungle' ? 0.93 : 0.82;
          if (lat + n * 0.12 > ice) col = mix(col, [236, 244, 250], 0.85);
          break;
        }
        case 'frozen': case 'tundra': {
          col = mix(mid, hi, n);
          if (type === 'tundra' && n < 0.45) col = mix(deep, mid, n / 0.45);
          if (lat > 0.7) col = mix(col, [245, 250, 255], 0.7);
          break;
        }
        case 'volcanic': {
          const crack = Math.abs(fbm(nx * 4, ny * 4, nz * 4, seed + 3) - 0.5);
          col = mix(deep, mid, n);
          if (crack < 0.04) col = mix(col, hi, 1 - crack / 0.04);
          break;
        }
        case 'toxic': {
          const swirl = fbm(nx * 3 + n * 2, ny * 3, nz * 3, seed + 9);
          col = mix(deep, mix(mid, hi, swirl), n);
          break;
        }
        default: {
          // desert, arid, barren: dunes/craters
          col = mix(deep, mid, Math.min(1, n * 1.4));
          col = mix(col, hi, Math.max(0, n - 0.6) * 2);
          if (type === 'barren') {
            const crater = fbm(nx * 6, ny * 6, nz * 6, seed + 5);
            if (crater > 0.66) col = mix(col, deep, 0.5);
          }
        }
      }
      const lambert = Math.max(0, dx * light[0] + dy * light[1] + dz * light[2]);
      const shade = 0.08 + lambert * 1.0;
      let [R, G, B] = col.map((v) => v * shade);
      // night-side city lights
      if (lights > 0 && lambert < 0.15 && type !== 'gas_giant') {
        const city = fbm(nx * 9, ny * 9, nz * 9, seed + 77);
        if (city > 0.62 - lights * 0.12) {
          const k = (city - (0.62 - lights * 0.12)) * 6 * (1 - lambert / 0.15);
          R += 255 * k; G += 196 * k; B += 110 * k;
        }
      }
      // limb darkening & atmospheric rim
      const rim = Math.pow(1 - dz, 3);
      if (def.atmosphere) {
        const a = hex(def.atmosphere);
        const k = rim * 0.75 * (0.25 + lambert);
        R = R * (1 - k) + a[0] * k; G = G * (1 - k) + a[1] * k; B = B * (1 - k) + a[2] * k;
      }
      const i = (y * W + x) * 4;
      img.data[i] = Math.min(255, R); img.data[i + 1] = Math.min(255, G); img.data[i + 2] = Math.min(255, B);
      // anti-aliased edge
      img.data[i + 3] = Math.round(255 * Math.min(1, (1 - Math.sqrt(d2)) * r * 1.5));
    }
  }
  ctx.putImageData(img, 0, 0);
  if (def.atmosphere) {
    const g = ctx.createRadialGradient(cx, cy, r * 0.98, cx, cy, r * 1.12);
    g.addColorStop(0, hexA(def.atmosphere, 0.28));
    g.addColorStop(1, hexA(def.atmosphere, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.12, 0, Math.PI * 2); ctx.fill();
  }
  if (cache.size > 400) cache.clear();
  cache.set(key, cv);
  return cv;
}

export function hexA(c: string, a: number): string {
  const [r, g, b] = hex(c);
  return `rgba(${r},${g},${b},${a})`;
}

/** Draw a planet sprite centred at (x, y) with diameter d. */
export function drawPlanet(ctx: CanvasRenderingContext2D, type: PlanetType, seed: number, x: number, y: number, d: number, look?: PlanetLook) {
  const spr = planetSprite(type, seed, Math.min(256, Math.max(8, d * (window.devicePixelRatio || 1))), look);
  const scale = d / (spr.width / 1.24);
  const w = spr.width * scale;
  ctx.drawImage(spr, x - w / 2, y - w / 2, w, w);
}
