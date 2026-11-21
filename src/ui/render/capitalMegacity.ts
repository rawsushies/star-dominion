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
import { mergeByMaterial, instancedFrom } from './instancing';
import { CapitalLife } from './capitalLife';
import { CapitalMetro } from './capitalMetro';
import { CapitalWorld, inOuterZone, CARGO_RING, BIOME_GROUND } from './capitalWorld';
import { CapitalActivity } from './capitalActivity';
import type { PlanetType } from '../../sim/types';
import { CAPITAL_BY_ID, CITADEL_PLOT } from '../../sim/data/capital';
import { capLevel, openPlots, plotOccupant } from '../../sim/capital';
import type { Empire } from '../../sim/types';
import type { CapitalLabel } from './capital3d';
import { disposeObject } from './assets/resources';
import { RenderPipeline, type QualityTier, type PassToggles } from './pipeline';
import { megacityLayout, skylineLayout, hash, CELL, PLOT, SKYLINE_MODELS, SKY_SUN_U, SUN, type DistrictBlock, type MegaSlot, type SkylineTower } from './megacityLayout';

export type KitModel =
  | 'citadel_t1' | 'citadel_t2' | 'citadel_t3' | 'citadel_t4' | 'arco_a' | 'arco_b' | 'arco_c' | 'spire_a' | 'spire_b' | 'truss_a'
  | 'res_a' | 'res_b' | 'res_c' | 'hall_a' | 'hall_b' | 'vault' | 'works_a' | 'refinery_a' | 'power_a' | 'yard_a' | 'bastion_a'
  | 'hwy_straight' | 'hwy_cross' | 'hwy_t' | 'skybridge' | 'lamp' | 'wall' | 'gate' | 'car' | 'taxi';

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

/** Lower kit buildings for district blocks whose Citadel level is not reached yet. */
const DISTRICT_EARLY: Record<Exclude<DistrictBlock['kind'], 'plaza'>, KitModel[]> = {
  residential: ['res_a', 'res_b', 'hall_a', 'res_a'],
  industrial: ['works_a', 'power_a', 'works_a'],
  energy: ['power_a', 'vault', 'power_a'],
  civic: ['hall_a', 'hall_b', 'vault'],
};
/** The old quarter standing on plots the Citadel has not opened yet (cleared when a plot opens). */
const OLD_QUARTER: KitModel[] = ['res_a', 'hall_a', 'works_a', 'res_b', 'vault', 'power_a'];

const DISTRICT_MODELS: Record<Exclude<DistrictBlock['kind'], 'plaza'>, KitModel[]> = {
  residential: ['res_a', 'res_b', 'res_c', 'arco_a', 'arco_b', 'res_b'],
  industrial: ['works_a', 'refinery_a', 'power_a', 'works_a'],
  energy: ['power_a', 'truss_a', 'power_a', 'spire_a'],
  civic: ['hall_b', 'spire_b', 'hall_a', 'arco_a'],
};

/** Kit units to scene units (the kit's plot is 10 x 10, the same as the layout's). */
const KIT = 1;
const HIGHWAY_SCALE = 0.6;
const PICK_Y = 0.15;
/** Per-tier scene budget (the render passes themselves are set by the pipeline's tiers). */
export const PROFILE: Record<QualityTier, { skyline: number; cars: number; shuttles: number; tubeLights: number; outerTubes: number }> = {
  mobile: { skyline: 80, cars: 36, shuttles: 8, tubeLights: 60, outerTubes: 200 },
  medium: { skyline: 150, cars: 90, shuttles: 18, tubeLights: 120, outerTubes: 260 },
  desktop: { skyline: 200, cars: 120, shuttles: 24, tubeLights: 160, outerTubes: 300 },
};

export interface MegacityOptions { quality: QualityTier; still?: boolean; passes?: PassToggles; kitUrl?: string; assetBase?: string; planetType?: PlanetType }

