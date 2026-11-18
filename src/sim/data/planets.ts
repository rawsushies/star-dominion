import type { Climate, PlanetType, StarType } from '../types';

export interface PlanetTypeDef {
  id: PlanetType;
  label: string;
  climate: Climate | null; // null = not a natural habitat for any climate
  /** habitability for each species climate preference */
  hab: Record<Climate, number>;
  /** share of planet size that each district type may occupy */
  districts: { residential: number; agri: number; mining: number; power: number };
  /** output multipliers applied to districts on this world */
  yield: { food: number; minerals: number; energy: number };
  colonyCostMult: number;
  palette: [string, string, string]; // deep, mid, highlight (render only)
  atmosphere: string | null;
  description: string;
}

const T = (d: PlanetTypeDef) => d;

export const PLANET_TYPES: Record<PlanetType, PlanetTypeDef> = {
  temperate: T({
    id: 'temperate', label: 'Temperate', climate: 'wet',
    hab: { wet: 1, dry: 0.6, cold: 0.6 },
    districts: { residential: 0.4, agri: 0.35, mining: 0.15, power: 0.15 },
    yield: { food: 1.2, minerals: 0.9, energy: 1 }, colonyCostMult: 1,
    palette: ['#1d4a6b', '#3f7d4f', '#c9d9b0'], atmosphere: '#8fc7ff',
    description: 'Mild seasons and fertile continents. Ideal breadbaskets and population centres.',
  }),
  ocean: T({
    id: 'ocean', label: 'Ocean', climate: 'wet',
    hab: { wet: 1, dry: 0.4, cold: 0.6 },
    districts: { residential: 0.35, agri: 0.45, mining: 0.05, power: 0.15 },
    yield: { food: 1.35, minerals: 0.6, energy: 1.05 }, colonyCostMult: 1.1,
    palette: ['#0b2a52', '#1f5f8f', '#a9e0ff'], atmosphere: '#7cc4ff',
    description: 'Planet-wide seas. Abundant aquaculture, scarce mineral access.',
  }),
  jungle: T({
    id: 'jungle', label: 'Jungle', climate: 'wet',
    hab: { wet: 0.9, dry: 0.5, cold: 0.4 },
    districts: { residential: 0.3, agri: 0.4, mining: 0.15, power: 0.15 },
    yield: { food: 1.25, minerals: 0.85, energy: 0.95 }, colonyCostMult: 1.1,
    palette: ['#123d22', '#2f7a2c', '#a6d76a'], atmosphere: '#9fe0a0',
    description: 'Humid canopy worlds teeming with biomass and hidden hazards.',
  }),
  desert: T({
    id: 'desert', label: 'Desert', climate: 'dry',
    hab: { wet: 0.4, dry: 1, cold: 0.3 },
    districts: { residential: 0.3, agri: 0.1, mining: 0.35, power: 0.3 },
    yield: { food: 0.6, minerals: 1.3, energy: 1.25 }, colonyCostMult: 1,
    palette: ['#6b3d17', '#c48a45', '#f2d39a'], atmosphere: '#ffd59c',
    description: 'Arid dune seas over mineral-rich crust. Strong solar exposure.',
  }),
  arid: T({
    id: 'arid', label: 'Arid', climate: 'dry',
    hab: { wet: 0.5, dry: 0.9, cold: 0.4 },
    districts: { residential: 0.35, agri: 0.2, mining: 0.3, power: 0.2 },
    yield: { food: 0.8, minerals: 1.15, energy: 1.1 }, colonyCostMult: 1,
    palette: ['#5a3420', '#a5643a', '#e5b37e'], atmosphere: '#f0c08c',
    description: 'Dry steppes and canyon systems. Balanced industrial potential.',
  }),
  tundra: T({
    id: 'tundra', label: 'Tundra', climate: 'cold',
    hab: { wet: 0.5, dry: 0.4, cold: 0.9 },
    districts: { residential: 0.35, agri: 0.2, mining: 0.3, power: 0.2 },
    yield: { food: 0.8, minerals: 1.1, energy: 0.95 }, colonyCostMult: 1,
    palette: ['#3a4a50', '#7d8f8a', '#dfe9e4'], atmosphere: '#c8e6f0',
    description: 'Permafrost plains with short growing seasons and deep ore seams.',
  }),
  frozen: T({
    id: 'frozen', label: 'Frozen', climate: 'cold',
    hab: { wet: 0.3, dry: 0.2, cold: 1 },
    districts: { residential: 0.35, agri: 0.05, mining: 0.35, power: 0.25 },
    yield: { food: 0.4, minerals: 1.2, energy: 1 }, colonyCostMult: 1.15,
    palette: ['#2c4a66', '#8db4cf', '#f4fbff'], atmosphere: '#d6f0ff',
    description: 'Glacial shells over subsurface oceans. Food must be manufactured.',
  }),
  volcanic: T({
    id: 'volcanic', label: 'Volcanic', climate: null,
    hab: { wet: 0.25, dry: 0.35, cold: 0.15 },
    districts: { residential: 0.15, agri: 0.0, mining: 0.4, power: 0.45 },
    yield: { food: 0.3, minerals: 1.4, energy: 1.6 }, colonyCostMult: 1.5,
    palette: ['#1a0d0a', '#6d1d0c', '#ff7a2a'], atmosphere: '#ff8f5a',
    description: 'Tectonically violent. Geothermal and ore riches at great human cost.',
  }),
  toxic: T({
    id: 'toxic', label: 'Toxic', climate: null,
    hab: { wet: 0.15, dry: 0.15, cold: 0.15 },
    districts: { residential: 0.2, agri: 0.0, mining: 0.45, power: 0.35 },
    yield: { food: 0.2, minerals: 1.25, energy: 1.2 }, colonyCostMult: 1.7,
    palette: ['#2a3a12', '#7c8f1f', '#e2e875'], atmosphere: '#c7e65a',
    description: 'Corrosive atmosphere. Only sealed habitats survive here.',
  }),
  barren: T({
    id: 'barren', label: 'Barren', climate: null,
    hab: { wet: 0, dry: 0, cold: 0 },
    districts: { residential: 0.2, agri: 0, mining: 0.6, power: 0.2 },
    yield: { food: 0, minerals: 1.3, energy: 0.9 }, colonyCostMult: 1.6,
    palette: ['#2b2a29', '#6f6a63', '#b9b2a6'], atmosphere: null,
    description: 'Airless rock. Uninhabitable without domed habitats technology.',
  }),
  gas_giant: T({
    id: 'gas_giant', label: 'Gas Giant', climate: null,
    hab: { wet: 0, dry: 0, cold: 0 },
    districts: { residential: 0, agri: 0, mining: 0, power: 0 },
    yield: { food: 0, minerals: 0, energy: 0 }, colonyCostMult: 99,
    palette: ['#3d2c4f', '#a77d5b', '#f1d5b3'], atmosphere: '#e8c9a0',
    description: 'Vast storm-wrapped giant. Harvested by orbital stations only.',
  }),
  gaia: T({
    id: 'gaia', label: 'Gaia', climate: 'wet',
    hab: { wet: 1, dry: 1, cold: 1 },
    districts: { residential: 0.4, agri: 0.3, mining: 0.15, power: 0.15 },
    yield: { food: 1.3, minerals: 1, energy: 1 }, colonyCostMult: 0.9,
    palette: ['#0f3b4a', '#3a8c5a', '#e6f2c8'], atmosphere: '#a8e8ff',
    description: 'A rare, perfectly balanced living world. Universally habitable.',
  }),
};

