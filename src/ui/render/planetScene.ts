// Planet view: one world filling the screen in 3D, with its moons, any orbital
// station, the host star's light and a nebula sky. The last step of the
// galaxy → sector → system → planet navigation.

import * as THREE from 'three';
import { STAR_TYPES } from '../../sim/data/planets';
import type { GameState, Planet } from '../../sim/types';
import { buildPlanet, type PlanetBuild } from './planet3d';
import { releaseView } from './assets/release';
import { worldLook, worldLookKey } from './worldLook';
import { civStyle, type CivStyle } from './civStyle';

export const planetCam = { yaw: 0.5, pitch: 0.18, dist: 5.2 };

export class PlanetView3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(36, 1, 0.05, 2000);
  private key = '';
  private main: PlanetBuild | null = null;
  private moons: { b: PlanetBuild; r: number; phase: number; speed: number; size: number }[] = [];
  private station: THREE.Object3D | null = null;
  /** orbital infrastructure and traffic (from the world's buildings, queues and merchant routes) */
  private orbitals: { obj: THREE.Object3D; r: number; phase: number; speed: number; tilt: number; y: number }[] = [];
  private traffic: { pts: THREE.Points; n: number } | null = null;
  private convoys: { obj: THREE.Object3D; dir: THREE.Vector3; phase: number; period: number }[] = [];
  private scaffold: THREE.Object3D | null = null;
  private hull: THREE.Object3D | null = null;
  private disposables: { dispose(): void }[] = [];

  private maxDpr: number;
  constructor(canvas: HTMLCanvasElement, q: { antialias: boolean; maxDpr: number } = { antialias: true, maxDpr: 2 }) {
    this.maxDpr = q.maxDpr;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x020305, 1);
  }

  private build(state: GameState, p: Planet) {
    this.main?.dispose();
    for (const m of this.moons) m.b.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = []; this.moons = []; this.station = null; this.orbitals = []; this.traffic = null; this.convoys = []; this.scaffold = null; this.hull = null;
    this.scene.clear();
    const sys = state.galaxy.systems[p.systemId];
    // stars
    const N = 3000, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, k = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * k * 800, u * 800, Math.sin(a) * k * 800], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sm = new THREE.PointsMaterial({ size: 1.4, sizeAttenuation: false, color: 0xbfc8d6 });
    this.scene.add(new THREE.Points(sg, sm));
    this.disposables.push(sg, sm);
    // the star itself, far away
    const glowC = document.createElement('canvas'); glowC.width = glowC.height = 128;
    const gx = glowC.getContext('2d')!; const gr = gx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    gx.fillStyle = gr; gx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(glowC);
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(STAR_TYPES[sys.star].glow), blending: THREE.AdditiveBlending, depthWrite: false }));
    sun.scale.setScalar(60);
    sun.position.set(-420, 120, 260);
    this.scene.add(sun);
    this.disposables.push(tex, sun.material);
    this.main = buildPlanet(p.type, p.id * 7919 + 13, worldLook(state, p), true);
    if (p.type === 'gas_giant') this.main.group.scale.setScalar(1.3);
    this.scene.add(this.main.group);
    const moons = state.planets.filter((m) => m.moonOf === p.id);
    moons.forEach((m, k) => {
      const b = buildPlanet(m.type, m.id * 7919 + 13, m.colony ? 0.5 : 0, true);
      const size = 0.18 + m.size * 0.008;
      b.group.scale.setScalar(size);
      this.scene.add(b.group);
      this.moons.push({ b, r: 2.4 + k * 0.9, phase: k * 2.1, speed: 0.00012 / (k + 1), size });
    });
    if (p.station || p.colony) {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x9aa6b4, metalness: 0.7, roughness: 0.35, emissive: 0x112233 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 32), mat);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.28, 12), mat);
      hub.rotation.x = Math.PI / 2;
      g.add(ring, hub);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), new THREE.MeshBasicMaterial({ color: p.colony ? 0xffcf7a : 0x74c7de }));
      lamp.position.set(0.16, 0, 0);
      g.add(lamp);
      g.scale.setScalar(0.55);
      this.scene.add(g);
      this.station = g;
      this.disposables.push(mat, ring.geometry, hub.geometry, lamp.geometry, lamp.material as THREE.Material);
    }
    if (p.colony) this.buildInfrastructure(state, p);
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.copy(sun.position);
    this.scene.add(light, new THREE.AmbientLight(0x223344, 0.4));
  }

  /** Shipyards, defence platforms, shields, construction and traffic, each from the world's real state. */
  private buildInfrastructure(state: GameState, p: Planet) {
    const c = p.colony!;
    const e = state.empires[c.ownerId];
    const style: CivStyle = civStyle(e);
    const tint = new THREE.Color(e?.color ?? '#999');
    const metal = new THREE.MeshStandardMaterial({ color: 0x8e98a6, metalness: 0.75, roughness: 0.4, emissive: tint.clone().multiplyScalar(0.12) });
    const glow = new THREE.MeshBasicMaterial({ color: 0xffd08a });
    this.disposables.push(metal, glow);
    const geo = <T extends THREE.BufferGeometry>(g: T) => { this.disposables.push(g); return g; };
    const b = c.buildings;
    // shipyards: a lattice dock per yard, with a hull growing in it while ships are under construction
    const yards = b.shipyard ?? 0;
    for (let k = 0; k < Math.min(3, yards); k++) {
      const dock = new THREE.Group();
      const frame = new THREE.LineSegments(geo(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.42, 0.12, 0.16))), new THREE.LineBasicMaterial({ color: tint.clone().lerp(new THREE.Color(0xffffff), 0.4) }));
      this.disposables.push(frame.material as THREE.Material);
      dock.add(frame);
      if (k === 0 && c.shipQueue.length) {
        const item = c.shipQueue[0];
        const hull = new THREE.Mesh(geo(style === 'industrial' ? new THREE.BoxGeometry(0.34, 0.06, 0.08) : style === 'organic' ? new THREE.CapsuleGeometry(0.04, 0.26, 4, 8) : new THREE.ConeGeometry(0.05, 0.34, style === 'crystalline' ? 4 : 6)), metal);
        if (style !== 'industrial') hull.rotation.z = Math.PI / 2;
        hull.scale.x = 0.2 + 0.8 * Math.min(1, item.progress / Math.max(1, item.total));
        dock.add(hull);
        this.hull = hull;
      }
      dock.scale.setScalar(0.9);
      this.scene.add(dock);
      this.orbitals.push({ obj: dock, r: 1.75 + k * 0.18, phase: k * 2.1, speed: 0.00018, tilt: 0.25, y: 0.3 });
    }
    // defence platforms ring the world
    const def = Math.min(8, (b.orbital_defense ?? 0) * 2);
    const pg = geo(style === 'crystalline' ? new THREE.OctahedronGeometry(0.05) : style === 'organic' ? new THREE.SphereGeometry(0.045, 10, 8) : new THREE.BoxGeometry(0.08, 0.03, 0.08));
    for (let k = 0; k < def; k++) {
      const m = new THREE.Mesh(pg, metal);
      m.scale.setScalar(1.5);
      this.scene.add(m);
      this.orbitals.push({ obj: m, r: 1.38, phase: (k / def) * Math.PI * 2, speed: 0.0003, tilt: -0.5, y: 0 });
    }
    // a planetary shield shimmers over a shielded world
    if (b.planetary_shield) {
      const sh = new THREE.Mesh(geo(new THREE.SphereGeometry(1.05, 48, 32)), new THREE.MeshBasicMaterial({ color: 0x6fc6ff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.disposables.push(sh.material as THREE.Material);
      if (p.type === 'gas_giant') sh.scale.setScalar(1.3);
      this.scene.add(sh);
    }
    // construction under way on the surface: scaffolding rings in low orbit
    if (c.queue.length) {
      const sc = new THREE.LineSegments(geo(new THREE.EdgesGeometry(new THREE.TorusGeometry(1.12, 0.012, 3, 24, Math.PI * 0.6))), new THREE.LineBasicMaterial({ color: 0xe8c77a, transparent: true, opacity: 0.8 }));
      this.disposables.push(sc.material as THREE.Material);
      this.scene.add(sc);
      this.scaffold = sc;
    }
    // orbital traffic: shuttles in proportion to the population and the world's trade
    const routes = (state.life?.routes ?? []).filter((r) => r.from === p.id || r.to === p.id);
    const n = Math.min(160, Math.round(c.pops * 1.2 + routes.length * 8));
    if (n > 0) {
      const pos = new Float32Array(n * 3);
      const tg = geo(new THREE.BufferGeometry());
      tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const tm = new THREE.PointsMaterial({ size: 2.6, sizeAttenuation: false, color: 0xffe9c4, transparent: true, opacity: 0.95 });
      this.disposables.push(tm);
      const pts = new THREE.Points(tg, tm);
      this.scene.add(pts);
      this.traffic = { pts, n };
    }
    // convoys of the world's merchant routes arrive and depart
    for (const [k, r] of routes.entries()) {
      const out = r.from === p.id;
      const ship = new THREE.Mesh(geo(new THREE.ConeGeometry(0.018, 0.07, 5)), r.status === 'blockaded' || r.status === 'severed' ? new THREE.MeshBasicMaterial({ color: 0xe2543f }) : glow);
      if (ship.material !== glow) this.disposables.push(ship.material as THREE.Material);
      this.scene.add(ship);
      const a = (r.id % 628) / 100, el = ((r.id * 7) % 100) / 300 - 0.15;
      this.convoys.push({ obj: ship, dir: new THREE.Vector3(Math.cos(a), el, Math.sin(a)).normalize().multiplyScalar(out ? 1 : -1), phase: k * 0.37, period: r.status === 'blockaded' || r.status === 'severed' ? 0 : 14000 + (r.id % 7) * 1500 });
    }
  }

  frame(state: GameState, p: Planet, w: number, h: number, dpr: number, time: number) {
    const c = p.colony;
    const routes = c ? (state.life?.routes ?? []).filter((r) => r.from === p.id || r.to === p.id).map((r) => r.status[0]).join('') : '';
    const key = `${p.id}:${c ? `${worldLookKey(state, p)}:${Math.round(c.pops / 5)}:${c.buildings.shipyard ?? 0}:${c.buildings.orbital_defense ?? 0}:${c.buildings.planetary_shield ?? 0}:${c.queue.length > 0}:${c.shipQueue.length > 0}:${routes}` : -1}:${p.station}`;
    if (key !== this.key) { this.key = key; this.build(state, p); }
    const pr = Math.min(dpr, this.maxDpr);
    if (this.renderer.getPixelRatio() !== pr) this.renderer.setPixelRatio(pr);
    const cv = this.renderer.domElement;
    if (cv.width !== Math.round(w * pr) || cv.height !== Math.round(h * pr)) this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const { yaw, pitch, dist } = planetCam;
    this.camera.position.set(Math.cos(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.sin(yaw) * Math.cos(pitch) * dist);
    this.camera.lookAt(0, 0, 0);
    const L = new THREE.Vector3(-420, 120, 260).normalize();
    this.main!.setLight(L);
    this.main!.setTime(time * 1.5);
    for (const m of this.moons) {
      const a = m.phase + time * m.speed;
      m.b.group.position.set(Math.cos(a) * m.r, Math.sin(a * 0.7) * 0.25, Math.sin(a) * m.r);
      m.b.setLight(L.clone().multiplyScalar(500).sub(m.b.group.position).normalize());
      m.b.setTime(time);
    }
    if (this.station) {
      const a = time * 0.00025;
      this.station.position.set(Math.cos(a) * 1.6, 0.45, Math.sin(a) * 1.6);
      this.station.rotation.y = a * 3;
    }
    for (const o of this.orbitals) {
      const a = o.phase + time * o.speed;
      o.obj.position.set(Math.cos(a) * o.r, o.y + Math.sin(a) * o.r * Math.sin(o.tilt), Math.sin(a) * o.r * Math.cos(o.tilt));
      o.obj.rotation.y = -a;
    }
    if (this.hull && p.colony?.shipQueue[0]) {
      const it = p.colony.shipQueue[0];
      this.hull.scale.x = 0.2 + 0.8 * Math.min(1, it.progress / Math.max(1, it.total));
    }
    if (this.scaffold) { this.scaffold.rotation.y = time * 0.0002; this.scaffold.rotation.x = 0.4; }
    if (this.traffic) {
      const arr = (this.traffic.pts.geometry.getAttribute('position') as THREE.BufferAttribute);
      for (let i = 0; i < this.traffic.n; i++) {
        const r = 1.12 + ((i * 37) % 50) / 120;
        const sp = 0.0004 + ((i * 13) % 17) / 40000;
        const a = i * 2.39996 + time * sp;
        const inc = ((i * 53) % 90) / 90 - 0.5;
        arr.setXYZ(i, Math.cos(a) * r, Math.sin(a) * r * inc, Math.sin(a) * r * Math.sqrt(1 - inc * inc));
      }
      arr.needsUpdate = true;
    }
    for (const cv of this.convoys) {
      // exports climb from orbit out to deep space; imports come in from deep space to orbit; held at the dock while the lane is cut
      const axis = cv.dir.clone().normalize();
      const out = cv.dir.x * axis.x + cv.dir.y * axis.y + cv.dir.z * axis.z > 0;
      const orbitP = axis.clone().multiplyScalar(out ? 1.5 : -1.5), farP = axis.clone().multiplyScalar(out ? 3.4 : -3.4);
      const u = cv.period ? ((time / cv.period + cv.phase) % 1) : 0;
      const pos = !cv.period ? orbitP.clone().multiplyScalar(1.02) : out ? orbitP.clone().lerp(farP, u) : farP.clone().lerp(orbitP, u);
      const heading = out ? farP.clone().sub(orbitP) : orbitP.clone().sub(farP);
      cv.obj.position.copy(pos);
      cv.obj.lookAt(pos.clone().add(heading));
      cv.obj.rotateX(Math.PI / 2);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.main?.dispose();
    for (const m of this.moons) m.b.dispose();
    for (const d of this.disposables) d.dispose();
    releaseView(this.scene, this.renderer);
  }
}
