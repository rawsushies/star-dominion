// The imperial capital city: the Citadel (levels 1–30) and the great
// buildings raised around it on the capital world. Each building occupies a
// plot, is upgraded level by level against rising costs and build times,
// and is gated by the Citadel's level and by other buildings. Effects are
// empire modifier keys per level (see sim/capital.ts).

export const CITADEL_MAX = 30;

export interface CapitalBuildingDef {
  id: string;
  label: string;
  description: string;
  maxLevel: number;
  /** Citadel level needed to raise the first level */
  citadel: number;
  /** other buildings needed for the first level */
  requires?: Record<string, number>;
  /** cost of level 1; level L costs base × growth^(L-1) */
  cost: Record<string, number>;
  /** build days for level 1; level L takes days × (1 + 0.12(L-1)) */
  days: number;
  /** empire modifiers gained per level */
  perLevel: Record<string, number>;
  /** extra effects described for the UI */
  notes?: string;
  /** silhouette used by the city view */
  shape: 'tower' | 'dome' | 'hall' | 'spire' | 'yard' | 'forge' | 'wall' | 'market' | 'ring';
}

export const COST_GROWTH = 1.16;

export const CAPITAL_BUILDINGS: CapitalBuildingDef[] = [
  { id: 'citadel', label: 'Citadel', description: 'The seat of the crown. Every level opens new plots and allows grander works around it.', maxLevel: CITADEL_MAX, citadel: 0,
    cost: { credits: 200, minerals: 80, alloys: 15 }, days: 45, perLevel: { admin: 0.5, stability: 0.3, 'output.influence': 0.01 }, shape: 'tower' },
  { id: 'throne_hall', label: 'Throne hall', description: 'Where the sovereign holds court. Lends weight to the crown\'s word.', maxLevel: 20, citadel: 1,
    cost: { credits: 120, rare: 10 }, days: 30, perLevel: { 'output.influence': 0.03, stability: 0.2 }, notes: 'Level 10 allows a fourth decree.', shape: 'hall' },
  { id: 'treasury', label: 'Royal treasury', description: 'Vaults, mints and tax offices.', maxLevel: 20, citadel: 1,
    cost: { credits: 100, minerals: 60 }, days: 25, perLevel: { tax: 0.015, storage: 0.03 }, shape: 'dome' },
  { id: 'hall_of_heroes', label: 'Hall of Heroes', description: 'Barracks, archives and honours for the realm\'s notable people.', maxLevel: 10, citadel: 2,
    cost: { credits: 140, alloys: 30 }, days: 30, perLevel: {}, notes: '+2 places in the roster per level.', shape: 'hall' },
  { id: 'research_institute', label: 'Imperial research institute', description: 'The finest minds of the realm, gathered under one roof.', maxLevel: 25, citadel: 2,
    cost: { credits: 120, electronics: 30 }, days: 35, perLevel: { 'output.research': 0.02 }, shape: 'dome' },
  { id: 'imperial_shipyards', label: 'Imperial shipyards', description: 'Orbital slips and design bureaux for the royal navy.', maxLevel: 25, citadel: 3, requires: { treasury: 2 },
    cost: { credits: 140, alloys: 80 }, days: 40, perLevel: { shipCost: -0.01, navalCap: 1 }, shape: 'yard' },
  { id: 'refinery_complex', label: 'Refinery complex', description: 'Smelters and fabricators feeding the realm\'s industry.', maxLevel: 25, citadel: 4,
    cost: { credits: 100, minerals: 160 }, days: 35, perLevel: { 'output.alloys': 0.02, 'output.minerals': 0.01 }, shape: 'forge' },
  { id: 'diplomatic_quarter', label: 'Diplomatic quarter', description: 'Embassies, guest palaces and the foreign ministry.', maxLevel: 20, citadel: 4, requires: { throne_hall: 2 },
    cost: { credits: 160, rare: 15 }, days: 30, perLevel: { 'output.influence': 0.02, intel: 1 }, notes: 'Envoys win foreign courts faster.', shape: 'hall' },
  { id: 'military_academy', label: 'Military academy', description: 'Trains officers and forges their arms.', maxLevel: 20, citadel: 5, requires: { hall_of_heroes: 1 },
    cost: { credits: 150, alloys: 60 }, days: 35, perLevel: { garrison: 0.02 }, notes: 'Unlocks commissioning equipment. +5% experience for every character per level; recruits arrive one level higher per 5 levels.', shape: 'wall' },
  { id: 'intelligence_bureau', label: 'Intelligence bureau', description: 'Ciphers, informants and the watch on rival courts.', maxLevel: 20, citadel: 6, requires: { diplomatic_quarter: 1 },
    cost: { credits: 140, electronics: 40 }, days: 30, perLevel: { intel: 2, stability: 0.15 }, shape: 'spire' },
  { id: 'grand_market', label: 'Grand market', description: 'The exchange where the realm\'s wealth changes hands.', maxLevel: 20, citadel: 7, requires: { treasury: 5 },
    cost: { credits: 180, minerals: 80 }, days: 30, perLevel: { tradeValue: 0.025 }, shape: 'market' },
  { id: 'bastion', label: 'Bastion walls', description: 'Shield generators and fortress batteries around the capital.', maxLevel: 20, citadel: 8, requires: { military_academy: 3 },
    cost: { credits: 120, alloys: 120 }, days: 40, perLevel: { garrison: 0.05, defensePlatform: 0.03 }, shape: 'wall' },
  { id: 'arcology', label: 'Arcology spires', description: 'Vertical cities that house millions in comfort.', maxLevel: 20, citadel: 10, requires: { treasury: 6 },
    cost: { credits: 200, minerals: 200, alloys: 60 }, days: 45, perLevel: { growth: 0.03, stability: 0.2 }, shape: 'spire' },
  { id: 'stellar_observatory', label: 'Stellar observatory', description: 'Deep-space arrays that map the galaxy and the stars\' output.', maxLevel: 15, citadel: 12, requires: { research_institute: 8 },
    cost: { credits: 220, electronics: 80, rare: 20 }, days: 45, perLevel: { 'output.research': 0.015, 'output.energy': 0.015 }, shape: 'ring' },
  { id: 'stellar_forge', label: 'Stellar forge', description: 'A furnace fed by a tamed fragment of the star itself.', maxLevel: 15, citadel: 18, requires: { refinery_complex: 12 },
    cost: { credits: 400, alloys: 300, rare: 60 }, days: 60, perLevel: { 'output.energy': 0.04, 'output.alloys': 0.02 }, shape: 'forge' },
  { id: 'monument_of_ages', label: 'Monument of the ages', description: 'A colossus that tells the story of the dynasty to every citizen.', maxLevel: 10, citadel: 25, requires: { throne_hall: 15 },
    cost: { credits: 800, minerals: 400, rare: 80 }, days: 90, perLevel: { stability: 1, 'output.influence': 0.03 }, shape: 'tower' },
];
export const CAPITAL_BY_ID: Record<string, CapitalBuildingDef> = Object.fromEntries(CAPITAL_BUILDINGS.map((b) => [b.id, b]));

/** The city grid. The Citadel stands on CITADEL_PLOT; plots open outward from it. */
export const PLOT_COLS = 6;
export const PLOT_ROWS = 4;
export const CITADEL_PLOT = 8; // row 1, col 2 (near the centre)

/** Plots open at Citadel level L. */
export function plotsUnlocked(citadel: number): number {
  return Math.min(PLOT_COLS * PLOT_ROWS, 4 + citadel);
}
