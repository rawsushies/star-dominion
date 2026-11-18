export type TechCategory =
  | 'propulsion' | 'weapons' | 'defense' | 'industry' | 'energy'
  | 'biology' | 'ai' | 'colonization' | 'engineering';

export interface TechDef {
  id: string;
  name: string;
  category: TechCategory;
  tier: number; // 1..5
  requires: string[];
  mods?: Record<string, number>;
  flags?: string[];
  description: string;
}

export const TECH_CATEGORIES: { id: TechCategory; label: string; color: string }[] = [
  { id: 'propulsion', label: 'Propulsion', color: '#7fb3d5' },
  { id: 'weapons', label: 'Weapon Systems', color: '#d9785f' },
  { id: 'defense', label: 'Defence', color: '#8aa1b8' },
  { id: 'industry', label: 'Industry', color: '#c9a45c' },
  { id: 'energy', label: 'Energy', color: '#e3c95a' },
  { id: 'biology', label: 'Biology', color: '#7fbf7f' },
  { id: 'ai', label: 'Artificial Intelligence', color: '#a98fd6' },
  { id: 'colonization', label: 'Colonisation', color: '#6fc2b0' },
  { id: 'engineering', label: 'Advanced Engineering', color: '#c48fb0' },
];

export const TIER_COST = [0, 300, 800, 1700, 3200, 5400];

const t = (d: TechDef) => d;

