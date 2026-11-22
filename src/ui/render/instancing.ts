// Shared helpers for drawing many copies of sourced models cheaply.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Merge static meshes by material, keeping UVs (the kit is textured). */
export function mergeByMaterial(group: THREE.Group) {
  group.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || m.userData.keep) return;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    // keep what the material reads (vertex colours, a second UV set for markings, tangents);
    // skinning data is not used by a static copy
    for (const k of Object.keys(g.attributes)) if (['skinIndex', 'skinWeight'].includes(k) || k.startsWith('_')) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    // quantised kit attributes are normalised integers; merge in float
    for (const k of Object.keys(g.attributes)) {
      const a = g.attributes[k] as THREE.BufferAttribute;
      if (!(a.array instanceof Float32Array)) {
        const f = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
        g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
      }
    }
    g.applyMatrix4(m.matrixWorld);
    let b = buckets.get(m.material);
    if (!b) buckets.set(m.material, (b = { geos: [], meshes: [] }));
    b.geos.push(g); b.meshes.push(m);
  });
  const out: THREE.Mesh[] = [];
  for (const [mat, b] of buckets) {
    // merging needs the same attributes on every piece: keep those all of them have
    const common = Object.keys(b.geos[0].attributes).filter((k) => b.geos.every((g) => g.attributes[k]));
    for (const g of b.geos) for (const k of Object.keys(g.attributes)) if (!common.includes(k)) g.deleteAttribute(k);
    const merged = mergeGeometries(b.geos);
    b.geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    out.push(mesh);
  }
  group.clear();
  for (const m of out) group.add(m);
}


/** Instanced copies of one model, merged by material: one draw call per material. */
export function instancedFrom(src: THREE.Object3D, count: number, opts: { shadow?: boolean } = {}): THREE.InstancedMesh[] {
  const g = new THREE.Group();
  const c = src.clone(true);
  c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); c.scale.setScalar(1);
  g.add(c);
  mergeByMaterial(g);
  return (g.children as THREE.Mesh[]).map((m) => {
    const im = new THREE.InstancedMesh(m.geometry, m.material, Math.max(1, count));
    im.count = count;
    im.castShadow = !!opts.shadow; im.receiveShadow = true;
    im.userData.keep = true;
    im.frustumCulled = false; // instances spread far beyond the source's bounds
    return im;
  });
}

/** Once a static set's instances are placed: bound them so the whole set is culled off screen. */
export function finishStatic(ims: THREE.InstancedMesh[]) {
  for (const im of ims) { im.computeBoundingSphere(); im.frustumCulled = true; }
}
