import type { BuildingId, Cost, ResId } from '../types';

export type YieldKey = ResId | 'research' | 'trade';
export type Yield = Partial<Record<YieldKey, number>>;

export interface BuildingDef {
  id: BuildingId;
  label: string;
  category: 'district' | 'industry' | 'civic' | 'military' | 'special';
  district?: 'residential' | 'agri' | 'mining' | 'power';
  cost: Cost;
  days: number;
  upkeep: Cost; // per month
  jobs: number;
  housing: number;
  /** produced per filled job per month (before modifiers) */
  output: Yield;
  /** consumed per filled job per month */
  input: Cost;
  max?: number;
  tech?: string;
  needs?: BuildingId;
  deposit?: 'rare';
  stability?: number;
  garrison?: number;
  admin?: number;
  storage?: number;
  navalCap?: number;
  buildable?: boolean;
  description: string;
}

const B = (d: BuildingDef) => d;

// Job priority: pops fill the earliest jobs first. Food and energy first so a
// shrinking colony does not starve itself before it stops refining alloys.
export const JOB_PRIORITY: BuildingId[] = [
  'capital', 'agri', 'hydroponics', 'power', 'fusion_plant', 'mining', 'rare_extractor',
  'refinery', 'electronics_fab', 'component_works', 'research_lab', 'admin_center',
  'garrison', 'entertainment', 'spaceport', 'shipyard', 'commerce_hub', 'residential',
  'arcology', 'orbital_defense', 'planetary_shield', 'storage_depot',
];

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  capital: B({
    id: 'capital', label: 'Sovereign Palace', category: 'special', buildable: false,
    cost: {}, days: 0, upkeep: {}, jobs: 4, housing: 8, max: 1,
    output: { credits: 3, influence: 0.75, research: 3, minerals: 1, energy: 1.5, food: 1 }, input: {},
    stability: 10, garrison: 8, admin: 6, storage: 4000, navalCap: 10,
    description: 'Seat of the crown. Houses the ministries and anchors the realm.',
  }),
  residential: B({
    id: 'residential', label: 'Residential District', category: 'district', district: 'residential',
    cost: { minerals: 80, credits: 30 }, days: 90, upkeep: { energy: 1 }, jobs: 1, housing: 6,
    output: { credits: 2 }, input: {},
    description: 'Arcing tower blocks and transit spines. Housing for six pops.',
  }),
  agri: B({
    id: 'agri', label: 'Agricultural District', category: 'district', district: 'agri',
    cost: { minerals: 60 }, days: 75, upkeep: { energy: 0.5 }, jobs: 3, housing: 2,
    output: { food: 4 }, input: {},
    description: 'Terraced farms and vertical aquaculture. Output depends on climate.',
  }),
  mining: B({
    id: 'mining', label: 'Mining District', category: 'district', district: 'mining',
    cost: { minerals: 60, credits: 20 }, days: 75, upkeep: { energy: 1 }, jobs: 3, housing: 2,
    output: { minerals: 4 }, input: {},
    description: 'Deep crust extraction. Rich on arid, volcanic and barren worlds.',
  }),
  power: B({
    id: 'power', label: 'Generator District', category: 'district', district: 'power',
    cost: { minerals: 70 }, days: 75, upkeep: {}, jobs: 3, housing: 2,
    output: { energy: 4 }, input: {},
    description: 'Solar arrays, geothermal taps and reactors feeding the grid.',
  }),
  refinery: B({
    id: 'refinery', label: 'Alloy Foundry', category: 'industry',
    cost: { minerals: 140, credits: 40 }, days: 120, upkeep: { energy: 2 }, jobs: 2, housing: 0,
    output: { alloys: 3 }, input: { minerals: 5 },
    description: 'Smelts raw minerals into ship-grade alloys.',
  }),
  electronics_fab: B({
    id: 'electronics_fab', label: 'Electronics Fabricator', category: 'industry',
    cost: { minerals: 140, credits: 60 }, days: 120, upkeep: { energy: 2 }, jobs: 2, housing: 0,
    output: { electronics: 1.5 }, input: { minerals: 1.5, rare: 0.35 },
    description: 'Clean-room lines producing processors, sensors and consumer goods.',
  }),
  component_works: B({
    id: 'component_works', label: 'Component Works', category: 'industry', tech: 'ind_components',
    cost: { minerals: 200, alloys: 40, credits: 80 }, days: 160, upkeep: { energy: 3 }, jobs: 2, housing: 0,
    output: { components: 1 }, input: { alloys: 0.9, electronics: 0.9 },
    description: 'Assembles advanced components: drives, reactors, weapon cores.',
  }),
  rare_extractor: B({
    id: 'rare_extractor', label: 'Rare Element Extractor', category: 'industry', deposit: 'rare',
    cost: { minerals: 160, credits: 60 }, days: 120, upkeep: { energy: 2 }, jobs: 2, housing: 0, max: 2,
    output: { rare: 1.2 }, input: {},
    description: 'Exploits exotic deposits. Requires a rare element vein on this world.',
  }),
  research_lab: B({
    id: 'research_lab', label: 'Research Laboratory', category: 'civic',
    cost: { minerals: 120, credits: 80 }, days: 120, upkeep: { energy: 2 }, jobs: 3, housing: 0,
    output: { research: 3 }, input: { electronics: 0.2 },
    description: 'Physics, biology and engineering institutes. Consumes electronics.',
  }),
  spaceport: B({
    id: 'spaceport', label: 'Spaceport', category: 'civic', max: 1,
    cost: { minerals: 180, credits: 60 }, days: 140, upkeep: { energy: 2 }, jobs: 2, housing: 1,
    output: { trade: 3 }, input: {}, navalCap: 2,
    description: 'Orbital elevators and cargo terminals. Generates trade, enables shipyards.',
  }),
  shipyard: B({
    id: 'shipyard', label: 'Orbital Shipyard', category: 'military', needs: 'spaceport', max: 1,
    cost: { minerals: 200, alloys: 60, credits: 80 }, days: 160, upkeep: { energy: 2, credits: 2 }, jobs: 2, housing: 0,
    output: {}, input: {}, navalCap: 6,
    description: 'Construction slips for warships and civilian hulls.',
  }),
  orbital_defense: B({
    id: 'orbital_defense', label: 'Orbital Defence Battery', category: 'military', max: 5,
    cost: { minerals: 120, alloys: 50 }, days: 110, upkeep: { credits: 1.5, energy: 1 }, jobs: 0, housing: 0,
    output: {}, input: {},
    description: 'Armoured gun platforms that engage hostile fleets in orbit.',
  }),
  planetary_shield: B({
    id: 'planetary_shield', label: 'Planetary Shield', category: 'military', max: 1, tech: 'def_planet_shield',
    cost: { minerals: 250, alloys: 80, electronics: 40 }, days: 200, upkeep: { energy: 5 }, jobs: 0, housing: 0,
    output: {}, input: {},
    description: 'Deflector dome. Halves invasion strength and protects defence batteries.',
  }),
  garrison: B({
    id: 'garrison', label: 'Military Garrison', category: 'military', max: 3,
    cost: { minerals: 100, credits: 40 }, days: 90, upkeep: { credits: 2 }, jobs: 2, housing: 1,
    output: {}, input: {}, garrison: 8, stability: 3, navalCap: 2,
    description: 'Barracks and armouries. Defends against invasion and suppresses resistance.',
  }),
  admin_center: B({
    id: 'admin_center', label: 'Administrative Centre', category: 'civic', max: 1,
    cost: { minerals: 150, credits: 100 }, days: 150, upkeep: { energy: 2 }, jobs: 2, housing: 0,
    output: { influence: 0.25 }, input: {}, admin: 3,
    description: 'Regional governance. Raises administrative capacity and influence.',
  }),
  commerce_hub: B({
    id: 'commerce_hub', label: 'Commerce Exchange', category: 'civic',
    cost: { minerals: 140, credits: 60 }, days: 120, upkeep: { energy: 1 }, jobs: 3, housing: 0,
    output: { trade: 3 }, input: {},
    description: 'Trading floors and banking houses. Value flows along trade routes.',
  }),
  storage_depot: B({
    id: 'storage_depot', label: 'Strategic Depot', category: 'civic', max: 2,
    cost: { minerals: 100 }, days: 80, upkeep: { energy: 0.5 }, jobs: 0, housing: 0,
    output: {}, input: {}, storage: 1500,
    description: 'Silos and vaults. Raises the kingdom storage limit of all goods.',
  }),
  entertainment: B({
    id: 'entertainment', label: 'Civic Forum', category: 'civic', max: 2,
    cost: { minerals: 110, credits: 50 }, days: 100, upkeep: { energy: 2 }, jobs: 2, housing: 0,
    output: {}, input: {}, stability: 7,
    description: 'Theatres, temples and public gardens. Improves stability.',
  }),
  hydroponics: B({
    id: 'hydroponics', label: 'Hydroponic Farms', category: 'industry', tech: 'bio_hydroponics',
    cost: { minerals: 120 }, days: 90, upkeep: { energy: 2 }, jobs: 2, housing: 0,
    output: { food: 3.5 }, input: {},
    description: 'Climate-independent food production. Vital on frozen and barren worlds.',
  }),
  fusion_plant: B({
    id: 'fusion_plant', label: 'Fusion Reactor', category: 'industry', tech: 'en_fusion',
    cost: { minerals: 220, rare: 20 }, days: 150, upkeep: {}, jobs: 2, housing: 0, max: 2,
    output: { energy: 7 }, input: {},
    description: 'Compact high-yield reactor independent of planetary conditions.',
  }),
  arcology: B({
    id: 'arcology', label: 'Arcology Spire', category: 'civic', tech: 'col_arcology', max: 2,
    cost: { minerals: 400, alloys: 80, credits: 200 }, days: 240, upkeep: { energy: 4 }, jobs: 2, housing: 14,
    output: { credits: 3 }, input: {}, stability: 2,
    description: 'Self-contained city-towers housing millions above the surface.',
  }),
};

export const BUILDABLE: BuildingId[] = (Object.keys(BUILDINGS) as BuildingId[]).filter(
  (b) => BUILDINGS[b].buildable !== false,
);
