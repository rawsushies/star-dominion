// Character lab (development only): /charlab.html?role=<archetype>&anim=<clip>&seed=<n>
// Every archetype's candidate variants (both sexes) beside the current production bodies for that
// role, with animation playback, orbit camera, lighting presets, role filters and model statistics.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CHARACTER_MODELS, ANTAGONIST_MODELS, type AssetId } from '../ui/render/assets/catalog';
import { loadAsset, instance, normalised } from '../ui/render/assets/loader';
import { Human, readyHumans } from '../ui/render/characters/humanKit';
import { ARCHETYPE_ORDER, archetypeVariants, humanSpec, type Archetype } from '../ui/render/characters/archetypes';
import type { CharRole } from '../sim/data/characters';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 1, 0);

// ---------------------------------------------------------------- lighting presets
const lights = new THREE.Group();
scene.add(lights);
const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x232936, roughness: 0.55, metalness: 0.25 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
scene.add(floor);
function lighting(kind: string) {
  lights.clear();
  const key = new THREE.DirectionalLight(0xfff0d8, kind === 'dusk' ? 1.4 : 2.6);
  key.position.set(4, 8, 6); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -12, right: 12, top: 8, bottom: -4 });
  key.shadow.bias = -0.0004;
  const rim = new THREE.DirectionalLight(kind === 'studio' ? 0xffffff : 0x6fa8ff, kind === 'dusk' ? 2.2 : 1.2);
  rim.position.set(-5, 4, -6);
  const hemi = kind === 'studio' ? new THREE.HemisphereLight(0xffffff, 0x606060, 1.4) : new THREE.HemisphereLight(0xb4c6e6, 0x2a2018, kind === 'dusk' ? 0.4 : 1.0);
  lights.add(key, rim, hemi);
  scene.background = new THREE.Color(kind === 'studio' ? 0x7a828e : kind === 'dusk' ? 0x07090e : 0x141a26);
  (floor.material as THREE.MeshStandardMaterial).color.set(kind === 'studio' ? 0x9aa0a8 : 0x232936);
}

// ---------------------------------------------------------------- figures
interface Fig { obj: THREE.Object3D; label: HTMLDivElement; kind: 'prod' | 'new'; name: string; human?: Human; mixer?: THREE.AnimationMixer; stats: string }
let figs: Fig[] = [];
const labels = document.getElementById('labels')!;
let role: Archetype | 'all' = (q.get('role') as Archetype) ?? 'admiral';
let seed = Number(q.get('seed') ?? 1);
let anim = q.get('anim') ?? '';

function stats(o: THREE.Object3D): string {
  let tris = 0, meshes = 0; const tex = new Set<THREE.Texture>(), mats = new Set<THREE.Material>();
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    let vis = true; for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible) vis = false;
    if (!vis) return;
    meshes++;
    const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    for (const mt of Array.isArray(m.material) ? m.material : [m.material]) {
      mats.add(mt);
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const) { const t = (mt as THREE.MeshStandardMaterial)[k]; if (t) tex.add(t); }
    }
  });
  return `${Math.round(tris).toLocaleString()} triangles, ${meshes} draw calls, ${mats.size} materials, ${tex.size} textures`;
}

function label(text: string, sub: string, kind: 'prod' | 'new') {
  const d = document.createElement('div');
  d.className = `lab ${kind}`;
  d.innerHTML = `<b></b><span></span>`;
  d.querySelector('b')!.textContent = text; d.querySelector('span')!.textContent = sub;
  labels.appendChild(d);
  return d;
}

function clear() {
  for (const f of figs) { f.human?.dispose(); f.mixer?.stopAllAction(); f.obj.removeFromParent(); f.label.remove(); }
  figs = [];
}

async function prodFigures(r: Archetype): Promise<THREE.Object3D[]> {
  const ids: AssetId[] = r === 'sovereign' ? ['char_noble_m', 'char_noble_f'] : r === 'rival' || r === 'villain' ? ANTAGONIST_MODELS.slice(0, 2) : CHARACTER_MODELS[r as CharRole];
  const out: THREE.Object3D[] = [];
  for (const id of ids) {
    const g = await loadAsset(id).catch(() => null);
    const o = g && instance(id);
    if (!o || !g) continue;
    const fig = normalised(o, { height: 1.75 });
    const mixer = new THREE.AnimationMixer(o);
    const idle = g.animations.find((a) => /^idle$/i.test(a.name)) ?? g.animations.find((a) => /idle/i.test(a.name));
    if (idle) mixer.clipAction(idle).play();
    fig.userData = { mixer, name: id };
    out.push(fig);
  }
  return out;
}

