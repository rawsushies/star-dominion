// Registry of externally sourced 3D assets and how the game uses them.
// Every model here is CC0 or public domain (NASA); see docs/ASSET_CATALOG.md for
// sources and evaluation notes. Rendering code asks for models by role
// (ship class, character role, capital building), never by file, so any
// asset can be swapped by editing this file alone.

import type { ShipClass } from '../../../sim/types';
import type { CharRole } from '../../../sim/data/characters';

export type License = 'CC0 1.0' | 'CC0 1.0 + public domain (NASA)';
export const LICENSES: readonly License[] = ['CC0 1.0', 'CC0 1.0 + public domain (NASA)'];
export interface PackInfo { name: string; creator: string; url: string; license: License }
export const PACKS = {
  qShips: { name: 'Ultimate Spaceships (May 2021)', creator: 'Quaternius', url: 'https://opengameart.org/content/lowpoly-spaceships-pack', license: 'CC0 1.0' },
  qSpace: { name: 'Ultimate Space Kit', creator: 'Quaternius', url: 'https://opengameart.org/content/ultimate-space-kit-by-quaternius', license: 'CC0 1.0' },
  qChars: { name: 'Ultimate Animated Character Pack (Nov 2019)', creator: 'Quaternius', url: 'https://opengameart.org/content/animated-characters-pack', license: 'CC0 1.0' },
  qMech: { name: 'Animated Mech Pack (March 2021)', creator: 'Quaternius', url: 'https://opengameart.org/content/animated-mech-pack', license: 'CC0 1.0' },
  kSpace: { name: 'Space Kit 2.0', creator: 'Kenney', url: 'https://opengameart.org/content/space-kit-remade', license: 'CC0 1.0' },
  kCommercial: { name: 'City Kit (Commercial) 2.1', creator: 'Kenney', url: 'https://opengameart.org/content/city-kit-commercial', license: 'CC0 1.0' },
  kIndustrial: { name: 'City Kit (Industrial) 2.0', creator: 'Kenney', url: 'https://opengameart.org/content/city-kit-industrial', license: 'CC0 1.0' },
  // assembled (not modelled) by scripts/blender/assemble_megastructures.py from Quaternius Ultimate Space Kit,
  // Kenney Space Kit, KayKit Space Base Bits (all CC0) and NASA 3D Resources hardware (public domain)
  sdMega: { name: 'Megastructures assembled from Quaternius, Kenney, KayKit and NASA parts', creator: 'Quaternius, Kenney, Kay Lousberg, NASA; assembled by the Star Dominion project', url: 'scripts/blender/assemble_megastructures.py', license: 'CC0 1.0 + public domain (NASA)' },
} satisfies Record<string, PackInfo>;
export type PackId = keyof typeof PACKS;

export interface AssetDef { file: string; pack: PackId; animated?: boolean }

const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';
export function assetUrl(a: AssetDef): string { return `${BASE}assets/models/${a.file}`; }

const ships = (n: string): AssetDef => ({ file: `ships/${n}.glb`, pack: 'qShips' });
const city = (n: string, pack: PackId): AssetDef => ({ file: `city/${n}.glb`, pack });
const space = (n: string, pack: PackId): AssetDef => ({ file: `space/${n}.glb`, pack });
const mega = (n: string): AssetDef => ({ file: `mega/${n}.glb`, pack: 'sdMega' });
const char = (n: string): AssetDef => ({ file: `chars/${n}.glb`, pack: 'qChars', animated: true });

