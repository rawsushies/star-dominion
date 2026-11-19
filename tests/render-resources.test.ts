import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { disposeObject, modelStats, resourcesOf } from '../src/ui/render/assets/resources';
import { loadAsset, preload, assetFailures, onAssetFailure } from '../src/ui/render/assets/loader';

describe('render resource management', () => {
  it('disposes each geometry, material and texture exactly once, and spares shared ones', () => {
    const tex = new THREE.Texture();
    const mat = new THREE.MeshStandardMaterial({ map: tex });
    const geo = new THREE.BoxGeometry();
    const keepGeo = new THREE.SphereGeometry();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geo, mat), new THREE.Mesh(geo, mat), new THREE.Mesh(keepGeo, [mat]));
    const spies = [vi.spyOn(tex, 'dispose'), vi.spyOn(mat, 'dispose'), vi.spyOn(geo, 'dispose'), vi.spyOn(keepGeo, 'dispose')];
    disposeObject(root, new Set([keepGeo]));
    expect(spies.map((s) => s.mock.calls.length)).toEqual([1, 1, 1, 0]);
    expect(resourcesOf(root).size).toBe(4);
  });

  it('measures triangles, draw calls, materials and textures', () => {
    const root = new THREE.Group();
    const img = { width: 512, height: 256 };
    const tex = new THREE.Texture(img as unknown as HTMLImageElement);
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: tex }))); // indexed: 12 triangles
    root.add(new THREE.Mesh(new THREE.BoxGeometry().toNonIndexed(), new THREE.MeshBasicMaterial())); // 12 triangles
    expect(modelStats(root)).toEqual({ triangles: 24, meshes: 2, materials: 2, textures: 1, maxTexture: 512 });
  });

  it('a model that fails to load is recorded, announced and reported by preload', async () => {
    const seen: string[] = [];
    const off = onAssetFailure((f) => seen.push(f.id));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // the server answers 404 for every model
    vi.stubGlobal('Request', class { url: string; constructor(u: string) { this.url = u; } });
    vi.stubGlobal('fetch', async () => new Response('missing', { status: 404, statusText: 'Not Found' }));
    await expect(loadAsset('ship_bob')).rejects.toBeTruthy();
    const res = await preload(['ship_bob', 'ship_omen']);
    expect(res.loaded).toEqual([]);
    expect(res.failed.map((f) => f.id).sort()).toEqual(['ship_bob', 'ship_omen']);
    expect(assetFailures().map((f) => f.id)).toContain('ship_omen');
    expect(seen).toContain('ship_bob');
    expect(assetFailures().find((f) => f.id === 'ship_bob')!.url).toMatch(/ships\/Bob\.glb$/);
    expect(warn).toHaveBeenCalled();
    expect(assetFailures().find((f) => f.id === 'ship_bob')!.reason).toMatch(/404/);
    off(); warn.mockRestore(); vi.unstubAllGlobals();
  });
});