async function build() {
  clear();
  const roles = role === 'all' ? ARCHETYPE_ORDER : [role];
  let z = 0;
  for (const r of roles) {
    let x = 0;
    for (const fig of await prodFigures(r)) {
      fig.position.set(x, 0, z); x += 1.3;
      fig.traverse((n) => { if ((n as THREE.Mesh).isMesh) n.castShadow = true; });
      scene.add(fig);
      figs.push({ obj: fig, kind: 'prod', name: fig.userData.name, mixer: fig.userData.mixer, label: label(`current: ${fig.userData.name}`, r, 'prod'), stats: stats(fig) });
    }
    x += 0.6;
    archetypeVariants(r).forEach((_, vi) => {
      for (const sex of ['male', 'female'] as const) {
        const spec = humanSpec(r, seed * 97 + ARCHETYPE_ORDER.indexOf(r) * 31 + vi * 13 + (sex === 'male' ? 0 : 7), { variant: vi, sex, anim: anim || undefined });
        const h = new Human(spec);
        h.root.position.set(x, 0, z); x += 1.3;
        scene.add(h.root);
        figs.push({ obj: h.root, human: h, kind: 'new', name: `${r} · ${spec.label}`, label: label(spec.label, `${r}, ${sex}, ${spec.anim}`, 'new'), stats: stats(h.root) });
      }
    });
    z -= 3.2;
  }
  const box = new THREE.Box3();
  for (const f of figs) box.expandByObject(f.obj);
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  controls.target.set(c.x, 1.0, c.z);
  const dist = Math.max(4.5, Math.max(size.x, size.z) * 0.95) * Number(q.get('zoom') ?? 1);
  const fx = q.get('fx'); // frame one figure by index
  if (fx != null && figs[Number(fx)]) {
    const p = figs[Number(fx)].obj.position, side = q.has('side');
    controls.target.set(p.x, 1.35, p.z); camera.position.set(p.x + (side ? 1.6 : 0), 1.5, p.z + (side ? 0.3 : 1.6));
  }
  else camera.position.set(c.x, 1.6 + dist * 0.12, c.z + dist);
  summary();
}

function summary() {
  const n = figs.filter((f) => f.kind === 'new'), p = figs.filter((f) => f.kind === 'prod');
  const avg = (fs: Fig[]) => fs.length ? fs.map((f) => Number(f.stats.split(' ')[0].replace(/,/g, ''))).reduce((a, b) => a + b, 0) / fs.length : 0;
  document.getElementById('stats')!.textContent =
    `figures: ${p.length} current, ${n.length} candidates\n` +
    `avg triangles: current ${Math.round(avg(p)).toLocaleString()}, candidate ${Math.round(avg(n)).toLocaleString()}\n` +
    `frame: ${renderer.info.render.calls} draw calls, ${Math.round(renderer.info.render.triangles).toLocaleString()} triangles\n` +
    `GPU: ${renderer.info.memory.geometries} geometries, ${renderer.info.memory.textures} textures`;
}

// ---------------------------------------------------------------- UI
const rolesEl = document.getElementById('roles')!;
for (const r of [...ARCHETYPE_ORDER, 'all'] as const) {
  const b = document.createElement('button');
  b.textContent = r; b.setAttribute('aria-pressed', String(r === role));
  b.onclick = () => { role = r; for (const x of rolesEl.children) x.setAttribute('aria-pressed', String(x === b)); void build(); };
  rolesEl.appendChild(b);
}
const animSel = document.getElementById('anim') as HTMLSelectElement;
document.getElementById('light')!.addEventListener('change', (e) => lighting((e.target as HTMLSelectElement).value));
document.getElementById('reseed')!.addEventListener('click', () => { seed++; void build(); });
animSel.addEventListener('change', () => { anim = animSel.value; for (const f of figs) if (f.human) f.human.play(anim || 'idle'); });

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let down = { x: 0, y: 0 };
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  // skinned bounds are unreliable: pick the figure whose standing column the ray passes closest to
  let best: Fig | null = null, bd = 0.6;
  for (const f of figs) {
    const p = f.obj.getWorldPosition(new THREE.Vector3()).setY(1);
    const d = ray.ray.distanceToPoint(p);
    if (d < bd) { bd = d; best = f; }
  }
  const sel = document.getElementById('sel')!;
  if (!best) { sel.textContent = 'Click a figure to inspect it.'; return; }
  sel.textContent = `${best.kind === 'prod' ? 'Current' : 'Candidate'}: ${best.name}\n${best.stats}`;
  sel.style.whiteSpace = 'pre-wrap';
  controls.target.copy(best.obj.getWorldPosition(new THREE.Vector3()).setY(1.0));
});

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
let frames = 0;
function frame() {
  const w = innerWidth, h = innerHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  const dt = q.has('still') ? 0 : Math.min(0.05, clock.getDelta());
  for (const f of figs) { f.human?.update(dt); f.mixer?.update(dt); }
  controls.update();
  renderer.render(scene, camera);
  for (const f of figs) {
    f.obj.getWorldPosition(tmp); tmp.y = 1.95; tmp.project(camera);
    const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
    f.label.style.display = vis ? '' : 'none';
    if (vis) { f.label.style.left = `${(tmp.x * 0.5 + 0.5) * w}px`; f.label.style.top = `${(-tmp.y * 0.5 + 0.5) * h}px`; }
  }
  if (++frames % 30 === 0) summary();
  if (frames === 60) document.body.dataset.ready = '1';
  requestAnimationFrame(frame);
}

lighting(q.get('light') ?? 'hall');
await readyHumans();
const names = Human.clips().map((c) => c.name).sort();
animSel.innerHTML = `<option value="">archetype default</option>` + names.map((n) => `<option>${n}</option>`).join('');
animSel.value = anim;
await build();
requestAnimationFrame(frame);
