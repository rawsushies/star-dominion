// GPU resource helpers shared by every 3D view: releasing geometries, materials and textures
// when a view or model is discarded, and measuring a model's rendering cost.

import * as THREE from 'three';

const TEXTURE_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'envMap', 'specularMap'] as const;

function materialsOf(o: THREE.Object3D): THREE.Material[] {
  const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
  return !m ? [] : Array.isArray(m) ? m : [m];
}

function texturesOf(mat: THREE.Material): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  const rec = mat as unknown as Record<string, unknown>;
  for (const k of TEXTURE_KEYS) { const t = rec[k]; if (t && (t as THREE.Texture).isTexture) out.push(t as THREE.Texture); }
  return out;
}

/**
 * Dispose every geometry, material and texture under `root`, once each.
 * `keep` lists resources that are shared with something still alive (e.g. a model cache)
 * and must survive.
 */
export function disposeObject(root: THREE.Object3D, keep?: Set<unknown>): void {
  const seen = new Set<unknown>();
  const free = (r: { dispose(): void } | undefined | null) => {
    if (!r || seen.has(r) || keep?.has(r)) return;
    seen.add(r);
    r.dispose();
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) free(mesh.geometry);
    for (const mat of materialsOf(o)) { for (const t of texturesOf(mat)) free(t); free(mat); }
    const sk = (o as THREE.SkinnedMesh).skeleton;
    if (sk) free(sk);
  });
}

/** Every geometry, material and texture under `root` (for building a `keep` set). */
export function resourcesOf(root: THREE.Object3D): Set<unknown> {
  const out = new Set<unknown>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) out.add(mesh.geometry);
    for (const mat of materialsOf(o)) { out.add(mat); for (const t of texturesOf(mat)) out.add(t); }
  });
  return out;
}

export interface ModelStats { triangles: number; meshes: number; materials: number; textures: number; maxTexture: number }

/** Rendering cost of a model: triangles, draw calls, materials and texture sizes. */
export function modelStats(root: THREE.Object3D): ModelStats {
  let triangles = 0, meshes = 0, maxTexture = 0;
  const mats = new Set<THREE.Material>(); const texs = new Set<THREE.Texture>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    meshes++;
    const g = mesh.geometry;
    triangles += Math.round((g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3);
    for (const m of materialsOf(o)) {
      mats.add(m);
      for (const t of texturesOf(m)) {
        texs.add(t);
        const img = t.image as { width?: number; height?: number } | undefined;
        if (img?.width) maxTexture = Math.max(maxTexture, img.width, img.height ?? 0);
      }
    }
  });
  return { triangles, meshes, materials: mats.size, textures: texs.size, maxTexture };
}
