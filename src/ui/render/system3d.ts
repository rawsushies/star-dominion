// 3D star-system view (Three.js). The star, planets, moons, belts, starbase and
// megastructures live in a real perspective scene the player can orbit and zoom.
// Names, ownership rings and the fleet roster are drawn on a 2D overlay canvas
// from projected positions, and the same projection yields click targets.

import * as THREE from 'three';
import { STAR_TYPES } from '../../sim/data/planets';
import { SHIPS } from '../../sim/data/ships';
import { visibleSystems } from '../../sim/territory';
import { fleetPower } from '../../sim/fleets';
import { SHIP_MODELS } from './assets/catalog';
import { instance, normalised, preload } from './assets/loader';
import type { Fleet, ShipClass } from '../../sim/types';

const SHIP_ASSETS = [...new Set(Object.values(SHIP_MODELS).map((m) => m.asset))];
const SIZE_ORDER: ShipClass[] = ['dreadnought', 'carrier', 'battleship', 'battlecruiser', 'cruiser', 'logistics', 'transport', 'destroyer', 'colony', 'frigate', 'constructor', 'corvette', 'scout'];

/** A fleet as a wedge of its real hulls: the biggest ship leads, the rest fall in behind. */
export function buildFleetFormation(f: Fleet, color: string, scale = 0.85, maxShown = 14): THREE.Group | null {
  const g = new THREE.Group();
  const ships = f.ships.slice().sort((a, b) => SIZE_ORDER.indexOf(a.cls) - SIZE_ORDER.indexOf(b.cls)).slice(0, maxShown);
  let row = 0, inRow = 0, perRow = 1, z = 0, maxLen = 0;
  for (const sh of ships) {
    const m = SHIP_MODELS[sh.cls];
    const o = instance(m.asset);
    if (!o) return null;
    const n = normalised(o, { length: m.length * scale });
    // centre vertically
    n.position.y = -0.05 * m.length * scale;
    const len = m.length * scale;
    maxLen = Math.max(maxLen, len);
    const x = (inRow - (perRow - 1) / 2) * maxLen * 0.95;
    n.position.x = x; n.position.z = z;
    g.add(n);
    inRow++;
    if (inRow >= perRow) { row++; inRow = 0; perRow = Math.min(5, perRow + 1); z += maxLen * 0.9; }
  }
  // a faint ring in the owner's colour marks whose fleet it is
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  ring.scale.setScalar(Math.max(size.x, size.z) * 0.62 + 0.2);
  ring.position.set(ctr.x, 0, ctr.z);
  g.add(ring);
  void row;
  return g;
}
import { hash2 } from '../../sim/rng';
import type { GameState, Planet, StarSystem } from '../../sim/types';
import { buildPlanet, hexA, NOISE_GLSL, type PlanetBuild } from './planet3d';
import { worldLook, worldLookKey } from './worldLook';
import { convoyPositions } from '../../sim/life';
import { routeIndexAt } from './galaxyLife';
import { civStyle, drawShip } from './civStyle';
import { simClock } from '../store';
import { releaseView } from './assets/release';
import { SystemMegastructures } from './megastructures3d';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface SysHit { kind: 'planet' | 'fleet' | 'starbase'; id: number; x: number; y: number; r: number }

/** Orbit camera, driven by MapView's pointer handlers. */
export const orbitCam = { theta: 0.6, phi: 1.05, dist: 40, auto: true };

