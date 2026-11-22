// The capital's planetary setting, built from sourced CC0 models (tevy.dev):
//   1. the outer metropolitan ring beyond the walls, in four districts on the gate axes:
//      energy to the north (cooling towers, gas tanks, substations), industry to the east (factory
//      halls, container yards, tower cranes), the spaceport to the west (hangars, control tower,
//      harbour cranes and a container yard round the freighter dock) and the shipyard to the south;
//      a ground cargo road rings the city and links them, with trucks on it;
//   2. the natural landscape, by the capital world's type: snow-capped peaks and ridges on
//      temperate, ocean, jungle, tundra and frozen worlds, sandstone buttes on desert and arid
//      worlds, cliff ranges on volcanic, toxic and barren ones;
//   3. water: temperate, ocean, jungle and gaia worlds set the capital on an island, with the sea
//      reaching to the mountains on the horizon.

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadTevy, loadTevyTexture, tevyUrl } from './assets/tevyLoader';
import { instancedFrom, finishStatic } from './instancing';
import { disposeObject } from './assets/resources';
import type { QualityTier } from './pipeline';
import type { PlanetType } from '../../sim/types';
import { M } from './cityRoads';
import { hash } from './megacityLayout';

export type Biome = 'green' | 'desert' | 'ice' | 'ash';
export function biomeOf(type: PlanetType | undefined): Biome {
  switch (type) {
    case 'desert': case 'arid': return 'desert';
    case 'tundra': case 'frozen': return 'ice';
    case 'volcanic': case 'toxic': case 'barren': case 'gas_giant': return 'ash';
    default: return 'green';
  }
}
export function hasSea(type: PlanetType | undefined) { return type === 'temperate' || type === 'ocean' || type === 'jungle' || type === 'gaia' || type == null; }
/** Ground tint per biome (multiplies the scanned concrete of the land beyond the city). */
export const BIOME_GROUND: Record<Biome, number> = { green: 0x8e9a82, desert: 0xc9a27a, ice: 0xdfe6ee, ash: 0x6d6662 };

/** Outer districts: axis-aligned rectangles beyond the walls (kept clear of the outer skyline). */
export const OUTER_ZONES = {
  energy: { x0: -120, x1: 120, z0: -270, z1: -105 },
  industry: { x0: 105, x1: 270, z0: -95, z1: 95 },
  port: { x0: -270, x1: -105, z0: -95, z1: 95 },
  shipyard: { x0: -120, x1: 120, z0: 105, z1: 270 },
};
export function inOuterZone(x: number, z: number, pad = 6) {
  return Object.values(OUTER_ZONES).some((r) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad);
}
/** The cargo road: a square ring at this distance from the centre, crossing each gate axis. */
export const CARGO_RING = 92;
/** Where the freighter docks in the spaceport. */
export const DOCK = { x: -190, z: 30 };

export class CapitalWorld {
  readonly group = new THREE.Group();
  ready: Promise<void>;
  readonly biome: Biome;
  private models = new Map<string, GLTF>();
  private ground: { color: THREE.Texture; normal: THREE.Texture } | null = null;
  private trucks: { mesh: THREE.InstancedMesh[]; s: number[]; speed: number[] } | null = null;
  private disposed = false;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private up = new THREE.Vector3(0, 1, 0); private v = new THREE.Vector3(); private s3 = new THREE.Vector3();

  constructor(private renderer: THREE.WebGLRenderer, private quality: QualityTier, readonly planetType?: PlanetType) {
    this.group.name = 'capital-world';
    this.biome = biomeOf(planetType);
    this.ready = this.load().then(() => { if (!this.disposed) this.build(); });
  }

