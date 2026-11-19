// Planet view: one world filling the screen in 3D, with its moons, any orbital
// station, the host star's light and a nebula sky. The last step of the
// galaxy → sector → system → planet navigation.

import * as THREE from 'three';
import { STAR_TYPES } from '../../sim/data/planets';
import type { GameState, Planet } from '../../sim/types';
import { buildPlanet, type PlanetBuild } from './planet3d';
import { releaseView } from './assets/release';

export const planetCam = { yaw: 0.5, pitch: 0.18, dist: 5.2 };

export class PlanetView3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(36, 1, 0.05, 2000);
  private key = '';
  private main: PlanetBuild | null = null;
  private moons: { b: PlanetBuild; r: number; phase: number; speed: number; size: number }[] = [];
  private station: THREE.Object3D | null = null;
  private disposables: { dispose(): void }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(0x020305, 1);
  }

  private build(state: GameState, p: Planet) {
    this.main?.dispose();
    for (const m of this.moons) m.b.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = []; this.moons = []; this.station = null;
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
    const lights = p.colony ? Math.min(1, p.colony.pops / 25) : 0;
    this.main = buildPlanet(p.type, p.id * 7919 + 13, lights, true);
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
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.copy(sun.position);
    this.scene.add(light, new THREE.AmbientLight(0x223344, 0.4));
  }

  frame(state: GameState, p: Planet, w: number, h: number, dpr: number, time: number) {
    const key = `${p.id}:${p.colony ? Math.round(p.colony.pops / 5) : -1}:${p.station}`;
    if (key !== this.key) { this.key = key; this.build(state, p); }
    this.renderer.setPixelRatio(dpr);
    const cv = this.renderer.domElement;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) this.renderer.setSize(w, h, false);
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
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.main?.dispose();
    for (const m of this.moons) m.b.dispose();
    for (const d of this.disposables) d.dispose();
    releaseView(this.scene, this.renderer);
  }
}
