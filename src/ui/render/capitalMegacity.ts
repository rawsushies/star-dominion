// Capital megacity (capital laboratory, variant D). A monumental imperial city assembled from the
// megacity kit (public/assets/models/megacity/kit.glb, built by scripts/blender/assemble_megacity.py
// from CC0 parts): steel arcologies with structural frameworks, spires and truss towers, industrial
// works and power plants, an elevated highway grid on pillars, sky-bridges between towers, a
// perimeter wall with gates, and the Imperial Citadel at the centre, which grows through four
// stages with its level. Plots, levels, construction and selection keep the production behaviour:
// the same 24 plot ids, a model per building and level tier, scaffolding over work in progress and
// a ghost for a building whose first level is still being raised. Same interface as the other
// capital views (sync, pick, plotScreen, stats, dispose).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CAPITAL_BY_ID, CITADEL_PLOT } from '../../sim/data/capital';
import { capLevel, openPlots, plotOccupant } from '../../sim/capital';
import type { Empire } from '../../sim/types';
import type { CapitalLabel } from './capital3d';
import { disposeObject } from './assets/resources';
import { RenderPipeline, type QualityTier, type PassToggles } from './pipeline';
import { megacityLayout, CELL, PLOT, type DistrictBlock, type MegaSlot } from './megacityLayout';

export type KitModel =
  | 'citadel_t1' | 'citadel_t2' | 'citadel_t3' | 'citadel_t4' | 'arco_a' | 'arco_b' | 'arco_c' | 'spire_a' | 'spire_b' | 'truss_a'
  | 'res_a' | 'res_b' | 'res_c' | 'hall_a' | 'hall_b' | 'vault' | 'works_a' | 'refinery_a' | 'power_a' | 'yard_a' | 'bastion_a'
  | 'hwy_straight' | 'hwy_cross' | 'hwy_t' | 'skybridge' | 'lamp' | 'wall' | 'gate';

/** Capital building -> kit model by level tier (the last tier whose `from` the level reaches). */
export const MEGA_TIERS: Record<string, [number, KitModel][]> = {
  citadel: [[1, 'citadel_t1'], [6, 'citadel_t2'], [12, 'citadel_t3'], [20, 'citadel_t4']],
  throne_hall: [[1, 'hall_b'], [10, 'spire_a']],
  treasury: [[1, 'vault'], [8, 'res_c']],
  hall_of_heroes: [[1, 'hall_a'], [6, 'res_b']],
  research_institute: [[1, 'res_b'], [8, 'truss_a'], [16, 'arco_a']],
  imperial_shipyards: [[1, 'yard_a']],
  refinery_complex: [[1, 'works_a'], [8, 'refinery_a']],
  diplomatic_quarter: [[1, 'res_a'], [8, 'spire_a']],
  military_academy: [[1, 'bastion_a'], [10, 'res_c']],
  intelligence_bureau: [[1, 'spire_a'], [6, 'spire_b']],
  grand_market: [[1, 'hall_a'], [8, 'res_c']],
  bastion: [[1, 'bastion_a']],
  arcology: [[1, 'arco_a'], [8, 'arco_b'], [15, 'arco_c']],
  stellar_observatory: [[1, 'truss_a']],
  stellar_forge: [[1, 'power_a'], [8, 'refinery_a']],
  monument_of_ages: [[1, 'spire_b']],
};

export function megaModelFor(id: string, level: number): { model: KitModel; from: number } | null {
  const tiers = MEGA_TIERS[id];
  if (!tiers) return null;
  let t = tiers[0];
  for (const x of tiers) if (level >= x[0]) t = x;
  return { model: t[1], from: t[0] };
}

const DISTRICT_MODELS: Record<DistrictBlock['kind'], KitModel[]> = {
  residential: ['res_a', 'res_b', 'res_c', 'arco_a', 'arco_b', 'res_b'],
  industrial: ['works_a', 'refinery_a', 'power_a', 'works_a'],
  energy: ['power_a', 'truss_a', 'power_a', 'spire_a'],
  civic: ['hall_b', 'spire_b', 'hall_a', 'arco_a'],
};