  private async load() {
    const terrain = this.biome === 'desert' ? ['red-sandstone-mesa', 'mountain-ridge'] : this.biome === 'ash' ? ['cliff-face', 'mountain-ridge'] : ['mountain-peak', 'mountain-ridge'];
    const want = ['cooling-tower', 'gas-tanks', 'substation', 'factory-hall', 'container-stack-40-ft-four-high', 'tower-crane', 'harbour-crane', 'control-tower', 'scifi-hangar', 'loading-dock', 'four-lane-city-road-12-m', 'semi-truck', 'scifi-shuttle', 'scifi-dropship', 'forklift', ...terrain];
    const mat = this.biome === 'desert' ? 'desert-sand' : this.biome === 'ice' ? 'snow' : this.biome === 'ash' ? 'granite-rock' : 'meadow-ground';
    const base = `${(import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/')}assets/textures/tevy/`;
    const groundP = Promise.all([loadTevyTexture(this.renderer, `${base}${mat}-color-1k.ktx2`), loadTevyTexture(this.renderer, `${base}${mat}-normal-1k.ktx2`)])
      .then(([color, normal]) => { this.ground = { color, normal }; })
      .catch((e) => console.warn(`[world] ground material failed to load: ${(e as Error).message ?? e}`));
    await groundP;
    await Promise.all(want.map(async (slug) => {
      try { this.models.set(slug, await loadTevy(this.renderer, tevyUrl(slug, slug === 'four-lane-city-road-12-m' ? 1 : 2))); } catch (e) { console.warn(`[world] ${slug} failed to load: ${(e as Error).message ?? e}`); }
    }));
  }

  private stamp(slug: string, xf: { x: number; y?: number; z: number; ry?: number; s?: number; sx?: number; sz?: number }[], shadow = true): THREE.InstancedMesh[] {
    const src = this.models.get(slug)?.scene;
    if (!src || !xf.length) return [];
    // beyond the walls is outside the sun's shadow map: nothing there casts shadows
    void shadow;
    const ims = instancedFrom(src, xf.length, { shadow: false });
    for (const im of ims) {
      xf.forEach((t, i) => { const s = t.s ?? M; im.setMatrixAt(i, this.m4.compose(this.v.set(t.x, t.y ?? 0, t.z), this.q.setFromAxisAngle(this.up, t.ry ?? 0), this.s3.set(t.sx ?? s, s, t.sz ?? s))); });
      im.instanceMatrix.needsUpdate = true;
      this.group.add(im);
    }
    finishStatic(ims);
    return ims;
  }

