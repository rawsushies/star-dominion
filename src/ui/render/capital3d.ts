// 3D imperial capital. A walled city on a floating plateau: the Citadel on
// its plot, great buildings on the others, roads, trees, a shield dome and
// shuttles in the sky. Buildings are procedural and grow with their level;
// work in progress shows scaffolding. Name/level tags and countdowns are
// HTML elements positioned over the canvas each frame.

import * as THREE from 'three';
import { CAPITAL_BY_ID, PLOT_COLS, PLOT_ROWS, type CapitalBuildingDef } from '../../sim/data/capital';
import { openPlots, plotOccupant } from '../../sim/capital';
import type { Empire } from '../../sim/types';
import { BUILDING_TIERS, DECOR, tierFor, type AssetId } from './assets/catalog';
import { instance, normalised, preload } from './assets/loader';
import { releaseView } from './assets/release';
import { RenderPipeline, type QualityTier, type PassToggles } from './pipeline';

/** Every sourced model the capital can use. */
export const CAPITAL_ASSETS: AssetId[] = [...new Set([...Object.values(BUILDING_TIERS).flatMap((ts) => ts.flatMap((t) => t.parts.map((p) => p.asset))), ...Object.values(DECOR)])];

/**
 * A capital building assembled from sourced models for its level tier, sized to a plot
 * of width `tile`. Returns null until every part has loaded.
 */
export function buildCapitalPart(id: string, level: number, tile: number): THREE.Group | null {
  const tier = tierFor(id, level);
  if (!tier) return null;
  const g = new THREE.Group();
  // within a tier, buildings still grow a little with every level
  const grow = 1 + Math.min(0.35, (level - tier.from) * 0.03);
  for (const p of tier.parts) {
    const o = instance(p.asset);
    if (!o) return null;
    const n = normalised(o, { height: p.h * tile * grow, maxFoot: (p.foot ?? (p.x || p.z ? 0.42 : 0.82)) * tile });
    n.position.set((p.x ?? 0) * tile, (p.y ?? 0) * tile, (p.z ?? 0) * tile);
    n.rotation.y = p.ry ?? 0;
    g.add(n);
  }
  return g;
}

const TILE = 4.2;
const ROAD = 1.4;
const STEP = TILE + ROAD;
const W = PLOT_COLS * STEP + ROAD;
const D = PLOT_ROWS * STEP + ROAD;

export function plotCentre(plot: number): THREE.Vector3 {
  const r = Math.floor(plot / PLOT_COLS), c = plot % PLOT_COLS;
  return new THREE.Vector3(-W / 2 + ROAD + TILE / 2 + c * STEP, 0, -D / 2 + ROAD + TILE / 2 + r * STEP);
}

/** Deterministic hash for decoration placement. */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

interface Mats { stone: THREE.Material; stoneDark: THREE.Material; metal: THREE.Material; roof: THREE.Material; glass: THREE.Material; gold: THREE.Material; leaf: THREE.Material; trunk: THREE.Material; glow: THREE.Material; scaffold: THREE.Material }

function makeMats(color: string): Mats {
  const c = new THREE.Color(color);
  return {
    stone: new THREE.MeshStandardMaterial({ color: 0xece6da, roughness: 0.8 }),
    stoneDark: new THREE.MeshStandardMaterial({ color: 0xb9b2a6, roughness: 0.9 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8f9bb0, roughness: 0.4, metalness: 0.6 }),
    roof: new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.15 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fd6ff, emissive: 0x4aa8ff, emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.3 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd9b45a, roughness: 0.3, metalness: 0.8 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x4f9a48, roughness: 0.9, flatShading: true }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 1 }),
    glow: new THREE.MeshStandardMaterial({ color: 0xffb060, emissive: 0xff7a20, emissiveIntensity: 1.4 }),
    scaffold: new THREE.LineBasicMaterial({ color: 0xd9b45a }),
  };
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function tree(m: Mats, x: number, z: number, s: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.08 * s, 0.12 * s, 0.6 * s, 5), m.trunk, 0, 0.3 * s, 0));
  const k = hash(x * 13 + z * 7);
  if (k < 0.5) g.add(mesh(new THREE.ConeGeometry(0.55 * s, 1.5 * s, 6), m.leaf, 0, 1.2 * s, 0));
  else g.add(mesh(new THREE.IcosahedronGeometry(0.6 * s, 0), m.leaf, 0, 1.0 * s, 0));
  g.position.set(x, 0, z);
  return g;
}

