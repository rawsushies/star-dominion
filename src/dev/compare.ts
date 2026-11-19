// Development comparison gallery for candidate asset sets (open /compare.html on the dev server).
// Every rendered set gets its own lane under identical lighting, so sets are judged side by side.
// Query parameters: cat=capital|ships|heroes|villains, set=<id> (render one set only),
// capture=1 (hide the interface, for documentation screenshots).
//
// A model that fails to load is shown as a labelled red error marker. Nothing is ever
// replaced with procedural stand-in geometry.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CANDIDATE_SETS, CATEGORY_LABEL, type Category, type CandidateSet, type CandidateItem } from './candidates';
import { disposeObject, modelStats, type ModelStats } from '../ui/render/assets/resources';

const params = new URLSearchParams(location.search);
const capture = params.has('capture');
const onlySet = params.get('set');
let category = (params.get('cat') as Category) || (CANDIDATE_SETS.find((s) => s.id === onlySet)?.category ?? 'capital');
if (capture) document.body.classList.add('capture');

const view = document.getElementById('view')!;
const panel = document.getElementById('sets')!;
const status = document.getElementById('status')!;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: capture });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
view.appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
Object.assign(labels.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
view.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a202b);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2f38, 0.6));
const key = new THREE.DirectionalLight(0xfff2dc, 2.2);
key.position.set(-30, 50, 40); key.castShadow = true; key.shadow.mapSize.set(4096, 4096);
scene.add(key, key.target);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0x252c39, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
scene.add(floor);

const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 4000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
const root = new THREE.Group();
scene.add(root);
let mixers: THREE.AnimationMixer[] = [];
const lanes = new Map<string, THREE.Box3>();

// ----------------------------------------------------------------- loading

interface Loaded { scene: THREE.Object3D; animations: THREE.AnimationClip[]; bytes: number; skinned: boolean }
let cache = new Map<string, Promise<Loaded>>();

async function byteSize(url: string): Promise<number> {
  try { const r = await fetch(url, { method: 'HEAD' }); return Number(r.headers.get('content-length') ?? 0); } catch { return 0; }
}

async function loadRaw(url: string): Promise<Loaded> {
  const ext = url.split('?')[0].split('.').pop()!.toLowerCase();
  const bytes = await byteSize(url);
  let sceneObj: THREE.Object3D; let animations: THREE.AnimationClip[] = [];
  if (ext === 'glb' || ext === 'gltf') {
    const g = await new GLTFLoader().loadAsync(url); sceneObj = g.scene; animations = g.animations;
  } else if (ext === 'fbx') {
    const o = await new FBXLoader().loadAsync(url); sceneObj = o; animations = o.animations;
  } else if (ext === 'obj') {
    const loader = new OBJLoader();
    const mtl = url.replace(/\.obj$/i, '.mtl');
    const head = await fetch(mtl, { method: 'HEAD' }).catch(() => null);
    if (head?.ok) loader.setMaterials(await new MTLLoader().loadAsync(mtl));
    sceneObj = await loader.loadAsync(url);
  } else if (ext === 'dae') {
    const c = await new ColladaLoader().loadAsync(url); sceneObj = c.scene; animations = (c as unknown as { animations?: THREE.AnimationClip[] }).animations ?? [];
  } else throw new Error(`unsupported format .${ext}`);
  let skinned = false;
  sceneObj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; if ((m as THREE.SkinnedMesh).isSkinnedMesh) skinned = true; } });
  return { scene: sceneObj, animations, bytes, skinned };
}

function load(url: string): Promise<Loaded> {
  let p = cache.get(url);
  if (!p) { p = loadRaw(url); cache.set(url, p); }
  return p;
}

// ----------------------------------------------------------------- layout

function label(html: string, cls = ''): CSS2DObject {
  const d = document.createElement('div');
  d.className = `lbl ${cls}`;
  d.innerHTML = html;
  return new CSS2DObject(d);
}

interface Placed { item: CandidateItem; name: string; obj: THREE.Object3D; stats: ModelStats; clips: THREE.AnimationClip[] }
interface SetResult { placed: Placed[]; errors: string[]; bytes: number }

function measure(o: THREE.Object3D): THREE.Vector3 {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
}