/** Kit units to scene units (the kit's plot is 10 x 10, the same as the layout's). */
const KIT = 1;
const HIGHWAY_SCALE = 0.6;
const PICK_Y = 0.15;

export interface MegacityOptions { quality: QualityTier; still?: boolean; passes?: PassToggles; kitUrl?: string }

function hash(n: number): number { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

/** Merge static meshes by material, keeping UVs (the kit is textured). */
function mergeByMaterial(group: THREE.Group) {
  group.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || m.userData.keep) return;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    // quantised kit attributes are normalised integers; merge in float
    for (const k of Object.keys(g.attributes)) {
      const a = g.attributes[k] as THREE.BufferAttribute;
      if (!(a.array instanceof Float32Array)) {
        const f = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
        g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
      }
    }
    g.applyMatrix4(m.matrixWorld);
    let b = buckets.get(m.material);
    if (!b) buckets.set(m.material, (b = { geos: [], meshes: [] }));
    b.geos.push(g); b.meshes.push(m);
  });
  const out: THREE.Mesh[] = [];
  for (const [mat, b] of buckets) {
    const merged = mergeGeometries(b.geos);
    b.geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    out.push(mesh);
  }
  group.clear();
  for (const m of out) group.add(m);
}

export class MegacityCapitalView3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(26, 1, 2, 2400);
  cam = { yaw: 0.32, pitch: 0.62, dist: 230 };
  readonly pipeline: RenderPipeline;
  readonly layout = megacityLayout();
  private slotByPlot = new Map<number, MegaSlot>();
  private kit = new Map<KitModel, THREE.Object3D>();
  private ground = new THREE.Group();
  private infra = new THREE.Group();
  private districts = new THREE.Group();
  private city = new THREE.Group();
  private pickPads: THREE.Mesh[] = [];
  private tops = new Map<number, number>();
  private labels = new Map<number, HTMLDivElement>();
  private labelData: CapitalLabel[] = [];
  private last: [Empire, CapitalLabel[], number | null] | null = null;
  private sig = '';
  private districtLevel = -1;
  private selected: number | null = null;
  private selMesh: THREE.Mesh;
  private mats: Record<string, THREE.Material>;
  private traffic: THREE.InstancedMesh | null = null;
  private raf = 0;
  private disposed = false;
  private frames: number[] = [];
  ready: Promise<void>;

  constructor(private canvas: HTMLCanvasElement, private overlay: HTMLDivElement, color: string, private onPick: (plot: number | null) => void, private opts: MegacityOptions) {
    for (const s of this.layout.slots) this.slotByPlot.set(s.plot, s);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.still });
    // late-afternoon sun, low and warm, so the towers throw long shadows across the city
    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.camera, opts.quality, { elevation: 24, azimuth: -58, intensity: 3.1 }, opts.passes);
    this.scene.fog = new THREE.Fog(0x9fb4c9, 420, 1500);
    this.mats = {
      deck: new THREE.MeshStandardMaterial({ color: 0x2a2f37, roughness: 0.82, metalness: 0.25 }),
      avenue: new THREE.MeshStandardMaterial({ color: 0x1c2027, roughness: 0.9 }),
      plaza: new THREE.MeshStandardMaterial({ color: 0x3b414b, roughness: 0.7, metalness: 0.35 }),
      lot: new THREE.MeshStandardMaterial({ color: 0x323843, roughness: 0.75, metalness: 0.3 }),
      sealed: new THREE.MeshStandardMaterial({ color: 0x242830, roughness: 0.9 }),
      trim: new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xd9b45a), 0.5), roughness: 0.35, metalness: 0.75 }),
      holo: new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffb43a, emissiveIntensity: 1.6, transparent: true, opacity: 0.6 }),
      ghost: new THREE.MeshStandardMaterial({ color: 0xd9c9a0, transparent: true, opacity: 0.32, depthWrite: false }),
      beacon: new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffb24a, emissiveIntensity: 18 }),
      lights: new THREE.MeshStandardMaterial({ color: 0xfff1cf, emissive: 0xffd28a, emissiveIntensity: 9 }),
      pick: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    };
    this.buildGround();
    this.scene.add(this.ground, this.infra, this.districts, this.city);
    this.selMesh = new THREE.Mesh(new THREE.RingGeometry(PLOT * 0.66, PLOT * 0.74, 4, 1), new THREE.MeshBasicMaterial({ color: 0xffd36a, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }));
    this.selMesh.rotation.x = -Math.PI / 2; this.selMesh.rotation.z = Math.PI / 4; this.selMesh.visible = false;
    this.scene.add(this.selMesh);
    this.pipeline.fitShadow(new THREE.Box3(new THREE.Vector3(-80, -2, -80), new THREE.Vector3(80, 90, 80)));
    this.bindInput();
    this.ready = this.loadKit().then(() => {
      if (this.disposed) return;
      this.buildInfrastructure();
      this.sig = ''; this.districtLevel = -1;
      if (this.last) this.sync(...this.last);
    });
    const loop = (t: number) => { if (this.disposed) return; this.frame(t); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ assets

  private async loadKit() {
    const url = this.opts.kitUrl ?? `${import.meta.env.BASE_URL ?? '/'}assets/models/megacity/kit.glb`;
    try {
      const g = await new GLTFLoader().loadAsync(url);
      for (const child of [...g.scene.children]) {
        child.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = true; m.receiveShadow = true;
          const mat = m.material as THREE.MeshStandardMaterial;
          if (mat.map) mat.map.anisotropy = 4;
          // the packs' metals read best slightly rough under the HDR sky
          mat.roughness = Math.max(mat.roughness, 0.42); mat.metalness = Math.min(mat.metalness, 0.7);
        });
        child.position.set(0, 0, 0);
        this.kit.set(child.name as KitModel, child);
      }
    } catch (e) {
      console.warn(`[megacity] kit failed to load: ${(e as Error).message ?? e}`);
    }
  }

  private place(model: KitModel, x: number, z: number, opts: { scale?: number; ry?: number; y?: number } = {}): THREE.Object3D | null {
    const src = this.kit.get(model);
    if (!src) return null;
    const o = src.clone(true);
    o.position.set(x, opts.y ?? 0, z);
    o.rotation.y = opts.ry ?? 0;
    o.scale.setScalar((opts.scale ?? 1) * KIT);
    return o;
  }

  // ------------------------------------------------------------------ world

  private buildGround() {
    const g = this.ground;
    const half = 4 * CELL + 10;
    // the city deck, avenues and the ground beyond the walls
    const deck = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 1, half * 2), this.mats.avenue);
    deck.position.y = -0.5; deck.receiveShadow = true; g.add(deck);
    const plain = new THREE.Mesh(new THREE.CircleGeometry(1400, 64), new THREE.MeshStandardMaterial({ color: 0x4d5a52, roughness: 1 }));
    plain.rotation.x = -Math.PI / 2; plain.position.y = -1.2; plain.receiveShadow = true; g.add(plain);
    // the Citadel plaza: the central 2 x 2 block
    const plaza = new THREE.Mesh(new THREE.BoxGeometry(2 * CELL - 4, 0.3, 2 * CELL - 4), this.mats.plaza);
    plaza.position.y = 0.15; plaza.receiveShadow = true; g.add(plaza);
    // a pick target and a paved lot for every plot (lots are re-coloured as plots open)
    for (const s of this.layout.slots) {
      const size = s.plot === CITADEL_PLOT ? 2 * CELL - 4 : PLOT;
      const pad = new THREE.Mesh(new THREE.BoxGeometry(size, 0.2, size), this.mats.pick);
      pad.position.set(s.x, PICK_Y, s.z); pad.userData.plot = s.plot;
      this.pickPads.push(pad); this.scene.add(pad);
    }
  }

  /** Highways, lamps, the perimeter wall and gates: the city's fixed skeleton. */
  private buildInfrastructure() {
    const g = new THREE.Group();
    const seen = new Set<string>();
    for (const h of this.layout.highways) {
      const key = `${Math.round(h.x)},${Math.round(h.z)}`;
      const cross = seen.has(key) || (Math.abs(Math.abs(h.x) - CELL) < 3.5 && Math.abs(Math.abs(h.z) - CELL) < 3.5) || (Math.abs(Math.abs(h.x) - 3 * CELL) < 3.5 && Math.abs(Math.abs(h.z) - 3 * CELL) < 3.5);
      seen.add(key);
      const o = this.place(cross ? 'hwy_cross' : 'hwy_straight', h.x, h.z, { scale: HIGHWAY_SCALE, ry: h.dir === 'x' ? 0 : Math.PI / 2 });
      if (o) g.add(o);
    }
    // street lamps along the inner avenues
    for (let t = -3 * CELL; t <= 3 * CELL; t += CELL) for (const s of [-2 * CELL, 2 * CELL]) {
      for (const [x, z] of [[t, s], [s, t]]) { const l = this.place('lamp', x + 2.6, z + 2.6, { scale: 0.8 }); if (l) g.add(l); }
    }
    // perimeter wall with a gate on each axis
    const R = 4 * CELL + 6;
    for (let t = -R + 5; t < R; t += 10) {
      for (const side of [0, 1, 2, 3]) {
        const gate = Math.abs(t) < 6;
        const [x, z, ry] = side === 0 ? [t, -R, 0] : side === 1 ? [t, R, Math.PI] : side === 2 ? [-R, t, Math.PI / 2] : [R, t, -Math.PI / 2];
        const o = this.place(gate ? 'gate' : 'wall', x, z, { ry, scale: gate ? 1.1 : 1 });
        if (o) g.add(o);
      }
    }
    mergeByMaterial(g);
    this.infra.add(g);
    // traffic: small light points gliding along the highway decks
    const n = this.opts.quality === 'mobile' ? 60 : 160;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.35, 0.45), this.mats.lights, n);
    im.userData.keep = true;
    this.traffic = im;
    this.scene.add(im);
  }

  /** Districts of the wider city appear as the Citadel rises (each block has a Citadel level). */
  private buildDistricts(citadel: number) {
    for (const o of [...this.districts.children]) { this.districts.remove(o); disposeObject(o, this.shared()); }
    const g = new THREE.Group();
    for (const d of this.layout.districts) {
      if (citadel < d.from) {
        // an unbuilt block: a fenced lot
        const lot = new THREE.Mesh(new THREE.BoxGeometry(PLOT, 0.25, PLOT), this.mats.sealed);
        lot.position.set(d.x, 0.12, d.z); lot.receiveShadow = true; g.add(lot);
        continue;
      }
      const pool = DISTRICT_MODELS[d.kind];
      const k = Math.floor(hash(d.seed) * pool.length) % pool.length;
      const scale = d.ring === 3 ? 0.9 + hash(d.seed + 3) * 0.25 : 1;
      const o = this.place(pool[k], d.x, d.z, { scale, ry: Math.floor(hash(d.seed + 1) * 4) * Math.PI / 2 });
      if (o) g.add(o);
      const lot = new THREE.Mesh(new THREE.BoxGeometry(PLOT + 1, 0.25, PLOT + 1), this.mats.lot);
      lot.position.set(d.x, 0.12, d.z); g.add(lot);
    }
    mergeByMaterial(g);
    this.districts.add(g);
  }

  private shared(): Set<unknown> {
    const s = new Set<unknown>(Object.values(this.mats));
    for (const src of this.kit.values()) src.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { s.add(m.geometry); s.add(m.material); const mat = m.material as THREE.MeshStandardMaterial; if (mat.map) s.add(mat.map); if (mat.normalMap) s.add(mat.normalMap); if (mat.metalnessMap) s.add(mat.metalnessMap); } });
    return s;
  }

  // ------------------------------------------------------------------ sync

  sync(e: Empire, labels: CapitalLabel[], sel: number | null) {
    this.last = [e, labels, sel];
    this.labelData = labels;
    const cap = e.capital;
    if (!cap || !this.kit.size) return;
    const citadel = capLevel(e, 'citadel');
    if (citadel !== this.districtLevel) { this.districtLevel = citadel; this.buildDistricts(citadel); }
    const open = new Set(openPlots(e));
    const sig = JSON.stringify(cap.buildings) + cap.queue.map((j) => j.building + j.toLevel).join() + [...open].join();
    if (sig !== this.sig) {
      this.sig = sig;
      for (const o of [...this.city.children]) { this.city.remove(o); disposeObject(o, this.shared()); }
      this.tops.clear();
      const lots = new THREE.Group();
      const towers: { plot: number; x: number; z: number; top: number }[] = [];
      for (const s of this.layout.slots) {
        const isCitadel = s.plot === CITADEL_PLOT;
        const id = plotOccupant(cap, s.plot);
        if (!isCitadel) {
          const lot = new THREE.Mesh(new THREE.BoxGeometry(PLOT, 0.3, PLOT), open.has(s.plot) ? this.mats.lot : this.mats.sealed);
          lot.position.set(s.x, 0.15, s.z); lot.receiveShadow = true;
          lots.add(lot);
          if (open.has(s.plot)) {
            // a gold kerb marks a plot that can be built on
            const kerb = new THREE.Mesh(new THREE.BoxGeometry(PLOT + 0.4, 0.4, PLOT + 0.4), this.mats.trim);
            kerb.position.set(s.x, 0.1, s.z); lots.add(kerb);
          }
        }
        if (!open.has(s.plot)) continue;
        if (!id) {
          const holo = new THREE.Mesh(new THREE.RingGeometry(PLOT * 0.3, PLOT * 0.34, 4, 1), this.mats.holo);
          holo.rotation.x = -Math.PI / 2; holo.rotation.z = Math.PI / 4; holo.position.set(s.x, 0.36, s.z); holo.userData.plot = s.plot;
          this.city.add(holo);
          continue;
        }
        const lvl = cap.buildings[id]?.level ?? 0;
        const pick = megaModelFor(id, lvl || 1);
        if (!pick) continue;
        const grow = 1 + Math.min(0.35, ((lvl || 1) - pick.from) * 0.03);
        const scale = (isCitadel ? 1.35 : 1) * (pick.model.startsWith('arco') || pick.model.startsWith('spire') || pick.model === 'truss_a' ? 0.72 : 1) * grow;
        // face the building towards the Citadel
        const ry = isCitadel ? 0 : Math.round(Math.atan2(-s.x, -s.z) / (Math.PI / 2)) * (Math.PI / 2);
        const model = this.place(pick.model, s.x, s.z, { scale, ry, y: 0.3 });
        if (!model) continue;
        model.traverse((o) => { o.userData.plot = s.plot; });
        if (!lvl) model.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = this.mats.ghost; });
        this.city.add(model);
        const box = new THREE.Box3().setFromObject(model);
        this.tops.set(s.plot, box.max.y);
        if (lvl) towers.push({ plot: s.plot, x: s.x, z: s.z, top: box.max.y });
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(isCitadel ? 0.9 : 0.4, 12, 8), this.mats.beacon);
        beacon.position.set(s.x, box.max.y + (isCitadel ? 1.2 : 0.5), s.z); beacon.userData.plot = s.plot;
        this.city.add(beacon);
        if (cap.queue.some((j) => j.building === id)) {
          const size = box.getSize(new THREE.Vector3());
          const sc = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x * 1.08, size.y * 1.04, size.z * 1.08, 2, Math.max(2, Math.round(size.y / 6)), 2)), new THREE.LineBasicMaterial({ color: 0xd9b45a }));
          sc.position.set(s.x, 0.3 + size.y * 0.52, s.z); sc.userData.plot = s.plot;
          this.city.add(sc);
        }
      }
      // sky-bridges between neighbouring towers that both rise above the highways
      const bridges = new THREE.Group();
      for (let a = 0; a < towers.length; a++) for (let b = a + 1; b < towers.length; b++) {
        const A = towers[a], B = towers[b];
        const dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz);
        if (Math.abs(d - CELL) > 0.5 || Math.min(A.top, B.top) < 24) continue;
        const y = Math.min(A.top, B.top) * 0.55;
        const o = this.place('skybridge', (A.x + B.x) / 2, (A.z + B.z) / 2, { y, ry: Math.abs(dx) > Math.abs(dz) ? 0 : Math.PI / 2 });
        if (o) { o.scale.set(d / 10, 0.9, 0.9); bridges.add(o); }
      }
      mergeByMaterial(lots);
      this.city.add(lots, bridges);
    }
    this.pipeline.setEnvironmentIntensity(this.scene, 0.55);
    this.selected = sel;
    const ss = sel != null ? this.slotByPlot.get(sel) : null;
    if (ss) { this.selMesh.position.set(ss.x, 0.45, ss.z); this.selMesh.scale.setScalar(ss.plot === CITADEL_PLOT ? 2.6 : 1); this.selMesh.visible = true; } else this.selMesh.visible = false;
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
      this.cam.pitch = Math.max(0.3, Math.min(1.35, down.pitch + dy * 0.004));
    });
    this.canvas.addEventListener('pointerup', (ev) => { if (down && !moved) this.onPick(this.pick(ev.clientX, ev.clientY)); down = null; });
    this.canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); this.cam.dist = Math.max(70, Math.min(420, this.cam.dist * (ev.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
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
    const p = new THREE.Vector3(s.x, lift, s.z).project(this.camera);
    return { x: ((p.x + 1) / 2) * this.canvas.clientWidth, y: ((1 - p.y) / 2) * this.canvas.clientHeight, visible: p.z < 1 };
  }

  private placeCamera(w: number, h: number) {
    const { yaw, pitch, dist } = this.cam;
    const target = new THREE.Vector3(0, 12, 0);
    this.camera.position.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(target);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 26 * Math.min(1.9, 0.8 / (w / h)) : 26;
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
  }

  private frame(t: number) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.pipeline.setSize(w, h);
    this.placeCamera(w, h);
    const time = this.opts.still ? 0 : t / 1000;
    if (this.traffic) {
      // each light runs round one of the two highway loops
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
      const deck = 6 * HIGHWAY_SCALE + 0.35;
      for (let i = 0; i < this.traffic.count; i++) {
        const L = i % 2 ? CELL : 3 * CELL, lane = (i % 4 < 2 ? -1 : 1) * 1.1;
        const perim = 8 * L;
        let u = ((hash(i) * perim + (i % 4 < 2 ? 1 : -1) * time * (6 + hash(i + 7) * 4)) % perim + perim) % perim;
        const side = Math.floor(u / (2 * L)); u -= side * 2 * L;
        const a = -L + u;
        const [x, z, ry] = side === 0 ? [a, -L + lane, 0] : side === 1 ? [L + lane, a, Math.PI / 2] : side === 2 ? [-a, L - lane, 0] : [-L - lane, -a, Math.PI / 2];
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
        m.compose(p.set(x, deck, z), q, sc);
        this.traffic.setMatrixAt(i, m);
      }
      this.traffic.instanceMatrix.needsUpdate = true;
    }
    this.pipeline.render();
    const now = performance.now();
    this.frames.push(now); while (this.frames.length && now - this.frames[0] > 2000) this.frames.shift();
    this.updateLabels();
  }

  stats() {
    const f = this.frames;
    const fps = f.length > 1 ? ((f.length - 1) * 1000) / (f[f.length - 1] - f[0]) : 0;
    return { fps, tier: this.opts.quality, ...this.pipeline.info(), kitModels: this.kit.size };
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
      const brief = this.cam.dist > 200 && l.plot !== this.selected && !l.building;
      const html = `<span class="lv">${l.level || '–'}</span>${brief ? '' : `<span class="nm">${l.name}</span>`}${l.building ? `<div class="bar"><i style="width:${Math.round(l.progress * 100)}%"></i></div><div class="tm">${l.days} days</div>` : ''}`;
      if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
      const s = this.plotScreen(l.plot, (this.tops.get(l.plot) ?? 4) + 1.5);
      el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      el.style.display = s.visible ? '' : 'none';
    }
    for (const [p, el] of this.labels) if (!seen.has(p)) { el.remove(); this.labels.delete(p); }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const el of this.labels.values()) el.remove();
    this.pipeline.dispose();
    disposeObject(this.scene);
    for (const src of this.kit.values()) disposeObject(src);
    this.scene.clear();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
  }
}

export { CAPITAL_BY_ID };