/** A building's model; height and detail grow with level. */
function buildingModel(def: CapitalBuildingDef, level: number, m: Mats): THREE.Group {
  const g = new THREE.Group();
  const L = Math.max(1, level);
  const hs = 1.3 + L * 0.08;
  const fp = TILE * 0.42 * (1 + Math.min(L, 20) * 0.01);
  const windows = (h: number, r: number, y0: number) => {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      g.add(mesh(new THREE.BoxGeometry(0.18, h * 0.5, 0.05), m.glass, Math.cos(a) * r, y0 + h * 0.5, Math.sin(a) * r).rotateY(-a + Math.PI / 2));
    }
  };
  switch (def.shape) {
    case 'tower': {
      // the Citadel (and the Monument): stacked tiers, a crown spire, corner turrets as it rises
      const tiers = def.id === 'citadel' ? Math.min(6, 1 + Math.floor(L / 5)) : 2 + Math.floor(L / 4);
      g.add(mesh(new THREE.BoxGeometry(TILE * 0.9, 0.5, TILE * 0.9), m.stoneDark, 0, 0.25, 0));
      let y = 0.5, r = TILE * 0.3;
      for (let i = 0; i < tiers; i++) {
        const h = (def.id === 'citadel' ? 1.6 + L * 0.06 : 1.1 * hs) * (1 - i * 0.05);
        g.add(mesh(new THREE.CylinderGeometry(r * 0.92, r, h, 8), m.stone, 0, y + h / 2, 0));
        windows(h, r * 0.93, y);
        g.add(mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.12, 8), m.roof, 0, y + h, 0));
        y += h; r *= 0.8;
      }
      g.add(mesh(new THREE.ConeGeometry(r * 1.25, 1.8 * hs, 8), m.roof, 0, y + 0.9 * hs, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 4), m.gold, 0, y + 1.8 * hs + 0.7, 0));
      g.add(mesh(new THREE.SphereGeometry(0.14, 8, 6), m.glow, 0, y + 1.8 * hs + 1.45, 0));
      if (def.id === 'citadel' && L >= 3) {
        const n = L >= 15 ? 8 : 4;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + Math.PI / 4, rr = TILE * 0.4;
          const th = (1.2 + L * 0.06) * (i % 2 ? 0.8 : 1);
          g.add(mesh(new THREE.CylinderGeometry(0.28, 0.32, th, 6), m.stone, Math.cos(a) * rr, 0.5 + th / 2, Math.sin(a) * rr));
          g.add(mesh(new THREE.ConeGeometry(0.4, 0.8, 6), m.roof, Math.cos(a) * rr, 0.5 + th + 0.4, Math.sin(a) * rr));
        }
      }
      if (L >= 20) g.add(mesh(new THREE.TorusGeometry(TILE * 0.32, 0.05, 6, 32), m.gold, 0, 0.5 + 1.5 * hs, 0).rotateX(Math.PI / 2));
      break;
    }
    case 'dome': {
      const h = 1.1 * hs;
      g.add(mesh(new THREE.CylinderGeometry(fp, fp * 1.05, h, 12), m.stone, 0, h / 2, 0));
      windows(h, fp * 1.01, 0);
      g.add(mesh(new THREE.SphereGeometry(fp * 0.95, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.roof, 0, h, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 6), m.gold, 0, h + fp * 0.95 + 0.2, 0));
      if (L >= 8) for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(fp * 0.7, h * 0.7, fp * 0.9), m.stone, s * fp * 1.25, h * 0.35, 0));
      break;
    }
    case 'hall': {
      const h = 0.9 * hs, w = fp * 2.1, d = fp * 1.4;
      g.add(mesh(new THREE.BoxGeometry(w, h, d), m.stone, 0, h / 2, 0));
      const roof = new THREE.CylinderGeometry(d * 0.62, d * 0.62, w * 1.04, 3, 1).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2);
      g.add(mesh(roof, m.roof, 0, h + d * 0.3, 0));
      for (let i = -2; i <= 2; i++) g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, h, 6), m.stoneDark, i * w / 5, h / 2, d / 2 + 0.12));
      g.add(mesh(new THREE.BoxGeometry(w * 0.9, 0.05, 0.05), m.glass, 0, h * 0.6, d / 2 + 0.01));
      if (L >= 6) g.add(mesh(new THREE.BoxGeometry(w * 0.4, h * 1.4, d * 0.6), m.stone, 0, h * 0.7, -d * 0.55));
      if (L >= 6) g.add(mesh(new THREE.ConeGeometry(d * 0.38, 0.9, 4), m.roof, 0, h * 1.4 + 0.45, -d * 0.55).rotateY(Math.PI / 4));
      break;
    }
    case 'spire': {
      const h = 2.4 * hs;
      g.add(mesh(new THREE.CylinderGeometry(fp * 0.35, fp * 0.6, h, 6), m.stone, 0, h / 2, 0));
      windows(h * 0.8, fp * 0.45, h * 0.1);
      g.add(mesh(new THREE.ConeGeometry(fp * 0.45, 1.4 * hs, 6), m.roof, 0, h + 0.7 * hs, 0));
      g.add(mesh(new THREE.TorusGeometry(fp * 0.6, 0.05, 6, 20), m.glass, 0, h * 0.75, 0).rotateX(Math.PI / 2));
      if (L >= 5) g.add(mesh(new THREE.CylinderGeometry(fp * 0.22, fp * 0.35, h * 0.6, 6), m.stone, fp * 0.8, h * 0.3, fp * 0.3));
      if (L >= 12) g.add(mesh(new THREE.CylinderGeometry(fp * 0.22, fp * 0.35, h * 0.7, 6), m.stone, -fp * 0.7, h * 0.35, -fp * 0.4));
      break;
    }
    case 'yard': {
      const h = 1.2 * hs;
      for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.18, h, TILE * 0.8), m.metal, s * fp, h / 2, 0));
      for (let i = -1; i <= 1; i++) g.add(mesh(new THREE.BoxGeometry(fp * 2.1, 0.12, 0.14), m.metal, 0, h, i * TILE * 0.3));
      const hull = mesh(new THREE.ConeGeometry(fp * 0.45, TILE * 0.8, 6), m.stone, 0, h * 0.5, 0);
      hull.rotation.x = Math.PI / 2;
      g.add(hull);
      g.add(mesh(new THREE.BoxGeometry(fp * 0.5, 0.15, TILE * 0.3), m.roof, 0, h * 0.5 + fp * 0.35, 0.3));
      break;
    }
    case 'forge': {
      const h = 0.9 * hs;
      g.add(mesh(new THREE.BoxGeometry(fp * 2, h, fp * 1.6), m.stoneDark, 0, h / 2, 0));
      g.add(mesh(new THREE.BoxGeometry(fp * 2.05, 0.15, fp * 1.65), m.roof, 0, h + 0.07, 0));
      const stacks = Math.min(4, 1 + Math.floor(L / 6));
      for (let i = 0; i < stacks; i++) g.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, h * 1.8, 8), m.metal, -fp * 0.7 + i * 0.5, h * 1.4, -fp * 0.4));
      g.add(mesh(new THREE.SphereGeometry(0.3, 10, 8), m.glow, fp * 0.5, h * 0.55, fp * 0.82));
      break;
    }
    case 'wall': {
      const h = 0.8 * hs;
      g.add(mesh(new THREE.BoxGeometry(fp * 2.2, h, fp * 2.2), m.stone, 0, h / 2, 0));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.add(mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), m.stoneDark, Math.cos(a) * fp * 1.1, h + 0.15, Math.sin(a) * fp * 1.1));
      }
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 4), m.metal, 0, h + 0.9, 0));
      g.add(mesh(new THREE.BoxGeometry(0.6, 0.35, 0.02), m.roof, 0.3, h + 1.6, 0));
      if (L >= 5) g.add(mesh(new THREE.CylinderGeometry(0.4, 0.45, h * 1.8, 6), m.stone, fp, h * 0.9, fp));
      if (L >= 5) g.add(mesh(new THREE.ConeGeometry(0.55, 0.8, 6), m.roof, fp, h * 1.8 + 0.4, fp));
      break;
    }
    case 'market': {
      const n = Math.min(9, 3 + Math.floor(L / 3));
      for (let i = 0; i < n; i++) {
        const x = ((i % 3) - 1) * fp * 0.8, z = (Math.floor(i / 3) - 1) * fp * 0.8;
        g.add(mesh(new THREE.BoxGeometry(0.5, 0.35, 0.5), m.stone, x, 0.18, z));
        g.add(mesh(new THREE.ConeGeometry(0.45, 0.35, 4), i % 2 ? m.roof : m.gold, x, 0.53, z).rotateY(Math.PI / 4));
      }
      g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 6), m.gold, 0, 0.8, 0));
      break;
    }
    case 'ring': {
      const h = 1.2 * hs;
      g.add(mesh(new THREE.CylinderGeometry(fp * 0.4, fp * 0.7, h, 8), m.stone, 0, h / 2, 0));
      g.add(mesh(new THREE.SphereGeometry(fp * 0.45, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.glass, 0, h, 0));
      const ring = mesh(new THREE.TorusGeometry(fp * 0.95, 0.07, 8, 32), m.gold, 0, h + 0.5, 0);
      ring.userData.spin = true;
      g.add(ring);
      break;
    }
  }
  return g;
}