/** luminosity is in solar luminosities (1 L☉ = 3.828e26 W); used by the Kardashev power model */
export const STAR_TYPES: Record<StarType, { label: string; color: string; glow: string; energy: number; weight: number; luminosity: number }> = {
  yellow: { label: 'Yellow Dwarf', color: '#fff1c4', glow: '#ffcf6b', energy: 1, weight: 26, luminosity: 1 },
  orange: { label: 'Orange Dwarf', color: '#ffd7a3', glow: '#ff9b45', energy: 0.9, weight: 22, luminosity: 0.3 },
  red: { label: 'Red Dwarf', color: '#ffb59a', glow: '#ff5a3a', energy: 0.7, weight: 24, luminosity: 0.02 },
  white: { label: 'White Star', color: '#f2f6ff', glow: '#bcd2ff', energy: 1.25, weight: 10, luminosity: 20 },
  blue: { label: 'Blue Giant', color: '#d8e6ff', glow: '#6ea8ff', energy: 1.6, weight: 6, luminosity: 5000 },
  neutron: { label: 'Neutron Star', color: '#e9f9ff', glow: '#7fe7ff', energy: 1.4, weight: 3, luminosity: 0.5 },
  black_hole: { label: 'Black Hole', color: '#000000', glow: '#b48cff', energy: 0.3, weight: 2, luminosity: 2000 },
};

/** Effective habitability of a planet type for a species, including unlocked techs. */
export function habitability(type: PlanetType, climate: Climate, habBonus: number, domes: boolean): number {
  const def = PLANET_TYPES[type];
  let h = def.hab[climate];
  if (type === 'gas_giant') return 0;
  if (type === 'barren') return domes ? 0.25 + habBonus * 0.5 : 0;
  if (h <= 0) return 0;
  h = Math.min(1, h + habBonus);
  return h;
}
