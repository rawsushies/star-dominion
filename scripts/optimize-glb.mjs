// Shrinks GLBs written by the Blender build scripts: quantised vertex data (KHR_mesh_quantization,
// read natively by three's GLTFLoader), resampled animation keys, deduplicated accessors.
// Usage: node scripts/optimize-glb.mjs <file.glb> [...]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, resample } from '@gltf-transform/functions';
import { statSync } from 'node:fs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const file of process.argv.slice(2)) {
  const before = statSync(file).size;
  const doc = await io.read(file);
  await doc.transform(dedup(), resample({ tolerance: 1e-4 }), prune(), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8 }));
  await io.write(file, doc);
  console.log(`${file}: ${(before / 1e6).toFixed(2)} → ${(statSync(file).size / 1e6).toFixed(2)} MB`);
}
