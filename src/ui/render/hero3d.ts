// Full-body hero figure for the Hall of Heroes: a procedural character on a
// lit stage, dressed for their role and realm, holding what they have
// equipped. Built from primitives so every character looks distinct without
// any art assets.

import * as THREE from 'three';
import type { Character } from '../../sim/types';

function hash(n: number): number {
  const x = Math.sin(n * 91.7 + 17.3) * 43758.5453;
  return x - Math.floor(x);
}

const SKIN = [0xf1d0b5, 0xe0b48f, 0xc68e64, 0x9a6440, 0x6e4529, 0xd9b8a0];
const HAIR = [0x1d1612, 0x4a2f1e, 0x8a5a2b, 0xc9a25e, 0xe8e2d6, 0x6b6b6b, 0x8b2d1f];

interface Dress { coat: number; trim: number; long: boolean; hood: boolean; cap: boolean; pads: boolean; prop: 'sabre' | 'halberd' | 'scroll' | 'orb' | 'staff' | 'chain' | 'wrench' | 'scanner' | 'dagger' }
const DRESS: Record<Character['role'], Dress> = {
  admiral: { coat: 0x1d2b4a, trim: 0xd9b45a, long: true, hood: false, cap: true, pads: true, prop: 'sabre' },
  general: { coat: 0x3a4232, trim: 0xb0a070, long: false, hood: false, cap: false, pads: true, prop: 'halberd' },
  governor: { coat: 0x5a2335, trim: 0xd9b45a, long: true, hood: false, cap: false, pads: false, prop: 'scroll' },
  scientist: { coat: 0xe8ecf0, trim: 0x4aa8ff, long: true, hood: false, cap: false, pads: false, prop: 'orb' },
  diplomat: { coat: 0x2e4a5a, trim: 0xe8e2d6, long: true, hood: false, cap: false, pads: false, prop: 'staff' },
  chancellor: { coat: 0x3d2a55, trim: 0xd9b45a, long: true, hood: false, cap: false, pads: false, prop: 'chain' },
  industrialist: { coat: 0x6a5032, trim: 0xe0a040, long: false, hood: false, cap: false, pads: false, prop: 'wrench' },
  explorer: { coat: 0x5b6a3a, trim: 0xc9a25e, long: false, hood: false, cap: false, pads: false, prop: 'scanner' },
  spymaster: { coat: 0x1a1a22, trim: 0x8b2d1f, long: true, hood: true, cap: false, pads: false, prop: 'dagger' },
};

