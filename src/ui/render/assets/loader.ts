// Loads catalogued GLB models once and hands out normalised clones.
// Models are fetched lazily the first time a view asks for them. A view shows a simple
// placeholder while a model is in flight; if loading fails, the failure is recorded, logged
// and announced to subscribers (the UI shows a notice naming the model), so a missing
// asset is never silently replaced.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ASSETS, assetUrl, type AssetId, type AssetDef } from './catalog';
import { resourcesOf } from './resources';

const loader = new GLTFLoader();
const cache = new Map<AssetId, Promise<GLTF>>();
const ready = new Map<AssetId, GLTF>();
/** Geometries, materials and textures owned by the model cache; views must not free these. */
const shared = new Set<unknown>();

export interface AssetFailure { id: AssetId; url: string; reason: string; at: number }
const failures = new Map<AssetId, AssetFailure>();
const listeners = new Set<(f: AssetFailure) => void>();

function reasonOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'target' in e) {
    const t = (e as { target?: { status?: number; statusText?: string } }).target;
    if (t?.status) return `HTTP ${t.status} ${t.statusText ?? ''}`.trim();
  }
  return String(e);
}

export function loadAsset(id: AssetId): Promise<GLTF> {
  let p = cache.get(id);
  if (!p) {
    const url = assetUrl(ASSETS[id]);
    p = loader.loadAsync(url).then((g) => {
      g.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      for (const r of resourcesOf(g.scene)) shared.add(r);
      ready.set(id, g);
      failures.delete(id);
      return g;
    });
    p.catch((e) => {
      cache.delete(id); // allow a later retry
      const f: AssetFailure = { id, url, reason: reasonOf(e), at: Date.now() };
      failures.set(id, f);
      console.warn(`[assets] ${id} failed to load from ${url}: ${f.reason}`);
      for (const l of listeners) l(f);
    });
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

export interface PreloadResult { loaded: AssetId[]; failed: AssetFailure[] }

/** Load a batch of models; resolves once every one has either arrived or failed. */
export async function preload(ids: AssetId[]): Promise<PreloadResult> {
  const settled = await Promise.allSettled(ids.map(loadAsset));
  const loaded: AssetId[] = []; const failed: AssetFailure[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') loaded.push(ids[i]);
    else failed.push(failures.get(ids[i]) ?? { id: ids[i], url: assetUrl(ASSETS[ids[i]]), reason: reasonOf(r.reason), at: Date.now() });
  });
  return { loaded, failed };
}

/** Every model that has failed to load and not since recovered. */
export function assetFailures(): AssetFailure[] { return [...failures.values()]; }

/** Subscribe to load failures; returns an unsubscribe function. */
export function onAssetFailure(fn: (f: AssetFailure) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Resources owned by the model cache, to pass as `keep` when a view frees its scene. */
export function sharedAssetResources(): Set<unknown> { return shared; }
