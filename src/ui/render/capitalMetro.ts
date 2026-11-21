// The elevated metro drawn with tevy's CC0 railway models (simulation: metro.ts):
//   - viaduct: elevated-railway-span (double track with catenary), instanced along the line; the
//     station sections use the span with shops built underneath
//   - stations: station-platform sections on both sides at deck height, held up by
//     metro-platform columns, with benches; station-entrance-canopy at street level
//   - trains: three metro-train-car each; the door leaves (door_L1a ... door_R4b) slide open on
//     the platform side while the train stands at a station
//   - passengers: people wait on the platforms, walk to the doors and board while the doors are
//     open; others step off and walk away along the platform

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadTevy, tevyUrl } from './assets/tevyLoader';
import { instancedFrom, mergeByMaterial, finishStatic } from './instancing';
import { disposeObject } from './assets/resources';
import type { QualityTier } from './pipeline';
import { M, type Walker } from './cityRoads';
import { MetroLine, LINE_Z, LINE_END, STATIONS, CAR_LENGTH, CARS, TRACK_OFFSET, trackZ, direction, type Train } from './metro';

const SPAN = 20 * M;        // a viaduct span is 20 m long
const DOOR_SLIDE = 0.65;    // metres each leaf slides
const PLATFORM_LEN = 12 * M;

interface CarRig { root: THREE.Group; doors: { node: THREE.Object3D; rest: THREE.Vector3; side: 'L' | 'R'; sign: number }[] }

export class CapitalMetro {
  readonly group = new THREE.Group();
  line = new MetroLine(2);
  ready: Promise<void>;
  /** the street below each station, for the street crowd's entrances */
  stationStreet = STATIONS.map((x) => ({ x, z: LINE_Z }));
  /** height of the rail heads above the street */
  railY = 3.2;
  passengers: Walker[] = [];
  private models = new Map<string, GLTF>();
  private trains: CarRig[][] = [];
  private platformY = 3.2;
  private disposed = false;
  private rng: () => number;

  constructor(private renderer: THREE.WebGLRenderer, private quality: QualityTier) {
    this.group.name = 'capital-metro';
    let s = 29; this.rng = () => { s = (s * 48271) % 2147483647; return (s - 1) / 2147483646; };
    this.ready = this.load().then(() => { if (!this.disposed) this.build(); });
  }

  private async load() {
    const carLod = this.quality === 'mobile' ? 2 : 1;
    const want: [string, string][] = [
      ['span', tevyUrl('elevated-railway-span', 2)], ['shops', tevyUrl('elevated-railway-span-shops', 2)], ['platform', tevyUrl('station-platform', 1)],
      ['column', tevyUrl('metro-platform-column', 2)], ['bench', tevyUrl('metro-platform-bench', 2)], ['canopy', tevyUrl('station-entrance-canopy', 2)],
      ['car', tevyUrl('metro-train-car', carLod)],
    ];
    await Promise.all(want.map(async ([k, url]) => {
      try { this.models.set(k, await loadTevy(this.renderer, url)); } catch (e) { console.warn(`[metro] ${url} failed to load: ${(e as Error).message ?? e}`); }
    }));
  }

  private stamp(k: string, xf: { x: number; y?: number; z: number; ry?: number; s?: number; sy?: number }[], shadow = true) {
    const src = this.models.get(k)?.scene;
    if (!src || !xf.length) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const ims = instancedFrom(src, xf.length, { shadow: shadow && this.quality !== 'mobile' });
    for (const im of ims) {
      xf.forEach((t, i) => im.setMatrixAt(i, m.compose(p.set(t.x, t.y ?? 0, t.z), q.setFromAxisAngle(up, t.ry ?? 0), sc.set(t.s ?? M, (t.sy ?? 1) * (t.s ?? M), t.s ?? M))));
      im.instanceMatrix.needsUpdate = true;
      this.group.add(im);
    }
    finishStatic(ims);
  }

