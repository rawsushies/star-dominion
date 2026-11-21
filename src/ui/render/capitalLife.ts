// Street life of the megacity capital, drawn with sourced CC0 models (see cityRoads.ts for the
// simulation):
//   - streets: Kenney City Kit Roads tiles (local streets, junctions with crosswalks, kerbs and
//     sidewalks) and tevy's four-lane road and scramble-crossing junction for the avenues
//   - furniture: tevy traffic lights (with the live signal lit), street lamps and bus shelters,
//     Kenney street signs
//   - traffic: tevy cars, taxis, hover cars, cargo vans, buses, police cars and ambulances,
//     instanced per model and steered by the Traffic simulation
//   - pedestrians: tevy's rigged people (shared skeleton, walk/idle clips). Near the camera they
//     are real skinned meshes playing their clips; further away they are instanced copies of
//     walk-cycle poses baked from the same models (eight frames), so a crowd costs a few draw calls
// Everything is instanced; per-tier counts live in LIFE_PROFILE.

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadTevy, tevyUrl, releaseTevyLoader } from './assets/tevyLoader';
import { instancedFrom, finishStatic } from './instancing';
import { disposeObject } from './assets/resources';
import type { QualityTier } from './pipeline';
import { M, JUNCTION, roadNetwork, nearestNode, Traffic, Crowd, SquareCrowd, signalFor, sidewalkOffset, roadHalf, type RoadNetwork, type VehicleKind, type Light, type Square, type Walker } from './cityRoads';
import type { MegaSlot, DistrictBlock } from './megacityLayout';

export const LIFE_PROFILE: Record<QualityTier, { vehicles: Partial<Record<VehicleKind, number>>; walkers: number; squareCrowd: number; nearPeople: number; lamps: boolean }> = {
  mobile: { vehicles: { car: 14, taxi: 6, hover: 5, van: 8, bus: 2, police: 2, ambulance: 1 }, walkers: 64, squareCrowd: 12, nearPeople: 0, lamps: true },
  medium: { vehicles: { car: 40, taxi: 16, hover: 12, van: 18, bus: 4, police: 3, ambulance: 2 }, walkers: 150, squareCrowd: 24, nearPeople: 12, lamps: true },
  desktop: { vehicles: { car: 56, taxi: 22, hover: 16, van: 24, bus: 5, police: 4, ambulance: 2 }, walkers: 280, squareCrowd: 36, nearPeople: 24, lamps: true },
};

const VEHICLE_MODEL: Record<VehicleKind, string> = { car: 'estate-car', taxi: 'city-taxi', hover: 'hover-car', van: 'cargo-hauler-van', bus: 'city-bus', police: 'police-car', ambulance: 'ambulance' };
const PEOPLE = ['casual-walker', 'dog-walker', 'road-worker', 'hiker'];
const WALK_FRAMES = 8;
const ROAD_Y = 0.03;

export interface LifeOptions { quality: QualityTier; still?: boolean; assetBase?: string }
export interface LifeSites { slots: MegaSlot[]; districts: DistrictBlock[]; occupied: Set<number> }

function base(opts: LifeOptions) { return `${(opts.assetBase ?? import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/')}`; }

export class CapitalLife {
  readonly net: RoadNetwork = roadNetwork();
  readonly group = new THREE.Group();
  traffic: Traffic | null = null;
  crowd: Crowd | null = null;
  squares: SquareCrowd | null = null;
  /** more people to draw with the crowd (metro passengers on the platforms) */
  extraWalkers: () => Walker[] = () => [];
  ready: Promise<void>;
  private models = new Map<string, GLTF>();
  private vehicleMeshes = new Map<VehicleKind, THREE.InstancedMesh[]>();
  private signalLamps: { mesh: THREE.InstancedMesh; spots: { node: number; axis: 'x' | 'z'; x: number; y: number; z: number }[] } | null = null;
  private crowdMeshes: THREE.InstancedMesh[][][] = []; // [variant][frame] -> meshes (one per material)
  private near: { root: THREE.Object3D; mixer: THREE.AnimationMixer; walk: THREE.AnimationAction; idle: THREE.AnimationAction; variant: number; walker: number }[] = [];
  private disposed = false;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private up = new THREE.Vector3(0, 1, 0); private v3 = new THREE.Vector3(); private s3 = new THREE.Vector3();