async function buildSet(set: CandidateSet): Promise<SetResult> {
  const placed: Placed[] = []; const errors: string[] = []; let bytes = 0;
  const seenFiles = new Set<string>();
  for (const item of set.items ?? []) {
    try {
      const L = await load(item.file);
      if (!seenFiles.has(item.file)) { bytes += L.bytes; seenFiles.add(item.file); }
      const copy = L.skinned ? cloneSkinned(L.scene) : L.scene.clone(true);
      let parts: { name: string; obj: THREE.Object3D }[] = [{ name: item.role, obj: copy }];
      if (item.split) {
        let base: THREE.Object3D = copy;
        while (base.children.length === 1) base = base.children[0];
        parts = base.children.filter((c) => measure(c).length() > 0).map((c, i) => ({ name: `${item.role} ${i + 1} (${c.name || 'unnamed'})`, obj: c }));
      }
      for (const p of parts) placed.push({ item, name: p.name, obj: p.obj, stats: modelStats(p.obj), clips: L.animations });
    } catch (e) {
      errors.push(`${item.role}: ${(e as Error).message ?? e}`);
      placed.push({ item, name: item.role, obj: new THREE.Group(), stats: { triangles: 0, meshes: 0, materials: 0, textures: 0, maxTexture: 0 }, clips: [], error: true } as Placed & { error: boolean });
    }
  }
  return { placed, errors, bytes };
}

function errorMarker(size: number): THREE.Object3D {
  // a deliberate, labelled error marker — never a substitute model
  const m = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size)), new THREE.LineBasicMaterial({ color: 0xe0715f }));
  m.position.y = size / 2;
  return m;
}

const showItemLabels = !capture || !!onlySet;
let itemLabels: CSS2DObject[] = [];

