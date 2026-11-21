// What moves above and around the capital, driven by the realm's state (CC0 tevy models):
//   - the freighter (scifi-freighter) descends to the spaceport dock, puts its landing legs down,
//     lowers its ramp and unloads its four containers, which forklifts carry to the container yard;
//     then it raises the ramp and leaves. It calls more often as the realm's industry grows.
//   - fighter patrols (scifi-fighter, stealth-fighter) fly racetracks over the city; how many
//     depends on naval readiness (ships in service against capacity), more and faster at war.
//     Each fighter comes home in turn: it descends to the spaceport, lands with its gear down
//     and taxis into a hangar, whose blast door opens for it; later it rolls out and takes off.
//   - drone swarms (quad-rotor-recon-drone) shuttle between the industrial district and every
//     capital building under construction, and circle the site.
//   - tower cranes (tower-crane) stand beside each building under construction, slewing and
//     raising their hooks.
// The models' moving parts (ramp, containers, legs, gear, canopy, blast door, crane slewing and
// hook) are animated from their rest pose.

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadTevy, tevyUrl } from './assets/tevyLoader';
import { instancedFrom } from './instancing';
import { disposeObject } from './assets/resources';
import type { QualityTier } from './pipeline';
import { M } from './cityRoads';
import { hash, type MegaSlot } from './megacityLayout';
import { DOCK, OUTER_ZONES } from './capitalWorld';

export interface Activity {
  /** plots with a building under construction */
  sites: { x: number; z: number }[];
  /** ships in service against naval capacity, 0..1 */
  readiness: number;
  atWar: boolean;
  /** realm industry, for the freighter's frequency */
  industry: number;
}

const FREIGHTER_CYCLE = { descend: 16, legs: 2, ramp: 3, unload: 22, close: 3, climb: 14 };
const HANGARS = [{ x: -125, z: -80, door: Math.PI / 2 }, { x: -125, z: -66.5, door: Math.PI / 2 }];

type Rig = { root: THREE.Object3D; parts: Map<string, { node: THREE.Object3D; pos: THREE.Vector3; rot: THREE.Euler }> };

function rig(src: THREE.Object3D, names: string[]): Rig {
  const root = src.clone(true);
  const parts = new Map<string, { node: THREE.Object3D; pos: THREE.Vector3; rot: THREE.Euler }>();
  root.traverse((o) => { if (names.includes(o.name)) parts.set(o.name, { node: o, pos: o.position.clone(), rot: o.rotation.clone() }); });
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, parts };
}

export class CapitalActivity {
  readonly group = new THREE.Group();
  ready: Promise<void>;
  activity: Activity = { sites: [], readiness: 0.4, atWar: false, industry: 50 };
  private models = new Map<string, GLTF>();
  private freighter: (Rig & { phase: number; t: number; rampSign: number; rampAxisZ: number; cargo: THREE.Object3D[] }) | null = null;
  private forklifts: Rig[] = [];
  private hangars: Rig[] = [];
  private fighters: { root: THREE.Object3D; gear: THREE.Object3D[]; state: 'patrol' | 'land' | 'taxi-in' | 'stowed' | 'taxi-out' | 'climb'; t: number; lap: number; hangar: number; phase: number; r: number; h: number }[] = [];
  private drones: THREE.InstancedMesh[] = [];
  private cranes: { rig: Rig; site: { x: number; z: number } }[] = [];
  private freighterWait = 6;
  private disposed = false;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private v = new THREE.Vector3(); private s3 = new THREE.Vector3();

  constructor(private renderer: THREE.WebGLRenderer, private quality: QualityTier, private slots: MegaSlot[]) {
    this.group.name = 'capital-activity';
    this.ready = this.load().then(() => { if (!this.disposed) this.build(); });
  }

  private async load() {
    const want: [string, number][] = [['scifi-freighter', 1], ['scifi-fighter', 2], ['stealth-fighter', 2], ['quad-rotor-recon-drone', 2], ['tower-crane', 2], ['forklift', 2], ['scifi-hangar', 2]];
    await Promise.all(want.map(async ([slug, lod]) => {
      try { this.models.set(slug, await loadTevy(this.renderer, tevyUrl(slug, lod))); } catch (e) { console.warn(`[activity] ${slug} failed to load: ${(e as Error).message ?? e}`); }
    }));
  }

