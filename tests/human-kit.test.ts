import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ARCHETYPE_ORDER, archetypeVariants, humanSpec } from '../src/ui/render/characters/archetypes';
import { ROLE_ORDER } from '../src/sim/data/characters';

/** The JSON chunk of a GLB. */
function gltf(file: string): { nodes: { name: string }[]; skins?: { joints: number[] }[]; animations?: { name: string; channels: { target: { node: number } }[] }[] } {
  const b = readFileSync(`public/assets/models/chars2/${file}`);
  const n = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + n).toString('utf8'));
}
const joints = (g: ReturnType<typeof gltf>) => new Set(g.skins![0].joints.map((j) => g.nodes[j].name));

describe('human character kit', () => {
  const male = gltf('male.glb'), female = gltf('female.glb'), anims = gltf('anims.glb');

  it('bodies, outfit parts and both animation libraries share one skeleton', () => {
    const ref = joints(male);
    expect(ref.size).toBe(65);
    expect(joints(female)).toEqual(ref);
    // every animated node in the clip file is a bone the bodies have
    for (const a of anims.animations!) for (const c of a.channels) expect(ref.has(anims.nodes[c.target.node].name)).toBe(true);
    // every skinned part of a body binds the same bones
    for (const s of male.skins!) for (const j of s.joints) expect(ref.has(male.nodes[j].name)).toBe(true);
  });

  it('every part an archetype can show exists in both bodies', () => {
    const parts = ['head', 'eyes', 'ranger_body', 'ranger_arms', 'ranger_legs', 'ranger_feet', 'ranger_hood', 'ranger_pauldron', 'peasant_body', 'peasant_arms', 'peasant_legs', 'peasant_feet', 'hair_long', 'hair_buns', 'hair_buzzed', 'hair_simpleparted', 'hair_buzzedfemale'];
    for (const g of [male, female]) {
      const names = new Set(g.nodes.map((n) => n.name.replace(/(_\d+|\.\d+)+$/, '')));
      for (const p of parts) expect(names.has(p), p).toBe(true);
    }
    expect(male.nodes.some((n) => n.name.startsWith('hair_beard'))).toBe(true);
  });

  it('every animation an archetype plays is in the clip file', () => {
    const clips = new Set(anims.animations!.map((a) => a.name));
    for (const a of ARCHETYPE_ORDER) for (const v of archetypeVariants(a)) for (const n of v.anims) expect(clips.has(n), `${a}: ${n}`).toBe(true);
    for (const g of ['yes', 'no', 'talk', 'interact', 'comms', 'hail', 'command', 'pistol_aim', 'pistol_idle']) expect(clips.has(g), g).toBe(true);
  });

  it('covers every roster role, and the same id always gives the same person', () => {
    for (const r of ROLE_ORDER) expect(ARCHETYPE_ORDER).toContain(r);
    expect(humanSpec('admiral', 42)).toEqual(humanSpec('admiral', 42));
    // people of one role differ: across 24 admirals, several faces, skin tones and builds
    const many = Array.from({ length: 24 }, (_, i) => humanSpec('admiral', i));
    expect(new Set(many.map((s) => s.skin)).size).toBeGreaterThan(4);
    expect(new Set(many.map((s) => `${s.sex}${s.hair}${s.beard}`)).size).toBeGreaterThan(4);
    expect(new Set(many.map((s) => s.label)).size).toBe(archetypeVariants('admiral').length);
  });
});
