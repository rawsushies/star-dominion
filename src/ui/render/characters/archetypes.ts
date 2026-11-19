// Imperial archetypes: how each kind of person dresses, stands and moves. A character's id picks a
// variant, sex, hairstyle, skin and hair tones and proportions, so two admirals rarely look alike.

import type { CharRole } from '../../../sim/data/characters';
import type { Hair, HumanSpec, OutfitPart, Palette, Sex } from './humanKit';

export type Archetype = CharRole | 'sovereign' | 'rival' | 'villain';

interface Variant {
  label: string;
  body: OutfitPart; arms: OutfitPart; legs: OutfitPart; feet: OutfitPart;
  hood?: boolean; pauldron?: boolean;
  palette: Palette;
  anims: string[];
  prop?: 'pistol' | 'revolver';
}

// palettes (shadow, mid, highlight)
const NAVY: Palette = { cloth: [0x05070f, 0x1a2a52, 0x5a7bc4], leather: [0x0a0806, 0x6b5320, 0xe8c76a] };
const NAVY_WHITE: Palette = { cloth: [0x2a2f3a, 0xb8bfcc, 0xffffff], leather: [0x05070f, 0x1a2a52, 0xd9b45a] };
const OLIVE: Palette = { cloth: [0x0b0d08, 0x3c4630, 0x8f9c72], leather: [0x080808, 0x2e2e30, 0x9aa0a8] };
const CHARCOAL: Palette = { cloth: [0x070707, 0x2a2c30, 0x737880], leather: [0x0a0504, 0x5a1a14, 0xc0503a] };
const BURGUNDY: Palette = { cloth: [0x12040a, 0x5a1430, 0xc4607a], leather: [0x0a0806, 0x6b5320, 0xf0d080] };
const VIOLET: Palette = { cloth: [0x0a0614, 0x3a2266, 0x9a80d8], leather: [0x0b0b0e, 0x4a4a56, 0xd8d8e8] };
const TEAL: Palette = { cloth: [0x031010, 0x14505a, 0x6ac0c8], leather: [0x0d0b08, 0x5a4a30, 0xe8dcc0] };
const LAB: Palette = { cloth: [0x4a525e, 0xd8dee8, 0xffffff], leather: [0x041020, 0x1e5a8c, 0x7ac8ff] };
const RUST: Palette = { cloth: [0x100804, 0x7a3a12, 0xe89a4a], leather: [0x0a0a0a, 0x3a3a3c, 0x9a9ca0] };
const SAND: Palette = { cloth: [0x1a140a, 0x8a7448, 0xe0d0a0], leather: [0x0a0806, 0x4a3420, 0xa88050] };
const SHADOW: Palette = { cloth: [0x020203, 0x121318, 0x3a3e4a], leather: [0x050202, 0x3a0c0c, 0x8a2020] };
const IVORY: Palette = { cloth: [0x3a3020, 0xd8ccb0, 0xfff8e8], leather: [0x0a0402, 0x6a1010, 0xf0c860], keep: 0.05 };
const OBSIDIAN: Palette = { cloth: [0x020202, 0x18101e, 0x5a3a70], leather: [0x080808, 0x5a5e66, 0xe0e4ec] };
const CRIMSON: Palette = { cloth: [0x080202, 0x4a0808, 0xb02020], leather: [0x020202, 0x1a1a1e, 0x5a5e66] };

