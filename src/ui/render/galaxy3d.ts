// 3D galaxy view (Three.js).
//
// Two kinds of stars are drawn and kept distinct:
//   - the visual starfield: ~140k GPU points sampled from the same barred-spiral
//     density model as the generator; scenery only, never simulated;
//   - simulated systems: one point per StarSystem (up to 10,000+), pickable,
//     coloured by star type and dimmed by fog of war.
// Hyperlanes, territory clouds and the disk glow are GPU geometry too. Labels,
// selection, markers, fleets and map-mode overlays are drawn on a 2D overlay
// canvas from projected positions with distance-based level of detail.

import * as THREE from 'three';
import { STAR_TYPES } from '../../sim/data/planets';
import { SHIPS } from '../../sim/data/ships';
import { visibleSystems, supplyNetwork, armed, isExplored } from '../../sim/territory';
import { fleetPower } from '../../sim/fleets';
import { laneLength, sampleGalaxyPoint, galaxyShape } from '../../sim/galaxy';
import { makeRng } from '../../sim/rng';
import type { Fleet, GameState } from '../../sim/types';
import type { MapMode } from '../store';
import { bakeGalaxyNebula } from './nebula';
import { hexA } from './planet3d';

export interface GalaxyCam { tx: number; ty: number; tz: number; dist: number; yaw: number; pitch: number }
/** Shared camera state (sim-space target), so other UI can focus systems. */
export const galaxyCam: GalaxyCam = { tx: 0, ty: 0, tz: 0, dist: 2000, yaw: 0.4, pitch: 0.9 };

export interface GalaxyFrameOpts {
  w: number; h: number; dpr: number; time: number;
  selectedSystem: number | null; selectedFleet: number | null; hoverSystem: number | null;
  mode: MapMode; routes?: { path: number[]; status: string }[];
  /** title-screen preview: no fog of war, no overlay detail */
  preview?: boolean;
}

export interface FleetMark { id: number; x: number; y: number }

/** Per-frame timings (ms), exposed for benchmarking. */
export const renderStats = { dynamic: 0, render: 0, overlay: 0, frames: 0 };

const STAR_VERT = /* glsl */ `
attribute float aSize; attribute vec3 aColor; attribute float aAlpha;
varying vec3 vColor; varying float vAlpha;
uniform float uScale;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / -mv.z, 1.2, 34.0);
  vColor = aColor; vAlpha = aAlpha;
  gl_Position = projectionMatrix * mv;
}`;
const STAR_FRAG = /* glsl */ `
varying vec3 vColor; varying float vAlpha;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float core = smoothstep(0.35, 0.0, d);
  float halo = exp(-d * d * 5.0) * 0.55;
  float a = (core + halo) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * (core * 1.2 + halo), a);
}`;
const FIELD_VERT = /* glsl */ `
attribute float aSize; attribute vec3 aColor;
varying vec3 vColor; varying float vFade;
uniform float uScale;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float s = aSize * uScale / -mv.z;
  gl_PointSize = clamp(s, 0.6, 6.0);
  vFade = clamp(s / 1.4, 0.15, 1.0);
  vColor = aColor;
  gl_Position = projectionMatrix * mv;
}`;
const FIELD_FRAG = /* glsl */ `
varying vec3 vColor; varying float vFade;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-d * d * 4.0) * vFade;
  gl_FragColor = vec4(vColor * a, a);
}`;
const TERR_VERT = /* glsl */ `
attribute vec3 aColor; varying vec3 vColor; uniform float uScale; uniform float uSize;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(uSize * uScale / -mv.z, 2.0, 420.0);
  vColor = aColor;
  gl_Position = projectionMatrix * mv;
}`;
const TERR_FRAG = /* glsl */ `
varying vec3 vColor; uniform float uK;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.3, d) * uK;
  gl_FragColor = vec4(vColor * a, a);
}`;

