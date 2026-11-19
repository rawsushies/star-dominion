// 3D battle replay. Drives a scene from a recorded BattleReport (the
// simulation's own record: per-ship hull per round and every shot), so the
// presentation never influences the outcome. Ships are the catalogued hull
// models in facing formations; weapons are drawn as beams, torpedoes and
// strike craft by role; hits flash shields, kills explode into debris.

import * as THREE from 'three';
import { SHIPS, SIZE_WEIGHT } from '../../sim/data/ships';
import type { BattleReport, BattleShipSnap, GameState } from '../../sim/types';
import { SHIP_MODELS, type AssetId } from './assets/catalog';
import { instance, normalised, preload } from './assets/loader';

const STRUCT_ASSETS: AssetId[] = ['truss', 'dish_l', 'turret2', 'pad'];
export const BATTLE_ASSETS: AssetId[] = [...new Set([...Object.values(SHIP_MODELS).map((m) => m.asset), ...STRUCT_ASSETS])];

type Weapon = 'beam' | 'heavy' | 'torpedo' | 'craft' | 'battery';
function weaponOf(s: BattleShipSnap): Weapon {
  if (s.id < 0) return (-s.id) % 10 === 2 ? 'battery' : 'heavy';
  const role = SHIPS[s.cls].role;
  if (role.startsWith('Torpedo')) return 'torpedo';
  if (role.startsWith('Strike craft')) return 'craft';
  if (SHIPS[s.cls].size === 'L' || SHIPS[s.cls].size === 'XL') return 'heavy';
  return 'beam';
}

