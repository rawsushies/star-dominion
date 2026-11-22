// Asset laboratory (dev only): renders candidate models side by side in the game's own render
// pipeline (sky, sun, shadows, tone mapping), at their real sizes, so they can be judged in the
// light they would have in the game. Query:
//   models=a,b,c   tevy slugs (from base, file <slug>.lod<lod>.glb) or paths ending in .glb
//   base=/tevy-candidates/   lod=2   spacing=metres   dist=camera distance   yaw, pitch
import * as THREE from 'three';
import { RenderPipeline } from '../ui/render/pipeline';
import { loadTevy } from '../ui/render/assets/tevyLoader';

const q = new URLSearchParams(location.search);
const names = (q.get('models') ?? '').split(',').filter(Boolean);
const base = q.get('base') ?? '/tevy-candidates/';
const lod = q.get('lod') ?? '2';
const spacing = +(q.get('spacing') ?? 0);
const canvas = document.querySelector('canvas')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20000);
const pipeline = new RenderPipeline(renderer, scene, camera, (q.get('quality') as 'mobile') ?? 'mobile', { elevation: 32, azimuth: -50, intensity: 3 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshStandardMaterial({ color: 0x5d6168, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const labels = document.getElementById('labels')!;
const placed: { obj: THREE.Object3D; el: HTMLDivElement; top: number }[] = [];

(async () => {
  let x = 0;
  const boxes: THREE.Box3[] = [];
  for (const n of names) {
    const url = n.endsWith('.glb') ? (n.includes('/') ? n : base + n) : `${base}${n}.lod${lod}.glb`;
    try {
      const g = await loadTevy(renderer, url);
      const o = g.scene;
      o.traverse((m) => { const mm = m as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true; } });
      const b = new THREE.Box3().setFromObject(o); const size = b.getSize(new THREE.Vector3());
      const w = spacing || Math.max(size.x, 2) * 1.25;
      o.position.set(x + w / 2 - (b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
      x += w;
      scene.add(o);
      let tris = 0; o.traverse((m) => { const mm = m as THREE.Mesh; if (mm.isMesh) tris += (mm.geometry.index ? mm.geometry.index.count : mm.geometry.attributes.position.count) / 3; });
      const el = document.createElement('div'); el.textContent = `${n.split('/').pop()} · ${size.x.toFixed(1)}×${size.y.toFixed(1)}×${size.z.toFixed(1)} m · ${Math.round(tris)} tris${g.animations.length ? ` · ${g.animations.map((a) => a.name).join('/')}` : ''}`;
      labels.appendChild(el); placed.push({ obj: o, el, top: size.y });
      boxes.push(new THREE.Box3().setFromObject(o));
    } catch (e) { console.warn(`asset lab: ${url}: ${(e as Error).message}`); }
  }
  const all = boxes.reduce((a, b) => a.union(b), new THREE.Box3(new THREE.Vector3(), new THREE.Vector3()));
  const c = all.getCenter(new THREE.Vector3()); const s = all.getSize(new THREE.Vector3());
  const dist = +(q.get('dist') ?? Math.max(s.x * 0.75, s.y * 2.2, 8));
  const yaw = +(q.get('yaw') ?? 0.35), pitch = +(q.get('pitch') ?? 0.32);
  camera.position.set(c.x + Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist + s.y * 0.3, c.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  camera.lookAt(c.x, s.y * 0.35, c.z);
  pipeline.fitShadow(all.clone().expandByScalar(2));
  pipeline.setEnvironmentIntensity(scene, 0.8);
  let frames = 0;
  const loop = () => {
    const w = innerWidth, h = innerHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); pipeline.setSize(w, h); pipeline.render();
    for (const p of placed) { const v = new THREE.Vector3().setFromMatrixPosition(p.obj.matrixWorld); v.y = p.top + 0.3; v.project(camera); p.el.style.left = `${((v.x + 1) / 2) * w}px`; p.el.style.top = `${((1 - v.y) / 2) * h - 18}px`; }
    if (++frames === 8) document.body.dataset.ready = '1';
    requestAnimationFrame(loop);
  };
  loop();
})();