/** Build one set as a compact grid block at the origin; returns the block group (not yet placed). */
function layoutBlock(set: CandidateSet, res: SetResult): THREE.Group {
  const block = new THREE.Group();
  const { size, axis, mode } = set.fit;
  const dims = res.placed.map((p) => measure(p.obj));
  const extent = (d: THREE.Vector3) => (axis === 'height' ? d.y : Math.max(d.x, d.z));
  // reference size for 'set' mode: the 80th-percentile extent, so one thin mast or antenna
  // does not shrink a whole kit (relative scale inside the set is still preserved)
  const sorted = dims.map(extent).filter((v) => v > 0).sort((a, b) => a - b);
  const setMax = Math.max(1e-6, sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.8))] ?? 1);
  const n = res.placed.length;
  const cols = n <= 5 ? n : Math.ceil(Math.sqrt(n * 1.8));
  // first pass: scale each model and measure its footprint, so every cell can share one size
  const cells = res.placed.map((p, i) => {
    const failed = (p as Placed & { error?: boolean }).error;
    const inner = new THREE.Group();
    if (failed) { inner.add(errorMarker(size * 0.6)); return { p, inner, w: size * 0.6, d: size * 0.6, h: size * 0.6, failed }; }
    const s = (mode === 'set' ? size / setMax : size / Math.max(1e-6, extent(dims[i]))) * (p.item.scale ?? 1);
    p.obj.position.set(0, 0, 0);
    inner.add(p.obj); inner.scale.setScalar(s); inner.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(inner);
    const c = box.getCenter(new THREE.Vector3());
    inner.position.set(-c.x, -box.min.y + (axis === 'length' ? size * 0.2 : 0), -c.z);
    const sz = box.getSize(new THREE.Vector3());
    return { p, inner, w: sz.x, d: sz.z, h: sz.y + (axis === 'length' ? size * 0.2 : 0), failed };
  });
  // flow layout: each model keeps its own footprint; rows wrap at a width chosen from the total area
  const gapX = size * 0.3, gapZ = size * (axis === 'height' && size < 3 ? 1.1 : 0.45);
  const area = cells.reduce((a, c) => a + (c.w + gapX) * (c.d + gapZ), 0);
  const rowWidth = Math.max(Math.sqrt(area * 2.2), ...cells.map((c) => c.w));
  let cx = 0, cz = 0, rowDepth = 0;
  const spots = cells.map((c) => {
    if (cx > 0 && cx + c.w > rowWidth) { cx = 0; cz += rowDepth + gapZ; rowDepth = 0; }
    const spot = { x: cx + c.w / 2, z: cz + c.d / 2 };
    cx += c.w + gapX; rowDepth = Math.max(rowDepth, c.d);
    return spot;
  });
  void cols;
  cells.forEach((c, i) => {
    const wrap = new THREE.Group();
    wrap.position.set(spots[i].x, 0, spots[i].z);
    wrap.add(c.inner);
    if (showItemLabels || c.failed) {
      const st = c.p.stats;
      const sub = c.failed ? 'failed to load' : `${st.triangles.toLocaleString()} tris${st.textures ? ` · ${st.textures} tex ≤${st.maxTexture}px` : ''}${c.p.clips.length ? ` · ${c.p.clips.length} anims` : ''}`;
      const l = label(`${c.p.name}<br><small>${sub}</small>`, c.failed ? 'err' : '');
      l.position.y = c.h + size * 0.1; wrap.add(l);
      if (!c.failed) { l.userData.fadeAt = size * 9; itemLabels.push(l); }
    }
    if (!c.failed && c.p.clips.length) {
      const mixer = new THREE.AnimationMixer(c.p.obj);
      const want = c.p.item.clip;
      const clip = (want && (c.p.clips.find((a) => a.name === want) ?? c.p.clips.find((a) => a.name.toLowerCase().includes(want.toLowerCase())))) || (want ? undefined : c.p.clips[0]);
      if (clip) { mixer.clipAction(clip).play(); mixers.push(mixer); }
    }
    block.add(wrap);
  });
  // title above the back-left corner of the block
  const title = label(set.title, 'title');
  title.position.set(0, size * 1.25, -size * 0.3);
  title.center.set(0, 1);
  block.add(title);
  return block;
}
function frame(box: THREE.Box3, fromAbove = 0.55) {
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  // fit the bounding sphere into the narrower of the two fields of view
  const vfov = (camera.fov * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const radius = Math.max(0.5, Math.hypot(s.x, s.z * 0.75, s.y) / 2);
  const dist = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * 0.82;
  const dir = new THREE.Vector3(0, fromAbove, 1).normalize();
  controls.target.copy(c);
  camera.position.copy(c).addScaledVector(dir, dist);
  camera.near = dist / 200; camera.far = dist * 20; camera.updateProjectionMatrix();
  key.position.set(c.x - s.x * 0.4, c.y + Math.max(s.x, 20), c.z + s.z + 20);
  key.target.position.copy(c);
  const r = Math.max(s.x, s.z) * 0.7 + 10;
  Object.assign(key.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.5, far: r * 6 });
  key.shadow.camera.updateProjectionMatrix();
  controls.update();
}

// ----------------------------------------------------------------- panel

function esc(s: string) { return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!)); }

function renderPanel(sets: CandidateSet[]) {
  panel.innerHTML = `<div class="set"><h2>${CATEGORY_LABEL[category]}</h2><div class="meta">Rendered sets appear in the 3D view under identical lighting. External sets show the creator's own published previews, because they cannot be downloaded here.</div></div>` + sets.map((s) => `
    <section class="set" id="set-${s.id}">
      <h2><span class="badge ${s.status}">${s.status}</span>${esc(s.title)}</h2>
      <div class="meta">${esc(s.creator)} · ${esc(s.license)} · ${s.source.startsWith('http') ? `<a href="${s.source}" target="_blank" rel="noopener">source</a>` : esc(s.source)}</div>
      <ul>${s.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
      <p class="verdict">${esc(s.verdict)}</p>
      <div class="stats" data-stats="${s.id}"></div>
      ${s.items ? `<button class="go" data-go="${s.id}">Show in view</button>` : ''}
      ${s.previews ? `<div class="previews">${s.previews.map((p) => `<figure><img loading="lazy" src="${p.url}" alt="${esc(p.caption)}"><figcaption>${esc(p.caption)}</figcaption></figure>`).join('')}</div>` : ''}
    </section>`).join('');
  panel.querySelectorAll<HTMLButtonElement>('button[data-go]').forEach((b) => b.addEventListener('click', () => { const box = lanes.get(b.dataset.go!); if (box) frame(box, 0.45); }));
}