  private build() {
    // the freighter, its ramp and containers
    const fr = this.models.get('scifi-freighter')?.scene;
    if (fr) {
      const r = rig(fr, ['ramp', 'container_1', 'container_2', 'container_3', 'container_4', 'leg_FL', 'leg_FR', 'leg_RL', 'leg_RR']);
      r.root.scale.setScalar(M);
      // which way the ramp swings down, and which end of the ship it is on
      const ramp = r.parts.get('ramp');
      let rampSign = 1, rampAxisZ = -1;
      if (ramp) {
        rampAxisZ = Math.sign(ramp.pos.z) || -1;
        const box = new THREE.Box3().setFromObject(ramp.node);
        const centre = box.getCenter(new THREE.Vector3());
        ramp.node.parent!.worldToLocal(centre);
        // a positive rotation about X lowers a ramp whose body lies towards +Z of its hinge if it hangs below
        rampSign = (centre.z - ramp.pos.z) * rampAxisZ > 0 ? (rampAxisZ > 0 ? 1 : -1) : (rampAxisZ > 0 ? -1 : 1);
      }
      const cargo = ['container_1', 'container_2', 'container_3', 'container_4'].map((n) => r.parts.get(n)?.node).filter(Boolean) as THREE.Object3D[];
      this.freighter = { ...r, phase: -1, t: 0, rampSign, rampAxisZ, cargo };
      r.root.visible = false;
      this.group.add(r.root);
    }
    const fk = this.models.get('forklift')?.scene;
    if (fk) for (let i = 0; i < 2; i++) { const f = rig(fk, ['carriage', 'fork_L', 'fork_R']); f.root.scale.setScalar(M); f.root.position.set(DOCK.x - 4 + i * 6, 0.03, DOCK.z + 20); this.group.add(f.root); this.forklifts.push(f); }
    // two hangars with working blast doors for the fighters (the rest of the port's are static)
    const hg = this.models.get('scifi-hangar')?.scene;
    if (hg) for (const h of HANGARS) { const r = rig(hg, ['blast_door']); r.root.scale.setScalar(M); r.root.position.set(h.x - 14, 0, h.z); r.root.rotation.y = h.door; this.group.add(r.root); this.hangars.push(r); }
    // fighters: clones (their gear folds), half of each type
    const types = ['scifi-fighter', 'stealth-fighter'].map((s) => this.models.get(s)?.scene).filter(Boolean) as THREE.Object3D[];
    const n = this.quality === 'mobile' ? 4 : 8;
    for (let i = 0; i < n && types.length; i++) {
      const src = types[i % types.length];
      const root = src.clone(true);
      root.scale.setScalar(M);
      root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      const gear: THREE.Object3D[] = [];
      root.traverse((o) => { if (/^gear_(nose|main_[LR])$/.test(o.name)) gear.push(o); });
      this.group.add(root);
      this.fighters.push({ root, gear, state: 'patrol', t: 0, lap: hash(i * 3.3) * 2, hangar: i % HANGARS.length, phase: (i / n) * Math.PI * 2, r: 70 + (i % 3) * 22, h: 55 + (i % 4) * 9 });
    }
    // drones: instanced
    const dr = this.models.get('quad-rotor-recon-drone')?.scene;
    if (dr) { this.drones = instancedFrom(dr, this.quality === 'mobile' ? 24 : 48, { shadow: false }); this.drones.forEach((d) => this.group.add(d)); }
  }

