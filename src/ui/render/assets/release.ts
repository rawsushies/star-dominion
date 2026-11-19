// Tearing down a 3D view: free every GPU resource the view created, but leave the shared
// model cache intact so the next view can reuse the loaded models.

import type * as THREE from 'three';
import { disposeObject } from './resources';
import { sharedAssetResources } from './loader';

export function releaseView(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
  const keep = sharedAssetResources();
  disposeObject(scene, keep);
  for (const t of [scene.environment, scene.background]) {
    if (t && (t as THREE.Texture).isTexture && !keep.has(t)) (t as THREE.Texture).dispose();
  }
  scene.clear();
  renderer.renderLists.dispose();
  renderer.dispose();
}