// ----------------------------------------------------------------- category

let generation = 0;
async function show(cat: Category) {
  const gen = ++generation;
  category = cat;
  document.querySelectorAll<HTMLButtonElement>('header button[data-cat]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === cat)));
  // free everything from the previous category: lanes, mixers, labels and every loaded source
  for (const m of mixers) m.stopAllAction();
  mixers = [];
  for (const child of [...root.children]) root.remove(child);
  const old = cache; cache = new Map();
  for (const p of old.values()) p.then((l) => disposeObject(l.scene)).catch(() => {});
  for (const el of Array.from(labels.domElement.children)) el.remove();
  lanes.clear();
  itemLabels = [];

  const sets = CANDIDATE_SETS.filter((s) => s.category === cat && (!onlySet || s.id === onlySet));
  if (!capture) renderPanel(sets);
  const rendered = sets.filter((s) => s.items?.length);
  status.textContent = `Loading ${rendered.length} sets…`;
  const t0 = performance.now();
  let totalErrors = 0;
  const all = new THREE.Box3();
  // pack the set blocks into two columns (one when a single set is shown)
  const columns = rendered.length > 1 ? 2 : 1;
  const colX = [0, 0]; const colZ = [0, 0];
  const built: { s: CandidateSet; block: THREE.Group; res: SetResult }[] = [];
  for (const s of rendered) {
    const res = await buildSet(s);
    if (gen !== generation) return;
    built.push({ s, block: layoutBlock(s, res), res });
  }
  const widths = built.map(({ block }) => { block.updateMatrixWorld(true); return new THREE.Box3().setFromObject(block).getSize(new THREE.Vector3()).x; });
  const colWidth = Math.max(...widths, 1);
  built.forEach(({ s, block, res }, i) => {
    const col = i % columns;
    block.updateMatrixWorld(true);
    const b0 = new THREE.Box3().setFromObject(block);
    colX[col] = col * (colWidth + s.fit.size * 6);
    block.position.set(colX[col] - b0.min.x, 0, colZ[col] - b0.min.z + s.fit.size * 1.6);
    root.add(block);
    block.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(block);
    colZ[col] = box.max.z + s.fit.size * 2.2;
    lanes.set(s.id, box); all.union(box);
    totalErrors += res.errors.length;
    const tris = res.placed.reduce((a, p) => a + p.stats.triangles, 0);
    const el = panel.querySelector(`[data-stats="${s.id}"]`);
    if (el) el.innerHTML = `Rendered ${res.placed.length - res.errors.length}/${res.placed.length} models · ${tris.toLocaleString()} triangles · ${(res.bytes / 1e6).toFixed(1)} MB on disk` + res.errors.map((e) => `<div class="err">✗ ${esc(e)}</div>`).join('');
    if (res.errors.length) console.error(`[compare] ${s.id}:`, res.errors);
  });
  const elev: Record<Category, number> = { capital: 0.5, ships: 0.55, heroes: 0.16, villains: 0.2 };
  if (!all.isEmpty()) frame(all, onlySet ? elev[cat] : elev[cat] + 0.5);
  status.textContent = `${rendered.length} sets rendered in ${((performance.now() - t0) / 1000).toFixed(1)} s${totalErrors ? ` · ${totalErrors} failed to load` : ''}`;
  resize();
  document.body.dataset.ready = '1';
  document.body.dataset.errors = String(totalErrors);
}

document.querySelectorAll<HTMLButtonElement>('header button[data-cat]').forEach((b) => b.addEventListener('click', () => {
  document.body.dataset.ready = '';
  history.replaceState(null, '', `?cat=${b.dataset.cat}`);
  void show(b.dataset.cat as Category);
}));

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h); labels.setSize(w, h);
  camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  for (const m of mixers) m.update(dt);
  controls.update();
  // in the interactive view, item labels appear only when zoomed in close enough to read them
  if (!capture) { const tmp = new THREE.Vector3(); for (const l of itemLabels) l.visible = camera.position.distanceTo(l.getWorldPosition(tmp)) < l.userData.fadeAt; }
  renderer.render(scene, camera);
  labels.render(scene, camera);
});

void show(category);