export const ASSETS = {
  // military and support hulls
  ship_bob: ships('Bob'), ship_omen: ships('Omen'), ship_challenger: ships('Challenger'), ship_striker: ships('Striker'),
  ship_dispatcher: ships('Dispatcher'), ship_spitfire: ships('Spitfire'), ship_imperial: ships('Imperial'), ship_pancake: ships('Pancake'),
  ship_insurgent: ships('Insurgent'), ship_zenith: ships('Zenith'), ship_executioner: ships('Executioner'),
  ship_colony: { file: 'ships/colony_pod.glb', pack: 'qSpace' }, ship_constructor: { file: 'ships/constructor_tug.glb', pack: 'qSpace' },
  // characters
  char_suit_m: char('Suit_Male'), char_suit_f: char('Suit_Female'), char_soldier_m: char('Soldier_Male'), char_soldier_f: char('Soldier_Female'),
  char_navy_m: char('BlueSoldier_Male'), char_navy_f: char('BlueSoldier_Female'), char_doctor_m: char('Doctor_Male_Young'), char_doctor_f: char('Doctor_Female_Young'),
  char_worker_m: char('Worker_Male'), char_worker_f: char('Worker_Female'), char_noble_m: char('OldClassy_Male'), char_noble_f: char('OldClassy_Female'),
  char_casual_m: char('Casual_Male'), char_casual_f: char('Casual2_Female'), char_shadow_m: char('Ninja_Male'), char_shadow_f: char('Ninja_Female'),
  // antagonists, mercenaries and alien species
  mech_mike: { file: 'villains/Mech_Mike.glb', pack: 'qMech', animated: true }, mech_stan: { file: 'villains/Mech_Stan.glb', pack: 'qMech', animated: true },
  mech_george: { file: 'villains/Mech_George.glb', pack: 'qMech', animated: true }, mech_leela: { file: 'villains/Mech_Leela.glb', pack: 'qMech', animated: true },
  alien_brute: { file: 'villains/alien_brute.glb', pack: 'qSpace' }, alien_scout: { file: 'villains/alien_scout.glb', pack: 'qSpace' }, alien_flyer: { file: 'villains/alien_flyer.glb', pack: 'qSpace' },
  // capital architecture
  tower_a: city('c_building-skyscraper-a', 'kCommercial'), tower_b: city('c_building-skyscraper-b', 'kCommercial'), tower_c: city('c_building-skyscraper-c', 'kCommercial'),
  tower_d: city('c_building-skyscraper-d', 'kCommercial'), tower_e: city('c_building-skyscraper-e', 'kCommercial'),
  civic_a: city('c_building-a', 'kCommercial'), civic_b: city('c_building-b', 'kCommercial'), civic_e: city('c_building-e', 'kCommercial'), civic_h: city('c_building-h', 'kCommercial'),
  civic_k: city('c_building-k', 'kCommercial'), civic_l: city('c_building-l', 'kCommercial'), civic_m: city('c_building-m', 'kCommercial'), civic_n: city('c_building-n', 'kCommercial'),
  parasol: city('c_detail-parasol-a', 'kCommercial'), awning: city('c_detail-awning-wide', 'kCommercial'),
  factory_d: city('i_building-d', 'kIndustrial'), factory_g: city('i_building-g', 'kIndustrial'), factory_m: city('i_building-m', 'kIndustrial'), factory_p: city('i_building-p', 'kIndustrial'), factory_r: city('i_building-r', 'kIndustrial'),
  chimney_l: city('i_chimney-large', 'kIndustrial'), chimney_m: city('i_chimney-medium', 'kIndustrial'), tank_l: city('i_detail-tank-large', 'kIndustrial'), tank: city('i_detail-tank', 'kIndustrial'),
  solar: city('i_solar-panel-landscape-group', 'kIndustrial'), water_tower: city('i_water-tower', 'kIndustrial'),
  dome: space('geodesic_dome', 'qSpace'), base_large: space('base_large', 'qSpace'), lab_l: space('building_l', 'qSpace'), hab_cyl: space('house_cylinder', 'qSpace'),
  hab_long: space('house_long', 'qSpace'), hab_pod: space('house_pod', 'qSpace'), radar: space('roof_radar', 'qSpace'), antenna: space('roof_antenna', 'qSpace'),
  solar_rig: space('solar_structure', 'qSpace'), connector: space('connector', 'qSpace'), globe: space('planet_globe', 'qSpace'), plinth: space('metal_support', 'qSpace'),
  hangar_l: space('k_hangar_largeA', 'kSpace'), hangar_l2: space('k_hangar_largeB', 'kSpace'), hangar_glass: space('k_hangar_roundGlass', 'kSpace'), hangar_s: space('k_hangar_smallA', 'kSpace'),
  dish_l: space('k_satelliteDish_large', 'kSpace'), dish: space('k_satelliteDish_detailed', 'kSpace'),
  rocket_base: space('k_rocket_baseA', 'kSpace'), rocket_fuel: space('k_rocket_fuelA', 'kSpace'), rocket_sides: space('k_rocket_sidesA', 'kSpace'), rocket_top: space('k_rocket_topA', 'kSpace'), rocket_fins: space('k_rocket_finsA', 'kSpace'),
  turret2: space('k_turret_double', 'kSpace'), turret: space('k_turret_single', 'kSpace'), gate: space('k_gate_complex', 'kSpace'), generator: space('k_machine_generatorLarge', 'kSpace'),
  truss: space('k_structure_detailed', 'kSpace'), pad: space('k_platform_large', 'kSpace'),
  // megastructures: one node per construction stage (stage_1 … stage_n)
  mega_orbital_ring: mega('orbital_ring'), mega_bastion: mega('bastion'), mega_dyson_panel: mega('dyson_panel'),
  mega_stellar_collector: mega('stellar_collector'), mega_hypergate: mega('hypergate'), mega_grand_archive: mega('grand_archive'),
  mega_lattice_relay: mega('lattice_relay'), mega_sector_array: mega('sector_array'), mega_continuum_engine: mega('continuum_engine'),
} satisfies Record<string, AssetDef>;
export type AssetId = keyof typeof ASSETS;

