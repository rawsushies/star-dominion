// Loader for tevy.dev models (CC0): GLB with meshopt-compressed geometry and KTX2 (Basis)
// textures. The Basis transcoder is bundled in public/basis/, so nothing loads from a CDN.
// One KTX2 loader per renderer (it detects that renderer's compressed-texture support).

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const loaders = new WeakMap<THREE.WebGLRenderer, { gltf: GLTFLoader; ktx2: KTX2Loader }>();

export function tevyLoader(renderer: THREE.WebGLRenderer): GLTFLoader {
  let l = loaders.get(renderer);
  if (!l) {
    const base = (import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/');
    const ktx2 = new KTX2Loader().setTranscoderPath(`${base}basis/`).detectSupport(renderer);
    const gltf = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
    l = { gltf, ktx2 };
    loaders.set(renderer, l);
  }
  return l.gltf;
}

/** Release the KTX2 transcoder workers held for a renderer (call when the view is disposed). */
export function releaseTevyLoader(renderer: THREE.WebGLRenderer) {
  const l = loaders.get(renderer);
  if (l) { l.ktx2.dispose(); loaders.delete(renderer); }
}

/** URL of a bundled tevy model (public/assets/models/tevy/<slug>.lod<n>.glb). */
export function tevyUrl(slug: string, lod: number, base = `${(import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/')}assets/models/tevy/`): string {
  return `${base}${slug}.lod${lod}.glb`;
}

export async function loadTevy(renderer: THREE.WebGLRenderer, url: string): Promise<GLTF> {
  return tevyLoader(renderer).loadAsync(url);
}
