// Loads catalogued GLB models once and hands out normalised clones.
// Models are fetched lazily the first time a view asks for them; callers
// render a placeholder until the promise resolves, and keep it if loading fails.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ASSETS, assetUrl, type AssetId, type AssetDef } from './catalog';

const loader = new GLTFLoader();
const cache = new Map<AssetId, Promise<GLTF>>();
const ready = new Map<AssetId, GLTF>();

export function loadAsset(id: AssetId): Promise<GLTF> {
  let p = cache.get(id);
  if (!p) {
    p = loader.loadAsync(assetUrl(ASSETS[id])).then((g) => {
      g.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      ready.set(id, g);
      return g;
    });
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

/** The loaded model, if it has arrived. */
export function assetIfReady(id: AssetId): GLTF | null {
  return ready.get(id) ?? null;
}

/** A fresh copy of an asset's scene (skeletons are cloned properly). */
export function instance(id: AssetId): THREE.Object3D | null {
  const g = ready.get(id);
  if (!g) return null;
  return (ASSETS[id] as AssetDef).animated ? cloneSkinned(g.scene) : g.scene.clone(true);
}

/** Wrap an object so its bounding box is centred on x/z, sits on y=0, and is scaled to fit. */
export function normalised(obj: THREE.Object3D, opts: { height?: number; length?: number; maxFoot?: number }): THREE.Group {
  const wrap = new THREE.Group();
  wrap.add(obj);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  let s = 1;
  if (opts.height) s = opts.height / Math.max(size.y, 1e-6);
  if (opts.length) s = opts.length / Math.max(size.x, size.z, 1e-6);
  if (opts.maxFoot) s = Math.min(s, opts.maxFoot / Math.max(size.x, size.z, 1e-6));
  const c = box.getCenter(new THREE.Vector3());
  obj.position.set(-c.x, -box.min.y, -c.z);
  wrap.scale.setScalar(s);
  return wrap;
}

export function preload(ids: AssetId[]): Promise<unknown> {
  return Promise.allSettled(ids.map(loadAsset));
}