// ---------------------------------------------------------------- ships

/** Hull per ship class, and its length in system-view units (relative sizes matter). */
export const SHIP_MODELS: Record<ShipClass, { asset: AssetId; length: number }> = {
  scout: { asset: 'ship_bob', length: 0.7 },
  corvette: { asset: 'ship_omen', length: 0.8 },
  frigate: { asset: 'ship_challenger', length: 0.95 },
  destroyer: { asset: 'ship_striker', length: 1.15 },
  cruiser: { asset: 'ship_dispatcher', length: 1.45 },
  battlecruiser: { asset: 'ship_spitfire', length: 1.7 },
  battleship: { asset: 'ship_imperial', length: 2.1 },
  carrier: { asset: 'ship_pancake', length: 2.2 },
  dreadnought: { asset: 'ship_insurgent', length: 2.8 },
  logistics: { asset: 'ship_zenith', length: 1.3 },
  transport: { asset: 'ship_executioner', length: 1.2 },
  constructor: { asset: 'ship_constructor', length: 0.9 },
  colony: { asset: 'ship_colony', length: 1.1 },
};

// ---------------------------------------------------------------- characters

/** Body models per role; a character's id picks between them. */
export const CHARACTER_MODELS: Record<CharRole, AssetId[]> = {
  admiral: ['char_navy_m', 'char_navy_f'],
  general: ['char_soldier_m', 'char_soldier_f'],
  governor: ['char_noble_m', 'char_noble_f'],
  scientist: ['char_doctor_m', 'char_doctor_f'],
  diplomat: ['char_suit_m', 'char_suit_f'],
  chancellor: ['char_noble_f', 'char_suit_m'],
  industrialist: ['char_worker_m', 'char_worker_f'],
  explorer: ['char_casual_m', 'char_casual_f'],
  spymaster: ['char_shadow_m', 'char_shadow_f'],
};
export const ANTAGONIST_MODELS: AssetId[] = ['mech_mike', 'mech_stan', 'mech_george', 'mech_leela', 'alien_brute', 'alien_scout', 'alien_flyer'];

// ---------------------------------------------------------------- capital

/** A sourced part placed on a plot: offsets in plot widths, height as a fraction of the plot width. */
export interface Part { asset: AssetId; x?: number; z?: number; h: number; ry?: number; y?: number; foot?: number }
/** A building's look from a given level upward. Later tiers replace earlier ones. */
export interface Tier { from: number; parts: Part[] }

