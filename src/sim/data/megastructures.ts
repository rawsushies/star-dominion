import type { Cost, StarType } from '../types';

export interface MegaDef {
  id: string;
  label: string;
  tech: string;
  stages: number;
  stageCost: Cost;
  stageDays: number;
  /** empire modifiers granted per completed stage */
  modsPerStage: Record<string, number>;
  /** flat monthly output per completed stage (added to kingdom income) */
  outputPerStage?: Partial<Record<string, number>>;
  starReq?: StarType[];
  unique?: boolean; // one per empire
  description: string;
}

export const MEGASTRUCTURES: MegaDef[] = [
  {
    id: 'sector_array', label: 'Sector Harvest Array', tech: 'era_galactic_lattice', stages: 3,
    stageCost: { alloys: 4000, components: 900, rare: 300, credits: 3000 }, stageDays: 480,
    modsPerStage: { 'output.energy': 0.1 }, outputPerStage: { energy: 250 },
    description: 'Relays and lenses spread across a whole galactic sector, gathering the light of every star it holds. The path to a Type III civilisation.',
  },
  {
    id: 'continuum_engine', label: 'Continuum Engine', tech: 'era_dimensional', stages: 3,
    stageCost: { alloys: 6000, components: 1500, rare: 800, credits: 5000 }, stageDays: 540,
    modsPerStage: { 'output.research': 0.2, 'output.energy': 0.2 }, outputPerStage: { energy: 400 }, unique: true,
    description: 'A machine that draws power from the vacuum itself. Its first stage opens the Transcendent Continuum; the third, Omega Sovereignty.',
  },
  {
    id: 'orbital_ring', label: 'Orbital Ring Shipyard', tech: 'ind_orbital_foundries', stages: 2,
    stageCost: { alloys: 1500, components: 200, credits: 1500 }, stageDays: 360,
    modsPerStage: { shipBuildSpeed: 0.25, navalCap: 10 },
    description: 'A ring of slipways circling a world. Faster shipbuilding and expanded naval capacity.',
  },
  {
    id: 'bastion', label: 'Bastion Citadel', tech: 'def_bastion', stages: 2,
    stageCost: { alloys: 2500, components: 300, electronics: 300 }, stageDays: 420,
    modsPerStage: {}, // combat: starbase in host system gets x3 strength per stage
    description: 'A fortress-moon of guns and shields. Makes its host system nearly impregnable.',
  },
  {
    id: 'dyson_swarm', label: 'Dyson Swarm', tech: 'en_dyson', stages: 4,
    stageCost: { alloys: 2000, components: 150, credits: 1000 }, stageDays: 360,
    modsPerStage: {}, outputPerStage: { energy: 120 },
    starReq: ['yellow', 'orange', 'red', 'white', 'blue'],
    description: 'Billions of collectors englobing a star. Each stage yields vast energy.',
  },
  {
    id: 'stellar_collector', label: 'Stellar Collector', tech: 'en_stellar_collector', stages: 2,
    stageCost: { alloys: 1200, electronics: 200, credits: 800 }, stageDays: 300,
    modsPerStage: { 'output.energy': 0.1 }, outputPerStage: { energy: 40, rare: 6 },
    starReq: ['white', 'blue', 'neutron'],
    description: 'Lensing array that siphons exotic matter from hot stars.',
  },
  {
    id: 'hypergate', label: 'Hypergate', tech: 'prop_hypergates', stages: 1,
    stageCost: { alloys: 1800, components: 250, rare: 150, credits: 1200 }, stageDays: 480,
    modsPerStage: {},
    description: 'Instant passage between any two of your Hypergates.',
  },
  {
    id: 'grand_archive', label: 'Grand Archive', tech: 'ai_sentient', stages: 3, unique: true,
    stageCost: { alloys: 1200, electronics: 500, credits: 1500 }, stageDays: 360,
    modsPerStage: { 'output.research': 0.15 }, outputPerStage: { research: 60 },
    description: 'A sentient library-station. Each stage accelerates research across the realm.',
  },
  {
    id: 'lattice', label: 'Planetary Lattice Network', tech: 'col_lattice', stages: 3, unique: true,
    stageCost: { alloys: 1500, electronics: 300, credits: 1800 }, stageDays: 360,
    modsPerStage: { admin: 6, stability: 4, tradeValue: 0.1 },
    description: 'A realm-wide infrastructure web binding worlds into one administration.',
  },
];

export const MEGA_BY_ID: Record<string, MegaDef> = Object.fromEntries(MEGASTRUCTURES.map((m) => [m.id, m]));