const R = 'ranger', P = 'peasant';
const ARCHETYPES: Record<Archetype, Variant[]> = {
  sovereign: [
    { label: 'Imperial regalia', body: R, arms: R, legs: R, feet: R, pauldron: true, palette: IVORY, anims: ['fold_arms', 'talk', 'idle'] },
    { label: 'Throne armour', body: R, arms: R, legs: R, feet: R, pauldron: true, palette: { ...NAVY_WHITE, leather: [0x0a0806, 0x8a6a20, 0xffe08a] }, anims: ['fold_arms', 'idle'] },
  ],
  admiral: [
    { label: 'Fleet dress uniform', body: R, arms: R, legs: P, feet: R, pauldron: true, palette: NAVY, anims: ['fold_arms', 'idle', 'talk'] },
    { label: 'Bridge whites', body: R, arms: R, legs: R, feet: R, palette: NAVY_WHITE, anims: ['talk', 'idle', 'yes'] },
  ],
  general: [
    { label: 'Field armour', body: R, arms: R, legs: R, feet: R, pauldron: true, palette: OLIVE, anims: ['pistol_idle', 'pistol_aim'], prop: 'revolver' },
    { label: 'Marine officer', body: R, arms: R, legs: R, feet: R, pauldron: true, palette: CHARCOAL, anims: ['pistol_idle', 'pistol_aim'], prop: 'pistol' },
  ],
  governor: [
    { label: 'Provincial robes', body: P, arms: P, legs: R, feet: R, palette: BURGUNDY, anims: ['talk', 'fold_arms', 'idle'] },
    { label: 'House colours', body: R, arms: P, legs: P, feet: R, palette: { ...BURGUNDY, cloth: [0x060a04, 0x24401c, 0x7aa060] }, anims: ['talk', 'yes'] },
  ],
  scientist: [
    { label: 'Laboratory coat', body: P, arms: P, legs: P, feet: P, palette: LAB, anims: ['interact', 'comms', 'idle'] },
    { label: 'Field researcher', body: P, arms: R, legs: R, feet: R, palette: TEAL, anims: ['interact', 'talk'] },
  ],
  diplomat: [
    { label: 'Envoy attire', body: P, arms: P, legs: R, feet: R, palette: TEAL, anims: ['talk', 'yes', 'idle'] },
    { label: 'Court formal', body: P, arms: P, legs: P, feet: R, palette: VIOLET, anims: ['talk', 'hail'] },
  ],
  chancellor: [
    { label: 'Chancery robes', body: P, arms: P, legs: R, feet: R, palette: VIOLET, anims: ['fold_arms', 'talk', 'no'] },
    { label: 'Treasury formal', body: R, arms: P, legs: P, feet: R, palette: BURGUNDY, anims: ['talk', 'idle'] },
  ],
  industrialist: [
    { label: 'Foundry master', body: P, arms: P, legs: R, feet: R, palette: RUST, anims: ['interact', 'hail', 'idle'] },
    { label: 'Shipwright', body: P, arms: R, legs: P, feet: R, palette: { ...RUST, cloth: [0x0a0a0a, 0x3a3e44, 0x9aa2ac] }, anims: ['interact', 'fold_arms'] },
  ],
  explorer: [
    { label: 'Pathfinder', body: R, arms: R, legs: R, feet: R, palette: SAND, anims: ['comms', 'walk', 'idle'] },
    { label: 'Deep-range scout', body: R, arms: R, legs: R, feet: R, hood: true, palette: OLIVE, anims: ['pistol_idle'], prop: 'pistol' },
  ],
  spymaster: [
    { label: 'Shadow operative', body: R, arms: R, legs: R, feet: R, hood: true, palette: SHADOW, anims: ['idle', 'sword_idle', 'fold_arms'] },
    { label: 'Court informant', body: P, arms: R, legs: R, feet: R, palette: CHARCOAL, anims: ['fold_arms', 'comms'] },
  ],
  rival: [
    { label: 'Rival sovereign', body: R, arms: R, legs: R, feet: R, pauldron: true, palette: OBSIDIAN, anims: ['command_idle', 'fold_arms', 'no'] },
    { label: 'Warlord', body: R, arms: R, legs: R, feet: R, pauldron: true, palette: CRIMSON, anims: ['guard', 'command'] },
  ],
  villain: [
    { label: 'Hooded tyrant', body: R, arms: R, legs: R, feet: R, hood: true, pauldron: true, palette: OBSIDIAN, anims: ['command_idle', 'sword_idle'] },
    { label: 'Pirate lord', body: R, arms: P, legs: R, feet: R, pauldron: true, palette: CRIMSON, anims: ['pistol_idle', 'pistol_aim'], prop: 'revolver' },
  ],
};

export function archetypeVariants(a: Archetype): readonly Variant[] { return ARCHETYPES[a]; }
export const ARCHETYPE_ORDER: Archetype[] = ['sovereign', 'admiral', 'general', 'governor', 'scientist', 'diplomat', 'chancellor', 'industrialist', 'explorer', 'spymaster', 'rival', 'villain'];

const SKIN = [0xd8b298, 0xd2a888, 0xc4936c, 0xa8744e, 0x845436, 0x633c26, 0x45291a, 0xb88566];
const HAIR_COLOR = [0x1a1410, 0x3a2416, 0x6a4424, 0x9a6a3a, 0xc8a060, 0xdcdcd8, 0x7a7a7a, 0x5a1a10];
const HAIR_M: Hair[] = ['hair_buzzed', 'hair_simpleparted', 'hair_buzzed', null];
const HAIR_F: Hair[] = ['hair_long', 'hair_buns', 'hair_buzzedfemale', 'hair_simpleparted'];

function hash(n: number, k: number): number {
  const x = Math.sin((n + 1) * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
const pick = <T>(arr: readonly T[], n: number, k: number): T => arr[Math.floor(hash(n, k) * arr.length) % arr.length];

/** The spec for a person: archetype and a seed (the character id), optionally a fixed variant or sex. */
export function humanSpec(a: Archetype, seed: number, opt: { variant?: number; sex?: Sex; anim?: string } = {}): HumanSpec & { label: string } {
  const vs = ARCHETYPES[a];
  const v = vs[opt.variant ?? Math.floor(hash(seed, 1) * vs.length) % vs.length];
  const sex: Sex = opt.sex ?? (hash(seed, 2) < 0.5 ? 'male' : 'female');
  const age = hash(seed, 7);
  return {
    label: v.label, sex, body: v.body, arms: v.arms, legs: v.legs, feet: v.feet, hood: v.hood, pauldron: v.pauldron,
    hair: pick(sex === 'male' ? HAIR_M : HAIR_F, seed, 3),
    beard: sex === 'male' && hash(seed, 4) < 0.4,
    skin: pick(SKIN, seed, 5),
    hairColor: age > 0.8 ? 0xd0d0cc : pick(HAIR_COLOR, seed, 6),
    palette: v.palette,
    height: (sex === 'male' ? 1.0 : 0.97) * (0.95 + hash(seed, 8) * 0.1),
    build: 0.92 + hash(seed, 9) * 0.16,
    anim: opt.anim ?? pick(v.anims, seed, 10),
    prop: v.prop,
  };
}