  /** Update what the realm's state drives (call when the capital changes). */
  setActivity(a: Activity) {
    this.activity = a;
    // a tower crane beside each building site (up to four)
    const crane = this.models.get('tower-crane')?.scene;
    const want = a.sites.slice(0, 4);
    const key = (s: { x: number; z: number }) => `${s.x},${s.z}`;
    for (const c of [...this.cranes]) if (!want.some((s) => key(s) === key(c.site))) { this.group.remove(c.rig.root); this.cranes.splice(this.cranes.indexOf(c), 1); }
    if (crane) for (const s of want) if (!this.cranes.some((c) => key(c.site) === key(s))) {
      const r = rig(crane, ['slewing', 'trolley', 'hook_block', 'hoist_cable']);
      r.root.scale.setScalar(M * 0.55);
      r.root.position.set(s.x + 5.5, 0.3, s.z + 5.5);
      this.group.add(r.root);
      this.cranes.push({ rig: r, site: s });
    }
  }

  update(dt: number, time: number) {
    if (dt <= 0) return;
    this.updateFreighter(dt);
    this.updateFighters(dt, time);
    this.updateDrones(time);
    for (const c of this.cranes) {
      const sl = c.rig.parts.get('slewing'); if (sl) sl.node.rotation.y = sl.rot.y + Math.sin(time * 0.15 + c.site.x) * 1.4;
      const hk = c.rig.parts.get('hook_block'); if (hk) hk.node.position.y = hk.pos.y + (Math.sin(time * 0.4 + c.site.z) - 1) * 6;
      const tr = c.rig.parts.get('trolley'); if (tr) tr.node.position.z = tr.pos.z + Math.sin(time * 0.22) * 8;
    }
  }

  // ---------------------------------------------------------------- freighter

  private updateFreighter(dt: number) {
    const f = this.freighter;
    if (!f) return;
    const C = FREIGHTER_CYCLE;
    if (f.phase < 0) {
      // between visits: the next one sooner when the realm's industry is high
      this.freighterWait -= dt;
      if (this.freighterWait <= 0) { f.phase = 0; f.t = 0; f.root.visible = true; f.cargo.forEach((c, i) => { const p = f.parts.get(`container_${i + 1}`)!; c.position.copy(p.pos); c.visible = true; }); }
      return;
    }
    f.t += dt;
    const durations = [C.descend, C.legs, C.ramp, C.unload, C.close, C.climb];
    if (f.t >= durations[f.phase]) { f.t -= durations[f.phase]; f.phase++; }
    if (f.phase >= durations.length) {
      f.phase = -1; f.root.visible = false;
      this.freighterWait = Math.max(20, 70 - Math.min(50, this.activity.industry / 4));
      return;
    }
    const k = Math.min(1, f.t / durations[f.phase]);
    const ease = (x: number) => x * x * (3 - 2 * x);
    // flight: descend from high over the sea side to the dock; climb out the same way
    let y = 0, off = 0;
    if (f.phase === 0) { y = 70 * (1 - ease(k)); off = 90 * (1 - ease(k)); }
    if (f.phase === 5) { y = 70 * ease(k); off = -90 * ease(k); }
    f.root.position.set(DOCK.x - off, y + 0.05, DOCK.z);
    f.root.rotation.set(0, Math.PI / 2, 0); // nose east, ramp towards the yard side
    // legs: out for landing (from late descent until climbing away)
    const legs = f.phase === 0 ? Math.max(0, (k - 0.7) / 0.3) : f.phase === 5 ? 1 - Math.min(1, k * 3) : 1;
    for (const n of ['leg_FL', 'leg_FR', 'leg_RL', 'leg_RR']) { const p = f.parts.get(n); if (p) { p.node.position.y = p.pos.y + (1 - legs) * 1.2; } }
    // ramp: lowered while unloading
    const ramp = f.parts.get('ramp');
    const open = f.phase === 2 ? ease(k) : f.phase === 3 ? 1 : f.phase === 4 ? 1 - ease(k) : 0;
    if (ramp) ramp.node.rotation.x = ramp.rot.x + f.rampSign * open * 0.42;
    // containers roll down the ramp one by one; a forklift collects each and carries it to the yard
    if (f.phase === 3) {
      const slot = C.unload / 4;
      f.cargo.forEach((c, i) => {
        const p = f.parts.get(`container_${i + 1}`)!;
        const u = THREE.MathUtils.clamp((f.t - i * slot) / slot, 0, 1);
        const out = THREE.MathUtils.clamp(u / 0.45, 0, 1); // rolling out
        c.position.copy(p.pos);
        c.position.z = p.pos.z + f.rampAxisZ * out * (Math.abs(p.pos.z - (ramp?.pos.z ?? 0)) + 9);
        c.position.y = p.pos.y - out * Math.max(0, p.pos.y - 0.2);
        c.visible = u < 0.98;
        // the forklift picks it up once it is on the ground and drives it to the stacks
        const fl = this.forklifts[i % this.forklifts.length];
        if (fl && u > 0.45) {
          const carry = (u - 0.45) / 0.55;
          const wp = c.getWorldPosition(this.v);
          const yard = { x: DOCK.x - 4 + (i % 2) * 6, z: DOCK.z + 22 };
          const fx = THREE.MathUtils.lerp(wp.x, yard.x, carry), fz = THREE.MathUtils.lerp(wp.z, yard.z, carry);
          fl.root.position.set(fx, 0.03, fz);
          fl.root.rotation.y = Math.atan2(yard.x - wp.x, yard.z - wp.z);
          if (carry > 0) { c.visible = false; const fork = fl.parts.get('carriage'); if (fork) fork.node.position.y = fork.pos.y + 0.6; }
        }
      });
    }
  }