export interface CapitalLabel { plot: number; name: string; level: number; building: boolean; progress: number; days: number }

export class CapitalView3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.5, 600);
  cam = { yaw: 0.35, pitch: 0.66, dist: 44 };
  private tops = new Map<number, number>();
  private city = new THREE.Group();
  private tiles: THREE.Mesh[] = [];
  private spinners: THREE.Object3D[] = [];
  private shuttles: THREE.Object3D[] = [];
  private clouds: THREE.Object3D[] = [];
  private mats: Mats;
  private sig = '';
  assetsReady = false;
  private last: [Empire, CapitalLabel[], number | null] | null = null;
  private labels = new Map<number, HTMLDivElement>();
  private labelData: CapitalLabel[] = [];
  private selMesh: THREE.Mesh;
  private raf = 0;
  private selected: number | null = null;
  private disposed = false;
  /** Opt-in post-processing pipeline (capital laboratory, variant B). Production passes no options. */
  readonly pipeline: RenderPipeline | null = null;
  private frames: number[] = [];

  constructor(private canvas: HTMLCanvasElement, private overlay: HTMLDivElement, color: string, private onPick: (plot: number | null) => void, opts: { quality?: QualityTier; passes?: PassToggles } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.mats = makeMats(color);
    this.buildWorld();
    this.scene.add(this.city);
    this.selMesh = new THREE.Mesh(new THREE.RingGeometry(TILE * 0.62, TILE * 0.7, 4, 1), new THREE.MeshBasicMaterial({ color: 0xffd36a, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    this.selMesh.rotation.x = -Math.PI / 2;
    this.selMesh.rotation.z = Math.PI / 4;
    this.selMesh.visible = false;
    this.scene.add(this.selMesh);
    if (opts.quality) {
      // replace the legacy lights and flat sky with the pipeline's sun, HDR sky and environment
      this.scene.traverse((o) => { if ((o as THREE.Light).isLight) o.userData.legacy = true; });
      for (const o of this.scene.children.filter((c) => c.userData.legacy)) this.scene.remove(o);
      this.scene.background = null;
      this.scene.fog = new THREE.Fog(0xcfe3f5, 140, 520);
      this.pipeline = new RenderPipeline(this.renderer, this.scene, this.camera, opts.quality, { elevation: 38, azimuth: -52, intensity: 3.4 }, opts.passes);
      this.pipeline.fitShadow(new THREE.Box3(new THREE.Vector3(-W * 0.85, -2, -D * 1.1), new THREE.Vector3(W * 0.85, 16, D * 1.1)));
    }
    this.bindInput();
    preload(CAPITAL_ASSETS).then(() => { this.sig = ''; this.assetsReady = true; if (this.last && !this.disposed) this.sync(...this.last); });
    const loop = (t: number) => { if (this.disposed) return; this.frame(t); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  private buildWorld() {
    const s = this.scene, m = this.mats;
    // sky
    const sky = document.createElement('canvas');
    sky.width = 4; sky.height = 256;
    const sg = sky.getContext('2d')!;
    const grd = sg.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#3d78c4'); grd.addColorStop(0.55, '#9cc9ef'); grd.addColorStop(1, '#e9f2fa');
    sg.fillStyle = grd; sg.fillRect(0, 0, 4, 256);
    const skyTex = new THREE.CanvasTexture(sky);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    s.background = skyTex;
    s.fog = new THREE.Fog(0xcfe3f5, 90, 260);
    // light
    s.add(new THREE.HemisphereLight(0xdfefff, 0x6a7a55, 0.9));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    sun.position.set(30, 50, 22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 140;
    sun.shadow.bias = -0.0008;
    s.add(sun);
    // far landscape far below the plateau
    const land = new THREE.Mesh(new THREE.CircleGeometry(400, 48), new THREE.MeshStandardMaterial({ color: 0x7fa86a, roughness: 1 }));
    land.rotation.x = -Math.PI / 2; land.position.y = -40;
    s.add(land);
    const sea = new THREE.Mesh(new THREE.CircleGeometry(160, 48), new THREE.MeshStandardMaterial({ color: 0x4a8fc4, roughness: 0.3, metalness: 0.2 }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(-90, -39.8, -60);
    s.add(sea);
    // plateau: grassy top, rocky flanks tapering downwards
    const R = Math.max(W, D) * 0.78;
    const top = mesh(new THREE.CylinderGeometry(R, R * 0.97, 2, 40), new THREE.MeshStandardMaterial({ color: 0x6fae5a, roughness: 1 }), 0, -1, 0);
    top.scale.z = D / W * 1.25;
    s.add(top);
    const rockGeo = new THREE.CylinderGeometry(R * 0.97, R * 0.25, 22, 24, 6);
    const pos = rockGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > 10.9) continue;
      const k = 1 + (hash(i * 3.1) - 0.5) * 0.18;
      pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k);
    }
    rockGeo.computeVertexNormals();
    const rock = mesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x8c7f70, roughness: 1, flatShading: true }), 0, -13, 0);
    rock.scale.z = D / W * 1.25;
    s.add(rock);
    // city pavement and roads
    const pave = mesh(new THREE.BoxGeometry(W + 2, 0.3, D + 2), m.stoneDark, 0, 0.0, 0);
    s.add(pave);
    // plot tiles
    for (let p = 0; p < PLOT_COLS * PLOT_ROWS; p++) {
      const c = plotCentre(p);
      const t = mesh(new THREE.BoxGeometry(TILE, 0.25, TILE), new THREE.MeshStandardMaterial({ color: 0x86b86c, roughness: 1 }), c.x, 0.2, c.z);
      t.userData.plot = p;
      this.tiles.push(t);
      s.add(t);
    }
    // ramparts with towers and a gate
    const wallH = 1.6, mx = W / 2 + 2.2, mz = D / 2 + 2.2;
    const wallSeg = (x: number, z: number, len: number, rot: number) => {
      const w = mesh(new THREE.BoxGeometry(len, wallH, 0.7), m.stone, x, wallH / 2, z);
      w.rotation.y = rot;
      s.add(w);
      for (let i = 0; i < len / 1.1; i++) {
        const o = -len / 2 + 0.4 + i * 1.1;
        const cr = mesh(new THREE.BoxGeometry(0.45, 0.35, 0.75), m.stone, x + Math.cos(rot) * o, wallH + 0.17, z - Math.sin(rot) * o);
        cr.rotation.y = rot;
        s.add(cr);
      }
    };
    wallSeg(0, -mz, mx * 2, 0);
    wallSeg(-mx, 0, mz * 2, Math.PI / 2);
    wallSeg(mx, 0, mz * 2, Math.PI / 2);
    wallSeg(-mx / 2 - 1.6, mz, mx - 3.2, 0);
    wallSeg(mx / 2 + 1.6, mz, mx - 3.2, 0);
    const towerAt = (x: number, z: number, big = false) => {
      const h = big ? 3.4 : 2.6, r = big ? 0.9 : 0.7;
      s.add(mesh(new THREE.CylinderGeometry(r, r * 1.1, h, 8), m.stone, x, h / 2, z));
      s.add(mesh(new THREE.ConeGeometry(r * 1.3, 1.4, 8), m.roof, x, h + 0.7, z));
    };
    for (const [x, z] of [[-mx, -mz], [mx, -mz], [-mx, mz], [mx, mz], [0, -mz], [-mx, 0], [mx, 0]]) towerAt(x, z);
    towerAt(-2, mz, true); towerAt(2, mz, true);
    // shield dome
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R * 1.02, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { t: { value: 0 } },
        vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vY; void main(){ vec4 w = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-w.xyz); vY = position.y; gl_Position = projectionMatrix*w; }',
        fragmentShader: 'uniform float t; varying vec3 vN; varying vec3 vV; varying float vY; void main(){ float f = pow(1.0-abs(dot(vN,vV)), 3.0); float band = 0.5+0.5*sin(vY*1.6 - t*1.2); gl_FragColor = vec4(0.6,0.85,1.0, f*0.16 + band*f*0.06); }',
      }));
    dome.scale.z = D / W * 1.25;
    dome.userData.dome = true;
    s.add(dome);
    // trees around the rim and outside the walls
    for (let i = 0; i < 70; i++) {
      const a = hash(i) * Math.PI * 2, rr = R * (0.8 + hash(i + 50) * 0.17);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr * (D / W * 1.25);
      if (Math.abs(x) < mx + 1 && Math.abs(z) < mz + 1) continue;
      s.add(tree(m, x, z, 0.9 + hash(i + 9) * 0.6));
    }
    // clouds and shuttles
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 9; i++) {
      const c = new THREE.Group();
      for (let k = 0; k < 4; k++) c.add(new THREE.Mesh(new THREE.SphereGeometry(2 + hash(i * 9 + k) * 2, 8, 6), cloudMat).translateX(k * 2.5).translateY(hash(k + i) * 1.2));
      const ca = hash(i + 3) * Math.PI * 2, cr = 80 + hash(i + 5) * 60;
      c.position.set(Math.cos(ca) * cr, -22 + hash(i + 4) * 20, Math.sin(ca) * cr);
      this.clouds.push(c);
      s.add(c);
    }
    for (let i = 0; i < 4; i++) {
      const sh = new THREE.Group();
      sh.add(mesh(new THREE.ConeGeometry(0.25, 1.2, 5), m.metal).rotateZ(-Math.PI / 2));
      sh.add(mesh(new THREE.SphereGeometry(0.1, 6, 4), m.glow, -0.6, 0, 0));
      sh.userData.phase = i * 1.7; sh.userData.r = 14 + i * 4; sh.userData.h = 10 + i * 2.5;
      this.shuttles.push(sh);
      s.add(sh);
    }
  }

  /** Rebuild the city from an empire's capital state when it changes. */
  sync(e: Empire, labels: CapitalLabel[], sel: number | null) {
    this.last = [e, labels, sel];
    const cap = e.capital;
    this.labelData = labels;
    if (!cap) return;
    const open = new Set(openPlots(e));
    const sig = JSON.stringify(cap.buildings) + cap.queue.map((j) => j.building + j.toLevel).join() + [...open].join();
    if (sig !== this.sig) {
      this.sig = sig;
      this.city.clear();
      this.tops.clear();
      this.spinners = [];
      for (let p = 0; p < PLOT_COLS * PLOT_ROWS; p++) {
        const tile = this.tiles[p];
        const id = plotOccupant(cap, p);
        (tile.material as THREE.MeshStandardMaterial).color.set(id ? 0xd8d2c4 : open.has(p) ? 0x9ccf7d : 0x5f8f4c);
        const c = plotCentre(p);
        if (!open.has(p)) {
          // sealed ground: woodland
          for (let k = 0; k < 4; k++) this.city.add(tree(this.mats, c.x + (hash(p * 4 + k) - 0.5) * TILE * 0.8, c.z + (hash(p * 4 + k + 2) - 0.5) * TILE * 0.8, 0.8 + hash(p + k) * 0.5));
          continue;
        }
        if (!id) {
          // an open plot: lawn with a couple of trees at the edge
          this.city.add(tree(this.mats, c.x - TILE * 0.38, c.z - TILE * 0.38, 0.6));
          continue;
        }
        const def = CAPITAL_BY_ID[id];
        const lvl = cap.buildings[id]?.level ?? 0;
        const job = cap.queue.find((j) => j.building === id);
        const model = buildCapitalPart(def.id, lvl || 1, TILE) ?? buildingModel(def, lvl || 1, this.mats);
        model.position.set(c.x, 0.32, c.z);
        model.traverse((o) => { o.userData.plot = p; if (o.userData.spin) this.spinners.push(o); });
        if (!lvl) {
          // foundations only: a translucent ghost of what will stand here
          model.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).material = new THREE.MeshStandardMaterial({ color: 0xd9c9a0, transparent: true, opacity: 0.35 }); } });
        }
        this.city.add(model);
        this.tops.set(p, new THREE.Box3().setFromObject(model).max.y);
        if (job) {
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const sc = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x * 1.1, size.y * 1.05, size.z * 1.1, 2, 3, 2)), this.mats.scaffold);
          sc.position.set(c.x, 0.32 + size.y * 0.525, c.z);
          sc.userData.plot = p;
          this.city.add(sc);
          const crane = new THREE.Group();
          crane.add(mesh(new THREE.BoxGeometry(0.12, size.y + 2, 0.12), this.mats.gold, 0, (size.y + 2) / 2, 0));
          crane.add(mesh(new THREE.BoxGeometry(3, 0.1, 0.1), this.mats.gold, 1, size.y + 2, 0));
          crane.position.set(c.x + TILE * 0.45, 0.32, c.z - TILE * 0.45);
          crane.userData.crane = true;
          this.spinners.push(crane);
          this.city.add(crane);
        }
      }
    }
    this.pipeline?.setEnvironmentIntensity(this.scene, 0.5);
    this.selected = sel;
    if (sel != null) { const c = plotCentre(sel); this.selMesh.position.set(c.x, 0.36, c.z); this.selMesh.visible = true; } else this.selMesh.visible = false;
  }

  private bindInput() {
    let down: { x: number; y: number; yaw: number; pitch: number } | null = null;
    let moved = false;
    this.canvas.addEventListener('pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY, yaw: this.cam.yaw, pitch: this.cam.pitch }; moved = false; this.canvas.setPointerCapture(ev.pointerId); });
    this.canvas.addEventListener('pointermove', (ev) => {
      if (!down) return;
      const dx = ev.clientX - down.x, dy = ev.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      this.cam.yaw = down.yaw - dx * 0.006;
      this.cam.pitch = Math.max(0.35, Math.min(1.35, down.pitch + dy * 0.004));
    });
    this.canvas.addEventListener('pointerup', (ev) => {
      if (down && !moved) this.onPick(this.pick(ev.clientX, ev.clientY));
      down = null;
    });
    this.canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); this.cam.dist = Math.max(18, Math.min(110, this.cam.dist * (ev.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
  }

  pick(cx: number, cy: number): number | null {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(v, this.camera);
    const hit = ray.intersectObjects([...this.city.children, ...this.tiles], true).find((h) => h.object.userData.plot != null);
    return hit ? hit.object.userData.plot : null;
  }

  /** Screen position of a plot (for tests and the overlay). */
  plotScreen(plot: number, lift = 0): { x: number; y: number; visible: boolean } {
    const c = plotCentre(plot).setY(lift);
    const p = c.project(this.camera);
    return { x: (p.x + 1) / 2 * this.canvas.clientWidth, y: (1 - p.y) / 2 * this.canvas.clientHeight, visible: p.z < 1 };
  }

  private frame(t: number) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h || this.camera.aspect !== w / h) {
      if (this.pipeline) this.pipeline.setSize(w, h); else this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    }
    const { yaw, pitch, dist } = this.cam;
    this.camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
    this.camera.lookAt(0, 1.5, 0);
    for (const sp of this.spinners) sp.rotation.y = t / (sp.userData.crane ? 3000 : 1500);
    for (const sh of this.shuttles) {
      const a = t / 6000 + sh.userData.phase;
      sh.position.set(Math.cos(a) * sh.userData.r, sh.userData.h + Math.sin(a * 2) * 0.6, Math.sin(a) * sh.userData.r * 0.7);
      sh.rotation.y = -a - Math.PI / 2;
    }
    for (const c of this.clouds) { c.position.x += 0.02; if (c.position.x > 140) c.position.x = -140; }
    this.scene.traverse((o) => { if (o.userData.dome) ((o as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.t.value = t / 1000; });
    if (this.pipeline) this.pipeline.render(); else this.renderer.render(this.scene, this.camera);
    const now = performance.now();
    this.frames.push(now); while (this.frames.length && now - this.frames[0] > 2000) this.frames.shift();
    this.updateLabels();
  }

  /** Frames per second over the last two seconds, and GPU counters. */
  stats() {
    const f = this.frames;
    const fps = f.length > 1 ? ((f.length - 1) * 1000) / (f[f.length - 1] - f[0]) : 0;
    const r = this.renderer.info;
    if (this.pipeline) return { fps, tier: this.pipeline.tier, ...this.pipeline.info() };
    return { fps, tier: 'production', calls: r.render.calls, triangles: r.render.triangles, geometries: r.memory.geometries, textures: r.memory.textures, passes: 1, shadowMap: 2048, pixelRatio: this.renderer.getPixelRatio(), aoScale: 0 };
  }

  private updateLabels() {
    const seen = new Set<number>();
    for (const l of this.labelData) {
      seen.add(l.plot);
      let el = this.labels.get(l.plot);
      if (!el) {
        el = document.createElement('div');
        el.className = 'cap-tag';
        el.title = l.name;
        el.dataset.plot = String(l.plot);
        el.addEventListener('click', () => this.onPick(l.plot));
        this.overlay.appendChild(el);
        this.labels.set(l.plot, el);
      }
      const brief = this.cam.dist > 36 && l.plot !== this.selected && !l.building;
      const html = `<span class="lv">${l.level || '–'}</span>${brief ? '' : `<span class="nm">${l.name}</span>`}${l.building ? `<div class="bar"><i style="width:${Math.round(l.progress * 100)}%"></i></div><div class="tm">${l.days} days</div>` : ''}`;
      if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
      const s = this.plotScreen(l.plot, (this.tops.get(l.plot) ?? 3) + 0.6);
      el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      el.style.display = s.visible ? '' : 'none';
    }
    for (const [p, el] of this.labels) if (!seen.has(p)) { el.remove(); this.labels.delete(p); }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const el of this.labels.values()) el.remove();
    this.pipeline?.dispose();
    releaseView(this.scene, this.renderer);
  }
}