  /** Rail-head height of the span model, found by casting a ray onto a track (model units). */
  private measureRail(): number {
    const span = this.models.get('span')?.scene;
    if (!span) return 8;
    span.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0.37, 30, TRACK_OFFSET / M), new THREE.Vector3(0, -1, 0));
    // skip the catenary wires: the first solid hit below 11 m
    const hits = ray.intersectObject(span, true).filter((h) => h.point.y < 11);
    return hits[0]?.point.y ?? 8;
  }

  private build() {
    const railModel = this.measureRail();
    this.railY = railModel * M;
    this.platformY = this.railY + 0.05;
    // viaduct spans centred on every junction and mid-block, so the piers (at the span ends) stand
    // clear of the junctions; station sections use the span with shops underneath
    const spans: Parameters<CapitalMetro['stamp']>[1] = [], shops: typeof spans = [];
    const stationAt = (x: number) => STATIONS.some((sx) => Math.abs(x - sx) <= SPAN * 1.01);
    // the low tier ends the visible viaduct where the haze thickens (trains run on beyond it)
    const reach = this.quality === 'mobile' ? 200 : LINE_END;
    for (let x = -reach; x <= reach; x += SPAN) (stationAt(x) ? shops : spans).push({ x, z: LINE_Z });
    this.stamp('span', spans); this.stamp('shops', shops);
    // stations: platforms both sides at deck height, columns underneath, benches, street entrance
    const plats: typeof spans = [], cols: typeof spans = [], benches: typeof spans = [], canopies: typeof spans = [];
    const pz = 5.77 * M + 1.84 * M; // span half width + half a platform's depth
    for (const sx of STATIONS) {
      for (const side of [-1, 1]) {
        for (let k = -2; k <= 2; k++) {
          const x = sx + k * PLATFORM_LEN;
          plats.push({ x, y: this.platformY - 1.05 * M, z: LINE_Z + side * pz, ry: side > 0 ? Math.PI : 0 });
          cols.push({ x, z: LINE_Z + side * (pz + 0.4), sy: (this.platformY - 1.05 * M) / (4.611 * M) });
          if (k % 2 === 0) benches.push({ x: x + 1.2, y: this.platformY, z: LINE_Z + side * (pz + 0.35), ry: side > 0 ? Math.PI : 0 });
        }
      }
      canopies.push({ x: sx + 3.2, z: LINE_Z + 4.9 * -1, ry: 0 });
    }
    this.stamp('platform', plats); this.stamp('column', cols); this.stamp('bench', benches); this.stamp('canopy', canopies);
    // trains
    for (const t of this.line.trains) this.trains[t.id] = Array.from({ length: CARS }, () => this.rigCar());
    // platform passengers: a few waiting on each platform
    const per = this.quality === 'mobile' ? 4 : this.quality === 'medium' ? 7 : 10;
    let id = 20000;
    for (const [si, sx] of STATIONS.entries()) for (const track of [0, 1] as const) for (let i = 0; i < per; i++) {
      const p = this.platformSpot(si, track);
      this.passengers.push({ id: id++, variant: i % 4, from: p, to: p, t: 0, len: 0, at: { node: si, sx: track, sz: 0 }, next: null, crossing: null, wait: this.rng() * 5, speed: 1.2 * M, x: p.x, z: p.z, ry: track === 0 ? 0 : Math.PI, walking: false, y: this.platformY, hidden: false });
      void sx;
    }
  }

  private platformSpot(station: number, track: 0 | 1) {
    const pz = 5.77 * M + 1.84 * M;
    return { x: STATIONS[station] + (this.rng() - 0.5) * PLATFORM_LEN * 4.2, z: LINE_Z + (track === 0 ? -1 : 1) * (pz + (this.rng() - 0.3) * 0.5) };
  }

  /** One car: its body merged by material, its sixteen door leaves kept as moving nodes. */
  private rigCar(): CarRig {
    const src = this.models.get('car')!.scene;
    const car = src.clone(true);
    car.updateMatrixWorld(true);
    const doors: CarRig['doors'] = [];
    const body = new THREE.Group();
    const keep: THREE.Object3D[] = [];
    car.traverse((o) => { if (/^door_[LR]\d[ab]$/.test(o.name)) keep.push(o); });
    // detach doors (keeping their placement), merge the rest
    for (const d of keep) { const w = d.matrixWorld.clone(); d.removeFromParent(); w.decompose(d.position, d.quaternion, d.scale); }
    body.add(car);
    mergeByMaterial(body);
    const root = new THREE.Group();
    root.add(body);
    for (const d of keep) {
      root.add(d);
      d.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
      const m = /^door_([LR])\d([ab])$/.exec(d.name)!;
      doors.push({ node: d, rest: d.position.clone(), side: m[1] as 'L' | 'R', sign: m[2] === 'a' ? -1 : 1 });
    }
    body.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    root.scale.setScalar(M);
    this.group.add(root);
    return { root, doors };
  }

  update(dt: number, time: number, still = false) {
    if (!this.trains.length) return;
    if (!still) this.line.step(Math.min(dt, 0.1), time);
    for (const t of this.line.trains) this.placeTrain(t);
    if (!still) this.stepPassengers(Math.min(dt, 0.1), time);
  }

  private placeTrain(t: Train) {
    const rig = this.trains[t.id];
    const d = direction(t.track);
    // the cars face their direction of travel: +Z of the model along +X (east) or -X (west)
    const ry = d > 0 ? Math.PI / 2 : -Math.PI / 2;
    // platform side: the north track's platform is to the north (-Z), the south track's to the south
    // a car turned to face east has its left (+X) to the north; facing west, its right is to the north
    // (both tracks therefore open their left-hand doors)
    const platformSide: 'L' | 'R' = 'L';
    rig.forEach((car, i) => {
      const offset = ((CARS - 1) / 2 - i) * CAR_LENGTH * d;
      car.root.position.set(t.x + offset, this.railY, trackZ(t.track));
      car.root.rotation.y = ry;
      for (const door of car.doors) {
        const open = door.side === platformSide ? t.doors : 0;
        door.node.position.copy(door.rest);
        door.node.position.z += door.sign * DOOR_SLIDE * open;
      }
    });
  }

  /** Waiting passengers board through the open doors; others step off and walk away. */
  private stepPassengers(dt: number, time: number) {
    for (const t of this.line.trains) {
      if (t.phase !== 'boarding' || t.timer > dt * 1.5) continue;
      const si = t.served!;
      // board: waiting passengers on this platform head for the nearest door
      for (const p of this.passengers) {
        if (p.hidden || p.at.node !== si || p.at.sx !== t.track || p.walking) continue;
        if (this.rng() < 0.6) {
          const door = this.doorPoint(t, p.x);
          p.from = { x: p.x, z: p.z }; p.to = door; p.len = Math.hypot(door.x - p.x, door.z - p.z); p.t = 0; p.walking = true; p.next = { node: -1, sx: 0, sz: 0 }; // -1: boarding
        }
      }
      // alight: a few step off at the doors and walk along the platform to the exit
      for (const p of this.passengers) {
        if (!p.hidden || p.at.node !== si || p.at.sx !== t.track || this.rng() > 0.5) continue;
        const door = this.doorPoint(t, STATIONS[si] + (this.rng() - 0.5) * CAR_LENGTH * CARS);
        const exit = { x: STATIONS[si] + (this.rng() < 0.5 ? -1 : 1) * PLATFORM_LEN * 2.3, z: door.z };
        Object.assign(p, { hidden: false, x: door.x, z: door.z, from: door, to: exit, len: Math.hypot(exit.x - door.x, exit.z - door.z), t: 0, walking: true, next: { node: -2, sx: 0, sz: 0 } }); // -2: leaving
      }
    }
    for (const p of this.passengers) {
      if (p.hidden) continue;
      if (!p.walking) { if (p.wait > 0) p.wait -= dt; continue; }
      p.t = Math.min(p.len, p.t + p.speed * dt);
      const k = p.len ? p.t / p.len : 1;
      p.x = p.from.x + (p.to.x - p.from.x) * k; p.z = p.from.z + (p.to.z - p.from.z) * k;
      p.ry = Math.atan2(p.to.x - p.from.x, p.to.z - p.from.z);
      if (p.t >= p.len) {
        p.walking = false;
        if (p.next?.node === -1) { p.hidden = true; }                           // boarded
        else if (p.next?.node === -2) {                                          // left the station: a new arrival takes their place later
          const spot = this.platformSpot(p.at.node, p.at.sx as 0 | 1);
          Object.assign(p, { x: spot.x, z: spot.z, wait: 4 + this.rng() * 10, ry: p.at.sx === 0 ? 0 : Math.PI });
        }
        p.next = null;
      }
    }
    void time;
  }

  private doorPoint(t: Train, nearX: number) {
    const span = CAR_LENGTH * CARS;
    const start = t.x - span / 2;
    // four door pairs per car, evenly spaced
    let best = t.x, bd = Infinity;
    for (let c = 0; c < CARS; c++) for (let k = 0; k < 4; k++) {
      const x = start + c * CAR_LENGTH + ((k + 0.5) / 4) * CAR_LENGTH;
      if (Math.abs(x - nearX) < bd) { bd = Math.abs(x - nearX); best = x; }
    }
    const pz = 5.77 * M + 1.84 * M;
    return { x: best, z: LINE_Z + (t.track === 0 ? -1 : 1) * (pz - 0.9) };
  }

  stats() { return { trains: this.line.trains.length, stopped: this.line.trains.filter((t) => t.phase !== 'running').length, passengers: this.passengers.filter((p) => !p.hidden).length }; }

  dispose() {
    this.disposed = true;
    disposeObject(this.group);
    for (const g of this.models.values()) disposeObject(g.scene);
  }
}