  // ---------------------------------------------------------------- fighters

  private updateFighters(dt: number, time: number) {
    const a = this.activity;
    const active = Math.max(2, Math.round(this.fighters.length * (0.35 + a.readiness * 0.65)));
    const speed = a.atWar ? 1.6 : 1;
    this.fighters.forEach((f, i) => {
      const flying = i < active;
      if (!flying && f.state === 'patrol') { f.state = 'land'; f.t = 0; }
      const h = HANGARS[f.hangar];
      const apron = { x: h.x - 30, z: h.z }, inside = { x: h.x - 14, z: h.z };
      if (f.state === 'patrol') {
        f.lap += dt * speed * (12 / f.r);
        const ang = f.phase + f.lap;
        f.root.position.set(Math.cos(ang) * f.r, f.h + Math.sin(time * 0.5 + i) * 2, Math.sin(ang) * f.r * 0.8);
        f.root.rotation.set(0, -ang + Math.PI, -0.35);
        this.setGear(f, 0);
        // a fighter comes home after a few laps (staggered), then another takes its place
        if (f.lap > 6 + (i % 3) * 2) { f.state = 'land'; f.t = 0; }
        return;
      }
      f.t += dt;
      if (f.state === 'land') {
        const k = Math.min(1, f.t / 12);
        const start = new THREE.Vector3(Math.cos(f.phase + f.lap) * f.r, f.h, Math.sin(f.phase + f.lap) * f.r * 0.8);
        f.root.position.lerpVectors(start, new THREE.Vector3(apron.x, 0, apron.z), k * k * (3 - 2 * k));
        f.root.position.y = f.h * (1 - k) ** 1.6;
        f.root.rotation.set(0, Math.atan2(apron.x - start.x, apron.z - start.z), 0);
        this.setGear(f, k > 0.6 ? 1 : 0);
        if (k >= 1) { f.state = 'taxi-in'; f.t = 0; }
      } else if (f.state === 'taxi-in') {
        const k = Math.min(1, f.t / 6);
        this.door(f.hangar, Math.min(1, f.t / 2));
        f.root.position.set(THREE.MathUtils.lerp(apron.x, inside.x, k), 0, apron.z);
        f.root.rotation.set(0, Math.PI / 2, 0);
        if (k >= 1) { f.state = 'stowed'; f.t = 0; f.root.visible = false; }
      } else if (f.state === 'stowed') {
        this.door(f.hangar, Math.max(0, 1 - f.t / 2));
        if (f.t > (flying ? 14 : 1e9)) { f.state = 'taxi-out'; f.t = 0; f.root.visible = true; }
      } else if (f.state === 'taxi-out') {
        const k = Math.min(1, f.t / 6);
        this.door(f.hangar, Math.min(1, f.t / 1.5));
        f.root.position.set(THREE.MathUtils.lerp(inside.x, apron.x - 20, k), 0, apron.z);
        f.root.rotation.set(0, -Math.PI / 2, 0);
        this.setGear(f, 1);
        if (k >= 1) { f.state = 'climb'; f.t = 0; }
      } else if (f.state === 'climb') {
        const k = Math.min(1, f.t / 10);
        this.door(f.hangar, Math.max(0, 1 - f.t / 2));
        f.root.position.set(apron.x - 20 - k * 80, f.h * k * k, apron.z + k * 30);
        f.root.rotation.set(-0.25 * (1 - k), -Math.PI / 2, 0);
        this.setGear(f, k < 0.3 ? 1 : 0);
        if (k >= 1) { f.state = 'patrol'; f.lap = Math.atan2(f.root.position.z / 0.8, f.root.position.x) - f.phase; f.lap = ((f.lap % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2); }
      }
    });
  }

  private setGear(f: { gear: THREE.Object3D[] }, down: number) { for (const g of f.gear) g.visible = down > 0.5; }
  private door(i: number, open: number) {
    const d = this.hangars[i]?.parts.get('blast_door');
    if (d) d.node.position.y = d.pos.y + open * 9; // the door rises into the lintel
  }

  // ---------------------------------------------------------------- drones

  private updateDrones(time: number) {
    if (!this.drones.length) return;
    const n = this.drones[0].count;
    const sites = this.activity.sites.length ? this.activity.sites : [];
    const ind = OUTER_ZONES.industry;
    const home = { x: (ind.x0 + ind.x1) / 2, z: (ind.z0 + ind.z1) / 2 };
    const active = Math.min(n, sites.length ? 8 + sites.length * 10 : 6);
    for (let i = 0; i < n; i++) {
      let x = 0, y = -50, z = 0, ry = 0;
      if (i < active) {
        const site = sites.length ? sites[i % sites.length] : { x: home.x - 20, z: home.z };
        const period = 40;
        const u = ((time + hash(i * 2.1) * period) % period) / period;
        // out to the site (35%), circle it (30%), back home (35%)
        const ang = i * 2.399 + time * 0.8;
        const ring = { x: site.x + Math.cos(ang) * 6, z: site.z + Math.sin(ang) * 6 };
        if (u < 0.35) { const k = u / 0.35; x = THREE.MathUtils.lerp(home.x, ring.x, k); z = THREE.MathUtils.lerp(home.z, ring.z, k); y = 18 + Math.sin(k * Math.PI) * 14; ry = Math.atan2(ring.x - home.x, ring.z - home.z); }
        else if (u < 0.65) { x = ring.x; z = ring.z; y = 12 + Math.sin(time * 2 + i) * 1.5; ry = -ang; }
        else { const k = (u - 0.65) / 0.35; x = THREE.MathUtils.lerp(ring.x, home.x, k); z = THREE.MathUtils.lerp(ring.z, home.z, k); y = 18 + Math.sin(k * Math.PI) * 14; ry = Math.atan2(home.x - ring.x, home.z - ring.z); }
      }
      this.m4.compose(this.v.set(x, y, z), this.q.setFromEuler(this.e.set(0, ry, 0)), this.s3.setScalar(i < active ? M * 1.6 : 0));
      for (const d of this.drones) d.setMatrixAt(i, this.m4);
    }
    for (const d of this.drones) d.instanceMatrix.needsUpdate = true;
  }

  stats() {
    return {
      freighter: this.freighter ? (this.freighter.phase < 0 ? 'away' : ['descending', 'landing', 'ramp down', 'unloading', 'ramp up', 'departing'][this.freighter.phase]) : 'none',
      fighters: this.fighters.filter((f) => f.state === 'patrol').length,
      landing: this.fighters.filter((f) => f.state !== 'patrol' && f.state !== 'stowed').length,
      drones: Math.min(this.drones[0]?.count ?? 0, this.activity.sites.length ? 8 + this.activity.sites.length * 10 : 6),
      cranes: this.cranes.length,
    };
  }

  dispose() {
    this.disposed = true;
    disposeObject(this.group);
    for (const g of this.models.values()) disposeObject(g.scene);
    void this.slots;
  }
}