interface Unit { snap: BattleShipSnap; obj: THREE.Group; home: THREE.Vector3; radius: number; color: THREE.Color; dead: boolean; deathRound: number }
interface Fx { kind: 'beam' | 'proj' | 'flash' | 'shield' | 'boom' | 'debris'; obj: THREE.Object3D; t0: number; dur: number; from?: THREE.Vector3; to?: THREE.Vector3; arc?: number; vel?: THREE.Vector3[] }

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class BattleView3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
  cam = { yaw: 0.35, pitch: 0.38, dist: 19 };
  private units = new Map<number, Unit>();
  private fx: Fx[] = [];
  private world = new THREE.Group();
  private glow = glowTexture();
  private report: BattleReport | null = null;
  private colors: [string, string] = ['#58a6ff', '#ff6a5a'];
  private lastRound = -1;
  private time = 0; // battle time in rounds
  private raf = 0;
  private disposed = false;
  ready = false;
  /** shots fired so far, for tests */
  shotsShown = 0;
  kills = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.backdrop();
    this.scene.add(this.world);
    let down: { x: number; y: number; yaw: number; pitch: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, yaw: this.cam.yaw, pitch: this.cam.pitch }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (!down) return; this.cam.yaw = down.yaw - (e.clientX - down.x) * 0.006; this.cam.pitch = Math.max(0.05, Math.min(1.3, down.pitch + (e.clientY - down.y) * 0.004)); });
    canvas.addEventListener('pointerup', () => { down = null; });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.cam.dist = Math.max(10, Math.min(60, this.cam.dist * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
    const loop = (t: number) => { if (this.disposed) return; this.frame(t); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  private backdrop() {
    const s = this.scene;
    s.background = new THREE.Color(0x03050a);
    const n = 1500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 180 + Math.random() * 60, k = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * k * r, u * r, Math.sin(a) * k * r], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    s.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfd8ea, size: 0.6, sizeAttenuation: true })));
    // a planet below the battle and a distant star as key light
    const planet = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 32), new THREE.MeshStandardMaterial({ color: 0x3a5f8a, roughness: 0.9 }));
    planet.position.set(-45, -80, -95);
    s.add(planet);
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(41.5, 48, 32), new THREE.MeshBasicMaterial({ color: 0x6fb4ff, transparent: true, opacity: 0.12, side: THREE.BackSide }));
    atmo.position.copy(planet.position);
    s.add(atmo);
    s.add(new THREE.AmbientLight(0x7f8fb0, 0.7));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    sun.position.set(40, 30, 20);
    s.add(sun);
    const rim = new THREE.DirectionalLight(0x5f7fff, 0.8);
    rim.position.set(-30, 10, -40);
    s.add(rim);
    const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: 0xfff1c8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    star.position.set(120, 80, 60); star.scale.setScalar(40);
    s.add(star);
  }

  /** Load a battle: build both formations from the report. Resolves once models are ready. */
  async load(g: GameState, b: BattleReport) {
    this.report = b;
    this.colors = [g.empires[b.sides[0][0]]?.color ?? '#58a6ff', g.empires[b.sides[1][0]]?.color ?? '#ff6a5a'];
    await preload(BATTLE_ASSETS);
    if (this.disposed || this.report !== b) return;
    this.world.clear();
    this.units.clear();
    this.fx = [];
    for (const side of [0, 1] as const) {
      const ships = b.ships.filter((s) => s.side === side).sort((a, c) => this.weight(c) - this.weight(a));
      // heaviest at the back-centre, escorts fan out ahead
      ships.forEach((s, i) => {
        const obj = this.model(s);
        const row = Math.floor(Math.sqrt(i));
        const inRow = i - row * row, perRow = row * 2 + 1;
        const dir = side === 0 ? -1 : 1;
        const x = dir * (12 - row * 2.4);
        const z = (inRow - (perRow - 1) / 2) * 2.2;
        const y = ((i * 7) % 5 - 2) * 0.35;
        obj.position.set(x, y, z);
        obj.rotation.y = side === 0 ? -Math.PI / 2 : Math.PI / 2;
        this.world.add(obj);
        const box = new THREE.Box3().setFromObject(obj);
        const radius = box.getSize(new THREE.Vector3()).length() / 2;
        // engine glow behind the hull
        if (s.id >= 0) {
          const eg = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: new THREE.Color(this.colors[side]).lerp(new THREE.Color(0x9fdcff), 0.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
          eg.scale.setScalar(radius * 0.9);
          eg.position.set(x + dir * radius * 0.9, y, z);
          eg.userData.engineOf = s.id;
          this.world.add(eg);
        }
        this.units.set(s.id, { snap: s, obj, home: obj.position.clone(), radius, color: new THREE.Color(this.colors[side]), dead: false, deathRound: s.hp.findIndex((h) => h <= 0) });
      });
    }
    this.lastRound = -1;
    this.shotsShown = 0;
    this.kills = 0;
    this.ready = true;
  }

  private weight(s: BattleShipSnap): number {
    return s.id < 0 ? 10 : SIZE_WEIGHT[SHIPS[s.cls].size] ?? 1;
  }

  private model(s: BattleShipSnap): THREE.Group {
    if (s.id < 0) {
      // starbase or planetary batteries, assembled from sourced structure parts
      const g = new THREE.Group();
      const battery = (-s.id) % 10 === 2;
      const parts: [AssetId, number, number, number][] = battery ? [['pad', 3.2, 0, 0], ['turret2', 1.4, 0.8, 0.6], ['turret2', 1.4, -0.8, -0.6]] : [['truss', 2.4, 0, 0], ['dish_l', 1.3, 0, 1.2], ['turret2', 0.9, 1.2, -1]];
      for (const [id, h, x, z] of parts) {
        const o = instance(id);
        if (!o) continue;
        const n = normalised(o, { height: h, maxFoot: 3.5 });
        n.position.set(x, -1, z);
        g.add(n);
      }
      return g;
    }
    const m = SHIP_MODELS[s.cls];
    const o = instance(m.asset);
    const wrap = new THREE.Group();
    if (o) {
      const n = normalised(o, { length: m.length * 1.25 });
      n.position.y = -0.2 * m.length;
      wrap.add(n);
      // keep per-unit materials so damage tinting does not leak to other ships
      n.traverse((c) => { const mesh = c as THREE.Mesh; if (mesh.isMesh) mesh.material = (mesh.material as THREE.MeshStandardMaterial).clone(); });
    }
    return wrap;
  }

  /** Set the replay position in rounds (fractional). Effects for each new round are spawned once. */
  setTime(t: number) {
    if (!this.report || !this.ready) return;
    const r = Math.floor(t);
    if (t < this.time - 0.01) this.reset();
    while (this.lastRound < r) { this.lastRound++; this.spawnRound(this.lastRound); }
    this.time = t;
    // hull state, destruction
    for (const u of this.units.values()) {
      const hp = u.snap.hp[Math.min(r, u.snap.hp.length - 1)] ?? 1;
      const killedNow = hp <= 0 && t >= (u.deathRound < 0 ? Infinity : u.deathRound + 0.6);
      if (killedNow && !u.dead) { u.dead = true; this.kills++; this.explode(u); }
      if (!killedNow && u.dead) u.dead = false;
      u.obj.visible = !u.dead;
      for (const c of this.world.children) if (c.userData.engineOf === u.snap.id) c.visible = !u.dead;
      // damaged hulls darken and glow red
      u.obj.traverse((c) => {
        const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && 'emissive' in m) { m.emissive.setRGB((1 - hp) * 0.35, (1 - hp) * 0.05, 0); m.color.setScalar(0.45 + 0.55 * Math.max(0.2, hp)); }
      });
    }
  }

  private reset() {
    for (const f of this.fx) this.world.remove(f.obj);
    this.fx = [];
    this.lastRound = -1;
    for (const u of this.units.values()) u.dead = false;
  }

  private spawnRound(r: number) {
    const shots = this.report!.shots.filter((s) => s.r === r);
    shots.forEach((sh, i) => {
      const a = this.units.get(sh.from), b = this.units.get(sh.to);
      if (!a || !b) return;
      const t0 = r + (i / Math.max(1, shots.length)) * 0.55;
      const from = a.home.clone(), to = b.home.clone().add(new THREE.Vector3((Math.random() - 0.5) * b.radius * 0.6, (Math.random() - 0.5) * b.radius * 0.4, (Math.random() - 0.5) * b.radius * 0.6));
      const w = weaponOf(a.snap);
      const col = a.color.clone().lerp(new THREE.Color(0xffffff), 0.35);
      if (w === 'beam' || w === 'heavy' || w === 'battery') {
        const width = w === 'heavy' ? 0.09 : w === 'battery' ? 0.07 : 0.04;
        const len = from.distanceTo(to);
        const geo = new THREE.CylinderGeometry(width, width, len, 6, 1, true);
        geo.rotateX(Math.PI / 2);
        const beam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
        beam.position.copy(from).lerp(to, 0.5);
        beam.lookAt(to);
        this.world.add(beam);
        this.fx.push({ kind: 'beam', obj: beam, t0, dur: 0.18 });
      } else {
        const n = w === 'craft' ? 3 : 1;
        for (let k = 0; k < n; k++) {
          const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: w === 'torpedo' ? 0xffb860 : col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
          p.scale.setScalar(w === 'torpedo' ? 0.55 : 0.35);
          p.visible = false;
          this.world.add(p);
          this.fx.push({ kind: 'proj', obj: p, t0: t0 + k * 0.04, dur: w === 'craft' ? 0.45 : 0.35, from, to, arc: (w === 'craft' ? 2.5 : 1.2) * (k % 2 ? -1 : 1) });
        }
      }
      // impact: shields absorb while the hull holds, flashes when it breaks through
      const impactT = t0 + (w === 'beam' || w === 'heavy' || w === 'battery' ? 0.05 : 0.35);
      const hpAfter = b.snap.hp[Math.min(r, b.snap.hp.length - 1)] ?? 1;
      if (hpAfter > 0.55) {
        const sh2 = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.6, b.radius * 0.75), 20, 14), new THREE.MeshBasicMaterial({ color: b.color.clone().lerp(new THREE.Color(0x9fdcff), 0.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
        sh2.position.copy(b.home);
        this.world.add(sh2);
        this.fx.push({ kind: 'shield', obj: sh2, t0: impactT, dur: 0.22 });
      }
      const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: 0xffe0a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      fl.position.copy(to);
      fl.scale.setScalar(0.6 + Math.min(1.4, sh.dmg / 60));
      this.world.add(fl);
      this.fx.push({ kind: 'flash', obj: fl, t0: impactT, dur: 0.15 });
      this.shotsShown++;
    });
  }

  private explode(u: Unit) {
    const t0 = this.time;
    const boom = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: 0xffa040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    boom.position.copy(u.home);
    this.world.add(boom);
    this.fx.push({ kind: 'boom', obj: boom, t0, dur: 0.7 });
    const n = 26, pos = new Float32Array(n * 3), vel: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) { pos.set([u.home.x, u.home.y, u.home.z], i * 3); vel.push(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(1.5 + Math.random() * 2.5 * u.radius)); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const debris = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffc080, size: 0.18, transparent: true }));
    this.world.add(debris);
    this.fx.push({ kind: 'debris', obj: debris, t0, dur: 1.2, from: u.home.clone(), vel });
  }

  private frame(ms: number) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    const sz = this.renderer.getSize(new THREE.Vector2());
    if (sz.x !== w || sz.y !== h) { this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    const { yaw, pitch, dist } = this.cam;
    this.camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
    this.camera.lookAt(0, 0, 0);
    // idle drift so the fleets feel alive
    for (const u of this.units.values()) {
      u.obj.position.y = u.home.y + Math.sin(ms / 900 + u.snap.id) * 0.05;
      u.obj.rotation.z = Math.sin(ms / 1400 + u.snap.id) * 0.03;
    }
    const t = this.time;
    for (const f of this.fx) {
      const k = (t - f.t0) / f.dur;
      const on = k >= 0 && k <= 1;
      f.obj.visible = on;
      if (!on) continue;
      const mat = (f.obj as THREE.Mesh).material as THREE.Material & { opacity: number };
      if (f.kind === 'beam') mat.opacity = Math.sin(k * Math.PI) * 0.95;
      else if (f.kind === 'flash') { mat.opacity = 1 - k; }
      else if (f.kind === 'shield') mat.opacity = (1 - k) * 0.35;
      else if (f.kind === 'boom') { f.obj.scale.setScalar(1 + k * 6); mat.opacity = 1 - k; }
      else if (f.kind === 'proj') {
        const p = f.from!.clone().lerp(f.to!, k);
        p.y += Math.sin(k * Math.PI) * f.arc!;
        f.obj.position.copy(p);
      } else if (f.kind === 'debris') {
        const attr = (f.obj as THREE.Points).geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < f.vel!.length; i++) attr.setXYZ(i, f.from!.x + f.vel![i].x * k, f.from!.y + f.vel![i].y * k, f.from!.z + f.vel![i].z * k);
        attr.needsUpdate = true;
        mat.opacity = 1 - k;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }
}