export const BUILDING_TIERS: Record<string, Tier[]> = {
  citadel: [
    { from: 1, parts: [{ asset: 'tower_e', h: 1.3 }, { asset: 'civic_n', x: 0, z: 0.32, h: 0.35 }] },
    { from: 6, parts: [{ asset: 'tower_e', h: 1.7 }, { asset: 'tower_c', x: -0.3, z: -0.25, h: 1.0 }, { asset: 'tower_c', x: 0.3, z: -0.25, h: 1.0, ry: Math.PI }, { asset: 'civic_n', x: 0, z: 0.34, h: 0.4 }] },
    { from: 12, parts: [{ asset: 'tower_e', h: 2.2 }, { asset: 'tower_d', x: -0.32, z: -0.28, h: 1.35 }, { asset: 'tower_d', x: 0.32, z: -0.28, h: 1.35, ry: Math.PI }, { asset: 'tower_b', x: -0.34, z: 0.3, h: 0.9 }, { asset: 'tower_b', x: 0.34, z: 0.3, h: 0.9, ry: Math.PI }, { asset: 'dish', x: 0, z: 0.36, h: 0.3 }] },
    { from: 20, parts: [{ asset: 'tower_e', h: 2.8 }, { asset: 'tower_d', x: -0.33, z: -0.3, h: 1.8 }, { asset: 'tower_d', x: 0.33, z: -0.3, h: 1.8, ry: Math.PI }, { asset: 'tower_a', x: -0.36, z: 0.3, h: 1.3 }, { asset: 'tower_a', x: 0.36, z: 0.3, h: 1.3, ry: Math.PI }, { asset: 'dish_l', x: 0, z: 0.38, h: 0.42 }] },
  ],
  throne_hall: [{ from: 1, parts: [{ asset: 'civic_m', h: 0.5 }] }, { from: 10, parts: [{ asset: 'civic_n', h: 0.7 }, { asset: 'antenna', x: 0.3, z: -0.3, h: 0.35 }] }],
  treasury: [{ from: 1, parts: [{ asset: 'civic_k', h: 0.5 }] }, { from: 8, parts: [{ asset: 'civic_k', h: 0.75 }, { asset: 'civic_e', x: 0.35, z: 0.2, h: 0.45 }] }],
  hall_of_heroes: [{ from: 1, parts: [{ asset: 'civic_l', h: 0.55 }] }, { from: 6, parts: [{ asset: 'civic_l', h: 0.8 }, { asset: 'plinth', x: 0.35, z: 0.35, h: 0.3 }] }],
  research_institute: [{ from: 1, parts: [{ asset: 'dome', h: 0.45 }] }, { from: 8, parts: [{ asset: 'dome', x: -0.15, h: 0.55 }, { asset: 'lab_l', x: 0.3, z: 0.25, h: 0.35 }] }, { from: 16, parts: [{ asset: 'dome', x: -0.15, h: 0.65 }, { asset: 'lab_l', x: 0.3, z: 0.25, h: 0.4 }, { asset: 'radar', x: 0.3, z: -0.3, h: 0.35 }] }],
  imperial_shipyards: [{ from: 1, parts: [{ asset: 'hangar_l', h: 0.45 }] }, { from: 8, parts: [{ asset: 'hangar_l', x: -0.15, h: 0.55 }, { asset: 'rocket_base', x: 0.32, z: 0.3, h: 0.5 }] }, { from: 16, parts: [{ asset: 'hangar_l2', x: -0.15, h: 0.6 }, { asset: 'rocket_fuel', x: 0.32, z: 0.3, h: 0.8 }, { asset: 'truss', x: 0.32, z: -0.3, h: 0.5 }] }],
  refinery_complex: [{ from: 1, parts: [{ asset: 'factory_g', h: 0.45 }] }, { from: 8, parts: [{ asset: 'factory_m', h: 0.5 }, { asset: 'chimney_m', x: 0.35, z: -0.3, h: 0.6 }] }, { from: 16, parts: [{ asset: 'factory_m', h: 0.55 }, { asset: 'chimney_l', x: 0.35, z: -0.3, h: 0.9 }, { asset: 'tank_l', x: -0.35, z: 0.3, h: 0.3 }] }],
  diplomatic_quarter: [{ from: 1, parts: [{ asset: 'civic_h', h: 0.55 }] }, { from: 8, parts: [{ asset: 'civic_h', h: 0.8 }, { asset: 'parasol', x: 0.35, z: 0.35, h: 0.18 }] }],
  military_academy: [{ from: 1, parts: [{ asset: 'base_large', h: 0.35 }] }, { from: 8, parts: [{ asset: 'base_large', h: 0.45 }, { asset: 'turret', x: 0.35, z: 0.35, h: 0.25 }] }],
  intelligence_bureau: [{ from: 1, parts: [{ asset: 'tower_c', h: 0.9 }] }, { from: 6, parts: [{ asset: 'tower_c', x: -0.15, h: 1.1 }, { asset: 'dish', x: 0.3, z: 0.3, h: 0.35 }] }],
  grand_market: [{ from: 1, parts: [{ asset: 'civic_a', h: 0.45 }] }, { from: 8, parts: [{ asset: 'civic_b', h: 0.6 }, { asset: 'awning', x: 0, z: 0.42, h: 0.12 }, { asset: 'parasol', x: 0.35, z: 0.35, h: 0.18 }] }],
  bastion: [{ from: 1, parts: [{ asset: 'gate', h: 0.4 }] }, { from: 6, parts: [{ asset: 'gate', h: 0.45 }, { asset: 'turret2', x: -0.35, z: 0.3, h: 0.3 }, { asset: 'turret2', x: 0.35, z: 0.3, h: 0.3 }] }],
  arcology: [{ from: 1, parts: [{ asset: 'tower_a', h: 1.0 }] }, { from: 8, parts: [{ asset: 'tower_a', x: -0.2, h: 1.3 }, { asset: 'tower_b', x: 0.25, z: 0.2, h: 1.0 }] }, { from: 15, parts: [{ asset: 'tower_d', x: -0.2, h: 1.7 }, { asset: 'tower_b', x: 0.25, z: 0.2, h: 1.3 }, { asset: 'tower_a', x: 0.25, z: -0.3, h: 1.1 }] }],
  stellar_observatory: [{ from: 1, parts: [{ asset: 'dish_l', h: 0.6 }] }, { from: 8, parts: [{ asset: 'dish_l', x: -0.15, h: 0.75 }, { asset: 'hangar_glass', x: 0.3, z: 0.3, h: 0.3 }] }],
  stellar_forge: [{ from: 1, parts: [{ asset: 'generator', h: 0.45 }, { asset: 'chimney_l', x: 0.32, z: -0.3, h: 0.8 }] }, { from: 8, parts: [{ asset: 'factory_r', h: 0.5 }, { asset: 'chimney_l', x: 0.32, z: -0.3, h: 1.0 }, { asset: 'generator', x: -0.32, z: 0.3, h: 0.35 }] }],
  monument_of_ages: [{ from: 1, parts: [{ asset: 'plinth', h: 0.5 }, { asset: 'globe', h: 0.35, y: 0.5 }] }, { from: 5, parts: [{ asset: 'plinth', h: 0.8 }, { asset: 'globe', h: 0.5, y: 0.8 }] }],
};

/** Decorative sourced pieces for empty, sealed or rim ground. */
export const DECOR = { solar: 'solar' as AssetId, waterTower: 'water_tower' as AssetId, habPod: 'hab_pod' as AssetId, turret: 'turret' as AssetId };

export function tierFor(id: string, level: number): Tier | null {
  const tiers = BUILDING_TIERS[id];
  if (!tiers) return null;
  let t: Tier | null = null;
  for (const x of tiers) if (level >= x.from) t = x;
  return t ?? tiers[0];
}