const STAR_FRAG = /* glsl */ `
uniform vec3 uCol; uniform vec3 uHot; uniform float uT;
varying vec3 vPos; varying vec3 vN; varying vec3 vV;
${NOISE_GLSL}
void main(){
  vec3 p = normalize(vPos);
  float g = fbm(p*5.0 + vec3(uT*0.02, 0.0, uT*0.015), 5);
  float cells = fbm(p*18.0 - vec3(0.0, uT*0.03, 0.0), 3);
  float mu = max(dot(normalize(vN), normalize(vV)), 0.0);
  vec3 c = mix(uCol, uHot, g*0.7 + cells*0.3);
  c *= 0.55 + 0.75*pow(mu, 0.45);       // limb darkening
  c += uHot * smoothstep(0.75, 1.0, g) * 0.6;
  gl_FragColor = vec4(c * 1.25, 1.0);
}`;
const STAR_VERT = /* glsl */ `
varying vec3 vPos; varying vec3 vN; varying vec3 vV;
void main(){ vPos = position; vec4 wp = modelMatrix*vec4(position,1.0); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition-wp.xyz); gl_Position = projectionMatrix*viewMatrix*wp; }`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uA; uniform vec3 uB; uniform vec3 uSeed;
varying vec3 vDir;
${NOISE_GLSL}
void main(){
  vec3 d = normalize(vDir);
  float n = fbm(d*1.6 + uSeed, 6);
  float m = fbm(d*3.2 + uSeed*1.7 + vec3(n*1.5), 5);
  float dens = smoothstep(0.45, 0.9, n) * (0.4 + m*0.9);
  float dust = smoothstep(0.55, 0.75, fbm(d*6.0 + uSeed + 4.0, 4));
  vec3 c = mix(uA, uB, m) * dens * 0.55;
  c *= 1.0 - dust*0.6;
  c += vec3(0.010, 0.014, 0.022);
  gl_FragColor = vec4(c, 1.0);
}`;
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = position; vec4 wp = modelMatrix*vec4(position,1.0); gl_Position = projectionMatrix*viewMatrix*wp; }`;

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Body { planet: Planet; build: PlanetBuild; radius: number; orbitR: number; parent?: Body; phase: number; speed: number; pos: THREE.Vector3 }

