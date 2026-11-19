// Candidate capital view: the imperial capital as a terraced island diorama.
// DEVELOPMENT CANDIDATE — used only by the capital laboratory (capitallab.html) until the
// visual direction is approved. Same public API as CapitalView3D (sync, pick, plotScreen,
// dispose), same plot IDs, same building models from the asset catalogue.
//
// Terrain, cliffs, water, roads and plazas are generated here (they are landform, not models);
// vegetation, rocks, hills, mountains, clouds and bridges come from the KayKit Medieval Hexagon
// pack, and district dressing (habitat modules, cargo depots, landing pads, solar arrays) from
// KayKit Space Base Bits, both CC0. Repeated vegetation and props are InstancedMeshes, chunked
// by sector so frustum culling works, with a detail layer hidden at distance.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CAPITAL_BY_ID, CITADEL_PLOT } from '../../sim/data/capital';
import { openPlots, plotOccupant } from '../../sim/capital';
import type { Empire } from '../../sim/types';
import { buildCapitalPart, CAPITAL_ASSETS, type CapitalLabel } from './capital3d';
import { preload, sharedAssetResources } from './assets/loader';
import { disposeObject } from './assets/resources';
import { RenderPipeline, TIERS, type QualityTier, type PassToggles } from './pipeline';
import { dioramaLayout, TERRACES, CANAL, AVENUES, PLOT_RADIUS, terraceEdge, groundHeight, memorialAngle, districtAt, edgeNoise, SEA_LEVEL, type PlotSlot } from './dioramaLayout';

export interface DioramaOptions {
  quality: QualityTier;
  /** URL prefix where the KayKit packs are served (the dev server serves /candidates). */
  assetBase: string;
  projection?: 'perspective' | 'orthographic';
  /** Stop all motion (water, clouds) for reproducible screenshots. */
  still?: boolean;
  passes?: PassToggles;
}

const KIT_DIR = {
  hex: 'kaykit-medieval-hexagon/addons/kaykit_medieval_hexagon_pack/Assets/gltf',
  space: 'kaykit-space-base/addons/kaykit_space_base_bits/Assets/gltf',
} as const;

/** Every external model the diorama uses, with how it is sized. */
export const DIORAMA_MODELS = {
  groveA: { kit: 'hex', path: 'decoration/nature/trees_A_large', foot: 2.6 },
  groveA2: { kit: 'hex', path: 'decoration/nature/trees_A_medium', foot: 2.2 },
  groveB: { kit: 'hex', path: 'decoration/nature/trees_B_large', foot: 2.6 },
  groveB2: { kit: 'hex', path: 'decoration/nature/trees_B_medium', foot: 2.2 },
  treeA: { kit: 'hex', path: 'decoration/nature/tree_single_A', height: 1.9 },
  treeB: { kit: 'hex', path: 'decoration/nature/tree_single_B', height: 2.1 },
  rockA: { kit: 'hex', path: 'decoration/nature/rock_single_A', height: 0.45 },
  rockC: { kit: 'hex', path: 'decoration/nature/rock_single_C', height: 0.6 },
  rockE: { kit: 'hex', path: 'decoration/nature/rock_single_E', height: 0.8 },
  hills: { kit: 'hex', path: 'decoration/nature/hills_A_trees', foot: 9 },
  mountainA: { kit: 'hex', path: 'decoration/nature/mountain_A_grass_trees', foot: 16 },
  mountainB: { kit: 'hex', path: 'decoration/nature/mountain_B_grass', foot: 14 },
  cloud: { kit: 'hex', path: 'decoration/nature/cloud_big', foot: 9 },
  cloudS: { kit: 'hex', path: 'decoration/nature/cloud_small', foot: 6 },
  lily: { kit: 'hex', path: 'decoration/nature/waterlily_A', foot: 0.9 },
  reeds: { kit: 'hex', path: 'decoration/nature/waterplant_A', foot: 0.9 },
  bridge: { kit: 'hex', path: 'buildings/neutral/building_bridge_A', foot: 3.4 },
  hab1: { kit: 'space', path: 'basemodule_A', foot: 2.6 },
  hab2: { kit: 'space', path: 'basemodule_B', foot: 2.6 },
  hab3: { kit: 'space', path: 'basemodule_C', foot: 2.6 },
  hab4: { kit: 'space', path: 'basemodule_D', foot: 2.8 },
  hab5: { kit: 'space', path: 'basemodule_E', foot: 2.8 },
  depot: { kit: 'space', path: 'cargodepot_A', foot: 3.2 },
  depot2: { kit: 'space', path: 'cargodepot_B', foot: 3.2 },
  containers: { kit: 'space', path: 'containers_A', foot: 1.8 },
  drill: { kit: 'space', path: 'drill_structure', foot: 2.6 },
  pad: { kit: 'space', path: 'landingpad_large', foot: 4.4 },
  padS: { kit: 'space', path: 'landingpad_small', foot: 3.0 },
  lander: { kit: 'space', path: 'lander_A', foot: 2.4 },
  solar: { kit: 'space', path: 'solarpanel', foot: 1.4 },
  turbine: { kit: 'space', path: 'windturbine_tall', height: 4.2 },
  mast: { kit: 'space', path: 'structure_tall', height: 3.6 },
} as const;
type ModelId = keyof typeof DIORAMA_MODELS;