  constructor(private renderer: THREE.WebGLRenderer, private opts: LifeOptions, private sites: LifeSites) {
    this.group.name = 'capital-life';
    this.ready = this.load().then(() => { if (!this.disposed) this.build(); });
  }

  // ------------------------------------------------------------------ assets

  private async load() {
    const roads = `${base(this.opts)}assets/models/roads/`;
    const want: [string, string][] = [
      ['k:straight', `${roads}road-straight.glb`], ['k:cross', `${roads}road-crossroad-path.glb`], ['k:tee', `${roads}road-intersection-path.glb`],
      ['k:bend', `${roads}road-bend-sidewalk.glb`], ['k:tile', `${roads}tile-low.glb`], ['k:sign', `${roads}road-sign-street.glb`],
      ['avenue', tevyUrl('four-lane-city-road-12-m', 1)], ['junction', tevyUrl('scramble-crossing-junction-box', 1)],
      ['kiosk', tevyUrl('noodle-kiosk', 2)], ['news', tevyUrl('newsstand-kiosk', 2)], ['cart', tevyUrl('street-food-stall-cart', 2)],
      ['holo', tevyUrl('holo-ring-sign', 1)], ['blade', tevyUrl('holo-blade-sign', 1)], ['planter', tevyUrl('concrete-planter', 2)], ['bench', tevyUrl('park-bench', 2)], ['bistro', tevyUrl('plaza-bistro-set', 2)],
      ['signal', tevyUrl('traffic-light', 2)], ['lamp', tevyUrl('street-lamp', 2)], ['shelter', tevyUrl('glass-bus-shelter', 2)],
      ...Object.values(VEHICLE_MODEL).map((s) => [s, tevyUrl(s, 2)] as [string, string]),
      ...PEOPLE.map((s) => [s, tevyUrl(s, 2)] as [string, string]),
      ...(LIFE_PROFILE[this.opts.quality].nearPeople ? PEOPLE.map((s) => [`${s}:near`, tevyUrl(s, 1)] as [string, string]) : []),
    ];
    await Promise.all(want.map(async ([k, url]) => {
      try { this.models.set(k, await loadTevy(this.renderer, url)); } catch (e) { console.warn(`[capital life] ${url} failed to load: ${(e as Error).message ?? e}`); }
    }));
    // Kenney's pastel palette, darkened to sit with the scanned ground and tevy's asphalt
    for (const k of ['k:straight', 'k:cross', 'k:tee', 'k:bend', 'k:tile']) this.models.get(k)?.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && !m.userData.toned) { m.color.setRGB(0.5, 0.52, 0.56); m.roughness = 0.9; m.metalness = 0; m.userData.toned = true; }
    });
  }

  private scene(k: string): THREE.Object3D | null { return this.models.get(k)?.scene ?? null; }

  /** Instanced copies of a model at the given transforms. */
  private stamp(k: string, xf: { x: number; y?: number; z: number; ry?: number; sx?: number; sy?: number; sz?: number }[], shadow = false) {
    const src = this.scene(k);
    if (!src || !xf.length) return;
    // furniture casts shadows only at the high tier (each shadow caster is drawn twice)
    const ims = instancedFrom(src, xf.length, { shadow: shadow && this.opts.quality === 'desktop' });
    for (const im of ims) {
      xf.forEach((t, i) => im.setMatrixAt(i, this.m4.compose(this.v3.set(t.x, t.y ?? 0, t.z), this.q.setFromAxisAngle(this.up, t.ry ?? 0), this.s3.set(t.sx ?? 1, t.sy ?? t.sx ?? 1, t.sz ?? t.sx ?? 1))));
      im.instanceMatrix.needsUpdate = true;
      this.group.add(im);
    }
    finishStatic(ims);
  }

  // ------------------------------------------------------------------ build

  private build() {
    const net = this.net;
    const P = LIFE_PROFILE[this.opts.quality];
    // street segments: two tiles between junctions (each JUNCTION wide, half a segment long)
    const kStraight: Parameters<CapitalLife['stamp']>[1] = [], avenue: typeof kStraight = [], tiles: typeof kStraight = [];
    for (const e of net.edges) {
      const A = net.nodes[e.a], B = net.nodes[e.b];
      const len = e.length - JUNCTION;
      for (const f of [0.25, 0.75]) {
        const x = A.x + (B.x - A.x) * (JUNCTION / 2 + len * f) / e.length, z = A.z + (B.z - A.z) * (JUNCTION / 2 + len * f) / e.length;
        const ry = e.axis === 'x' ? 0 : Math.PI / 2;
        if (e.major) {
          // tevy's road runs along its X: 16 m long, 12 m wide; scaled to half the segment by 4.8 units
          avenue.push({ x, y: ROAD_Y, z, ry, sx: (len / 2) / 16, sy: 1, sz: (roadHalf(true) * 2) / 12 });
          // sidewalks either side (Kenney paving), between the carriageway and the lots
          for (const side of [-1, 1]) {
            const off = (roadHalf(true) + 0.3) * side;
            tiles.push({ x: x + (e.axis === 'z' ? off : 0), y: ROAD_Y, z: z + (e.axis === 'x' ? off : 0), ry, sx: len / 2, sy: 1, sz: 0.6 });
          }
        } else {
          kStraight.push({ x, y: ROAD_Y, z, ry, sx: len / 2, sy: 1, sz: JUNCTION });
        }
      }
    }
    this.stamp('k:straight', kStraight);
    this.stamp('avenue', avenue);
    // junctions
    const cross: typeof kStraight = [], tee: typeof kStraight = [], bend: typeof kStraight = [], box: typeof kStraight = [];
    for (const n of net.nodes) {
      const dirs = n.edges.map((id) => { const e = net.edges[id]; const o = net.nodes[e.a === n.id ? e.b : e.a]; return [Math.sign(o.x - n.x), Math.sign(o.z - n.z)] as [number, number]; });
      const major = n.edges.some((id) => net.edges[id].major);
      if (major && dirs.length >= 3) {
        box.push({ x: n.x, y: ROAD_Y, z: n.z, sx: JUNCTION / 16 });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) tiles.push({ x: n.x + sx * (JUNCTION / 2 - 0.3), y: ROAD_Y + 0.005, z: n.z + sz * (JUNCTION / 2 - 0.3), sx: 0.6, sz: 0.6 });
        continue;
      }
      if (dirs.length === 4) cross.push({ x: n.x, y: ROAD_Y, z: n.z, sx: JUNCTION });
      else if (dirs.length === 3) {
        // Kenney's T opens left, right and towards +Z (its closed side faces -Z)
        const missing = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).find(([dx, dz]) => !dirs.some(([a, b]) => a === dx && b === dz))!;
        const ry = missing[1] === -1 ? 0 : missing[1] === 1 ? Math.PI : missing[0] === 1 ? Math.PI / 2 : -Math.PI / 2;
        tee.push({ x: n.x, y: ROAD_Y, z: n.z, ry, sx: JUNCTION });
      } else if (dirs.length === 2) {
        const [a, b] = dirs;
        if (a[0] === -b[0] && a[1] === -b[1]) kStraight.push({ x: n.x, y: ROAD_Y, z: n.z, ry: a[0] ? 0 : Math.PI / 2, sx: JUNCTION, sz: JUNCTION });
        else {
          // Kenney's bend joins +X and +Z
          const hasX = a[0] || b[0], hasZ = a[1] || b[1];
          const ry = hasX === 1 && hasZ === 1 ? 0 : hasX === -1 && hasZ === 1 ? -Math.PI / 2 : hasX === -1 && hasZ === -1 ? Math.PI : Math.PI / 2;
          bend.push({ x: n.x, y: ROAD_Y, z: n.z, ry, sx: JUNCTION });
        }
      }
    }
    this.stamp('k:cross', cross); this.stamp('k:tee', tee); this.stamp('k:bend', bend); this.stamp('junction', box); this.stamp('k:tile', tiles);
    // traffic lights: one on the near-right corner of each approach to a signalled junction
    const poles: typeof kStraight = [];
    const spots: { node: number; axis: 'x' | 'z'; x: number; y: number; z: number }[] = [];
    for (const n of net.nodes) {
      if (!n.signal) continue;
      // the low tier draws one pole per street axis at each junction (the far approaches share it)
      const seenAxis = new Set<string>();
      for (const id of n.edges) {
        const e = net.edges[id]; const o = net.nodes[e.a === n.id ? e.b : e.a];
        if (this.opts.quality === 'mobile') { if (seenAxis.has(e.axis)) continue; seenAxis.add(e.axis); }
        const dx = Math.sign(n.x - o.x), dz = Math.sign(n.z - o.z); // travel direction into the node
        const rx = -dz, rz = dx; // right of travel
        const off = sidewalkOffset(e.major) - 0.2;
        const px = n.x - dx * (JUNCTION / 2 + 0.2) + rx * off, pz = n.z - dz * (JUNCTION / 2 + 0.2) + rz * off;
        // tevy's light faces +Z: turn it to face the approaching traffic
        const ry = Math.atan2(-dx, -dz);
        poles.push({ x: px, z: pz, ry, sx: M });
        spots.push({ node: n.id, axis: e.axis, x: px - dx * 0.12, y: 3.0 * M, z: pz - dz * 0.12 });
      }
    }
    this.stamp('signal', poles, true);
    // the lit lamp of each signal: a small emissive disc in the head, coloured by the live phase
    const lamp = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), spots.length);
    lamp.frustumCulled = false; lamp.userData.keep = true;
    spots.forEach((s, i) => lamp.setMatrixAt(i, this.m4.makeTranslation(s.x, s.y, s.z)));
    lamp.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(spots.length * 3), 3);
    this.group.add(lamp);
    this.signalLamps = { mesh: lamp, spots };
    // street lamps along every street (alternate sides), street signs on corners
    if (P.lamps) {
      const lamps: typeof kStraight = [], signs: typeof kStraight = [];
      for (const e of net.edges) {
        const A = net.nodes[e.a], B = net.nodes[e.b];
        const side = (e.id % 2 ? 1 : -1);
        const off = sidewalkOffset(e.major) + 0.15;
        const t = 0.5;
        const x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t;
        lamps.push({ x: x + (e.axis === 'z' ? off * side : 0), z: z + (e.axis === 'x' ? off * side : 0), ry: e.axis === 'x' ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2), sx: M });
        if (e.id % 3 === 0) signs.push({ x: A.x + (B.x - A.x) * 0.24 - (e.axis === 'z' ? off : 0), z: A.z + (B.z - A.z) * 0.24 - (e.axis === 'x' ? off : 0), ry: e.axis === 'x' ? 0 : Math.PI / 2, sx: 2.2 });
      }
      this.stamp('lamp', lamps, true); this.stamp('k:sign', signs);
    }
    // bus stops: shelters on avenue sidewalks; the buses run between them
    const stops = net.edges.filter((e) => e.major).filter((_, i) => i % 5 === 2);
    const shelters: typeof kStraight = [];
    const stopNodes: number[] = [];
    for (const e of stops) {
      const A = net.nodes[e.a], B = net.nodes[e.b];
      const off = sidewalkOffset(true) + 0.1;
      shelters.push({ x: (A.x + B.x) / 2 + (e.axis === 'z' ? off : 0), z: (A.z + B.z) / 2 + (e.axis === 'x' ? off : 0), ry: e.axis === 'x' ? Math.PI : -Math.PI / 2, sx: M });
      stopNodes.push(e.a, e.b);
    }
    this.stamp('shelter', shelters, true);
    // traffic with destinations meaningful to each kind
    const nodeOf = (x: number, z: number) => nearestNode(net, x, z);
    const districts = (kind: DistrictBlock['kind']) => this.sites.districts.filter((d) => d.kind === kind).map((d) => nodeOf(d.x, d.z));
    const plots = this.sites.slots.filter((s) => this.sites.occupied.has(s.plot)).map((s) => nodeOf(s.x, s.z));
    const gates = [nodeOf(0, -64), nodeOf(0, 64), nodeOf(-64, 0), nodeOf(64, 0)];
    this.traffic = new Traffic(net, {
      seed: 21,
      destinations: {
        van: [...districts('industrial'), ...districts('energy'), ...gates, ...plots],
        car: [...districts('residential'), ...plots, ...districts('civic')],
        taxi: [...districts('residential'), ...districts('civic'), ...plots, ...gates],
        hover: [...districts('civic'), ...plots, ...districts('residential')],
        bus: stopNodes,
      },
    }, P.vehicles);
    for (const kind of Object.keys(P.vehicles) as VehicleKind[]) {
      const src = this.scene(VEHICLE_MODEL[kind]);
      if (!src) continue;
      const n = this.traffic.vehicles.filter((v) => v.kind === kind).length;
      const meshes = instancedFrom(src, n, { shadow: this.opts.quality !== 'mobile' });
      meshes.forEach((m) => this.group.add(m));
      this.vehicleMeshes.set(kind, meshes);
    }
    // public squares: market furniture, and a crowd that strolls, gathers and idles
    const squares = this.buildSquares();
    this.squares = new SquareCrowd(squares, P.squareCrowd, PEOPLE.length, 17);
    // pedestrians
    this.crowd = new Crowd(net, P.walkers, PEOPLE.length, 9);
    this.crowdMeshes = PEOPLE.map((slug) => this.bakeWalk(slug, P.walkers + P.squareCrowd * squares.length + 48));
    for (let i = 0; i < P.nearPeople; i++) {
      const variant = i % PEOPLE.length;
      const g = this.models.get(`${PEOPLE[variant]}:near`);
      if (!g) continue;
      const root = cloneSkinned(g.scene);
      root.scale.setScalar(M);
      root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      const mixer = new THREE.AnimationMixer(root);
      const clip = (name: string) => g.animations.find((a) => a.name === name) ?? g.animations[0];
      const walk = mixer.clipAction(clip('walk')), idle = mixer.clipAction(clip('idle'));
      walk.play(); idle.play(); idle.weight = 0;
      root.visible = false;
      this.group.add(root);
      this.near.push({ root, mixer, walk, idle, variant, walker: -1 });
    }
  }

  /** Furnish each public square (tevy kiosks, stalls, screen, signs, planters, benches, tables). */
  private buildSquares(): Square[] {
    const out: Square[] = [];
    const place: Record<string, Parameters<CapitalLife['stamp']>[1]> = {};
    const put = (k: string, x: number, z: number, ry: number, r: number, sq: Square, gatherAt?: number) => {
      (place[k] ??= []).push({ x, z, ry, sx: M });
      sq.obstacles.push({ x, z, r });
      // gather in front of it (its front faces +Z before turning)
      if (gatherAt != null) sq.gather.push({ x: x + Math.sin(ry) * gatherAt, z: z + Math.cos(ry) * gatherAt });
    };
    for (const d of this.sites.districts.filter((x) => x.kind === 'plaza')) {
      const sq: Square = { x: d.x, z: d.z, half: 5.4, obstacles: [], gather: [] };
      // face the stalls inwards, towards the square's centre
      const face = (x: number, z: number) => Math.atan2(d.x - x, d.z - z);
      const c = (dx: number, dz: number) => [d.x + dx, d.z + dz] as const;
      { const [x, z] = c(-3.2, -3.2); put('kiosk', x, z, face(x, z), 0.75, sq, 1.4); }
      { const [x, z] = c(3.2, -3.2); put('news', x, z, face(x, z), 0.75, sq, 1.4); }
      { const [x, z] = c(-3.4, 3.0); put('cart', x, z, face(x, z), 0.8, sq, 1.3); }
      { const [x, z] = c(3.2, 3.2); put('kiosk', x, z, face(x, z), 0.75, sq, 1.4); }
      { const [x, z] = c(0, 0); put('holo', x, z, 0, 0.4, sq, 1.2); }
      for (const [dx, dz] of [[-1.6, 1.6], [1.6, -1.6]] as const) { const [x, z] = c(dx, dz); put('bistro', x, z, 0.4, 0.4, sq, 0.7); }
      for (const [dx, dz, ry] of [[0, -4.6, 0], [0, 4.6, Math.PI], [-4.6, 0, Math.PI / 2], [4.6, 0, -Math.PI / 2]] as const) { const [x, z] = c(dx, dz); put('planter', x, z, ry, 0.5, sq); }
      for (const [dx, dz, ry] of [[-1.8, -4.4, 0], [1.8, 4.4, Math.PI], [4.4, 1.8, -Math.PI / 2]] as const) { const [x, z] = c(dx, dz); put('bench', x, z, ry, 0.45, sq, 0.6); }
      { const [x, z] = c(-4.6, -1.4); put('blade', x, z, Math.PI / 2, 0.2, sq); }
      out.push(sq);
    }
    for (const [k, xf] of Object.entries(place)) this.stamp(k, xf, true);
    return out;
  }

  /**
   * Bake a rigged person's walk cycle into static poses: WALK_FRAMES frames of the walk clip and
   * one idle frame, each merged by material and drawn instanced. Returns [frame][material].
   */
  private bakeWalk(slug: string, capacity: number): THREE.InstancedMesh[][] {
    const g = this.models.get(slug);
    if (!g) return [];
    const root = cloneSkinned(g.scene);
    const mixer = new THREE.AnimationMixer(root);
    const walkClip = g.animations.find((a) => a.name === 'walk') ?? g.animations[0];
    const idleClip = g.animations.find((a) => a.name === 'idle') ?? walkClip;
    const frames: THREE.InstancedMesh[][] = [];
    const v = new THREE.Vector3();
    for (let f = 0; f <= WALK_FRAMES; f++) {
      mixer.stopAllAction();
      const idle = f === WALK_FRAMES;
      const action = mixer.clipAction(idle ? idleClip : walkClip);
      action.play();
      mixer.setTime(idle ? 0.3 : (walkClip.duration * f) / WALK_FRAMES);
      root.updateMatrixWorld(true);
      const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
      root.traverse((o) => {
        const sm = o as THREE.SkinnedMesh;
        if (!sm.isMesh) return;
        const src = sm.geometry;
        const geo = new THREE.BufferGeometry();
        const pos = src.attributes.position;
        const out = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          if (sm.isSkinnedMesh) sm.applyBoneTransform(i, v);
          v.applyMatrix4(sm.matrixWorld);
          out[i * 3] = v.x * M; out[i * 3 + 1] = v.y * M; out[i * 3 + 2] = v.z * M;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
        if (src.attributes.uv) {
          const uv = src.attributes.uv; const u = new Float32Array(uv.count * 2);
          for (let i = 0; i < uv.count; i++) { u[i * 2] = uv.getX(i); u[i * 2 + 1] = uv.getY(i); }
          geo.setAttribute('uv', new THREE.BufferAttribute(u, 2));
        }
        if (src.index) geo.setIndex(src.index.clone());
        geo.computeVertexNormals();
        const mat = Array.isArray(sm.material) ? sm.material[0] : sm.material;
        byMat.set(mat, [...(byMat.get(mat) ?? []), geo]);
      });
      const meshes: THREE.InstancedMesh[] = [];
      for (const [mat, geos] of byMat) {
        const merged = geos.length > 1 ? mergeGeometries(geos) : geos[0];
        if (geos.length > 1) geos.forEach((x) => x.dispose());
        if (!merged) continue;
        const im = new THREE.InstancedMesh(merged, mat, capacity);
        im.count = 0; im.frustumCulled = false; im.castShadow = this.opts.quality === 'desktop'; im.userData.keep = true;
        this.group.add(im);
        meshes.push(im);
      }
      frames.push(meshes);
    }
    // the clone shares geometry and materials with the loaded model, which dispose() releases
    return frames;
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number, time: number, focus: THREE.Vector3) {
    if (!this.traffic || !this.crowd) return;
    const step = this.opts.still ? 0 : Math.min(dt, 0.1);
    if (step > 0) { this.traffic.step(step, time); this.crowd.step(step, time); this.squares?.step(step); }
    // vehicles
    const byKind = new Map<VehicleKind, number>();
    for (const v of this.traffic.vehicles) {
      const meshes = this.vehicleMeshes.get(v.kind);
      if (!meshes) continue;
      const i = byKind.get(v.kind) ?? 0; byKind.set(v.kind, i + 1);
      const hidden = v.dwell > 0;
      const y = v.kind === 'hover' ? 0.5 * M + 0.15 * Math.sin(time * 2 + v.id) * M : ROAD_Y;
      this.m4.compose(this.v3.set(v.x, y, v.z), this.q.setFromAxisAngle(this.up, v.ry), this.s3.setScalar(hidden ? 0 : M));
      for (const m of meshes) m.setMatrixAt(i, this.m4);
    }
    for (const meshes of this.vehicleMeshes.values()) for (const m of meshes) m.instanceMatrix.needsUpdate = true;
    // signal lamps show each approach's live light
    if (this.signalLamps) {
      const c = new THREE.Color();
      const COL: Record<Light, number> = { green: 0x35ff7a, amber: 0xffb020, red: 0xff2a1a };
      this.signalLamps.spots.forEach((s, i) => this.signalLamps!.mesh.setColorAt(i, c.setHex(COL[signalFor(this.net.nodes[s.node], s.axis, time)]).multiplyScalar(3)));
      this.signalLamps.mesh.instanceColor!.needsUpdate = true;
    }
    // pedestrians: the nearest ones as skinned meshes, the rest as baked instanced poses
    const ws: Walker[] = [...this.crowd.walkers, ...(this.squares?.walkers ?? []), ...this.extraWalkers().filter((w) => !w.hidden)];
    const nearIds = new Set<number>();
    if (this.near.length) {
      const order = ws.map((w, i) => ({ i, d: (w.x - focus.x) ** 2 + (w.z - focus.z) ** 2 })).filter((o) => o.d < 45 * 45).sort((a, b) => a.d - b.d);
      const taken = new Set<number>();
      for (const n of this.near) {
        const pick = order.find((o) => !taken.has(o.i) && ws[o.i].variant === n.variant);
        if (!pick) { n.root.visible = false; n.walker = -1; continue; }
        taken.add(pick.i); nearIds.add(pick.i);
        const w = ws[pick.i];
        n.walker = pick.i; n.root.visible = true;
        n.root.position.set(w.x, w.y ?? ROAD_Y, w.z); n.root.rotation.y = w.ry;
        n.walk.weight = w.walking ? 1 : 0; n.idle.weight = w.walking ? 0 : 1;
        n.mixer.update(step * (w.speed / (1.3 * M)));
      }
    }
    const counts = this.crowdMeshes.map((frames) => frames.map(() => 0));
    for (let i = 0; i < ws.length; i++) {
      if (nearIds.has(i)) continue;
      const w = ws[i];
      const frames = this.crowdMeshes[w.variant];
      if (!frames?.length) continue;
      const f = w.walking ? Math.floor(((time * w.speed) / (1.3 * M) / 1.05 + w.id * 0.37) * WALK_FRAMES) % WALK_FRAMES : WALK_FRAMES;
      const k = counts[w.variant][f]++;
      if (k >= (frames[f][0]?.instanceMatrix.count ?? 0)) continue;
      this.m4.compose(this.v3.set(w.x, w.y ?? ROAD_Y, w.z), this.q.setFromAxisAngle(this.up, w.ry), this.s3.setScalar(1));
      for (const m of frames[f]) m.setMatrixAt(k, this.m4);
    }
    this.crowdMeshes.forEach((frames, vi) => frames.forEach((meshes, fi) => { for (const m of meshes) { m.count = counts[vi][fi]; m.instanceMatrix.needsUpdate = true; } }));
  }

  stats() {
    return { vehicles: this.traffic?.vehicles.filter((v) => v.dwell <= 0).length ?? 0, walkers: (this.crowd?.walkers.length ?? 0) + (this.squares?.walkers.length ?? 0), nearPeople: this.near.filter((n) => n.root.visible).length };
  }

  dispose() {
    this.disposed = true;
    disposeObject(this.group);
    for (const g of this.models.values()) disposeObject(g.scene);
    releaseTevyLoader(this.renderer);
  }
}
