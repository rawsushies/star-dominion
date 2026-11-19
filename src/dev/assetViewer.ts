// Development viewer for the sourced 3D assets (open /assets.html on the dev server).
// Sections: every ship class, every character body, antagonists, each capital
// building at each level tier, and a full capital arrangement.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { ASSETS, PACKS, SHIP_MODELS, CHARACTER_MODELS, ANTAGONIST_MODELS, BUILDING_TIERS, type AssetId } from '../ui/render/assets/catalog';
import { loadAsset, instance, normalised, preload } from '../ui/render/assets/loader';
import { buildCapitalPart } from '../ui/render/capital3d';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
Object.assign(labels.domElement.style, { position: 'fixed', top: '0', left: '0', pointerEvents: 'none' });
document.body.appendChild(labels.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc4e8);
scene.add(new THREE.HemisphereLight(0xeaf3ff, 0x55604a, 1.1));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.position.set(20, 30, 15); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x7aa36a }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 1000);
const controls = new OrbitControls(camera, renderer.domElement);
const root = new THREE.Group();
scene.add(root);
const mixers: THREE.AnimationMixer[] = [];
const status = document.getElementById('status')!;

function label(text: string, sub: string, y: number): CSS2DObject {
  const d = document.createElement('div');
  d.className = 'lbl';
  d.innerHTML = `${text}<br><small>${sub}</small>`;
  const o = new CSS2DObject(d);
  o.position.y = y;
  return o;
}

function credit(id: AssetId): string { const p = PACKS[ASSETS[id].pack]; return `${p.creator} · ${p.license}`; }

async function show(section: string) {
  document.querySelectorAll('#bar button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.s === section));
  root.clear(); mixers.length = 0;
  root.traverse(() => {});
  for (const el of Array.from(labels.domElement.children)) el.remove();
  status.textContent = 'Loading…';
  const t0 = performance.now();
  if (section === 'ships') {
    const classes = Object.keys(SHIP_MODELS) as (keyof typeof SHIP_MODELS)[];
    await preload(classes.map((c) => SHIP_MODELS[c].asset));
    classes.forEach((c, i) => {
      const m = SHIP_MODELS[c];
      const o = instance(m.asset); if (!o) return;
      const g = normalised(o, { length: m.length * 2.2 });
      g.position.set((i % 5) * 7 - 14, 1.5, Math.floor(i / 5) * 7 - 7);
      g.rotation.y = -0.6;
      g.add(label(c, `${ASSETS[m.asset].file} · ${credit(m.asset)}`, 2.2 / g.scale.x));
      root.add(g);
    });
    frame(new THREE.Vector3(0, 18, 26));
  } else if (section === 'chars' || section === 'villains') {
    const ids: AssetId[] = section === 'chars' ? [...new Set(Object.values(CHARACTER_MODELS).flat())] : ANTAGONIST_MODELS;
    await preload(ids);
    ids.forEach((id, i) => {
      const o = instance(id); if (!o) return;
      const g = normalised(o, { height: 1.8 });
      g.position.set((i % 6) * 2.2 - 5.5, 0, Math.floor(i / 6) * 3 - 1.5);
      const roles = Object.entries(CHARACTER_MODELS).filter(([, v]) => v.includes(id)).map(([k]) => k).join(', ');
      g.add(label(id.replace(/^(char|mech|alien)_/, ''), `${roles || 'antagonist'} · ${credit(id)}`, 2.0 / g.scale.x));
      const gl = (o.userData.__gltf) as undefined;
      void gl;
      loadAsset(id).then((gltf) => {
        const idle = gltf.animations.find((a) => /idle/i.test(a.name)) ?? gltf.animations[0];
        if (idle) { const mx = new THREE.AnimationMixer(o); mx.clipAction(idle).play(); mixers.push(mx); }
      });
      root.add(g);
    });
    frame(new THREE.Vector3(0, 4, 11), new THREE.Vector3(0, 1, 0));
  } else if (section === 'city') {
    const ids = Object.keys(BUILDING_TIERS);
    const allAssets = [...new Set(ids.flatMap((id) => BUILDING_TIERS[id].flatMap((t) => t.parts.map((p) => p.asset))))];
    await preload(allAssets);
    ids.forEach((id, r) => {
      BUILDING_TIERS[id].forEach((t, c) => {
        const g = buildCapitalPart(id, t.from, 4);
        if (!g) return;
        g.position.set(c * 6 - 6, 0, r * 6 - 45);
        g.add(label(`${id} ${t.from}+`, t.parts.map((p) => p.asset).join(', '), 6));
        root.add(g);
      });
    });
    frame(new THREE.Vector3(30, 40, 30), new THREE.Vector3(0, 0, 0));
  } else if (section === 'capital') {
    // a whole late-game city, built with the same parts the game uses
    const ids = Object.keys(BUILDING_TIERS);
    await preload([...new Set(ids.flatMap((id) => BUILDING_TIERS[id].flatMap((t) => t.parts.map((p) => p.asset))))]);
    const order = ['throne_hall', 'treasury', 'hall_of_heroes', 'research_institute', 'imperial_shipyards', 'refinery_complex', 'diplomatic_quarter', 'military_academy', 'intelligence_bureau', 'grand_market', 'bastion', 'arcology', 'stellar_observatory', 'stellar_forge', 'monument_of_ages'];
    const slots: [number, number][] = [];
    for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) if (r || c) slots.push([c, r]);
    const cit = buildCapitalPart('citadel', 22, 5.2)!;
    root.add(cit);
    order.forEach((id, i) => {
      const g = buildCapitalPart(id, 6 + (i * 5) % 15, 4.2);
      if (!g) return;
      const [c, r] = slots[i];
      g.position.set(c * 5.6, 0, r * 5.6);
      root.add(g);
    });
    frame(new THREE.Vector3(20, 22, 26), new THREE.Vector3(0, 2, 0));
  }
  status.textContent = `${section}: ${root.children.length} objects, ${Math.round(performance.now() - t0)} ms`;
  (window as unknown as { __assetsReady?: string }).__assetsReady = section;
}

function frame(pos: THREE.Vector3, target = new THREE.Vector3(0, 0, 0)) {
  camera.position.copy(pos); controls.target.copy(target); controls.update();
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  for (const m of mixers) m.update(dt);
  controls.update();
  renderer.render(scene, camera);
  labels.render(scene, camera);
});
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); labels.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
document.querySelectorAll('#bar button').forEach((b) => b.addEventListener('click', () => show((b as HTMLElement).dataset.s!)));
show(new URLSearchParams(location.search).get('s') ?? 'ships');
