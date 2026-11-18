// Civilisational evolution. A kingdom climbs a Kardashev-style ladder, from
// feudal houses scrapping over a handful of worlds to a power that rewrites
// physical law. Each era has concrete requirements, grants permanent bonuses
// and opens era-locked technologies. Reaching the final era wins the game.

export interface EraReq {
  techs?: number; // technologies researched
  systems?: number; // systems held
  galaxyShare?: number; // fraction of all systems held
  pops?: number; // total population
  tech?: string; // a specific breakthrough
  megaStages?: number; // completed megastructure stages across the realm
  mega?: { id: string; stages: number }; // a specific megastructure
}

export interface EraDef {
  id: number;
  name: string;
  /** Kardashev rating at the start of the era */
  type: number;
  epithet: string;
  lore: string;
  /** shown when the era is reached */
  dawn: string;
  req: EraReq;
  mods: Record<string, number>;
  perks: string[];
}

export const ERAS: EraDef[] = [
  {
    id: 0, name: 'Age of Houses', type: 0.7, epithet: 'Feudal starfarers',
    lore: 'A handful of great houses hold a few worlds each. Ships are precious, loyalty is bought with land, and every claim is contested.',
    dawn: '',
    req: {}, mods: {}, perks: ['Starting era'],
  },
  {
    id: 1, name: 'Interstellar Imperium', type: 1.0, epithet: 'Type I civilisation',
    lore: 'Hyperlanes are charted and governed. A standing navy, an imperial bureaucracy and a senate of worlds turn a house into an empire.',
    dawn: 'The houses are bound into one imperial order. Your crown now commands a true interstellar state.',
    req: { techs: 10, systems: 4, pops: 60 },
    mods: { admin: 3, navalCap: 6, 'output.research': 0.1, stability: 2 },
    perks: ['+3 administrative capacity', '+6 naval capacity', '+10% research', '+2 stability', 'Unlocks imperial technologies'],
  },
  {
    id: 2, name: 'Stellar Ascendancy', type: 2.0, epithet: 'Type II civilisation',
    lore: 'Your realm drinks directly from its stars. Swarms of collectors englobe suns, and energy stops being a constraint.',
    dawn: 'The first star is harnessed. Your civilisation commands the full output of a sun.',
    req: { techs: 26, tech: 'era_stellar_engineering', megaStages: 2, pops: 160 },
    mods: { admin: 5, navalCap: 15, 'output.energy': 0.25, 'output.research': 0.15, 'output.alloys': 0.1, shipHull: 0.1 },
    perks: ['+25% energy, +15% research, +10% alloys', '+10% ship hull', '+5 admin, +15 naval capacity', 'Unlocks galactic-scale theory'],
  },
  {
    id: 3, name: 'Galactic Hegemony', type: 3.0, epithet: 'Type III civilisation',
    lore: 'A lattice of gates and relays spans the spiral. Your word moves faster than light and your industry spans the galaxy.',
    dawn: 'Your power now spans the galaxy itself. Lesser realms measure themselves against your shadow.',
    req: { techs: 42, tech: 'era_galactic_lattice', galaxyShare: 0.25, megaStages: 6 },
    mods: { admin: 10, navalCap: 30, 'output.minerals': 0.2, 'output.energy': 0.2, 'output.alloys': 0.2, 'output.research': 0.2, shipDamage: 0.15, stability: 5 },
    perks: ['+20% minerals, energy, alloys and research', '+15% weapon damage', '+10 admin, +30 naval capacity', '+5 stability', 'Unlocks dimensional engineering'],
  },
  {
    id: 4, name: 'Transcendent Continuum', type: 4.0, epithet: 'Type IV civilisation',
    lore: 'The Continuum Engine taps the vacuum between galaxies. Distance, scarcity and decay become choices rather than laws.',
    dawn: 'The Continuum Engine wakes. Your civilisation draws power from the fabric of the universe.',
    req: { tech: 'era_dimensional', mega: { id: 'continuum_engine', stages: 1 } },
    mods: { 'output.research': 0.4, 'output.energy': 0.4, shipShields: 0.25, growth: 0.25, stability: 5 },
    perks: ['+40% research and energy', '+25% shields', '+25% population growth', 'Unlocks the Omega Theorem'],
  },
  {
    id: 5, name: 'Omega Sovereignty', type: 5.0, epithet: 'Type V civilisation',
    lore: 'Your crown is no longer bound to one universe. History records this as the end of the age of kingdoms.',
    dawn: 'The Omega Theorem is proven and the Continuum Engine completed. Your sovereignty transcends this universe.',
    req: { tech: 'era_omega', mega: { id: 'continuum_engine', stages: 3 } },
    mods: {},
    perks: ['Ascension victory'],
  },
];

export const MAX_ERA = ERAS.length - 1;