  private build() {
    const Z = OUTER_ZONES;
    // ---- paved aprons under each district (scanned concrete, Poly Haven)
    const tl = new THREE.TextureLoader();
    const tb = `${(import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/')}assets/textures/megacity/`;
    const apronMat = new THREE.MeshStandardMaterial({ map: tl.load(`${tb}land_color.jpg`), normalMap: tl.load(`${tb}land_normal.jpg`), color: new THREE.Color(1.9, 1.9, 1.95), roughness: 0.92 });
    for (const t of [apronMat.map!, apronMat.normalMap!]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(24, 24); }
    apronMat.map!.colorSpace = THREE.SRGBColorSpace;
    for (const r of Object.values(Z)) {
      const a = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0), apronMat);
      a.rotation.x = -Math.PI / 2; a.position.set((r.x0 + r.x1) / 2, 0.02, (r.z0 + r.z1) / 2); a.receiveShadow = true;
      this.group.add(a);
    }
    // ---- energy district (north): a row of cooling towers, tank farms, substations
    this.stamp('cooling-tower', [{ x: -85, z: -215 }, { x: -30, z: -225 }, { x: 25, z: -215 }, { x: 80, z: -225 }]);
    this.stamp('gas-tanks', [{ x: -75, z: -140 }, { x: -10, z: -135, ry: Math.PI }, { x: 60, z: -140 }]);
    this.stamp('substation', [{ x: -100, z: -175 }, { x: 0, z: -172 }, { x: 100, z: -175, ry: Math.PI / 2 }, { x: 105, z: -255, ry: Math.PI / 2 }]);
    // ---- industry (east): rows of factory halls, container yards, cranes
    const halls: Parameters<CapitalWorld['stamp']>[1] = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) halls.push({ x: 128 + i * 34, z: -62 + j * 54, ry: Math.PI / 2 });
    this.stamp('factory-hall', halls);
    const stacks: typeof halls = [];
    for (let i = 0; i < 10; i++) for (let j = 0; j < 4; j++) stacks.push({ x: 248 + j * 3.2, z: -88 + i * 9 + (j % 2) * 3, ry: Math.PI / 2 });
    this.stamp('container-stack-40-ft-four-high', stacks);
    this.stamp('tower-crane', [{ x: 195, z: 78, ry: 0.6 }, { x: 255, z: 82, ry: 2.2 }, { x: 150, z: -88, ry: 1.4 }]);
    // ---- spaceport (west): a row of hangars, landing pads with craft, the freighter dock
    const hangars: typeof halls = [];
    for (let i = 0; i < 6; i++) hangars.push({ x: -125, z: -80 + i * 13.5 + (i > 2 ? 30 : 0), ry: Math.PI / 2 });
    this.stamp('scifi-hangar', hangars);
    this.stamp('control-tower', [{ x: -245, z: -75, ry: Math.PI / 2 }]);
    this.stamp('harbour-crane', [{ x: DOCK.x - 24, z: DOCK.z - 8, ry: Math.PI / 2, s: M * 0.8 }, { x: DOCK.x - 24, z: DOCK.z + 12, ry: Math.PI / 2, s: M * 0.8 }]);
    const yard: typeof halls = [];
    for (let i = 0; i < 24; i++) yard.push({ x: DOCK.x - 12 + (i % 6) * 3.4, z: DOCK.z + 24 + Math.floor(i / 6) * 6.5, ry: 0 });
    for (let i = 0; i < 12; i++) yard.push({ x: -230 + (i % 4) * 3.4, z: 40 + Math.floor(i / 4) * 6.5, ry: 0 });
    this.stamp('container-stack-40-ft-four-high', yard);
    this.stamp('loading-dock', [{ x: DOCK.x + 16, z: DOCK.z - 14, ry: -Math.PI / 2 }, { x: DOCK.x + 16, z: DOCK.z - 8, ry: -Math.PI / 2 }, { x: DOCK.x + 16, z: DOCK.z - 2, ry: -Math.PI / 2 }]);
    // craft on the aprons: shuttles and dropships parked by the hangars and on the pads
    this.stamp('scifi-shuttle', [{ x: -150, z: -70, ry: -Math.PI / 2 }, { x: -150, z: -45, ry: -Math.PI / 2 }, { x: -215, z: -40, ry: 0.4 }]);
    this.stamp('scifi-dropship', [{ x: -150, z: 55, ry: -Math.PI / 2 }, { x: -240, z: -20, ry: 1.2 }]);
    this.stamp('forklift', [{ x: DOCK.x - 2, z: DOCK.z + 18, ry: 0 }, { x: DOCK.x + 6, z: DOCK.z + 19, ry: 2 }, { x: -222, z: 36, ry: 1 }]);
    // ---- shipyard (south): slips with dropships under the cranes, hangars behind
    this.stamp('tower-crane', [{ x: -60, z: 150, ry: 1.2 }, { x: 0, z: 165, ry: 2.6 }, { x: 60, z: 150, ry: 0.2 }]);
    this.stamp('scifi-dropship', [{ x: -60, z: 135, ry: 0 }, { x: 0, z: 140, ry: 0 }, { x: 60, z: 135, ry: 0 }]);
    this.stamp('scifi-hangar', [{ x: -90, z: 235, ry: 0 }, { x: -45, z: 240, ry: 0 }, { x: 0, z: 240, ry: 0 }, { x: 45, z: 240, ry: 0 }, { x: 90, z: 235, ry: 0 }]);
    // ---- cargo ring road (tevy four-lane road) and its trucks
    const road: typeof halls = [];
    const segLen = 16 * M * 1.6; // tile stretched a little along its length
    for (let t = -CARGO_RING; t < CARGO_RING; t += segLen) {
      const c = t + segLen / 2;
      road.push({ x: c, z: -CARGO_RING, ry: 0, sx: 1.6 * M, sz: M }, { x: c, z: CARGO_RING, ry: 0, sx: 1.6 * M, sz: M });
      road.push({ x: -CARGO_RING, z: c, ry: Math.PI / 2, sx: 1.6 * M, sz: M }, { x: CARGO_RING, z: c, ry: Math.PI / 2, sx: 1.6 * M, sz: M });
    }
    this.stamp('four-lane-city-road-12-m', road.map((r) => ({ ...r, y: 0.03 })), false);
    const truck = this.models.get('semi-truck')?.scene;
    if (truck) {
      const n = this.quality === 'mobile' ? 6 : 12;
      const mesh = instancedFrom(truck, n, { shadow: false });
      mesh.forEach((m) => this.group.add(m));
      const per = 8 * CARGO_RING;
      this.trucks = { mesh, s: Array.from({ length: n }, (_, i) => (i / n) * per + hash(i) * 10), speed: Array.from({ length: n }, (_, i) => 5 + hash(i * 3) * 2) };
    }
    // ---- landscape
    const R = (a: number, r: number) => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });
    if (this.biome === 'desert') {
      const mesas: typeof halls = [];
      for (let i = 0; i < 14; i++) { const p = R(hash(i * 2.3) * Math.PI * 2, 520 + hash(i * 5.1) * 900); mesas.push({ ...p, ry: hash(i) * 6.3, s: M * (6 + hash(i * 7) * 6) }); }
      this.stamp('red-sandstone-mesa', mesas, false);
    } else if (this.biome === 'ash') {
      const cliffs: typeof halls = [];
      for (let i = 0; i < 16; i++) { const p = R(hash(i * 2.3) * Math.PI * 2, 500 + hash(i * 5.1) * 900); cliffs.push({ ...p, ry: Math.atan2(-p.x, -p.z), s: M * (8 + hash(i * 7) * 7) }); }
      this.stamp('cliff-face', cliffs, false);
    } else {
      const peaks: typeof halls = [];
      for (let i = 0; i < 4; i++) { const p = R(i * Math.PI / 2 + 0.6 + hash(i) * 0.6, 1700 + hash(i * 3) * 500); peaks.push({ ...p, ry: hash(i * 9) * 6.3, s: M * (0.8 + hash(i * 4) * 0.5) }); }
      this.stamp('mountain-peak', peaks, false);
    }
    const ridges: Parameters<CapitalWorld['stamp']>[1] = [];
    for (let i = 0; i < 6; i++) { const p = R(i * Math.PI / 3 + hash(i * 1.7), 1350 + hash(i * 2.9) * 600); ridges.push({ ...p, ry: Math.atan2(p.x, p.z) + Math.PI / 2, s: M * (0.7 + hash(i * 5) * 0.5) }); }
    this.stamp('mountain-ridge', ridges, false);
    // tint the sourced terrain a little toward the biome
    const tint = new THREE.Color(this.biome === 'ice' ? 0xf0f4ff : this.biome === 'ash' ? 0x8c8580 : 0xffffff);
    for (const slug of ['mountain-ridge', 'mountain-peak', 'cliff-face']) this.models.get(slug)?.scene.traverse((o) => { const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (mm?.color) mm.color.multiply(tint); });
    // natural ground beyond the urban ring (tevy's seamless PBR ground for the biome)
    if (this.ground) {
      const outer = this.landRadius() - 2;
      const geo = new THREE.RingGeometry(285, outer, 96, 4);
      for (const t of [this.ground.color, this.ground.normal]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(outer / 6, outer / 6); t.anisotropy = 8; }
      this.ground.color.colorSpace = THREE.SRGBColorSpace;
      const ring = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this.ground.color, normalMap: this.ground.normal, roughness: 0.95 }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = -1.1; ring.receiveShadow = true;
      this.group.add(ring);
    }
    // the sea: a calm reflective plane below the land disc
    if (hasSea(this.planetType)) {
      const sea = new THREE.Mesh(new THREE.CircleGeometry(5200, 64), new THREE.MeshStandardMaterial({ color: 0x2a4b5e, roughness: 0.12, metalness: 0.6 }));
      sea.rotation.x = -Math.PI / 2; sea.position.y = -2.2; sea.receiveShadow = false;
      this.group.add(sea);
    }
  }

  /** Radius of the land the city stands on (an island when there is a sea). */
  landRadius() { return hasSea(this.planetType) ? 760 : 5200; }

  update(dt: number) {
    if (!this.trucks) return;
    const per = 8 * CARGO_RING;
    const L = CARGO_RING;
    this.trucks.s.forEach((s0, i) => {
      const s = (s0 + this.trucks!.speed[i] * dt + per) % per;
      this.trucks!.s[i] = s;
      // clockwise round the square, driving on the right
      const side = Math.floor(s / (2 * L)), u = s - side * 2 * L - L, lane = 1.2;
      const [x, z, ry] = side === 0 ? [u, -L + lane, Math.PI / 2] : side === 1 ? [L - lane, u, Math.PI] : side === 2 ? [-u, L - lane, -Math.PI / 2] : [-L + lane, -u, 0];
      this.m4.compose(this.v.set(x, 0.03, z), this.q.setFromAxisAngle(this.up, ry), this.s3.setScalar(M));
      for (const m of this.trucks!.mesh) m.setMatrixAt(i, this.m4);
    });
    for (const m of this.trucks.mesh) m.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.disposed = true;
    disposeObject(this.group);
    this.ground?.color.dispose(); this.ground?.normal.dispose();
    for (const g of this.models.values()) disposeObject(g.scene);
  }
}