export class MegacityCapitalView3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(26, 1, 2, 7000);
  cam = { yaw: 0.32, pitch: 0.5, dist: 230 };
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
  /** plots with a building (traffic destinations); filled by the first sync */
  private occupied = new Set<number>();
  private shuttles: THREE.InstancedMesh[] = [];
  private skyline: { mesh: THREE.InstancedMesh; towers: SkylineTower[] }[] = [];
  private skylineLevel = -1;
  private plinths: { mesh: THREE.InstancedMesh; towers: SkylineTower[] } | null = null;
  private textures: THREE.Texture[] = [];
  /** streets, signals, traffic and pedestrians (capitalLife.ts) */
  life: CapitalLife | null = null;
  /** the elevated metro (capitalMetro.ts) */
  metro: CapitalMetro | null = null;
  /** outer districts, cargo road and the planetary landscape (capitalWorld.ts) */
  world: CapitalWorld | null = null;
  /** freighter, fighters, drones and cranes, driven by the realm's state (capitalActivity.ts) */
  activity: CapitalActivity | null = null;
  private atWar = false;
  private lastFrame = 0;
  private raf = 0;
  private disposed = false;
  private frames: number[] = [];
  /** set when the player (or the laboratory) has placed the camera; stops the automatic framing */
  cameraLocked = false;
  ready: Promise<void>;
  private shuttleSrc: THREE.Object3D | null = null;

  constructor(private canvas: HTMLCanvasElement, private overlay: HTMLDivElement, color: string, private onPick: (plot: number | null) => void, private opts: MegacityOptions) {
    for (const s of this.layout.slots) this.slotByPlot.set(s.plot, s);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.still });
    // late-afternoon sun, low and warm, so the towers throw long shadows across the city
    // the low tier drops ambient occlusion here: it redraws the whole dense city a second time
    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.camera, opts.quality, { ...SUN, intensity: 3.1 }, opts.passes ?? (opts.quality === 'mobile' ? { ao: false } : undefined));
    // haze in the colour of the photographed sky's horizon, so the far city melts into it
    this.scene.fog = new THREE.Fog(0xb4b6bc, 320, 3400);
    // ground surfaces: Poly Haven photo-scanned textures (CC0), see assets/textures/megacity/manifest.json
    const texLoad = new THREE.LoadingManager();
    const texReady = new Promise<void>((res) => { texLoad.onLoad = () => res(); texLoad.onError = (u) => console.warn(`[megacity] texture failed to load: ${u}`); });
    const loader = new THREE.TextureLoader(texLoad);
    const base = `${opts.assetBase ?? import.meta.env.BASE_URL ?? '/'}assets/textures/megacity/`;
    const tex = (name: string, repeat: number, colour: boolean) => {
      const t = loader.load(`${base}${name}.jpg`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 8;
      if (colour) t.colorSpace = THREE.SRGBColorSpace;
      this.textures.push(t);
      return t;
    };
    const surface = (name: string, repeat: number, o: THREE.MeshStandardMaterialParameters) =>
      new THREE.MeshStandardMaterial({ map: tex(`${name}_color`, repeat, true), normalMap: tex(`${name}_normal`, repeat, false), ...o });
    const half = 4 * CELL + 10;
    this.mats = {
      avenue: surface('street', (half * 2) / 7, { color: new THREE.Color(1.5, 1.5, 1.55), roughness: 0.85, metalness: 0.05 }),
      plaza: surface('plaza', 7, { color: 0xffffff, roughness: 0.7, metalness: 0.0 }),
      lot: surface('lot', 3, { color: new THREE.Color(1.2, 1.25, 1.35), roughness: 0.5, metalness: 0.45 }),
      sealed: surface('land', 2, { color: new THREE.Color(1.3, 1.3, 1.3), roughness: 0.9 }),
      land: surface('land', 260, { color: new THREE.Color(2.2, 2.2, 2.25), roughness: 0.95 }),
      trim: new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xd9b45a), 0.5), roughness: 0.35, metalness: 0.75 }),
      holo: new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffb43a, emissiveIntensity: 1.6, transparent: true, opacity: 0.6 }),
      ghost: new THREE.MeshStandardMaterial({ color: 0xd9c9a0, transparent: true, opacity: 0.32, depthWrite: false }),
      beacon: new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffb24a, emissiveIntensity: 18 }),
      lights: new THREE.MeshStandardMaterial({ color: 0xfff1cf, emissive: 0xffd28a, emissiveIntensity: 9 }),
      pick: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    };
    this.loadSky(loader);
    this.buildGround();
    this.scene.add(this.ground, this.infra, this.districts, this.city);
    this.selMesh = new THREE.Mesh(new THREE.RingGeometry(PLOT * 0.66, PLOT * 0.74, 4, 1), new THREE.MeshBasicMaterial({ color: 0xffd36a, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }));
    this.selMesh.rotation.x = -Math.PI / 2; this.selMesh.rotation.z = Math.PI / 4; this.selMesh.visible = false;
    this.scene.add(this.selMesh);
    this.pipeline.fitShadow(new THREE.Box3(new THREE.Vector3(-80, -2, -80), new THREE.Vector3(80, 90, 80)));
    this.bindInput();
    this.life = new CapitalLife(this.renderer, { quality: opts.quality, still: opts.still, assetBase: opts.assetBase }, { slots: this.layout.slots, districts: this.layout.districts, occupied: this.occupied });
    this.scene.add(this.life.group);
    this.metro = new CapitalMetro(this.renderer, opts.quality);
    this.world = new CapitalWorld(this.renderer, opts.quality, opts.planetType);
    this.scene.add(this.world.group);
    this.activity = new CapitalActivity(this.renderer, opts.quality, this.layout.slots);
    this.scene.add(this.activity.group);
    this.scene.add(this.metro.group);
    this.life.extraWalkers = () => this.metro?.passengers ?? [];
    // street life is not essential to the city: a failure there is reported, the city still builds
    const lifeReady = Promise.all([this.life.ready, this.metro.ready, this.world.ready, this.activity.ready]).catch((e) => console.warn(`[megacity] street life failed: ${(e as Error).message ?? e}`));
    this.ready = Promise.all([this.loadKit(), this.loadShuttle(), texReady, lifeReady]).then(() => {
      if (this.disposed) return;
      this.buildInfrastructure();
      this.buildTraffic();
      this.pipeline.setEnvironmentIntensity(this.life!.group, 0.75);
      this.pipeline.setEnvironmentIntensity(this.metro!.group, 0.75);
      this.pipeline.setEnvironmentIntensity(this.world!.group, 0.75);
      this.pipeline.setEnvironmentIntensity(this.activity!.group, 0.75);
      // the land the city stands on: an island on worlds with a sea, tinted by the biome
      const land = this.ground.children.find((o) => (o as THREE.Mesh).geometry?.type === 'CircleGeometry') as THREE.Mesh | undefined;
      if (land) { const r = this.world!.landRadius(); land.scale.setScalar(r / 1400); (this.mats.land as THREE.MeshStandardMaterial).color.setRGB(2.9, 2.9, 2.95).multiply(new THREE.Color(BIOME_GROUND[this.world!.biome]).lerp(new THREE.Color(0xffffff), 0.6)); }
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

  /** The photographed sky, turned so its sun stands where the scene's light comes from. */
  private loadSky(loader: THREE.TextureLoader) {
    const u = 1 - SKY_SUN_U;
    const sunNow = Math.atan2(-Math.cos(2 * Math.PI * u), Math.sin(2 * Math.PI * u));
    const turn = THREE.MathUtils.degToRad(SUN.azimuth) - sunNow;
    // the environment is pre-filtered from the image, so wait for it (the procedural sky lights the
    // scene until then, and stays if the photograph is missing)
    const t = loader.load(`${this.opts.assetBase ?? import.meta.env.BASE_URL ?? '/'}assets/textures/megacity/sky.jpg`, (tex) => {
      if (this.disposed) return;
      this.scene.add(this.pipeline.setSkyMap(tex, turn, 6000));
    });
    this.textures.push(t);
    // seen from inside the dome the image would be mirrored: flip it back
    t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1;
  }

  /** A small transport (Quaternius Ultimate Spaceships, CC0) for the air lanes over the city. */
  private async loadShuttle() {
    try {
      const g = await new GLTFLoader().loadAsync(`${this.opts.assetBase ?? import.meta.env.BASE_URL ?? '/'}assets/models/ships/Dispatcher.glb`);
      this.shuttleSrc = g.scene;
    } catch (e) {
      console.warn(`[megacity] shuttle failed to load: ${(e as Error).message ?? e}`);
    }
  }

  /** Instanced copies of one model (merged by material): one draw call per material. */
  private instanced(src: THREE.Object3D, count: number, opts: { shadow?: boolean } = {}): THREE.InstancedMesh[] {
    return instancedFrom(src, count, opts);
  }

  /** Shuttles on the air lanes (street traffic is CapitalLife's). */
  private buildTraffic() {
    const P = PROFILE[this.opts.quality];
    if (this.shuttleSrc) {
      for (const im of this.instanced(this.shuttleSrc, P.shuttles)) { this.shuttles.push(im); this.scene.add(im); }
    }
  }

  /** The skyline beyond the walls: built once, revealed tower by tower with the Citadel. */
  private buildSkyline(citadel: number) {
    if (!this.skyline.length) {
      const towers = skylineLayout(PROFILE[this.opts.quality].skyline, (x, z) => inOuterZone(x, z) || (Math.max(Math.abs(x), Math.abs(z)) > CARGO_RING - 9 && Math.max(Math.abs(x), Math.abs(z)) < CARGO_RING + 9));
      for (const model of SKYLINE_MODELS) {
        const src = this.kit.get(model);
        const mine = towers.filter((t) => t.model === model).sort((a, b) => a.from - b.from);
        if (!src || !mine.length) continue;
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
        for (const im of this.instanced(src, mine.length)) {
          mine.forEach((t, k) => im.setMatrixAt(k, m.compose(new THREE.Vector3(t.x, 0, t.z), q.setFromAxisAngle(up, t.ry), new THREE.Vector3(t.sx, t.sy, t.sx))));
          im.instanceMatrix.needsUpdate = true;
          this.skyline.push({ mesh: im, towers: mine });
          this.scene.add(im);
        }
      }
    }
    if (!this.plinths) {
      // every tower of the outer city stands on a paved block, so it meets the ground
      const towers = this.skyline.length ? [...new Map(this.skyline.flatMap((s) => s.towers).map((t) => [`${t.x},${t.z}`, t])).values()].sort((a, b) => a.from - b.from) : [];
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.mats.lot, Math.max(1, towers.length));
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      towers.forEach((t, k) => im.setMatrixAt(k, m.compose(new THREE.Vector3(t.x, 0.2, t.z), q.setFromAxisAngle(up, t.ry), new THREE.Vector3(12 * t.sx, 0.8, 12 * t.sx))));
      im.receiveShadow = true; im.frustumCulled = false; im.userData.keep = true;
      this.plinths = { mesh: im, towers };
      this.scene.add(im);
    }
    // towers are sorted by level, so revealing is a matter of the instance count
    for (const s of this.skyline) s.mesh.count = s.towers.filter((t) => t.from <= citadel).length;
    this.plinths.mesh.count = this.plinths.towers.filter((t) => t.from <= citadel).length;
    this.skylineLevel = citadel;
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
    const plain = new THREE.Mesh(new THREE.CircleGeometry(1400, 64), this.mats.land);
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
    // the transit tubes run on from each gate across the outer city (instanced)
    const tube = this.kit.get('hwy_straight');
    if (tube) {
      const segs: [number, number, number][] = [];
      for (let r = 4 * CELL + 16; r < PROFILE[this.opts.quality].outerTubes; r += 10) for (const [x, z, ry] of [[0, -r, Math.PI / 2], [0, r, Math.PI / 2], [-r, 0, 0], [r, 0, 0]] as const) segs.push([x, z, ry]);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1);
      for (const im of this.instanced(tube, segs.length)) {
        segs.forEach(([x, z, ry], k) => im.setMatrixAt(k, m.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(up, ry), sc)));
        im.instanceMatrix.needsUpdate = true;
        this.infra.add(im);
      }
    }
    // (the expressway tubes are sealed corridors: no traffic is drawn on them)
  }

  /** Districts of the wider city appear as the Citadel rises (each block has a Citadel level). */
  private buildDistricts(citadel: number) {
    for (const o of [...this.districts.children]) { this.districts.remove(o); disposeObject(o, this.shared()); }
    const g = new THREE.Group();
    for (const d of this.layout.districts) {
      // public squares are paved; their stalls and crowds are CapitalLife's
      if (d.kind === 'plaza') {
        const sq = new THREE.Mesh(new THREE.BoxGeometry(PLOT + 1, 0.25, PLOT + 1), this.mats.plaza);
        sq.position.set(d.x, 0.12, d.z); sq.receiveShadow = true; g.add(sq);
        continue;
      }
      // until the Citadel reaches the block's level it stands as an older, lower quarter
      const kind = d.kind as Exclude<DistrictBlock['kind'], 'plaza'>;
      const pool = citadel < d.from ? DISTRICT_EARLY[kind] : DISTRICT_MODELS[kind];
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

  private agedMats = new Map<THREE.Material, THREE.Material>();
  /** A darker, rougher copy of a kit material for the old quarter on sealed plots. */
  private aged(m: THREE.Material): THREE.Material {
    let a = this.agedMats.get(m);
    if (!a) {
      a = m.clone();
      const s = a as THREE.MeshStandardMaterial;
      if (s.color) s.color.multiplyScalar(0.5);
      if ('roughness' in s) s.roughness = Math.min(1, s.roughness + 0.25);
      if (s.emissive) s.emissiveIntensity = 0;
      this.agedMats.set(m, a);
    }
    return a;
  }

  private shared(): Set<unknown> {
    const s = new Set<unknown>([...Object.values(this.mats), ...this.agedMats.values()]);
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
    // frame the city as it stands: a young capital close up, a grown one whole (until the
    // player turns or zooms the camera themselves)
    if (!this.cameraLocked) this.cam.dist = Math.min(250, 175 + citadel * 4);
    if (citadel !== this.districtLevel) { this.districtLevel = citadel; this.buildDistricts(citadel); }
    if (citadel !== this.skylineLevel) this.buildSkyline(citadel);
    const open = new Set(openPlots(e));
    for (const [, b] of Object.entries(cap.buildings)) this.occupied.add(b.plot);
    // what the realm's state drives: cranes and drones at building sites, fighters by readiness
    this.activity?.setActivity({
      sites: cap.queue.map((j) => this.slotByPlot.get(j.plot)).filter((x): x is MegaSlot => !!x).map((sl) => ({ x: sl.x, z: sl.z })),
      readiness: e.stats.navalCap ? Math.min(1, e.stats.navalUsed / e.stats.navalCap) : 0.3,
      atWar: this.atWar,
      industry: e.stats.industry ?? 0,
    });
    const sig = JSON.stringify(cap.buildings) + cap.queue.map((j) => j.building + j.toLevel).join() + [...open].join();
    if (sig !== this.sig) {
      this.sig = sig;
      for (const o of [...this.city.children]) { this.city.remove(o); disposeObject(o, this.shared()); }
      this.tops.clear();
      const lots = new THREE.Group();
      const oldQuarter = new THREE.Group();
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
        if (!open.has(s.plot)) {
          if (!isCitadel) {
            const m = OLD_QUARTER[Math.floor(hash(s.plot * 5.3) * OLD_QUARTER.length) % OLD_QUARTER.length];
            const o = this.place(m, s.x, s.z, { scale: 0.82, ry: Math.floor(hash(s.plot * 2.1) * 4) * Math.PI / 2, y: 0.3 });
            if (o) { o.traverse((x) => { const mm = x as THREE.Mesh; if (mm.isMesh) mm.material = this.aged(mm.material as THREE.Material); }); oldQuarter.add(o); }
          }
          continue;
        }
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
        if (!lvl) model.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = this.mats.ghost; });
        // one building, merged by material into a few meshes that keep the plot id for picking
        const merged = new THREE.Group();
        merged.add(model);
        mergeByMaterial(merged);
        merged.traverse((o) => { o.userData.plot = s.plot; if ((o as THREE.Mesh).isMesh && !lvl) (o as THREE.Mesh).castShadow = false; });
        this.city.add(merged);
        const box = new THREE.Box3().setFromObject(merged);
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
      mergeByMaterial(oldQuarter);
      oldQuarter.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.userData.oldQuarter = true; });
      this.city.add(lots, bridges, oldQuarter);
    }
    this.pipeline.setEnvironmentIntensity(this.scene, 0.55);
    this.selected = sel;
    const ss = sel != null ? this.slotByPlot.get(sel) : null;
    if (ss) { this.selMesh.position.set(ss.x, 0.45, ss.z); this.selMesh.scale.setScalar(ss.plot === CITADEL_PLOT ? 2.6 : 1); this.selMesh.visible = true; } else this.selMesh.visible = false;
  }

  /** The realm's wider state that the city shows (patrols scramble at war). */
  setRealmState(s: { atWar: boolean }) { this.atWar = s.atWar; if (this.activity) this.activity.activity = { ...this.activity.activity, atWar: s.atWar }; }

  // ------------------------------------------------------------------ input, camera, frame

  /** Pan with one finger or the left button, rotate with the right button, Shift or a two-finger
   *  twist, zoom with the wheel or a pinch. A tap (no movement) picks a plot. */
  private bindInput() {
    const pts = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number; tx: number; tz: number; yaw: number; pitch: number; dist: number; rotate: boolean; span: number; angle: number } | null = null;
    let moved = false;
    const two = () => { const [a, b] = [...pts.values()]; return { span: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    const begin = (rotate: boolean) => {
      const c = pts.size >= 2 ? two() : { ...[...pts.values()][0], span: 0, angle: 0 };
      start = { x: c.x, y: c.y, tx: this.camGoal.x, tz: this.camGoal.z, yaw: this.cam.yaw, pitch: this.cam.pitch, dist: this.cam.dist, rotate, span: c.span, angle: c.angle };
    };
    this.canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
    this.canvas.addEventListener('pointerdown', (ev) => {
      this.cameraLocked = true;
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pts.size === 1) moved = false; else moved = true;
      begin(ev.button === 2 || ev.shiftKey);
      this.canvas.setPointerCapture(ev.pointerId);
    });
    this.canvas.addEventListener('pointermove', (ev) => {
      if (!pts.has(ev.pointerId) || !start) return;
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pts.size >= 2) {
        const c = two();
        if (start.span > 0) this.cam.dist = Math.max(55, Math.min(420, start.dist * (start.span / Math.max(1, c.span))));
        this.cam.yaw = start.yaw - (c.angle - start.angle);
        return;
      }
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
      if (start.rotate) {
        this.cam.yaw = start.yaw - dx * 0.006;
        this.cam.pitch = Math.max(0.3, Math.min(1.35, start.pitch + dy * 0.004));
      } else {
        // drag the ground under the pointer: scale screen pixels to ground units at this distance
        const k = (this.cam.dist * 0.95) / Math.max(1, this.canvas.clientHeight);
        const cy = Math.cos(this.cam.yaw), sy = Math.sin(this.cam.yaw);
        const fx = -dx * k, fz = -dy * k / Math.max(0.35, Math.sin(this.cam.pitch));
        this.panTo(start.tx + fx * cy + fz * sy, start.tz - fx * sy + fz * cy, true);
      }
    });
    const end = (ev: PointerEvent) => {
      if (!pts.has(ev.pointerId)) return;
      pts.delete(ev.pointerId);
      if (!pts.size) { if (!moved && ev.type === 'pointerup') this.onPick(this.pick(ev.clientX, ev.clientY)); start = null; }
      else begin(false);
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); this.cameraLocked = true; this.cam.dist = Math.max(55, Math.min(420, this.cam.dist * (ev.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
  }

  /** Where the camera looks (ground point); it eases towards `camGoal`. */
  private camTarget = new THREE.Vector3(0, 12, 0);
  private camGoal = new THREE.Vector3(0, 12, 0);
  private distGoal: number | null = null;

  private panTo(x: number, z: number, instant = false) {
    const R = 4 * CELL + 30; // keep the city in reach
    this.camGoal.set(Math.max(-R, Math.min(R, x)), 12, Math.max(-R, Math.min(R, z)));
    if (instant) this.camTarget.copy(this.camGoal);
  }

  /** Glide to a plot and frame it (selection from the interface or a tap). */
  focusPlot(plot: number | null) {
    if (plot == null) return;
    const s = this.slotByPlot.get(plot);
    if (!s) return;
    this.cameraLocked = true;
    this.panTo(s.x, s.z);
    const top = this.tops.get(plot) ?? 10;
    this.distGoal = Math.max(70, Math.min(160, top * 2.4 + 50));
  }

  /** Back to the whole city. */
  frameCity() {
    this.panTo(0, 0);
    this.distGoal = Math.min(250, 175 + Math.max(1, this.districtLevel) * 4);
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
    // ease towards the goal (selection glides; panning sets both at once)
    this.camTarget.lerp(this.camGoal, this.opts.still ? 1 : 0.12);
    if (this.distGoal != null) { this.cam.dist += (this.distGoal - this.cam.dist) * (this.opts.still ? 1 : 0.1); if (Math.abs(this.distGoal - this.cam.dist) < 0.5) this.distGoal = null; }
    const { yaw, pitch, dist } = this.cam;
    const target = this.camTarget;
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
    const dt = this.lastFrame ? (t - this.lastFrame) / 1000 : 0; this.lastFrame = t;
    this.metro?.update(dt, time, !!this.opts.still);
    if (!this.opts.still) { this.world?.update(Math.min(dt, 0.1)); this.activity?.update(Math.min(dt, 0.1), time); }
    this.life?.update(dt, time, this.camTarget);
    if (this.shuttles.length) {
      // shuttles circle the Citadel on three air lanes, alternating direction
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3().setScalar(0.32), p = new THREE.Vector3();
      for (let k = 0; k < this.shuttles[0].count; k++) {
        const lane = k % 3, dir = lane === 1 ? -1 : 1;
        const r = 38 + lane * 34, y = 34 + lane * 9 + hash(k) * 4;
        const a = hash(k * 3.7) * Math.PI * 2 + dir * time * (9 / r);
        m.compose(p.set(Math.cos(a) * r, y, Math.sin(a) * r), q.setFromAxisAngle(up, -a + (dir > 0 ? 0 : Math.PI)), sc);
        for (const im of this.shuttles) im.setMatrixAt(k, m);
      }
      for (const im of this.shuttles) im.instanceMatrix.needsUpdate = true;
    }
    this.pipeline.render();
    const now = performance.now();
    this.frames.push(now); while (this.frames.length && now - this.frames[0] > 2000) this.frames.shift();
    this.updateLabels();
  }

  stats() {
    const f = this.frames;
    const fps = f.length > 1 ? ((f.length - 1) * 1000) / (f[f.length - 1] - f[0]) : 0;
    const skyline = this.skyline.length ? new Set(this.skyline.flatMap((s) => s.towers.slice(0, s.mesh.count).map((t) => `${t.x},${t.z}`))).size : 0;
    const life = this.life?.stats();
    const metro = this.metro?.stats();
    const act = this.activity?.stats();
    return { fps, tier: this.opts.quality, ...this.pipeline.info(), kitModels: this.kit.size, skyline, trains: metro?.trains ?? 0, trainsStopped: metro?.stopped ?? 0, freighter: act?.freighter ?? 'none', fighters: act?.fighters ?? 0, drones: act?.drones ?? 0, cranes: act?.cranes ?? 0, cars: life?.vehicles ?? 0, walkers: life?.walkers ?? 0, nearPeople: life?.nearPeople ?? 0, shuttles: this.shuttles[0]?.count ?? 0 };
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
    if (this.shuttleSrc) disposeObject(this.shuttleSrc);
    for (const m of this.agedMats.values()) m.dispose();
    this.life?.dispose();
    this.metro?.dispose();
    this.world?.dispose();
    this.activity?.dispose();
    for (const t of this.textures) t.dispose();
    this.scene.clear();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
  }
}

export { CAPITAL_BY_ID };