function softSprite(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class GalaxyView3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 1, 120000);
  private gKey = '';
  private cx = 0; private cy = 0; private R = 1;
  /** world positions (x, y, z) per system, three.js frame: plane = XZ, up = Y */
  pos = new Float32Array(0);
  private systems: THREE.Points | null = null;
  private lanes: THREE.LineSegments | null = null;
  private terr: THREE.Points | null = null;
  private routeLines: THREE.LineSegments | null = null;
  private stateSig = '';
  private disposables: { dispose(): void }[] = [];
  private sprite = softSprite();
  private proj = new Float32Array(0); // screen x, y, depth per system
  private projOk = new Uint8Array(0);
  private vp = new THREE.Matrix4();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(0x020305, 1);
  }

  /** sim (x, y, z) to three.js world */
  world(x: number, y: number, z = 0): [number, number, number] { return [x - this.cx, z, y - this.cy]; }

  private buildStatic(state: GameState) {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.scene.clear();
    const g = state.galaxy;
    this.cx = g.width / 2; this.cy = g.height / 2;
    this.R = g.shape?.R ?? (g.width - 160) / 2;
    const R = this.R;
    const n = g.systems.length;
    this.pos = new Float32Array(n * 3);
    for (const s of g.systems) {
      const [x, y, z] = this.world(s.x, s.y, s.z ?? 0);
      this.pos[s.id * 3] = x; this.pos[s.id * 3 + 1] = y; this.pos[s.id * 3 + 2] = z;
    }
    this.proj = new Float32Array(n * 3);
    this.projOk = new Uint8Array(n);

    // distant background stars
    {
      const N = 4000, p = new Float32Array(N * 3), c = new Float32Array(N * 3), sz = new Float32Array(N);
      const rng = makeRng(77);
      for (let i = 0; i < N; i++) {
        const u = rngf(rng) * 2 - 1, a = rngf(rng) * Math.PI * 2, k = Math.sqrt(1 - u * u), rr = 60000;
        p.set([Math.cos(a) * k * rr, u * rr, Math.sin(a) * k * rr], i * 3);
        const b = 0.3 + rngf(rng) * 0.5;
        c.set([b, b, b * 1.05], i * 3);
        sz[i] = 30000 + rngf(rng) * 60000;
      }
      this.addPoints(p, c, sz, FIELD_VERT, FIELD_FRAG, false);
    }
    // visual starfield from the galaxy's own density model (scenery, not simulated)
    {
      const N = Math.min(140000, Math.max(20000, n * 14));
      const p = new Float32Array(N * 3), c = new Float32Array(N * 3), sz = new Float32Array(N);
      const rng = makeRng((g.shape?.seed ?? 1) + 991);
      const shape = { ...galaxyShape(Math.max(n, 30), makeRng(1)), R, barAngle: g.shape?.barAngle ?? 0 };
      shape.barLen = 0.27 * R; shape.rMin = 0.2 * R;
      shape.arms = [0, Math.PI, Math.PI / 2, (3 * Math.PI) / 2].map((o, i) => ({ theta: shape.barAngle + o, weight: i < 2 ? 0.32 : 0.18 }));
      for (let i = 0; i < N; i++) {
        const q = sampleGalaxyPoint(rng, shape);
        p.set([q.x, q.z, q.y], i * 3);
        const warm = q.region === 'bulge' || q.region === 'bar';
        const t = rngf(rng);
        const col = warm ? [1, 0.82 - t * 0.1, 0.6 - t * 0.15] : t < 0.25 ? [0.7, 0.8, 1] : t < 0.8 ? [0.95, 0.93, 0.9] : [1, 0.78, 0.6];
        const b = 0.35 + rngf(rng) * 0.65;
        c.set([col[0] * b, col[1] * b, col[2] * b], i * 3);
        sz[i] = 12 + rngf(rng) * 30;
      }
      this.addPoints(p, c, sz, FIELD_VERT, FIELD_FRAG, true);
    }
    // disk glow
    const ext = 1.25;
    const neb = bakeGalaxyNebula(1024, g.shape?.barAngle ?? 0, ext, g.shape?.seed ?? 1);
    if (neb) {
      const tex = new THREE.CanvasTexture(neb);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(R * 2 * ext, R * 2 * ext), mat);
      plane.rotation.x = -Math.PI / 2;
      this.scene.add(plane);
      this.disposables.push(tex, mat, plane.geometry);
    }
    // bulge glow (camera-facing)
    {
      const mat = new THREE.SpriteMaterial({ map: this.sprite, color: new THREE.Color('#ffd9a0'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 });
      const s = new THREE.Sprite(mat);
      s.scale.set(R * 0.55, R * 0.4, 1);
      this.scene.add(s);
      this.disposables.push(mat);
    }
    // emission nebulae along the arms
    {
      const rng = makeRng((g.shape?.seed ?? 1) + 3);
      const count = Math.round(Math.min(260, 30 + n / 40));
      const shape = { ...galaxyShape(Math.max(n, 30), makeRng(1)), R, barAngle: g.shape?.barAngle ?? 0 };
      shape.barLen = 0.27 * R; shape.rMin = 0.2 * R;
      shape.arms = [0, Math.PI, Math.PI / 2, (3 * Math.PI) / 2].map((o, i) => ({ theta: shape.barAngle + o, weight: i < 2 ? 0.32 : 0.18 }));
      for (let i = 0; i < count; i++) {
        const q = sampleGalaxyPoint(rng, shape, 'arm');
        const tint = rngf(rng) < 0.6 ? '#c45a86' : rngf(rng) < 0.5 ? '#4fa3a8' : '#6f6fc4';
        const mat = new THREE.SpriteMaterial({ map: this.sprite, color: new THREE.Color(tint), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.1 + rngf(rng) * 0.12 });
        const sp = new THREE.Sprite(mat);
        const sc = R * (0.03 + rngf(rng) * 0.06);
        sp.scale.set(sc, sc * (0.6 + rngf(rng) * 0.6), 1);
        sp.position.set(q.x, q.z, q.y);
        sp.userData.nebula = mat.opacity;
        this.scene.add(sp);
        this.disposables.push(mat);
      }
    }
    // simulated systems
    {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
      geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1));
      const mat = new THREE.ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, uniforms: { uScale: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      this.systems = new THREE.Points(geo, mat);
      this.systems.frustumCulled = false;
      this.scene.add(this.systems);
      this.disposables.push(geo, mat);
    }
    this.lanes = null; this.terr = null; this.routeLines = null;
    this.stateSig = '';
  }

  private addPoints(p: Float32Array, c: Float32Array, sz: Float32Array, vs: string, fs: string, inGalaxy: boolean) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(c, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    const mat = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: { uScale: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.userData.field = inGalaxy;
    this.scene.add(pts);
    this.disposables.push(geo, mat);
  }

  /** Rebuild state-dependent buffers (fog of war, ownership, lanes, territory) when they change. */
  private buildDynamic(state: GameState, preview: boolean) {
    const g = state.galaxy;
    const pid = state.playerId;
    const me = state.empires[pid];
    const vis = preview ? null : visibleSystems(state, pid);
    const known = (id: number) => preview || isExplored(me, id) || vis!.has(id);
    let owned = 0;
    for (const s of g.systems) if (s.owner != null) owned = (owned * 31 + s.id * 7 + s.owner) | 0;
    const sig = `${preview}:${me?.explored.length}:${vis?.size}:${owned}`;
    if (sig === this.stateSig) return;
    this.stateSig = sig;
    const n = g.systems.length;
    // stars
    const col = this.systems!.geometry.getAttribute('aColor') as THREE.BufferAttribute;
    const size = this.systems!.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    const alpha = this.systems!.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
    const tmp = new THREE.Color();
    for (const s of g.systems) {
      const k = known(s.id);
      tmp.set(STAR_TYPES[s.star].glow);
      if (s.star === 'black_hole') tmp.set('#b48cff');
      const base = s.star === 'blue' ? 1.5 : s.star === 'red' ? 0.85 : 1;
      col.setXYZ(s.id, tmp.r, tmp.g, tmp.b);
      size.setX(s.id, (k ? 900 : 520) * base);
      alpha.setX(s.id, k ? 1 : 0.32);
    }
    col.needsUpdate = size.needsUpdate = alpha.needsUpdate = true;
    // lanes between known systems
    if (this.lanes) { this.scene.remove(this.lanes); this.lanes.geometry.dispose(); (this.lanes.material as THREE.Material).dispose(); }
    const lp: number[] = [], lc: number[] = [];
    const ec = new Map<number, THREE.Color>();
    const ecol = (o: number) => { let c = ec.get(o); if (!c) { c = new THREE.Color(state.empires[o].color); ec.set(o, c); } return c; };
    for (const [a, b] of g.lanes) {
      if (!known(a) || !known(b)) continue;
      const oa = g.systems[a].owner, ob = g.systems[b].owner;
      lp.push(this.pos[a * 3], this.pos[a * 3 + 1], this.pos[a * 3 + 2], this.pos[b * 3], this.pos[b * 3 + 1], this.pos[b * 3 + 2]);
      const c = oa != null && oa === ob ? ecol(oa).clone().multiplyScalar(0.7) : new THREE.Color(0.32, 0.38, 0.46);
      lc.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lgeo.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
    this.lanes = new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.lanes.frustumCulled = false;
    this.scene.add(this.lanes);
    // territory clouds
    if (this.terr) { this.scene.remove(this.terr); this.terr.geometry.dispose(); (this.terr.material as THREE.Material).dispose(); }
    const tp: number[] = [], tc: number[] = [];
    for (const s of g.systems) {
      if (s.owner == null || !known(s.id)) continue;
      const kind = state.empires[s.owner].kind;
      if (kind === 'guardian' || kind === 'raiders') continue;
      tp.push(this.pos[s.id * 3], this.pos[s.id * 3 + 1], this.pos[s.id * 3 + 2]);
      const c = ecol(s.owner);
      tc.push(c.r, c.g, c.b);
    }
    const tgeo = new THREE.BufferGeometry();
    tgeo.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
    tgeo.setAttribute('aColor', new THREE.Float32BufferAttribute(tc, 3));
    this.terr = new THREE.Points(tgeo, new THREE.ShaderMaterial({ vertexShader: TERR_VERT, fragmentShader: TERR_FRAG, uniforms: { uScale: { value: 1 }, uSize: { value: 260 }, uK: { value: 0.16 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.terr.frustumCulled = false;
    this.scene.add(this.terr);
    void n;
  }

  private setRoutes(routes: { path: number[]; status: string }[] | undefined) {
    if (this.routeLines) { this.scene.remove(this.routeLines); this.routeLines.geometry.dispose(); (this.routeLines.material as THREE.Material).dispose(); this.routeLines = null; }
    if (!routes?.length) return;
    const p: number[] = [], c: number[] = [];
    const col = { secure: [0.86, 0.68, 0.38], raided: [0.89, 0.66, 0.29], disrupted: [0.9, 0.38, 0.31] } as Record<string, number[]>;
    for (const r of routes) {
      for (let i = 1; i < r.path.length; i++) {
        const a = r.path[i - 1], b = r.path[i];
        p.push(this.pos[a * 3], this.pos[a * 3 + 1] + 4, this.pos[a * 3 + 2], this.pos[b * 3], this.pos[b * 3 + 1] + 4, this.pos[b * 3 + 2]);
        const k = col[r.status] ?? col.secure;
        c.push(...k, ...k);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    this.routeLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthWrite: false }));
    this.scene.add(this.routeLines);
  }

  private placeCamera(w: number, h: number) {
    const cam = galaxyCam;
    const [tx, ty, tz] = this.world(cam.tx, cam.ty, cam.tz);
    this.camera.aspect = w / h;
    this.camera.near = Math.max(1, cam.dist * 0.01);
    this.camera.far = 140000;
    this.camera.updateProjectionMatrix();
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    this.camera.position.set(tx + Math.cos(cam.yaw) * cp * cam.dist, ty + sp * cam.dist, tz + Math.sin(cam.yaw) * cp * cam.dist);
    this.camera.lookAt(tx, ty, tz);
    this.camera.updateMatrixWorld();
  }

  /** Render one frame; returns projected fleet markers for picking. */
  frame(state: GameState, o: GalaxyFrameOpts, ov: CanvasRenderingContext2D | null): FleetMark[] {
    const key = `${state.galaxy.systems.length}:${state.galaxy.width}:${state.galaxy.shape?.seed}:${state.galaxy.lanes.length}`;
    if (key !== this.gKey) { this.gKey = key; this.buildStatic(state); }
    let t0 = performance.now();
    this.buildDynamic(state, !!o.preview);
    renderStats.dynamic = performance.now() - t0;
    const { w, h, dpr } = o;
    this.renderer.setPixelRatio(dpr);
    const cv = this.renderer.domElement;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) this.renderer.setSize(w, h, false);
    this.placeCamera(w, h);
    // perspective point scale: pixels per world unit at distance 1
    const scale = (h * dpr) / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) / 100;
    // emission nebulae fade out as the camera comes in close, so local space stays clear
    const fog = Math.min(1, Math.max(0, (galaxyCam.dist - this.R * 0.12) / (this.R * 0.5)));
    this.scene.traverse((ob) => {
      const m = (ob as THREE.Points).material as THREE.ShaderMaterial;
      if (m?.uniforms?.uScale) m.uniforms.uScale.value = scale;
      if (ob.userData.nebula != null) ((ob as THREE.Sprite).material as THREE.SpriteMaterial).opacity = ob.userData.nebula * fog;
    });
    if (this.terr) (this.terr.material as THREE.ShaderMaterial).uniforms.uK.value = o.mode === 'political' ? 0.17 : 0.07;
    this.setRoutes(o.mode === 'trade' ? o.routes : undefined);
    t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    renderStats.render = performance.now() - t0;
    if (!ov) return [];
    t0 = performance.now();
    const marks = this.overlay(state, o, ov);
    renderStats.overlay = performance.now() - t0;
    renderStats.frames++;
    return marks;
  }

  /** Project every system to screen space (used by picking and the overlay). */
  private project(w: number, h: number) {
    this.vp.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const e = this.vp.elements, P = this.pos, out = this.proj, ok = this.projOk;
    const n = ok.length;
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (cw <= 0) { ok[i] = 0; continue; }
      const sx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / cw;
      const sy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw;
      out[i * 3] = (sx * 0.5 + 0.5) * w;
      out[i * 3 + 1] = (-sy * 0.5 + 0.5) * h;
      out[i * 3 + 2] = cw;
      ok[i] = sx > -1.2 && sx < 1.2 && sy > -1.2 && sy < 1.2 ? 1 : 0;
    }
  }

  screenOf(x: number, y: number, z: number, w: number, h: number): [number, number, number] | null {
    const v = new THREE.Vector3(...this.world(x, y, z)).applyMatrix4(this.vp);
    const cw = new THREE.Vector4(...this.world(x, y, z), 1).applyMatrix4(this.vp).w;
    if (cw <= 0) return null;
    return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h, cw];
  }

  /** Nearest projected system to a screen point (within `radius` px). */
  pick(state: GameState, x: number, y: number, radius = 12, knownOnly = false): number | null {
    let best = -1, bd = radius * radius;
    const me = state.empires[state.playerId];
    const ok = this.projOk, P = this.proj;
    for (let i = 0; i < ok.length; i++) {
      if (!ok[i]) continue;
      if (knownOnly && !isExplored(me, i)) continue;
      const d = (P[i * 3] - x) ** 2 + (P[i * 3 + 1] - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best >= 0 ? best : null;
  }

  /** World-space point (sim coordinates) on the galactic plane under a screen position. */
  planePoint(x: number, y: number, w: number, h: number): [number, number] | null {
    const ndc = new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const t = -ray.ray.origin.y / ray.ray.direction.y;
    if (!Number.isFinite(t) || t < 0) return null;
    const p = ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
    return [p.x + this.cx, p.z + this.cy];
  }

  private overlay(state: GameState, o: GalaxyFrameOpts, ctx: CanvasRenderingContext2D): FleetMark[] {
    const { w, h } = o;
    ctx.clearRect(0, 0, w, h);
    this.project(w, h);
    if (o.preview) return [];
    const g = state.galaxy;
    const pid = state.playerId;
    const me = state.empires[pid];
    const vis = visibleSystems(state, pid);
    const P = this.proj, ok = this.projOk;
    const pxPerUnit = (i: number) => (h / (2 * Math.tan((this.camera.fov * Math.PI) / 360))) / P[i * 3 + 2];
    // sector names when zoomed out, decluttered
    if (galaxyCam.dist > this.R * 0.25 && g.sectors) {
      ctx.font = "500 12px 'Saira Semi Condensed', sans-serif";
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const far = galaxyCam.dist > this.R * 1.1;
      const placed: [number, number, number][] = [];
      const ordered = g.sectors.slice().sort((a, b) => b.systems - a.systems);
      for (const sec of ordered) {
        const globular = sec.name.includes('Globular');
        if (sec.systems < (far ? 90 : 20) || (globular && far)) continue;
        const sp = this.screenOf(sec.x, sec.y, sec.z, w, h);
        if (!sp || sp[0] < 0 || sp[0] > w || sp[1] < 0 || sp[1] > h) continue;
        const label = sec.name.toUpperCase();
        const tw = ctx.measureText(label).width * 1.25;
        if (placed.some(([x, y, ww]) => Math.abs(x - sp[0]) < (ww + tw) / 2 + 8 && Math.abs(y - sp[1]) < 18)) continue;
        placed.push([sp[0], sp[1], tw]);
        ctx.fillStyle = globular ? 'rgba(200,170,120,0.45)' : 'rgba(170,190,215,0.45)';
        ctx.fillText(label.split('').join('\u200a'), sp[0], sp[1]);
      }
    }
    // supply lens
    if (o.mode === 'supply') {
      ctx.fillStyle = 'rgba(108,201,146,0.10)';
      for (const sid of supplyNetwork(state, pid)) {
        if (!ok[sid]) continue;
        const r = Math.max(4, 60 * pxPerUnit(sid));
        ctx.beginPath(); ctx.arc(P[sid * 3], P[sid * 3 + 1], r, 0, Math.PI * 2); ctx.fill();
      }
    }
    // selected fleet path
    const sf = o.selectedFleet != null ? state.fleets[o.selectedFleet] : null;
    if (sf && sf.path.length) {
      ctx.strokeStyle = 'rgba(116,199,222,0.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      const a0 = fleetScreen(this, state, sf, w, h);
      if (a0) ctx.moveTo(a0[0], a0[1]);
      for (const sid of sf.path) if (ok[sid]) ctx.lineTo(P[sid * 3], P[sid * 3 + 1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // per-system detail, nearest first, with a label budget
    const detailDist = Math.max(900, this.R * 0.55);
    const cand: number[] = [];
    for (let i = 0; i < ok.length; i++) {
      if (!ok[i]) continue;
      if (!isExplored(me, i) && !vis.has(i) && i !== o.selectedSystem) continue;
      if (P[i * 3 + 2] > detailDist * 1.6 && g.systems[i].owner == null && i !== o.selectedSystem) continue;
      cand.push(i);
    }
    cand.sort((a, b) => P[a * 3 + 2] - P[b * 3 + 2]);
    const battles = new Set(state.battles.filter((b) => b.ongoing).map((b) => b.systemId));
    let labels = 0;
    for (const i of cand) {
      const s = g.systems[i];
      const x = P[i * 3], y = P[i * 3 + 1], depth = P[i * 3 + 2];
      const near = depth < detailDist;
      const owner = s.owner != null ? state.empires[s.owner] : null;
      const isCap = owner && owner.capitalSystemId === s.id;
      const r = Math.max(3, Math.min(9, 26 * pxPerUnit(i)));
      if (isCap) {
        ctx.strokeStyle = owner!.color; ctx.lineWidth = 1.3;
        const k = r + 5;
        ctx.beginPath(); ctx.moveTo(x, y - k); ctx.lineTo(x + k, y); ctx.lineTo(x, y + k); ctx.lineTo(x - k, y); ctx.closePath(); ctx.stroke();
      }
      if (near && s.starbase >= 2 && isExplored(me, i)) {
        ctx.fillStyle = owner?.color ?? '#999';
        ctx.fillRect(x + r + 3, y - r - 5, 3, 3);
        if (s.starbase >= 3) ctx.fillRect(x + r + 7, y - r - 5, 3, 3);
      }
      if (near && s.megastructures.length && isExplored(me, i)) {
        ctx.strokeStyle = '#dcae62'; ctx.lineWidth = 1;
        const hx = x - r - 9, hy = y - r - 4;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) { const a = (Math.PI / 3) * k; const px = hx + Math.cos(a) * 4, py = hy + Math.sin(a) * 4; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
        ctx.closePath(); ctx.stroke();
      }
      if (o.mode === 'resources' && near && isExplored(me, i)) {
        let min = s.asteroidBelts * 2.5, en = 0, rare = s.features.includes('rare_cluster') ? 2 : 0, hab = 0;
        for (const p2 of s.planetIds) {
          const p = state.planets[p2];
          min += p.deposits.minerals; en += p.deposits.energy; rare += p.deposits.rare;
          if (['temperate', 'ocean', 'jungle', 'gaia', 'desert', 'arid', 'tundra', 'frozen'].includes(p.type) && !p.colony) hab++;
        }
        ([[min / 12, '#b8ae98'], [en / 12, '#e3c95a'], [rare / 4, '#a98fd6'], [hab / 3, '#6cc992']] as [number, string][]).forEach(([v, c], k) => {
          const bh = Math.min(18, v * 18);
          ctx.fillStyle = c;
          ctx.fillRect(x + 8 + k * 4, y + 6 - bh, 3, bh);
        });
      }
      if (battles.has(i) && vis.has(i)) {
        const pulse = 0.5 + 0.5 * Math.sin(o.time / 160);
        ctx.strokeStyle = `rgba(229,96,79,${0.5 + pulse * 0.5})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(x, y, r + 9 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
      }
      if (o.selectedSystem === i || o.hoverSystem === i) {
        ctx.strokeStyle = o.selectedSystem === i ? '#74c7de' : 'rgba(116,199,222,0.5)';
        ctx.lineWidth = 1.3;
        const k = r + 10;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.beginPath(); ctx.moveTo(x + sx * k, y + sy * (k - 5)); ctx.lineTo(x + sx * k, y + sy * k); ctx.lineTo(x + sx * (k - 5), y + sy * k); ctx.stroke();
        }
      }
      const wantLabel = isExplored(me, i) && (near || isCap || o.selectedSystem === i) && (labels < 160 || isCap || o.selectedSystem === i);
      if (wantLabel) {
        labels++;
        ctx.font = isCap ? "600 13px 'Saira Semi Condensed', sans-serif" : "500 11.5px 'Saira Semi Condensed', sans-serif";
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        const ly = y + r + (o.selectedSystem === i ? 14 : 5);
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillText(s.name, x + 1, ly + 1);
        ctx.fillStyle = owner && owner.kind !== 'guardian' ? hexA(owner.color, 0.95) : 'rgba(214,224,236,0.8)';
        ctx.fillText(s.name, x, ly);
      }
    }
    // fleets
    const marks: FleetMark[] = [];
    const perSys = new Map<number, number>();
    for (const f of Object.values(state.fleets).sort((a, b) => a.id - b.id)) {
      const own = f.ownerId === pid;
      const seen = own || (vis.has(f.systemId) && (f.progress === 0 || vis.has(f.path[0] ?? -1)));
      if (!seen || !f.ships.length) continue;
      const sp = fleetScreen(this, state, f, w, h);
      if (!sp || sp[0] < -20 || sp[0] > w + 20 || sp[1] < -20 || sp[1] > h + 20) continue;
      if (sp[2] > Math.max(detailDist * 2.2, 3000) && !own && o.selectedFleet !== f.id) continue;
      let [x, y] = sp;
      if (f.progress === 0) {
        const k = perSys.get(f.systemId) ?? 0;
        perSys.set(f.systemId, k + 1);
        x += -16 - (k % 3) * 11;
        y += -10 - Math.floor(k / 3) * 9;
      }
      const e = state.empires[f.ownerId];
      const civ = f.ships.every((sh) => SHIPS[sh.cls].civilian);
      ctx.fillStyle = e.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (civ) ctx.rect(x - 3, y - 3, 6, 6);
      else { ctx.moveTo(x + 6, y); ctx.lineTo(x - 5, y - 4.5); ctx.lineTo(x - 2.5, y); ctx.lineTo(x - 5, y + 4.5); ctx.closePath(); }
      ctx.fill(); ctx.stroke();
      if (o.mode === 'military' && armed(f)) {
        const pw = fleetPower(state, f);
        ctx.strokeStyle = hexA(e.color, 0.6);
        ctx.beginPath(); ctx.arc(x, y, 6 + Math.sqrt(pw) * 0.7, 0, Math.PI * 2); ctx.stroke();
      }
      if (o.selectedFleet === f.id) {
        ctx.strokeStyle = '#74c7de';
        ctx.strokeRect(x - 9, y - 9, 18, 18);
      }
      marks.push({ id: f.id, x, y });
    }
    return marks;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
  }
}

function fleetScreen(v: GalaxyView3D, state: GameState, f: Fleet, w: number, h: number) {
  const s = state.galaxy.systems[f.systemId];
  let x = s.x, y = s.y, z = s.z ?? 0;
  if (f.progress > 0 && f.path.length) {
    const n = state.galaxy.systems[f.path[0]];
    const t = Math.min(1, f.progress / laneLength(state.galaxy, f.systemId, f.path[0]));
    x += (n.x - x) * t; y += (n.y - y) * t; z += ((n.z ?? 0) - z) * t;
  }
  return v.screenOf(x, y, z, w, h);
}

function rngf(r: { s: number }): number {
  let t = (r.s = (r.s + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Point the camera at a system (sim coordinates), zooming in to sector scale if far out. */
export function focusGalaxyOn(x: number, y: number, z: number, dist?: number) {
  galaxyCam.tx = x; galaxyCam.ty = y; galaxyCam.tz = z;
  if (dist != null) galaxyCam.dist = dist;
}