export const TECHS: TechDef[] = [
  // PROPULSION
  t({ id: 'prop_ion_drives', name: 'Ion Drive Arrays', category: 'propulsion', tier: 1, requires: [], mods: { shipSpeed: 0.1 }, description: '+10% fleet speed.' }),
  t({ id: 'prop_logistics', name: 'Fleet Logistics Doctrine', category: 'propulsion', tier: 1, requires: [], mods: { supplyDrain: -0.25 }, description: 'Unlocks Logistics Tenders. Fleets lose supply 25% slower.' }),
  t({ id: 'prop_lane_mapping', name: 'Hyperlane Cartography', category: 'propulsion', tier: 2, requires: ['prop_ion_drives'], mods: { shipSpeed: 0.1, sensor: 1 }, description: '+10% fleet speed, +1 sensor range.' }),
  t({ id: 'prop_jump_drives', name: 'Jump Drive Resonators', category: 'propulsion', tier: 3, requires: ['prop_lane_mapping'], mods: { shipSpeed: 0.2, evasion: 0.03 }, description: '+20% fleet speed, +3% evasion.' }),
  t({ id: 'prop_supply_networks', name: 'Deep Supply Networks', category: 'propulsion', tier: 3, requires: ['prop_logistics'], mods: { supplyDrain: -0.25, repair: 0.5 }, description: 'Further reduces supply drain. Repairs 50% faster.' }),
  t({ id: 'prop_hypergates', name: 'Hypergate Theory', category: 'propulsion', tier: 5, requires: ['prop_jump_drives', 'eng_mega'], description: 'Unlocks the Hypergate megastructure.' }),

  // WEAPONS
  t({ id: 'wpn_lasers', name: 'Focused Laser Batteries', category: 'weapons', tier: 1, requires: [], mods: { shipDamage: 0.1 }, description: '+10% ship weapon damage.' }),
  t({ id: 'wpn_torpedoes', name: 'Torpedo Tubes', category: 'weapons', tier: 1, requires: [], description: 'Unlocks Frigates.' }),
  t({ id: 'wpn_mass_drivers', name: 'Magnetic Mass Drivers', category: 'weapons', tier: 2, requires: ['wpn_lasers'], mods: { shipDamage: 0.1, tracking: 0.04 }, description: '+10% damage, +4% tracking.' }),
  t({ id: 'wpn_strike_craft', name: 'Strike Craft Wings', category: 'weapons', tier: 2, requires: ['wpn_lasers'], mods: { strikeDamage: 0.2 }, description: 'Prerequisite for Carriers. +20% strike craft damage.' }),
  t({ id: 'wpn_plasma', name: 'Plasma Accelerators', category: 'weapons', tier: 3, requires: ['wpn_mass_drivers'], mods: { shipDamage: 0.15 }, description: '+15% ship weapon damage.' }),
  t({ id: 'wpn_targeting_ai', name: 'Predictive Targeting', category: 'weapons', tier: 3, requires: ['wpn_mass_drivers', 'ai_cognitive'], mods: { tracking: 0.08, defensePlatform: 0.15 }, description: '+8% tracking. Defence batteries +15%.' }),
  t({ id: 'wpn_lances', name: 'Particle Lances', category: 'weapons', tier: 4, requires: ['wpn_plasma'], mods: { shipDamage: 0.2 }, description: '+20% ship weapon damage.' }),

  // DEFENCE
  t({ id: 'def_deflectors', name: 'Deflector Shields', category: 'defense', tier: 1, requires: [], mods: { shipShields: 0.15 }, description: '+15% ship shields.' }),
  t({ id: 'def_composite_armor', name: 'Composite Armour', category: 'defense', tier: 1, requires: [], mods: { shipArmor: 0.15 }, description: '+15% ship armour.' }),
  t({ id: 'def_planet_shield', name: 'Planetary Shielding', category: 'defense', tier: 2, requires: ['def_deflectors'], description: 'Unlocks Planetary Shields.' }),
  t({ id: 'def_fortress', name: 'Fortress Doctrine', category: 'defense', tier: 2, requires: ['def_composite_armor'], mods: { defensePlatform: 0.3, garrison: 0.25, starbase: 0.25 }, description: 'Defence batteries +30%, garrisons +25%, starbases +25%.' }),
  t({ id: 'def_hardened_hulls', name: 'Hardened Hull Lattices', category: 'defense', tier: 3, requires: ['def_composite_armor'], mods: { shipHull: 0.15 }, description: '+15% ship hull.' }),
  t({ id: 'def_aegis', name: 'Aegis Field Projectors', category: 'defense', tier: 4, requires: ['def_hardened_hulls', 'def_planet_shield'], mods: { shipShields: 0.25, shipArmor: 0.2 }, description: '+25% shields, +20% armour.' }),
  t({ id: 'def_bastion', name: 'Bastion Engineering', category: 'defense', tier: 5, requires: ['def_aegis', 'eng_mega'], description: 'Unlocks the Bastion Citadel megastructure.' }),

  // INDUSTRY
  t({ id: 'ind_automated_mining', name: 'Automated Mining', category: 'industry', tier: 1, requires: [], mods: { 'output.minerals': 0.15 }, description: '+15% mineral output.' }),
  t({ id: 'ind_alloy_smelting', name: 'Arc Furnace Smelting', category: 'industry', tier: 1, requires: [], mods: { 'output.alloys': 0.15 }, description: '+15% alloy output.' }),
  t({ id: 'ind_components', name: 'Advanced Component Assembly', category: 'industry', tier: 2, requires: ['ind_alloy_smelting'], description: 'Unlocks Component Works.' }),
  t({ id: 'ind_modular', name: 'Modular Construction', category: 'industry', tier: 2, requires: ['ind_automated_mining'], mods: { buildSpeed: 0.2, buildCost: -0.1 }, description: 'Buildings complete 20% faster and cost 10% less.' }),
  t({ id: 'ind_nanofab', name: 'Nanofabrication', category: 'industry', tier: 3, requires: ['ind_components'], mods: { 'output.electronics': 0.2, 'output.components': 0.15 }, description: '+20% electronics, +15% components.' }),
  t({ id: 'ind_orbital_foundries', name: 'Orbital Foundries', category: 'industry', tier: 4, requires: ['ind_nanofab', 'ind_modular'], mods: { shipBuildSpeed: 0.25, shipCost: -0.1 }, description: 'Ships build 25% faster and cost 10% less. Unlocks Orbital Ring Shipyard.' }),
  t({ id: 'ind_matter_compression', name: 'Matter Compression', category: 'industry', tier: 5, requires: ['ind_orbital_foundries'], mods: { 'output.alloys': 0.25, storage: 0.5 }, description: '+25% alloys, +50% storage.' }),

  // ENERGY
  t({ id: 'en_grid', name: 'Superconducting Grids', category: 'energy', tier: 1, requires: [], mods: { 'output.energy': 0.15 }, description: '+15% energy output.' }),
  t({ id: 'en_fusion', name: 'Fusion Containment', category: 'energy', tier: 2, requires: ['en_grid'], description: 'Unlocks Fusion Reactors.' }),
  t({ id: 'en_capacitors', name: 'Hyper-Capacitors', category: 'energy', tier: 2, requires: ['en_grid'], mods: { storage: 0.25, shipShields: 0.05 }, description: '+25% storage, +5% shields.' }),
  t({ id: 'en_zero_point', name: 'Zero-Point Taps', category: 'energy', tier: 4, requires: ['en_fusion', 'en_capacitors'], mods: { 'output.energy': 0.3 }, description: '+30% energy output.' }),
  t({ id: 'en_stellar_collector', name: 'Stellar Lensing', category: 'energy', tier: 4, requires: ['en_zero_point'], description: 'Unlocks the Stellar Collector megastructure.' }),
  t({ id: 'en_dyson', name: 'Dyson Swarm Mechanics', category: 'energy', tier: 5, requires: ['en_stellar_collector', 'eng_mega'], description: 'Unlocks the Dyson Swarm megastructure.' }),

  // BIOLOGY
  t({ id: 'bio_genome_crops', name: 'Genome-Edited Crops', category: 'biology', tier: 1, requires: [], mods: { 'output.food': 0.2 }, description: '+20% food output.' }),
  t({ id: 'bio_hydroponics', name: 'Closed-Loop Hydroponics', category: 'biology', tier: 1, requires: [], description: 'Unlocks Hydroponic Farms.' }),
  t({ id: 'bio_medicine', name: 'Regenerative Medicine', category: 'biology', tier: 2, requires: ['bio_genome_crops'], mods: { growth: 0.25 }, description: '+25% population growth.' }),
  t({ id: 'bio_adaptation', name: 'Environmental Adaptation', category: 'biology', tier: 2, requires: ['bio_genome_crops'], mods: { habitability: 0.1 }, description: '+10% habitability on all worlds.' }),
  t({ id: 'bio_longevity', name: 'Longevity Therapies', category: 'biology', tier: 3, requires: ['bio_medicine'], mods: { stability: 4, growth: 0.15 }, description: '+4 stability, +15% growth.' }),
  t({ id: 'bio_terraforming', name: 'Atmospheric Terraforming', category: 'biology', tier: 4, requires: ['bio_adaptation', 'bio_longevity'], mods: { habitability: 0.15 }, description: '+15% habitability.' }),

  // AI
  t({ id: 'ai_cognitive', name: 'Cognitive Architectures', category: 'ai', tier: 1, requires: [], mods: { 'output.research': 0.1 }, description: '+10% research.' }),
  t({ id: 'ai_admin', name: 'Administrative Algorithms', category: 'ai', tier: 2, requires: ['ai_cognitive'], mods: { admin: 3 }, description: '+3 administrative capacity.' }),
  t({ id: 'ai_automation', name: 'Industrial Automation', category: 'ai', tier: 3, requires: ['ai_admin'], mods: { 'output.minerals': 0.1, 'output.energy': 0.1, 'output.food': 0.1 }, description: '+10% minerals, energy and food.' }),
  t({ id: 'ai_governance', name: 'Synthetic Governance', category: 'ai', tier: 4, requires: ['ai_automation'], mods: { admin: 5, stability: 5 }, description: '+5 administrative capacity, +5 stability.' }),
  t({ id: 'ai_sentient', name: 'Sentient Research Engines', category: 'ai', tier: 5, requires: ['ai_governance', 'eng_mega'], mods: { 'output.research': 0.25 }, description: '+25% research. Unlocks the Grand Archive.' }),

  // COLONISATION
  t({ id: 'col_prefab', name: 'Prefabricated Settlements', category: 'colonization', tier: 1, requires: [], mods: { colonyCost: -0.25, colonizeSpeed: 0.3 }, description: 'Colony ships 25% cheaper; colonies establish 30% faster.' }),
  t({ id: 'col_domes', name: 'Pressurised Domes', category: 'colonization', tier: 2, requires: ['col_prefab'], flags: ['domes'], description: 'Barren worlds become colonisable (25% habitability).' }),
  t({ id: 'col_frontier', name: 'Frontier Administration', category: 'colonization', tier: 2, requires: ['col_prefab'], mods: { claimCost: -0.25, admin: 2 }, description: 'Outposts cost 25% less influence. +2 admin capacity.' }),
  t({ id: 'col_arcology', name: 'Arcology Design', category: 'colonization', tier: 4, requires: ['col_frontier', 'bio_longevity'], description: 'Unlocks Arcology Spires.' }),
  t({ id: 'col_lattice', name: 'Planetary Lattice', category: 'colonization', tier: 5, requires: ['col_arcology', 'eng_mega'], description: 'Unlocks the Lattice Network megastructure.' }),

  // ADVANCED ENGINEERING
  t({ id: 'eng_destroyers', name: 'Destroyer Hulls', category: 'engineering', tier: 1, requires: [], description: 'Unlocks Destroyers.' }),
  t({ id: 'eng_cruisers', name: 'Cruiser Hulls', category: 'engineering', tier: 2, requires: ['eng_destroyers'], description: 'Unlocks Cruisers.' }),
  t({ id: 'eng_starbases', name: 'Citadel Engineering', category: 'engineering', tier: 2, requires: ['eng_destroyers'], mods: { starbase: 0.2 }, description: 'Starbases may be upgraded to Citadels. +20% starbase strength.' }),
  t({ id: 'eng_battlecruisers', name: 'Battlecruiser Hulls', category: 'engineering', tier: 3, requires: ['eng_cruisers'], description: 'Unlocks Battlecruisers.' }),
  t({ id: 'eng_carriers', name: 'Carrier Hulls', category: 'engineering', tier: 3, requires: ['eng_cruisers', 'wpn_strike_craft'], description: 'Unlocks Carriers.' }),
  t({ id: 'eng_battleships', name: 'Battleship Hulls', category: 'engineering', tier: 4, requires: ['eng_battlecruisers'], description: 'Unlocks Battleships.' }),
  t({ id: 'eng_mega', name: 'Megastructure Engineering', category: 'engineering', tier: 4, requires: ['eng_battlecruisers', 'ind_nanofab'], mods: { navalCap: 10 }, description: 'Unlocks megastructure construction. +10 naval capacity.' }),
  t({ id: 'eng_dreadnoughts', name: 'Dreadnought Keels', category: 'engineering', tier: 5, requires: ['eng_battleships', 'eng_mega'], description: 'Unlocks Dreadnoughts.' }),
];

export const TECH_BY_ID: Record<string, TechDef> = Object.fromEntries(TECHS.map((x) => [x.id, x]));

export function techCost(id: string): number {
  return TIER_COST[TECH_BY_ID[id]?.tier ?? 1];
}
