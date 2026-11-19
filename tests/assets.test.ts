import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { ASSETS, PACKS, SHIP_MODELS, CHARACTER_MODELS, ANTAGONIST_MODELS, BUILDING_TIERS, DECOR, tierFor } from '../src/ui/render/assets/catalog';
import { SHIPS } from '../src/sim/data/ships';
import { ROLE_ORDER } from '../src/sim/data/characters';
import { CAPITAL_BUILDINGS } from '../src/sim/data/capital';

/** Minimal GLB reader: header, JSON chunk, and whether textures are embedded. */
function readGlb(path: string) {
  const b = readFileSync(path);
  expect(b.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  expect(b.readUInt32LE(4)).toBe(2);
  const jsonLen = b.readUInt32LE(12);
  expect(b.readUInt32LE(16)).toBe(0x4e4f534a); // 'JSON'
  return JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8')) as { images?: { uri?: string }[]; meshes?: unknown[]; animations?: { name: string }[]; materials?: { alphaMode?: string }[] };
}

describe('sourced 3D assets', () => {
  it('every catalogued file exists, is a valid self-contained GLB and comes from a CC0 pack', () => {
    for (const [id, a] of Object.entries(ASSETS)) {
      const path = `public/assets/models/${a.file}`;
      expect(existsSync(path), `${id} -> ${path}`).toBe(true);
      expect(statSync(path).size).toBeLessThan(2_500_000);
      const j = readGlb(path);
      expect(j.meshes?.length ?? 0, id).toBeGreaterThan(0);
      for (const img of j.images ?? []) expect(img.uri, `${id} has an external texture`).toBeUndefined();
      expect(PACKS[a.pack].license).toBe('CC0 1.0');
    }
  });

  it('animated characters carry idle animations and render opaque', () => {
    for (const [id, a] of Object.entries(ASSETS)) {
      if (!('animated' in a) || !a.animated) continue;
      const j = readGlb(`public/assets/models/${a.file}`);
      expect((j.animations ?? []).some((x) => /idle/i.test(x.name)), id).toBe(true);
      for (const m of j.materials ?? []) expect(m.alphaMode ?? 'OPAQUE', id).toBe('OPAQUE');
    }
  });

  it('maps every ship class to a distinct hull with increasing size for heavier classes', () => {
    for (const cls of Object.keys(SHIPS)) expect(SHIP_MODELS[cls as keyof typeof SHIP_MODELS], cls).toBeDefined();
    const hulls = Object.values(SHIP_MODELS).map((m) => m.asset);
    expect(new Set(hulls).size).toBe(hulls.length);
    expect(SHIP_MODELS.dreadnought.length).toBeGreaterThan(SHIP_MODELS.battleship.length);
    expect(SHIP_MODELS.battleship.length).toBeGreaterThan(SHIP_MODELS.cruiser.length);
    expect(SHIP_MODELS.cruiser.length).toBeGreaterThan(SHIP_MODELS.corvette.length);
  });

  it('gives every character role a body and every capital building tiered models', () => {
    for (const r of ROLE_ORDER) expect(CHARACTER_MODELS[r].length, r).toBeGreaterThan(0);
    for (const id of [...Object.values(CHARACTER_MODELS).flat(), ...ANTAGONIST_MODELS, ...Object.values(DECOR)]) expect(ASSETS[id], id).toBeDefined();
    for (const b of CAPITAL_BUILDINGS) {
      const tiers = BUILDING_TIERS[b.id];
      expect(tiers?.length, b.id).toBeGreaterThan(0);
      expect(tiers[0].from).toBe(1);
      for (let i = 1; i < tiers.length; i++) expect(tiers[i].from).toBeGreaterThan(tiers[i - 1].from);
      for (const t of tiers) for (const p of t.parts) expect(ASSETS[p.asset], `${b.id}:${p.asset}`).toBeDefined();
      // the look changes as the building rises
      expect(tierFor(b.id, b.maxLevel)).toBe(tiers[tiers.length - 1]);
    }
    expect(BUILDING_TIERS.citadel.length).toBeGreaterThanOrEqual(4);
  });
});