export class HeroView3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private figure = new THREE.Group();
  private sparks!: THREE.Points;
  private yaw = 0.3;
  private dragging = false;
  private raf = 0;
  private disposed = false;
  private key = '';

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.stage();
    this.scene.add(this.figure);
    let lastX = 0;
    canvas.addEventListener('pointerdown', (e) => { this.dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (this.dragging) { this.yaw += (e.clientX - lastX) * 0.01; lastX = e.clientX; } });
    canvas.addEventListener('pointerup', () => { this.dragging = false; });
    const loop = (t: number) => { if (this.disposed) return; this.frame(t); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  private stage() {
    const s = this.scene;
    s.background = new THREE.Color(0x141a26);
    s.fog = new THREE.Fog(0x141a26, 8, 20);
    s.add(new THREE.HemisphereLight(0xb4c6e6, 0x2a2018, 1.3));
    const key = new THREE.SpotLight(0xfff0d8, 120, 20, 0.5, 0.5);
    key.position.set(2.5, 6, 4); key.target.position.set(0, 1, 0); key.castShadow = true;
    s.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x6fa8ff, 1.6);
    rim.position.set(-3, 3, -4);
    s.add(rim);
    // dais
    const stone = new THREE.MeshStandardMaterial({ color: 0x5b6070, roughness: 0.6, metalness: 0.2 });
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.45, 0.25, 40), stone);
    dais.position.y = -0.125; dais.receiveShadow = true;
    s.add(dais);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.025, 8, 64), new THREE.MeshBasicMaterial({ color: 0x6fc8ff }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.005;
    s.add(ring);
    // hall: pillars and arches fading into the dark
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * (0.15 + (i / 5) * 0.7) + Math.PI;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 6, 10), stone);
      p.position.set(Math.cos(a) * 5, 2.8, Math.sin(a) * 5);
      s.add(p);
    }
    const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 48), new THREE.MeshStandardMaterial({ color: 0x232936, roughness: 0.4, metalness: 0.3 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.25; floor.receiveShadow = true;
    s.add(floor);
    const pts = new Float32Array(120 * 3);
    for (let i = 0; i < 120; i++) { const a = hash(i) * Math.PI * 2, r = 0.4 + hash(i + 7) * 0.9; pts[i * 3] = Math.cos(a) * r; pts[i * 3 + 1] = hash(i + 3) * 2.2; pts[i * 3 + 2] = Math.sin(a) * r; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.sparks = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x8fd4ff, size: 0.035, transparent: true, opacity: 0.8 }));
    s.add(this.sparks);
  }

  /** Dress the figure for a character (rebuilt only when their look changes). */
  show(c: Character, realmColor: string) {
    const key = `${c.id}|${c.role}|${c.level}|${Object.values(c.equipment).join()}|${realmColor}`;
    if (key === this.key) return;
    this.key = key;
    this.figure.clear();
    const d = DRESS[c.role];
    const h = (k: number) => hash(c.id * 13 + k);
    const mat = (color: number | string, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    const skin = mat(SKIN[Math.floor(h(1) * SKIN.length)], 0.7);
    const hair = mat(HAIR[Math.floor(h(2) * HAIR.length)], 0.8);
    const coat = mat(d.coat, 0.65);
    const trim = mat(d.trim, 0.35, 0.6);
    const realm = mat(realmColor, 0.5, 0.1);
    const boots = mat(0x1a1612, 0.5);
    const steel = mat(0xc8d0dc, 0.25, 0.9);
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.figure) => {
      const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o;
    };
    const tall = 0.95 + h(3) * 0.12, broad = 0.9 + h(4) * 0.2;
    const root = new THREE.Group();
    root.scale.set(broad, tall, broad);
    this.figure.add(root);
    // legs and boots
    for (const s of [-1, 1]) {
      add(new THREE.CapsuleGeometry(0.09, 0.62, 4, 8), mat(0x22252c), s * 0.11, 0.48, 0, root);
      add(new THREE.BoxGeometry(0.15, 0.12, 0.26), boots, s * 0.11, 0.06, 0.04, root);
    }
    // torso and coat
    add(new THREE.CylinderGeometry(0.2, 0.17, 0.62, 12), coat, 0, 1.12, 0, root);
    if (d.long) add(new THREE.CylinderGeometry(0.19, 0.3, 0.7, 14, 1, true), coat, 0, 0.66, 0, root).material = Object.assign(coat.clone(), { side: THREE.DoubleSide });
    add(new THREE.BoxGeometry(0.06, 0.6, 0.02), trim, 0, 1.12, 0.19, root);
    add(new THREE.TorusGeometry(0.18, 0.025, 6, 20), trim, 0, 0.84, 0, root).rotation.x = Math.PI / 2;
    // cloak in the realm's colour
    const cloak = add(new THREE.CylinderGeometry(0.24, 0.42, 1.2, 16, 1, true, Math.PI * 0.6, Math.PI * 0.8), realm, 0, 0.82, -0.02, root);
    (cloak.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    // shoulders
    for (const s of [-1, 1]) {
      add(new THREE.SphereGeometry(d.pads ? 0.1 : 0.075, 10, 8), d.pads ? trim : coat, s * 0.23, 1.38, 0, root);
      const arm = add(new THREE.CapsuleGeometry(0.06, 0.5, 4, 8), coat, s * 0.27, 1.08, 0, root);
      arm.rotation.z = s * 0.12;
      add(new THREE.SphereGeometry(0.055, 8, 6), skin, s * 0.31, 0.78, 0.02, root);
    }
    // head
    add(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 8), skin, 0, 1.47, 0, root);
    const head = add(new THREE.SphereGeometry(0.13, 16, 12), skin, 0, 1.62, 0, root);
    head.scale.set(0.92, 1.08, 0.98);
    for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.015, 6, 4), mat(0x1a1a1a, 0.3), s * 0.045, 1.64, 0.115, root);
    if (d.hood) {
      const hood = add(new THREE.SphereGeometry(0.17, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), coat, 0, 1.6, -0.02, root);
      hood.rotation.x = -0.25;
    } else {
      const style = Math.floor(h(5) * 3);
      add(new THREE.SphereGeometry(0.138, 14, 10, 0, Math.PI * 2, 0, Math.PI * (style === 0 ? 0.42 : 0.55)), hair, 0, 1.635, -0.01, root);
      if (style === 2) add(new THREE.CapsuleGeometry(0.05, 0.18, 4, 6), hair, 0, 1.5, -0.12, root);
    }
    if (d.cap) {
      add(new THREE.CylinderGeometry(0.15, 0.14, 0.07, 16), coat, 0, 1.76, 0, root);
      add(new THREE.CylinderGeometry(0.17, 0.17, 0.015, 16), mat(0x111111, 0.3), 0, 1.73, 0.03, root);
      add(new THREE.BoxGeometry(0.05, 0.03, 0.01), trim, 0, 1.76, 0.15, root);
    }
    // the role's prop, or the equipped weapon / instrument
    const hand = new THREE.Group();
    hand.position.set(0.32, 0.78, 0.05);
    root.add(hand);
    const prop = c.equipment.weapon ? 'sabre' : c.equipment.instrument && d.prop !== 'orb' ? 'scanner' : d.prop;
    switch (prop) {
      case 'sabre': add(new THREE.BoxGeometry(0.02, 0.7, 0.04), steel, 0, -0.32, 0.04, hand).rotation.x = 0.15; add(new THREE.BoxGeometry(0.12, 0.02, 0.05), trim, 0, 0.03, 0.02, hand); break;
      case 'halberd': add(new THREE.CylinderGeometry(0.015, 0.015, 1.8, 6), mat(0x5a4632), 0, 0.15, 0.05, hand); add(new THREE.ConeGeometry(0.05, 0.25, 4), steel, 0, 1.15, 0.05, hand); break;
      case 'staff': add(new THREE.CylinderGeometry(0.02, 0.02, 1.7, 6), mat(0x8a6a3a), 0, 0.1, 0.05, hand); add(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0x9fe0ff, emissive: 0x4ab8ff, emissiveIntensity: 1.5 }), 0, 0.98, 0.05, hand); break;
      case 'orb': add(new THREE.IcosahedronGeometry(0.09, 1), new THREE.MeshStandardMaterial({ color: 0x9fe0ff, emissive: 0x4ab8ff, emissiveIntensity: 1.8, wireframe: true }), 0, 0.25, 0.12, hand).userData.float = true; break;
      case 'scroll': add(new THREE.CylinderGeometry(0.03, 0.03, 0.26, 8), mat(0xe8dcb8), 0, 0.02, 0.06, hand).rotation.z = Math.PI / 2; break;
      case 'chain': add(new THREE.TorusGeometry(0.16, 0.018, 6, 24, Math.PI), trim, 0, 1.36, 0.08, root).rotation.z = Math.PI; break;
      case 'wrench': add(new THREE.BoxGeometry(0.035, 0.4, 0.02), steel, 0, -0.15, 0.04, hand); add(new THREE.TorusGeometry(0.04, 0.015, 6, 12), steel, 0, -0.37, 0.04, hand); break;
      case 'scanner': add(new THREE.BoxGeometry(0.1, 0.06, 0.14), mat(0x30343c, 0.4, 0.5), 0, 0.02, 0.08, hand); add(new THREE.PlaneGeometry(0.08, 0.05), new THREE.MeshBasicMaterial({ color: 0x6fffb0 }), 0, 0.055, 0.08, hand).rotation.x = -Math.PI / 2; break;
      case 'dagger': add(new THREE.ConeGeometry(0.02, 0.25, 4), steel, 0, -0.12, 0.05, hand).rotation.x = Math.PI; break;
    }
    if (c.equipment.armour) add(new THREE.CylinderGeometry(0.215, 0.19, 0.42, 12), steel, 0, 1.18, 0, root);
    if (c.equipment.relic) add(new THREE.OctahedronGeometry(0.05), new THREE.MeshStandardMaterial({ color: 0xc89bff, emissive: 0x8a4aff, emissiveIntensity: 1.5 }), 0, 1.3, 0.21, root);
    // veterans get a gilded sash
    if (c.level >= 8) add(new THREE.TorusGeometry(0.21, 0.02, 6, 24), trim, 0, 1.16, 0, root).rotation.set(Math.PI / 2, 0.6, 0);
  }

  private frame(t: number) {
    const w = this.canvas.clientWidth, hgt = this.canvas.clientHeight;
    if (!w || !hgt) return;
    const sz = this.renderer.getSize(new THREE.Vector2());
    if (sz.x !== w || sz.y !== hgt) { this.renderer.setSize(w, hgt, false); this.camera.aspect = w / hgt; this.camera.updateProjectionMatrix(); }
    this.figure.rotation.y = this.yaw + (this.dragging ? 0 : Math.sin(t / 3000) * 0.45);
    this.figure.position.y = Math.sin(t / 1400) * 0.005;
    this.figure.traverse((o) => { if (o.userData.float) { o.position.y = 0.3 + Math.sin(t / 500) * 0.05; o.rotation.y = t / 900; } });
    this.sparks.rotation.y = t / 6000;
    this.camera.position.set(0, 1.2, 4.3);
    this.camera.lookAt(0, 0.92, 0);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }
}