function hash(n: number): number { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function noise2(x: number, z: number): number { return Math.sin(x * 0.21 + Math.sin(z * 0.17) * 1.7) * 0.5 + Math.sin(z * 0.27 + Math.sin(x * 0.13) * 1.3) * 0.5; }

const CITADEL_TILE = 8.6;
const PLOT_TILE = 5.8;

/** A procedural tiling normal map for water ripples. */
function rippleNormalMap(size = 128): THREE.DataTexture {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x / size) * Math.PI * 2, v = (y / size) * Math.PI * 2;
    h[y * size + x] = Math.sin(u * 3 + Math.sin(v * 2) * 1.5) * 0.5 + Math.sin(v * 5 + u * 2) * 0.3 + Math.sin((u + v) * 7) * 0.2;
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const hx = h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)];
    const hy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
    const n = new THREE.Vector3(-hx, -hy, 1.2).normalize();
    const i = (y * size + x) * 4;
    data[i] = (n.x * 0.5 + 0.5) * 255; data[i + 1] = (n.y * 0.5 + 0.5) * 255; data[i + 2] = (n.z * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/**
 * Merge the many small static procedural meshes (ribbons, ramps, pylons, rings) into one mesh per
 * material, cutting draw calls in every pass. Pick targets, water and anything marked
 * `userData.keep` stay separate.
 */
export function mergeStatic(group: THREE.Group): number {
  group.updateMatrixWorld(true);
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; cast: boolean; meshes: THREE.Mesh[] }>();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || m.userData.plot != null || m.userData.noAO || m.userData.keep) return;
    const mat = m.material as THREE.Material;
    if (Array.isArray(m.material) || !mat.visible || (mat as THREE.MeshBasicMaterial).transparent) return;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(m.matrixWorld);
    const key = `${mat.uuid}|${Object.keys(g.attributes).sort().join()}|${m.castShadow}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat, geos: [], cast: m.castShadow, meshes: [] }));
    b.geos.push(g); b.meshes.push(m);
  });
  let saved = 0;
  for (const b of buckets.values()) {
    if (b.geos.length < 2) { b.geos.forEach((g) => g.dispose()); continue; }
    const merged = mergeGeometries(b.geos);
    b.geos.forEach((g) => g.dispose());
    if (!merged) continue;
    for (const m of b.meshes) { m.parent?.remove(m); m.geometry.dispose(); }
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.cast; mesh.receiveShadow = true;
    group.add(mesh);
    saved += b.meshes.length - 1;
  }
  return saved;
}

export class DioramaCapitalView3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  cam = { yaw: 0.3, pitch: 0.66, dist: 128 };
  readonly pipeline: RenderPipeline;
  private slots = dioramaLayout();
  private slotByPlot = new Map<number, PlotSlot>();
  private static_ = new THREE.Group();
  private city = new THREE.Group();
  private groves = new THREE.Group();
  private detail: THREE.Object3D[] = [];
  private pickPads: THREE.Mesh[] = [];
  private kit = new Map<ModelId, THREE.Object3D>();
  private tops = new Map<number, number>();
  private labels = new Map<number, HTMLDivElement>();
  private labelData: CapitalLabel[] = [];
  private last: [Empire, CapitalLabel[], number | null] | null = null;
  private sig = '';
  private selected: number | null = null;
  private selMesh: THREE.Mesh;
  private water: THREE.MeshStandardMaterial;
  private clouds: THREE.Object3D[] = [];
  private raf = 0;
  private disposed = false;
  private frames: number[] = [];
  /** Instance counts per vegetation model (for the laboratory's statistics). */
  vegetation: Record<string, number> = {};
  private mats: Record<string, THREE.MeshStandardMaterial>;
  ready: Promise<void>;

  constructor(private canvas: HTMLCanvasElement, private overlay: HTMLDivElement, color: string, private onPick: (plot: number | null) => void, private opts: DioramaOptions) {
    for (const s of this.slots) this.slotByPlot.set(s.plot, s);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.still });
    this.camera = opts.projection === 'orthographic' ? new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1200) : new THREE.PerspectiveCamera(24, 1, 2, 1500);
    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.camera, opts.quality, { elevation: 38, azimuth: -52, intensity: 3.4 }, opts.passes);
    this.scene.fog = new THREE.Fog(0xbfd9ee, 260, 900);
    this.water = new THREE.MeshStandardMaterial({ color: 0x1b6f9c, roughness: 0.06, metalness: 0.0, normalMap: rippleNormalMap(), normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 0.75 });
    this.water.userData.envFixed = true;
    this.water.normalMap!.repeat.set(24, 24);
    this.mats = {
      grass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
      cliff: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }),
      paving: new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.66, metalness: 0.02 }),
      pavingDark: new THREE.MeshStandardMaterial({ color: 0xa9b0bb, roughness: 0.5, metalness: 0.25 }),
      road: new THREE.MeshStandardMaterial({ color: 0xa9adb3, roughness: 0.75 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x8e99ab, roughness: 0.35, metalness: 0.7 }),
      accent: new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.4, metalness: 0.3 }),
      sand: new THREE.MeshStandardMaterial({ color: 0xe6d6ab, roughness: 1 }),
      light: new THREE.MeshStandardMaterial({ color: 0xbff4ff, emissive: 0x6fe3ff, emissiveIntensity: 14, roughness: 0.3 }),
      beacon: new THREE.MeshStandardMaterial({ color: 0xffe7b0, emissive: 0xffc46a, emissiveIntensity: 22 }),
      holo: new THREE.MeshStandardMaterial({ color: 0x7fe0ff, emissive: 0x4fc8ff, emissiveIntensity: 1.2, transparent: true, opacity: 0.55 }),
      ghost: new THREE.MeshStandardMaterial({ color: 0xd9c9a0, transparent: true, opacity: 0.35 }),
    };
    this.buildTerrain();
    mergeStatic(this.static_);
    this.scene.add(this.static_, this.city, this.groves);
    this.selMesh = new THREE.Mesh(new THREE.RingGeometry(PLOT_RADIUS + 0.15, PLOT_RADIUS + 0.45, 48), new THREE.MeshBasicMaterial({ color: 0xffd36a, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }));
    this.selMesh.rotation.x = -Math.PI / 2; this.selMesh.visible = false;
    this.scene.add(this.selMesh);
    this.pipeline.fitShadow(new THREE.Box3(new THREE.Vector3(-50, -2, -50), new THREE.Vector3(50, 34, 50)));
    this.bindInput();
    this.ready = Promise.all([this.loadKit(), preload(CAPITAL_ASSETS)]).then(() => {
      if (this.disposed) return;
      this.dress();
      this.sig = '';
      if (this.last) this.sync(...this.last);
    });
    const loop = (t: number) => { if (this.disposed) return; this.frame(t); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ assets

  private async loadKit() {
    const loader = new GLTFLoader();
    await Promise.all((Object.keys(DIORAMA_MODELS) as ModelId[]).map(async (id) => {
      const m = DIORAMA_MODELS[id];
      try {
        const g = await loader.loadAsync(`${this.opts.assetBase}/${KIT_DIR[m.kit]}/${m.path}.gltf`);
        g.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true; mesh.receiveShadow = true;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (mat.map) { mat.map.colorSpace = THREE.SRGBColorSpace; mat.map.anisotropy = 4; }
          mat.roughness = Math.max(mat.roughness, 0.75); mat.metalness = Math.min(mat.metalness, 0.1);
        });
        // normalise: centred on x/z, resting on y = 0, sized by footprint or height
        g.scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(g.scene);
        const size = box.getSize(new THREE.Vector3()); const c = box.getCenter(new THREE.Vector3());
        const s = 'height' in m ? m.height / Math.max(size.y, 1e-6) : m.foot / Math.max(size.x, size.z, 1e-6);
        const wrap = new THREE.Group();
        g.scene.position.set(-c.x, -box.min.y, -c.z);
        wrap.add(g.scene); wrap.scale.setScalar(s);
        this.kit.set(id, wrap);
      } catch (e) {
        console.warn(`[diorama] ${id} failed to load: ${(e as Error).message ?? e}`);
      }
    }));
  }

  private place(id: ModelId, x: number, y: number, z: number, ry = 0, scale = 1): THREE.Object3D | null {
    const src = this.kit.get(id);
    if (!src) return null;
    const o = src.clone(true);
    o.position.set(x, y, z); o.rotation.y = ry; o.scale.multiplyScalar(scale);
    return o;
  }

  /** Instanced copies of a kit model, split into sector chunks so each chunk can be culled. */
  private instance(id: ModelId, xf: { x: number; y: number; z: number; ry: number; s: number }[], target: THREE.Group, isDetail = false) {
    const src = this.kit.get(id);
    if (!src || !xf.length) return;
    src.updateMatrixWorld(true);
    const parts: { geo: THREE.BufferGeometry; mat: THREE.Material; local: THREE.Matrix4 }[] = [];
    src.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) parts.push({ geo: m.geometry, mat: m.material as THREE.Material, local: m.matrixWorld.clone() }); });
    const chunks: (typeof xf)[] = [[], [], [], []];
    for (const t of xf) chunks[Math.floor(((Math.atan2(t.z, t.x) + Math.PI) / (Math.PI * 2)) * 4) % 4].push(t);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const list of chunks) {
      if (!list.length) continue;
      for (const p of parts) {
        const im = new THREE.InstancedMesh(p.geo, p.mat, list.length);
        list.forEach((t, i) => {
          m4.compose(new THREE.Vector3(t.x, t.y, t.z), q.setFromAxisAngle(up, t.ry), new THREE.Vector3(t.s, t.s, t.s)).multiply(p.local);
          im.setMatrixAt(i, m4);
        });
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        const tier = TIERS[this.opts.quality];
        im.castShadow = target !== this.groves || tier.vegetationShadows; im.receiveShadow = true;
        if (target === this.groves && !tier.vegetationAO) im.userData.noAO = true;
        target.add(im);
        if (isDetail) this.detail.push(im);
      }
    }
  }

  // ------------------------------------------------------------------ terrain

  private buildTerrain() {
    const N = 220;
    const grassA = new THREE.Color(0x6fb04f), grassB = new THREE.Color(0x8cc45a), grassC = new THREE.Color(0x5a9a45);
    const strata = [0xd9c4a0, 0xc7ae88, 0xb79c78, 0xe2d0ae, 0xa88d6c].map((c) => new THREE.Color(c));
    const tops: { pos: number[]; col: number[]; idx: number[] } = { pos: [], col: [], idx: [] };
    const walls: { pos: number[]; col: number[]; idx: number[] } = { pos: [], col: [], idx: [] };
    const edge = (ti: number, a: number) => (ti < 0 ? 0 : terraceEdge(TERRACES[ti], a));

    // terrace tops: polar strips between the previous edge and this edge (the outer terrace is
    // split around the canal channel, so its water shows)
    TERRACES.forEach((t, ti) => {
      const R = 5;
      const cIn = CANAL.radius - CANAL.width / 2, cOut = CANAL.radius + CANAL.width / 2;
      const bands: [(a: number) => number, (a: number) => number][] = ti === TERRACES.length - 1
        ? [[(a) => edge(ti - 1, a), () => cIn], [() => cOut, (a) => edge(ti, a)]]
        : [[(a) => edge(ti - 1, a), (a) => edge(ti, a)]];
      for (const [inner, outer] of bands) {
        const base = tops.pos.length / 3;
        for (let i = 0; i <= N; i++) {
          const a = (i / N) * Math.PI * 2;
          const r0 = inner(a), r1 = outer(a);
          for (let k = 0; k <= R; k++) {
            const r = r0 + (r1 - r0) * (k / R);
            const x = Math.cos(a) * r, z = Math.sin(a) * r;
            tops.pos.push(x, t.height, z);
            const n = noise2(x, z), c = grassA.clone().lerp(n > 0 ? grassB : grassC, Math.abs(n) * 0.6);
            tops.col.push(c.r, c.g, c.b);
          }
        }
        for (let i = 0; i < N; i++) for (let k = 0; k < R; k++) {
          const a0 = base + i * (R + 1) + k, a1 = a0 + R + 1;
          tops.idx.push(a0, a1, a0 + 1, a1, a1 + 1, a0 + 1); // counter-clockwise seen from above
        }
      }
      // cliff wall down to the next terrace (or into the sea), layered strata with ledges
      const bottom = ti < TERRACES.length - 1 ? TERRACES[ti + 1].height : SEA_LEVEL - 3;
      const V = ti < TERRACES.length - 1 ? 5 : 9;
      const wb = walls.pos.length / 3;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const r = edge(ti, a);
        for (let k = 0; k <= V; k++) {
          const f = k / V, y = t.height + (bottom - t.height) * f;
          const band = Math.floor(y * 1.4 + edgeNoise(a * 2, 9) * 1.2);
          // ledges: each stratum juts out a little more than the one above, with rough edges
          const out = (k === 0 ? 0 : 0.22 + (band % 3) * 0.12 + hash(i * 31 + k * 7) * 0.18) + (ti === TERRACES.length - 1 ? f * f * 3.2 : f * 0.35);
          const rr = r + out;
          walls.pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
          const c = strata[((band % strata.length) + strata.length) % strata.length].clone().multiplyScalar(0.92 + hash(i * 13 + k) * 0.12);
          if (ti === TERRACES.length - 1 && y < 0.6) c.lerp(new THREE.Color(0xe6d6ab), 0.6); // wet sand at the waterline
          walls.col.push(c.r, c.g, c.b);
        }
      }
      for (let i = 0; i < N; i++) for (let k = 0; k < V; k++) {
        const a0 = wb + i * (V + 1) + k, a1 = a0 + V + 1;
        walls.idx.push(a0, a1, a0 + 1, a1, a1 + 1, a0 + 1);
      }
    });
    const geo = (d: typeof tops) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
      g.setIndex(d.idx); g.computeVertexNormals();
      return g;
    };
    const topMesh = new THREE.Mesh(geo(tops), this.mats.grass); topMesh.receiveShadow = true;
    const wallMesh = new THREE.Mesh(geo(walls), this.mats.cliff); wallMesh.receiveShadow = true; wallMesh.castShadow = true;
    this.static_.add(topMesh, wallMesh);

    // the sea and a soft shoreline
    const sea = new THREE.Mesh(new THREE.CircleGeometry(1400, 64), this.water);
    sea.rotation.x = -Math.PI / 2; sea.position.y = SEA_LEVEL; sea.receiveShadow = true; sea.userData.noAO = true;
    this.static_.add(sea);
    const foamGeo = new THREE.BufferGeometry(); const fp: number[] = [], fa: number[] = [], fi: number[] = [];
    const last = TERRACES[TERRACES.length - 1];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2, r = terraceEdge(last, a) + 2.3;
      for (const [dr, al] of [[-0.6, 0.85], [1.6, 0]] as const) { fp.push(Math.cos(a) * (r + dr), SEA_LEVEL + 0.04, Math.sin(a) * (r + dr)); fa.push(1, 1, 1, al); }
    }
    for (let i = 0; i < N; i++) { const b = i * 2; fi.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    foamGeo.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    foamGeo.setAttribute('color', new THREE.Float32BufferAttribute(fa, 4));
    foamGeo.setIndex(fi);
    const foam = new THREE.Mesh(foamGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, opacity: 0.55 }));
    foam.renderOrder = 2; foam.userData.noAO = true;
    this.static_.add(foam);

    // turquoise shallows fading into the deep water
    const shGeo = new THREE.BufferGeometry(); const sp: number[] = [], sc: number[] = [], si: number[] = [];
    const shallow = new THREE.Color(0x4fc7c4);
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2, r = terraceEdge(last, a) + 1.0;
      for (const [dr, al] of [[0, 0.9], [9, 0]] as const) { sp.push(Math.cos(a) * (r + dr), SEA_LEVEL + 0.02, Math.sin(a) * (r + dr)); sc.push(shallow.r, shallow.g, shallow.b, al); }
    }
    for (let i = 0; i < N; i++) { const b = i * 2; si.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    shGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    shGeo.setAttribute('color', new THREE.Float32BufferAttribute(sc, 4));
    shGeo.setIndex(si);
    shGeo.computeVertexNormals(); // a lit material without normals renders NaN, which bloom spreads across the frame
    const shallows = new THREE.Mesh(shGeo, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.1, envMapIntensity: 0.4 }));
    shallows.userData.envFixed = true;
    shallows.renderOrder = 1; shallows.userData.noAO = true;
    this.static_.add(shallows);

    // the canal: a stone channel cut into the outer terrace, with water
    const ch = new THREE.Group();
    const cIn = CANAL.radius - CANAL.width / 2, cOut = CANAL.radius + CANAL.width / 2;
    const canalWater = new THREE.Mesh(new THREE.RingGeometry(cIn, cOut, 160), this.water);
    canalWater.rotation.x = -Math.PI / 2; canalWater.position.y = CANAL.level; canalWater.userData.noAO = true;
    ch.add(canalWater);
    for (const r of [cIn, cOut]) {
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r, TERRACES[3].height - CANAL.level + 0.3, 160, 1, true), this.mats.paving);
      (wall.material as THREE.Material).side = THREE.DoubleSide;
      wall.position.y = (TERRACES[3].height + CANAL.level) / 2 - 0.1;
      wall.receiveShadow = true;
      ch.add(wall);
      const coping = new THREE.Mesh(new THREE.RingGeometry(r - 0.18, r + 0.18, 160), this.mats.pavingDark);
      coping.rotation.x = -Math.PI / 2; coping.position.y = TERRACES[3].height + 0.035;
      ch.add(coping);
    }
    this.static_.add(ch);

    // central plaza and podium for the Citadel
    const T0 = TERRACES[0].height;
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(TERRACES[0].outer - 0.7, 96), this.mats.paving);
    plaza.rotation.x = -Math.PI / 2; plaza.position.y = T0 + 0.03; plaza.receiveShadow = true;
    this.static_.add(plaza);
    for (const [r0, r1] of [[5.0, 5.35], [7.1, 7.3]]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 96), this.mats.pavingDark);
      ring.rotation.x = -Math.PI / 2; ring.position.y = T0 + 0.05;
      this.static_.add(ring);
    }
    const podium1 = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.9, 0.55, 64), this.mats.pavingDark);
    podium1.position.y = T0 + 0.3; podium1.castShadow = podium1.receiveShadow = true;
    const podium2 = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 4.1, 0.5, 64), this.mats.paving);
    podium2.position.y = T0 + 0.8; podium2.castShadow = podium2.receiveShadow = true;
    this.static_.add(podium1, podium2);
    // light pylons ringing the plaza (the only emissive accents that bloom)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
      const g = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 1.6, 8), this.mats.trim); post.position.y = 0.8;
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), this.mats.light); lamp.position.y = 1.68;
      post.castShadow = true; g.add(post, lamp);
      g.position.set(Math.cos(a) * 6.3, T0, Math.sin(a) * 6.3);
      this.static_.add(g);
    }

    // avenues: paved ribbons on each terrace, ramps down each cliff, bridges over the canal
    for (const av of AVENUES) {
      const dir = new THREE.Vector3(Math.cos(av), 0, Math.sin(av));
      TERRACES.forEach((t, ti) => {
        if (ti === 0) return;
        const r0 = terraceEdge(TERRACES[ti - 1], av) + 1.7, r1 = ti === 3 ? 35.1 : terraceEdge(t, av) - 1.2;
        this.addRibbon(dir, r0, r1, t.height + 0.04, 2.4, this.mats.road);
        // kerbs
        for (const s of [-1, 1]) this.addRibbon(dir, r0, r1, t.height + 0.06, 0.18, this.mats.pavingDark, s * 1.3);
      });
      // ramps between terraces
      for (let ti = 0; ti < TERRACES.length - 1; ti++) {
        const e = terraceEdge(TERRACES[ti], av);
        const a = dir.clone().multiplyScalar(e - (ti === 0 ? 0.9 : 1.2)).setY(TERRACES[ti].height + 0.04);
        const b = dir.clone().multiplyScalar(e + 1.7).setY(TERRACES[ti + 1].height + 0.04);
        this.addRamp(a, b, 2.4);
      }
    }
    // ring promenades
    for (const [r, h] of [[20.2, TERRACES[2].height], [9.5, TERRACES[1].height], [35.1, TERRACES[3].height]] as const) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.55, r + 0.55, 160), this.mats.road);
      ring.rotation.x = -Math.PI / 2; ring.position.y = h + 0.035; ring.receiveShadow = true;
      this.static_.add(ring);
    }
    // the memorial plaza in the spare upper-terrace place: a round reflecting pool
    const ma = memorialAngle(), mr = 13.6;
    const mx = Math.cos(ma) * mr, mz = Math.sin(ma) * mr, mh = TERRACES[1].height;
    const mem = new THREE.Mesh(new THREE.CircleGeometry(3.0, 64), this.mats.paving); mem.rotation.x = -Math.PI / 2; mem.position.set(mx, mh + 0.04, mz); mem.receiveShadow = true;
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), this.water); pool.rotation.x = -Math.PI / 2; pool.position.set(mx, mh + 0.09, mz);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.65, 0.1, 8, 48), this.mats.trim); rim.rotation.x = Math.PI / 2; rim.position.set(mx, mh + 0.1, mz);
    this.static_.add(mem, pool, rim);

    // plot pads and pick targets
    for (const s of this.slots) {
      if (s.plot === CITADEL_PLOT) {
        const pickC = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 1.2, 24), new THREE.MeshBasicMaterial({ visible: false }));
        pickC.position.set(0, TERRACES[0].height + 0.6, 0); pickC.userData.plot = s.plot;
        this.pickPads.push(pickC); this.static_.add(pickC);
        continue;
      }
      const pick = new THREE.Mesh(new THREE.CylinderGeometry(PLOT_RADIUS, PLOT_RADIUS, 0.6, 24), new THREE.MeshBasicMaterial({ visible: false }));
      pick.position.set(s.x, s.y + 0.3, s.z); pick.userData.plot = s.plot;
      this.pickPads.push(pick); this.static_.add(pick);
    }
  }

  private addRibbon(dir: THREE.Vector3, r0: number, r1: number, y: number, width: number, mat: THREE.Material, offset = 0) {
    if (r1 <= r0) return;
    const len = r1 - r0;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, len), mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.atan2(dir.x, dir.z) + Math.PI;
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(offset);
    m.position.copy(dir).multiplyScalar((r0 + r1) / 2).add(side).setY(y);
    m.receiveShadow = true;
    this.static_.add(m);
  }

  private addRamp(a: THREE.Vector3, b: THREE.Vector3, width: number) {
    const d = b.clone().sub(a); const len = d.length();
    const g = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(width, 0.25, len), this.mats.road);
    deck.castShadow = deck.receiveShadow = true;
    g.add(deck);
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, len), this.mats.pavingDark);
      wall.position.set(s * (width / 2 + 0.11), 0.2, 0); wall.castShadow = true;
      g.add(wall);
    }
    // support under the ramp, down to the lower terrace
    const pier = new THREE.Mesh(new THREE.BoxGeometry(width * 0.9, Math.abs(d.y), len * 0.55), this.mats.paving);
    pier.position.set(0, -Math.abs(d.y) / 2, len * 0.18); pier.castShadow = pier.receiveShadow = true;
    g.add(pier);
    g.position.copy(a).add(b).multiplyScalar(0.5);
    g.lookAt(b);
    this.static_.add(g);
  }

  /** Vegetation, rocks, islands, clouds, bridges and district dressing (after the kit loads). */
  private dress() {
    const dens = TIERS[this.opts.quality].density;
    const deco = new THREE.Group();
    // bridges over the canal on every avenue
    for (const av of AVENUES) {
      const b = this.place('bridge', Math.cos(av) * CANAL.radius, CANAL.level - 0.25, Math.sin(av) * CANAL.radius, -av + Math.PI / 2, 1);
      if (b) deco.add(b);
    }
    // district dressing in the free gaps between plots (at 0°, 90°, 180°, 270° on each ring)
    const dressAt = (angle: number, r: number, terrace: number) => {
      const y = TERRACES[terrace].height, x = Math.cos(angle) * r, z = Math.sin(angle) * r, face = -angle + Math.PI / 2;
      const d = districtAt(angle + 0.01, terrace);
      const put = (id: ModelId, dx: number, dz: number, ry = 0, s = 1) => {
        const o = this.place(id, x + dx, y + 0.02, z + dz, face + ry, s);
        if (o) deco.add(o);
      };
      const tx = -Math.sin(angle), tz = Math.cos(angle); // tangent
      if (d === 'residential') { put('hab1', tx * 1.5, tz * 1.5); put('hab3', -tx * 1.5, -tz * 1.5, Math.PI); put('solar', Math.cos(angle) * 1.8, Math.sin(angle) * 1.8); }
      else if (d === 'industry') { put('depot', 0, 0); put('containers', tx * 2.4, tz * 2.4); put('drill', -tx * 2.4, -tz * 2.4); }
      else if (d === 'military') { put('padS', 0, 0); put('lander', 0, 0, 0.6, 0.8); }
      else if (d === 'research') { put('turbine', tx * 1.6, tz * 1.6); put('solar', -tx * 1.2, -tz * 1.2); put('solar', -tx * 2.6, -tz * 2.6); }
      else { put('mast', 0, 0); }
    };
    for (const [r, terrace] of [[24.6, 2], [38.2, 3]] as const) for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) dressAt(a, r, terrace);
    this.static_.add(deco);

    // rocky islets with hills and mountains in the back half of the bay
    const islets = new THREE.Group();
    const isle: [ModelId, number, number, number][] = [['mountainA', -2.05, 118, 1.6], ['mountainB', -1.5, 128, 1.4], ['mountainA', -0.95, 122, 1.8], ['mountainB', -2.6, 104, 1.2], ['mountainA', -0.35, 112, 1.3]];
    isle.forEach(([id, a, r, s], i) => { const o = this.place(id, Math.cos(a) * r, SEA_LEVEL - 2.6 * s, Math.sin(a) * r, hash(i) * 6, s); if (o) islets.add(o); }); // hex bases sink below the waterline
    this.static_.add(islets);
    // clouds drifting low at the edges of the view
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI * 0.85 + (i / 8) * Math.PI * 1.7, r = 110 + hash(i + 3) * 60;
      const c = this.place(i % 3 ? 'cloud' : 'cloudS', Math.cos(a) * r, 26 + hash(i) * 14, Math.sin(a) * r - 20, hash(i + 7) * 6, 1 + hash(i + 1));
      if (c) { c.traverse((o) => { o.castShadow = false; }); this.clouds.push(c); this.static_.add(c); }
    }
    this.rebuildVegetation(dens);
  }

  /** Scatter groves and trees over open grass; locked plots become woodland. */
  private rebuildVegetation(dens: number, locked: Set<number> = new Set()) {
    for (const o of [...this.groves.children]) { this.groves.remove(o); (o as THREE.InstancedMesh).dispose?.(); }
    this.detail = [];
    const groves: Record<string, { x: number; y: number; z: number; ry: number; s: number }[]> = { groveA: [], groveA2: [], groveB: [], groveB2: [], treeA: [], treeB: [], rockA: [], rockC: [], rockE: [], lily: [], reeds: [] };
    const roadClear = (x: number, z: number) => AVENUES.every((av) => { const along = x * Math.cos(av) + z * Math.sin(av); const across = Math.abs(-x * Math.sin(av) + z * Math.cos(av)); return along < 0 || across > 2.2; });
    const step = 1.55 / Math.sqrt(dens);
    let n = 0;
    for (let gx = -46; gx <= 46; gx += step) for (let gz = -46; gz <= 46; gz += step) {
      n++;
      const x = gx + (hash(n) - 0.5) * step * 0.9, z = gz + (hash(n + 77) - 0.5) * step * 0.9;
      const h = groundHeight(x, z); if (h == null) continue;
      const r = Math.hypot(x, z), a = Math.atan2(z, x);
      const ti = TERRACES.findIndex((t) => t.height === h);
      if (ti === 0) continue; // the plaza is paved
      if (r > terraceEdge(TERRACES[ti], a) - 0.9 || r < terraceEdge(TERRACES[ti - 1], a) + 0.9) {
        // cliff lips: occasional rocks (detail layer)
        if (hash(n * 3) < 0.18 * dens) groves[['rockA', 'rockC', 'rockE'][n % 3]].push({ x, y: h, z, ry: hash(n) * 6, s: 0.8 + hash(n + 1) * 0.6 });
        continue;
      }
      if (!roadClear(x, z)) continue;
      if (Math.abs(r - CANAL.radius) < CANAL.width / 2 + 0.7) continue;
      if ([9.5, 20.2, 35.1].some((rr) => Math.abs(r - rr) < 0.9)) continue;
      // plot pads: open plots stay clear, locked plots fill with woodland
      let inPlot = -1;
      for (const s of this.slots) if (s.plot !== CITADEL_PLOT && Math.hypot(x - s.x, z - s.z) < PLOT_RADIUS + 0.4) { inPlot = s.plot; break; }
      const ma = memorialAngle();
      if (Math.hypot(x - Math.cos(ma) * 13.6, z - Math.sin(ma) * 13.6) < 3.4) continue;
      if ([0, Math.PI / 2, Math.PI, Math.PI * 1.5].some((da) => [24.6, 38.2].some((dr) => Math.hypot(x - Math.cos(da) * dr, z - Math.sin(da) * dr) < 3.6))) continue;
      const wood = inPlot >= 0 && locked.has(inPlot);
      if (inPlot >= 0 && !wood) continue;
      const cluster = noise2(x * 1.7, z * 1.7) * 0.5 + 0.5;
      if (!wood && cluster < 0.42) continue;
      const k = hash(n * 5);
      const kind = wood ? (k < 0.5 ? 'groveA' : 'groveB') : cluster > 0.75 ? (k < 0.5 ? 'groveA' : 'groveB') : cluster > 0.6 ? (k < 0.5 ? 'groveA2' : 'groveB2') : k < 0.5 ? 'treeA' : 'treeB';
      const light = TIERS[this.opts.quality].lightVegetation;
      const use = light ? ({ groveB: 'groveA2', groveB2: 'groveA2', groveA: 'groveA2', treeB: 'treeA' } as Record<string, string>)[kind] ?? kind : kind;
      groves[use].push({ x, y: h, z, ry: hash(n + 9) * Math.PI * 2, s: 0.85 + hash(n + 4) * 0.35 });
    }
    // canal planting
    for (let i = 0; i < 60 * dens; i++) {
      const a = hash(i * 11) * Math.PI * 2;
      if (AVENUES.some((av) => Math.abs(Math.sin((a - av) / 2)) < 0.06)) continue;
      const r = CANAL.radius + (hash(i * 7) - 0.5) * CANAL.width * 0.7;
      groves[i % 3 ? 'lily' : 'reeds'].push({ x: Math.cos(a) * r, y: CANAL.level + 0.01, z: Math.sin(a) * r, ry: hash(i) * 6, s: 0.8 + hash(i + 2) * 0.4 });
    }
    this.vegetation = Object.fromEntries(Object.entries(groves).map(([k, v]) => [k, v.length]));
    for (const [id, list] of Object.entries(groves)) this.instance(id as ModelId, list, this.groves, id.startsWith('rock') || id === 'lily' || id === 'reeds');
  }

  // ------------------------------------------------------------------ city

  sync(e: Empire, labels: CapitalLabel[], sel: number | null) {
    this.last = [e, labels, sel];
    this.labelData = labels;
    const cap = e.capital;
    if (!cap || !this.kit.size) return;
    const open = new Set(openPlots(e));
    const sig = JSON.stringify(cap.buildings) + cap.queue.map((j) => j.building + j.toLevel).join() + [...open].join();
    if (sig !== this.sig) {
      const openChanged = !this.sig.endsWith([...open].join());
      this.sig = sig;
      for (const o of [...this.city.children]) { this.city.remove(o); disposeObject(o, this.sharedResources()); }
      this.tops.clear();
      const pads = new THREE.Group(); // merged into a few meshes after the loop
      for (const s of this.slots) {
        const id = plotOccupant(cap, s.plot);
        const isCitadel = s.plot === CITADEL_PLOT;
        if (!open.has(s.plot)) continue;
        if (!isCitadel) {
          // a round paved pad with a metal rim; an empty plot shows a faint holographic ring
          const pad = new THREE.Mesh(new THREE.CylinderGeometry(PLOT_RADIUS, PLOT_RADIUS + 0.1, 0.18, 48), this.mats.paving);
          pad.position.set(s.x, s.y + 0.09, s.z); pad.receiveShadow = true; // picking uses the pick pads
          const rim = new THREE.Mesh(new THREE.TorusGeometry(PLOT_RADIUS + 0.02, 0.06, 6, 48), this.mats.trim);
          rim.rotation.x = Math.PI / 2; rim.position.set(s.x, s.y + 0.19, s.z);
          pads.add(pad, rim);
          if (!id) {
            const holo = new THREE.Mesh(new THREE.RingGeometry(PLOT_RADIUS * 0.55, PLOT_RADIUS * 0.62, 48), this.mats.holo);
            holo.rotation.x = -Math.PI / 2; holo.position.set(s.x, s.y + 0.21, s.z); holo.userData.plot = s.plot;
            this.city.add(holo);
            continue;
          }
        }
        if (!id) continue;
        const def = CAPITAL_BY_ID[id];
        const lvl = cap.buildings[id]?.level ?? 0;
        const model = buildCapitalPart(def.id, lvl || 1, isCitadel ? CITADEL_TILE : PLOT_TILE);
        if (!model) continue; // the catalogue reports missing models through the asset notice
        const baseY = isCitadel ? TERRACES[0].height + 1.05 : s.y + 0.18;
        model.position.set(s.x, baseY, s.z);
        model.rotation.y = -s.angle - Math.PI / 2; // face the avenue towards the centre
        model.traverse((o) => { o.userData.plot = s.plot; });
        if (!lvl) model.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = this.mats.ghost; });
        this.city.add(model);
        if (isCitadel) {
          const top = new THREE.Box3().setFromObject(model).max.y;
          const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 10), this.mats.beacon);
          beacon.position.set(0, top + 0.5, 0); beacon.userData.plot = s.plot;
          this.city.add(beacon);
        }
        const box = new THREE.Box3().setFromObject(model);
        this.tops.set(s.plot, box.max.y);
        const job = cap.queue.find((j) => j.building === id);
        if (job) {
          const size = box.getSize(new THREE.Vector3());
          const sc = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x * 1.1, size.y * 1.05, size.z * 1.1, 2, 3, 2)), new THREE.LineBasicMaterial({ color: 0xd9b45a }));
          sc.position.set(s.x, baseY + size.y * 0.525, s.z); sc.userData.plot = s.plot;
          this.city.add(sc);
        }
      }
      mergeStatic(pads);
      this.city.add(pads);
      if (openChanged) {
        const locked = new Set(this.slots.map((s) => s.plot).filter((p) => !open.has(p)));
        this.rebuildVegetation(TIERS[this.opts.quality].density, locked);
      }
    }
    this.pipeline.setEnvironmentIntensity(this.scene, 0.5);
    this.selected = sel;
    const ss = sel != null ? this.slotByPlot.get(sel) : null;
    if (ss) { this.selMesh.position.set(ss.x, ss.y + 0.25, ss.z); this.selMesh.scale.setScalar(ss.plot === CITADEL_PLOT ? 1.4 : 1); this.selMesh.visible = true; } else this.selMesh.visible = false;
  }

  /** Resources that must survive a city rebuild: the shared model cache and this view's materials. */
  private sharedResources(): Set<unknown> {
    return new Set<unknown>([...sharedAssetResources(), ...Object.values(this.mats)]);
  }

  // ------------------------------------------------------------------ input, camera, frame

  private bindInput() {
    let down: { x: number; y: number; yaw: number; pitch: number } | null = null;
    let moved = false;
    this.canvas.addEventListener('pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY, yaw: this.cam.yaw, pitch: this.cam.pitch }; moved = false; this.canvas.setPointerCapture(ev.pointerId); });
    this.canvas.addEventListener('pointermove', (ev) => {
      if (!down) return;
      const dx = ev.clientX - down.x, dy = ev.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      this.cam.yaw = down.yaw - dx * 0.006;
      this.cam.pitch = Math.max(0.42, Math.min(1.3, down.pitch + dy * 0.004));
    });
    this.canvas.addEventListener('pointerup', (ev) => { if (down && !moved) this.onPick(this.pick(ev.clientX, ev.clientY)); down = null; });
    this.canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); this.cam.dist = Math.max(45, Math.min(260, this.cam.dist * (ev.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
  }

  pick(cx: number, cy: number): number | null {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(v, this.camera);
    const hit = ray.intersectObjects([...this.city.children, ...this.pickPads], true).find((h) => h.object.userData.plot != null);
    return hit ? hit.object.userData.plot : null;
  }

  plotScreen(plot: number, lift = 0): { x: number; y: number; visible: boolean } {
    const s = this.slotByPlot.get(plot)!;
    const p = new THREE.Vector3(s.x, lift || s.y, s.z).project(this.camera);
    return { x: ((p.x + 1) / 2) * this.canvas.clientWidth, y: ((1 - p.y) / 2) * this.canvas.clientHeight, visible: p.z < 1 };
  }

  private placeCamera(w: number, h: number) {
    const { yaw, pitch, dist } = this.cam;
    const target = new THREE.Vector3(0, 7.5, 3);
    const pos = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(target);
    this.camera.position.copy(pos);
    if (this.camera instanceof THREE.OrthographicCamera) {
      // frame the island; narrow screens get a taller frustum so the island still fits across
      const halfW = Math.max(dist * 0.36, (dist * 0.36 * w) / h);
      const half = Math.max(dist * 0.28, (halfW * h) / w);
      Object.assign(this.camera, { left: (-half * w) / h, right: (half * w) / h, top: half, bottom: -half });
    } else {
      this.camera.aspect = w / h;
      // keep the island's width in frame on portrait screens
      this.camera.fov = w / h < 0.8 ? 24 * Math.min(1.9, 0.8 / (w / h)) : 24;
    }
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
  }

  private frame(t: number) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.pipeline.setSize(w, h);
    this.placeCamera(w, h);
    const time = this.opts.still ? 0 : t / 1000;
    if (this.water.normalMap) this.water.normalMap.offset.set(time * 0.004, time * 0.0025);
    for (const c of this.clouds) {
      if (c.userData.x0 === undefined) c.userData.x0 = c.position.x;
      c.position.x = (c.userData.x0 as number) + Math.sin(time * 0.02 + c.position.z) * 6;
    }
    const dist = this.camera.position.length();
    const show = dist < TIERS[this.opts.quality].detailDistance;
    for (const d of this.detail) d.visible = show;
    this.pipeline.render();
    const now = performance.now();
    this.frames.push(now); while (this.frames.length && now - this.frames[0] > 2000) this.frames.shift();
    this.updateLabels();
  }

  /** Frames per second over the last two seconds, and GPU counters. */
  stats() {
    const f = this.frames;
    const fps = f.length > 1 ? ((f.length - 1) * 1000) / (f[f.length - 1] - f[0]) : 0;
    return { fps, tier: this.opts.quality, ...this.pipeline.info(), vegetation: this.vegetation };
  }

  private updateLabels() {
    const seen = new Set<number>();
    for (const l of this.labelData) {
      seen.add(l.plot);
      let el = this.labels.get(l.plot);
      if (!el) {
        el = document.createElement('div');
        el.className = 'cap-tag'; el.title = l.name; el.dataset.plot = String(l.plot);
        el.addEventListener('click', () => this.onPick(l.plot));
        this.overlay.appendChild(el); this.labels.set(l.plot, el);
      }
      const brief = this.cam.dist > 120 && l.plot !== this.selected && !l.building;
      const html = `<span class="lv">${l.level || '–'}</span>${brief ? '' : `<span class="nm">${l.name}</span>`}${l.building ? `<div class="bar"><i style="width:${Math.round(l.progress * 100)}%"></i></div><div class="tm">${l.days} days</div>` : ''}`;
      if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
      const s = this.plotScreen(l.plot, (this.tops.get(l.plot) ?? (this.slotByPlot.get(l.plot)!.y + 3)) + 0.8);
      el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      el.style.display = s.visible ? '' : 'none';
    }
    for (const [p, el] of this.labels) if (!seen.has(p)) { el.remove(); this.labels.delete(p); }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const el of this.labels.values()) el.remove();
    for (const src of this.kit.values()) disposeObject(src);
    this.pipeline.dispose();
    disposeObject(this.scene, sharedAssetResources());
    this.scene.clear();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
  }
}
