// Developer preview: every planet type rendered live in 3D (open /lab.html).
import * as THREE from 'three';
import { buildPlanet } from '../ui/render/planet3d';
import { PLANET_TYPES } from '../sim/data/planets';
import type { PlanetType } from '../sim/types';

const cv = document.getElementById('c') as HTMLCanvasElement;
const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
r.setPixelRatio(window.devicePixelRatio);
r.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 100);
const close = location.hash === '#close';
cam.position.set(close ? -4.6 : 0, close ? 2.2 : 0, close ? 5 : 22);
const types = Object.keys(PLANET_TYPES) as PlanetType[];
const builds = types.map((t, i) => {
  const b = buildPlanet(t, 1000 + i * 37, i % 3 === 0 ? 0.9 : 0);
  b.group.position.set(((i % 6) - 2.5) * 3.1, i < 6 ? 2.2 : -2.2, 0);
  if (t === 'gas_giant') b.group.scale.setScalar(1.1);
  scene.add(b.group);
  return b;
});
const L = new THREE.Vector3(-1, 0.3, 0.55);
const loop = (t: number) => {
  for (const b of builds) { b.setLight(L); b.setTime(t * 40); }
  r.render(scene, cam);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