export class SystemView3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
  private sig = '';
  private bodies: Body[] = [];
  private starMat: THREE.ShaderMaterial | null = null;
  private starRadius = 1.6;
  private starbase: THREE.Object3D | null = null;
  private glowTex = glowTexture();
  private disposables: { dispose(): void }[] = [];
  private maxR = 20;
  private fleetGroup = new THREE.Group();
  private fleetSig = '';
  private fleetPos = new Map<number, THREE.Vector3>();
  private shipsReady = false;
  private megas: SystemMegastructures | null = null;
  private env: THREE.WebGLRenderTarget | null = null;
  private lastTime = 0;

  private maxDpr: number;
  constructor(canvas: HTMLCanvasElement, q: { antialias: boolean; maxDpr: number } = { antialias: true, maxDpr: 2 }) {
    this.maxDpr = q.maxDpr;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x05070b, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    preload(SHIP_ASSETS).then(() => { this.shipsReady = true; this.fleetSig = ''; });
  }

  /** Fleets present in the system, shown as formations of their actual hulls. */
  private syncFleets(state: GameState, sys: StarSystem, visible: boolean) {
    const fleets = visible ? Object.values(state.fleets).filter((f) => f.systemId === sys.id && f.progress === 0 && f.ships.length) : [];
    const sig = (this.shipsReady ? 'r' : 'w') + fleets.map((f) => `${f.id}:${f.ships.length}:${f.ownerId}`).join(',');
    if (sig === this.fleetSig) return;
    this.fleetSig = sig;
    this.fleetGroup.clear();
    this.fleetPos.clear();
    if (!this.shipsReady) return;
    fleets.forEach((f, i) => {
      const g = buildFleetFormation(f, state.empires[f.ownerId].color);
      if (!g) return;
      // hold station on a ring between the star and the first planets
      const a = (f.id * 2.399) % (Math.PI * 2);
      const r = this.starRadius * 3.2 + 2.5 + (i % 3) * 2.2;
      g.position.set(Math.cos(a) * r, 0.6 + (i % 2) * 0.5, Math.sin(a) * r);
      g.rotation.y = -a; // nose along the orbit
      this.fleetGroup.add(g);
      this.fleetPos.set(f.id, g.position.clone());
    });
  }

  private clear() {
    this.megas?.dispose(); this.megas = null;
    for (const b of this.bodies) b.build.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.bodies = [];
    this.scene.clear();
    this.starbase = null; this.starMat = null;
  }

  private build(state: GameState, sys: StarSystem) {
    this.buildScene(state, sys);
    // lights for the ship models (planets and the star light themselves in their shaders)
    this.scene.add(new THREE.AmbientLight(0x9fb0d0, 0.9));
    const sunLight = new THREE.PointLight(0xfff0dc, 3.2, 0, 0);
    this.scene.add(sunLight);
    const fill = new THREE.DirectionalLight(0x6f8fff, 0.6);
    fill.position.set(-20, 30, 10);
    this.scene.add(fill);
    this.scene.add(this.fleetGroup);
    this.fleetSig = '';
    // a soft reflected environment so metal hulls and megastructures read as metal
    if (!this.env) { const pm = new THREE.PMREMGenerator(this.renderer); this.env = pm.fromScene(new RoomEnvironment(), 0.04); pm.dispose(); }
    this.scene.environment = this.env.texture;
  }

  private buildScene(state: GameState, sys: StarSystem) {
    this.clear();
    const st = STAR_TYPES[sys.star];
    const rng = (k: number) => hash2(sys.id, k, 991);
    // sky
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
      uniforms: { uA: { value: new THREE.Color(st.glow) }, uB: { value: new THREE.Color(['#2a4f7a', '#6a2f5a', '#2f6a64', '#7a5a2a'][sys.id % 4]) }, uSeed: { value: new THREE.Vector3(rng(1) * 40, rng(2) * 40, rng(3) * 40) } },
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 32), skyMat);
    this.scene.add(sky);
    this.disposables.push(skyMat, sky.geometry);
    // background stars
    const N = 2600, pos = new Float32Array(N * 3), colr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = hash2(i, 1, sys.id) * 2 - 1, a = hash2(i, 2, sys.id) * Math.PI * 2, s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * s * 850, u * 850, Math.sin(a) * s * 850], i * 3);
      const b = 0.35 + hash2(i, 3, sys.id) ** 3 * 0.9;
      colr.set([b, b * 0.97, b * (0.9 + hash2(i, 4, sys.id) * 0.2)], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    const sm = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false });
    this.scene.add(new THREE.Points(sg, sm));
    this.disposables.push(sg, sm);

    // star
    this.starRadius = sys.star === 'blue' ? 2.1 : sys.star === 'red' ? 1.25 : sys.star === 'black_hole' ? 1.0 : 1.6;
    const glow = new THREE.SpriteMaterial({ map: this.glowTex, color: new THREE.Color(st.glow), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const halo = new THREE.Sprite(glow);
    halo.scale.setScalar(this.starRadius * (sys.star === 'black_hole' ? 9 : 14));
    this.disposables.push(glow);
    if (sys.star === 'black_hole') {
      const hole = new THREE.Mesh(new THREE.SphereGeometry(this.starRadius, 48, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
      this.scene.add(hole);
      const diskMat = new THREE.ShaderMaterial({
        transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
        uniforms: { uCol: { value: new THREE.Color(st.glow) }, uT: { value: 0 } },
        vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform vec3 uCol; uniform float uT; varying vec2 vP; ${NOISE_GLSL}
          void main(){ float r = length(vP); float a = atan(vP.y, vP.x);
          float s = fbm(vec3(cos(a)*2.0, sin(a)*2.0, r*3.0 - uT*0.05), 4);
          float k = smoothstep(1.15, 1.5, r) * smoothstep(4.2, 1.8, r) * (0.4 + s);
          gl_FragColor = vec4(mix(uCol, vec3(1.0,0.95,0.85), smoothstep(2.2,1.3,r)) * k * 1.4, 1.0); }`,
      });
      const disk = new THREE.Mesh(new THREE.RingGeometry(1.1, 4.4, 160, 1), diskMat);
      disk.rotation.x = -Math.PI / 2 + 0.25;
      this.scene.add(disk);
      this.starMat = diskMat;
      this.disposables.push(diskMat, disk.geometry, hole.geometry);
    } else {
      this.starMat = new THREE.ShaderMaterial({
        vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
        uniforms: { uCol: { value: new THREE.Color(st.glow) }, uHot: { value: new THREE.Color(st.color).lerp(new THREE.Color('#ffffff'), 0.35) }, uT: { value: 0 } },
      });
      const star = new THREE.Mesh(new THREE.SphereGeometry(this.starRadius, 64, 48), this.starMat);
      this.scene.add(star);
      this.disposables.push(this.starMat, star.geometry);
    }
    this.scene.add(halo);

    // planets and moons
    const top = state.planets.filter((p) => p.systemId === sys.id && p.moonOf == null).sort((a, b) => a.orbit - b.orbit);
    const orbitR = (o: number) => this.starRadius * 2.5 + 3 + o * 3.4;
    const lineMat = new THREE.LineBasicMaterial({ color: 0xc8d6e8, transparent: true, opacity: 0.13 });
    this.disposables.push(lineMat);
    const ring = (r: number, mat: THREE.Material) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 160; i++) { const a = (i / 160) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      this.disposables.push(g);
      return new THREE.Line(g, mat);
    };
    for (const p of top) {
      const R = orbitR(p.orbit);
      this.scene.add(ring(R, lineMat));
      const radius = p.type === 'gas_giant' ? 1.25 : 0.38 + p.size * 0.022;
      const build = buildPlanet(p.type, p.id * 7919 + 13, worldLook(state, p), true);
      build.group.scale.setScalar(radius);
      this.scene.add(build.group);
      const body: Body = { planet: p, build, radius, orbitR: R, phase: hash2(p.id, 5, 3) * Math.PI * 2, speed: 0.00006 / Math.sqrt(p.orbit + 1), pos: new THREE.Vector3() };
      this.bodies.push(body);
      const moons = state.planets.filter((m) => m.moonOf === p.id);
      moons.forEach((m, k) => {
        const mb = buildPlanet(m.type, m.id * 7919 + 13, m.colony ? 0.5 : 0, false);
        const mr = 0.16 + m.size * 0.006;
        mb.group.scale.setScalar(mr);
        this.scene.add(mb.group);
        this.bodies.push({ planet: m, build: mb, radius: mr, orbitR: radius * (p.type === 'gas_giant' ? 2.6 : 2.0) + k * 0.55, parent: body, phase: hash2(m.id, 6, 3) * Math.PI * 2, speed: 0.0004 / (k + 1), pos: new THREE.Vector3() });
      });
    }
    let maxR = top.length ? orbitR(top[top.length - 1].orbit) : 10;
    // asteroid belts
    for (let b = 0; b < (sys.asteroidBelts ?? 0); b++) {
      const R = orbitR((top.at(-1)?.orbit ?? 0) + 1 + b);
      maxR = Math.max(maxR, R);
      const n = 1800, ap = new Float32Array(n * 3), ac = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = hash2(i, 7 + b, sys.id) * Math.PI * 2;
        const rr = R + (hash2(i, 8 + b, sys.id) - 0.5) * 2.2 * (0.4 + hash2(i, 9, sys.id));
        ap.set([Math.cos(a) * rr, (hash2(i, 10, sys.id) - 0.5) * 0.5, Math.sin(a) * rr], i * 3);
        const g = 0.35 + hash2(i, 11, sys.id) * 0.35;
        ac.set([g * 1.05, g * 0.95, g * 0.85], i * 3);
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.BufferAttribute(ap, 3));
      bg.setAttribute('color', new THREE.BufferAttribute(ac, 3));
      const bm = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, sizeAttenuation: true });
      this.scene.add(new THREE.Points(bg, bm));
      this.disposables.push(bg, bm);
    }
    this.maxR = maxR;
    // starbase: a slowly turning lattice near the star
    if (sys.starbase > 0) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0xd8b56a, wireframe: true, transparent: true, opacity: 0.85 });
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.35 + sys.starbase * 0.08, 0), mat);
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.62 + sys.starbase * 0.1, 0.03, 6, 48), new THREE.MeshBasicMaterial({ color: 0x9fb8c8 }));
      hoop.rotation.x = Math.PI / 2;
      g.add(core, hoop);
      g.position.set(this.starRadius * 2.5 + 1.2, 0.9, -this.starRadius * 1.2);
      this.scene.add(g);
      this.starbase = g;
      this.disposables.push(mat, core.geometry, hoop.geometry, hoop.material as THREE.Material);
    }
    // megastructures: staged models (completed stages solid, the one under construction as scaffold)
    if (sys.megastructures.length) {
      const byId = new Map(this.bodies.map((b) => [b.planet.id, b]));
      this.megas = new SystemMegastructures(state, sys, {
        starRadius: this.starRadius, maxR: this.maxR,
        planetPos: (id) => byId.get(id)?.pos ?? null,
        planetRadius: (id) => byId.get(id)?.radius ?? 0.6,
        starbasePos: this.starbase ? this.starbase.position : null,
      });
      this.scene.add(this.megas.group);
    }
  }

  frame(state: GameState, sys: StarSystem, w: number, h: number, dpr: number, time: number, selPlanet: number | null, selFleet: number | null, ov: CanvasRenderingContext2D): SysHit[] {
    const sig = `${sys.id}:${sys.starbase}:${sys.megastructures.map((m) => m.id + m.stage).join()}:${state.planets.filter((p) => p.systemId === sys.id).map((p) => (p.colony ? worldLookKey(state, p) : -1)).join()}`;
    if (sig !== this.sig) {
      const newSystem = !this.sig.startsWith(`${sys.id}:`);
      this.sig = sig;
      this.build(state, sys);
      if (newSystem) { orbitCam.dist = Math.max(16, this.maxR * 2.35); orbitCam.phi = 1.08; }
    }
    // renderer sizing
    const pr = Math.min(dpr, this.maxDpr);
    if (this.renderer.getPixelRatio() !== pr) this.renderer.setPixelRatio(pr);
    const cv = this.renderer.domElement;
    if (cv.width !== Math.round(w * pr) || cv.height !== Math.round(h * pr)) this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (orbitCam.auto) orbitCam.theta += 0.00012;
    const { theta, phi, dist } = orbitCam;
    this.camera.position.set(Math.sin(phi) * Math.cos(theta) * dist, Math.cos(phi) * dist, Math.sin(phi) * Math.sin(theta) * dist);
    this.camera.lookAt(0, 0, 0);
    if (this.starMat) this.starMat.uniforms.uT.value = time / 1000;
    if (this.starbase) this.starbase.rotation.y = time * 0.0003;
    // place bodies (parents are listed before their moons)
    const tmp = new THREE.Vector3();
    for (const b of this.bodies) {
      const a = b.phase + time * b.speed;
      b.pos.set(Math.cos(a) * b.orbitR, 0, Math.sin(a) * b.orbitR);
      if (b.parent) b.pos.add(b.parent.pos);
      b.build.group.position.copy(b.pos);
      b.build.setLight(tmp.copy(b.pos).multiplyScalar(-1));
      b.build.setTime(time);
    }
    this.megas?.update(Math.min(0.1, Math.max(0, (time - this.lastTime) / 1000)));
    this.lastTime = time;
    this.syncFleets(state, sys, visibleSystems(state, state.playerId).has(sys.id));
    for (const [i, g] of this.fleetGroup.children.entries()) g.position.y += Math.sin(time / 1300 + i) * 0.0008;
    this.renderer.render(this.scene, this.camera);

    // ---------- overlay: labels, ownership, selection, fleets ----------
    ov.clearRect(0, 0, w, h);
    const hits: SysHit[] = [];
    const proj = (v: THREE.Vector3) => { const p = v.clone().project(this.camera); return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, z: p.z }; };
    const pxPerUnit = (v: THREE.Vector3) => h / (2 * Math.tan((this.camera.fov * Math.PI) / 360) * v.distanceTo(this.camera.position));
    for (const b of this.bodies) {
      const s = proj(b.pos);
      if (s.z > 1) continue;
      const rpx = b.radius * pxPerUnit(b.pos);
      const p = b.planet;
      if (p.colony) {
        const owner = state.empires[p.colony.ownerId];
        ov.strokeStyle = hexA(owner.color, 0.85);
        ov.lineWidth = 1.2;
        ov.setLineDash([3, 3]);
        ov.beginPath(); ov.arc(s.x, s.y, rpx + 5, 0, Math.PI * 2); ov.stroke();
        ov.setLineDash([]);
      }
      if (selPlanet === p.id) bracket(ov, s.x, s.y, rpx + 9);
      if (!b.parent || selPlanet === p.id || rpx > 6) {
        ov.font = `${b.parent ? 500 : 600} ${b.parent ? 11 : 12.5}px 'Saira Semi Condensed', sans-serif`;
        ov.textAlign = 'center'; ov.textBaseline = 'top';
        ov.fillStyle = 'rgba(0,0,0,0.7)';
        ov.fillText(p.name, s.x + 1, s.y + rpx + 7);
        ov.fillStyle = p.colony ? hexA(state.empires[p.colony.ownerId].color, 1) : 'rgba(214,224,236,0.78)';
        ov.fillText(p.name, s.x, s.y + rpx + 6);
      }
      hits.push({ kind: 'planet', id: p.id, x: s.x, y: s.y, r: Math.max(10, rpx + 4) });
    }
    // merchant traffic: convoys of real routes leave and reach this system's worlds, heading for the next star on their path
    const routes = state.life?.routes ?? [];
    if (routes.length && visibleSystems(state, state.playerId).has(sys.id)) {
      const t = state.tick + simClock.frac;
      const edge = this.maxR * 1.35;
      const gsys = state.galaxy.systems;
      const bodyPos = (pid: number) => this.bodies.find((b) => b.planet.id === pid)?.pos ?? null;
      for (const r of routes) {
        const i = r.path.indexOf(sys.id);
        if (i < 0) continue;
        const style = civStyle(state.empires[r.a]);
        const col = r.a !== r.b ? '#f0dcae' : (state.empires[r.a]?.color ?? '#aaa');
        for (const c of convoyPositions(r, t)) {
          const at = routeIndexAt(state, r, c.u);
          const k = at - i;
          if (Math.abs(k) > 0.5 && !(c.docked && i === 0)) continue;
          // where in this system: from a world (at an end of the route) or the star (passing through) out toward a neighbour
          const anchor = i === 0 ? bodyPos(r.from) : i === r.path.length - 1 ? bodyPos(r.to) : null;
          const nb = k >= 0 ? r.path[i + 1] : r.path[i - 1];
          const dir = new THREE.Vector3();
          if (nb != null) dir.set(gsys[nb].x - sys.x, 0, gsys[nb].y - sys.y).normalize();
          const base = anchor ? anchor.clone() : new THREE.Vector3();
          const pos = c.docked ? base.clone().add(new THREE.Vector3(0.6, 0.2, 0)) : base.clone().lerp(dir.clone().multiplyScalar(edge), Math.min(1, Math.abs(k) * 2));
          const s = proj(pos);
          if (s.z > 1) continue;
          const ahead = proj(pos.clone().add(dir.clone().multiplyScalar((c.laden === (k >= 0)) ? 1 : -1)));
          drawShip(ov, 'cargo', style, s.x, s.y, Math.atan2(ahead.y - s.y, ahead.x - s.x), 4.5, c.docked ? '#e2543f' : col, c.laden ? 0.95 : 0.6);
        }
      }
    }
    if (this.starbase) {
      const s = proj(this.starbase.position);
      ov.font = "500 11px 'Saira Semi Condensed', sans-serif";
      ov.fillStyle = 'rgba(216,181,106,0.9)'; ov.textAlign = 'center'; ov.textBaseline = 'top';
      ov.fillText(['', 'Outpost', 'Starport', 'Citadel'][sys.starbase] ?? 'Starbase', s.x, s.y + 16);
      hits.push({ kind: 'starbase', id: sys.id, x: s.x, y: s.y, r: 14 });
    }
    // fleet roster in the lower-left corner
    const visible = visibleSystems(state, state.playerId).has(sys.id);
    if (visible) {
      const fleets = Object.values(state.fleets).filter((f) => f.systemId === sys.id && f.progress === 0 && f.ships.length);
      const perCol = Math.max(3, Math.floor((h * 0.22) / 26));
      fleets.forEach((f, i) => {
        const e = state.empires[f.ownerId];
        const x = 28 + Math.floor(i / perCol) * 230;
        const y = h - 250 - (perCol - 1 - (i % perCol)) * 26;
        const civ = f.ships.every((s) => SHIPS[s.cls].civilian);
        ov.fillStyle = e.color;
        ov.beginPath();
        if (civ) ov.rect(x - 4, y - 4, 8, 8);
        else { ov.moveTo(x + 7, y); ov.lineTo(x - 6, y - 5); ov.lineTo(x - 3, y); ov.lineTo(x - 6, y + 5); ov.closePath(); }
        ov.fill();
        if (selFleet === f.id) bracket(ov, x, y, 12);
        ov.font = "500 12px 'Saira Semi Condensed', sans-serif";
        ov.fillStyle = hexA(e.color, 0.95); ov.textAlign = 'left'; ov.textBaseline = 'middle';
        ov.fillText(civ ? f.name : `${f.name}  ${fleetPower(state, f)}`, x + 16, y);
        hits.push({ kind: 'fleet', id: f.id, x, y, r: 14 });
        const p3 = this.fleetPos.get(f.id);
        if (p3) {
          const sp = proj(p3);
          hits.push({ kind: 'fleet', id: f.id, x: sp.x, y: sp.y, r: 18 });
          if (selFleet === f.id) bracket(ov, sp.x, sp.y, 18);
          ov.font = "500 11px 'Saira Semi Condensed', sans-serif";
          ov.fillStyle = hexA(e.color, 0.95); ov.textAlign = 'center'; ov.textBaseline = 'top';
          ov.fillText(f.name, sp.x, sp.y + 20);
        }
      });
    }
    return hits;
  }

  dispose() { this.clear(); this.env?.dispose(); this.env = null; releaseView(this.scene, this.renderer); }
}

function bracket(ctx: CanvasRenderingContext2D, x: number, y: number, k: number) {
  ctx.strokeStyle = '#7fd8ec';
  ctx.lineWidth = 1.3;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.beginPath();
    ctx.moveTo(x + sx * k, y + sy * (k - 6)); ctx.lineTo(x + sx * k, y + sy * k); ctx.lineTo(x + sx * (k - 6), y + sy * k);
    ctx.stroke();
  }
}
