// Planet designations: every colony beyond the capital is a province with a role. A designation
// strengthens the outputs that role depends on and costs a little elsewhere; a governor running
// the province strengthens the specialisation further (scaled by stewardship).

import type { YieldKey } from './buildings';

export type DesignationId = 'balanced' | 'agrarian' | 'mining' | 'energy' | 'forge' | 'research' | 'trade' | 'fortress';

export interface DesignationDef {
  id: DesignationId;
  label: string;
  description: string;
  /** output multipliers added to matching yields (0.25 = +25%) */
  boost: Partial<Record<YieldKey, number>>;
  /** applied to every yield the designation does not boost */
  other: number;
  stability: number;
  /** multiplier on orbital battery strength */
  defence: number;
}

export const DESIGNATIONS: Record<DesignationId, DesignationDef> = {
  balanced: { id: 'balanced', label: 'Balanced world', description: 'No specialisation.', boost: {}, other: 0, stability: 0, defence: 1 },
  agrarian: { id: 'agrarian', label: 'Breadbasket', description: '+30% food, −10% other output.', boost: { food: 0.3 }, other: -0.1, stability: 2, defence: 1 },
  mining: { id: 'mining', label: 'Mining world', description: '+30% minerals and rare elements, −10% other output.', boost: { minerals: 0.3, rare: 0.3 }, other: -0.1, stability: 0, defence: 1 },
  energy: { id: 'energy', label: 'Power world', description: '+30% energy, −10% other output.', boost: { energy: 0.3 }, other: -0.1, stability: 0, defence: 1 },
  forge: { id: 'forge', label: 'Forge world', description: '+25% alloys, electronics and components, −10% other output.', boost: { alloys: 0.25, electronics: 0.25, components: 0.25 }, other: -0.1, stability: -2, defence: 1 },
  research: { id: 'research', label: 'Academy world', description: '+30% research, −10% other output.', boost: { research: 0.3 }, other: -0.1, stability: 1, defence: 1 },
  trade: { id: 'trade', label: 'Trade hub', description: '+30% trade value and credits, −10% other output.', boost: { trade: 0.3, credits: 0.3 }, other: -0.1, stability: 1, defence: 1 },
  fortress: { id: 'fortress', label: 'Fortress world', description: 'Orbital batteries 60% stronger, +6 stability, −15% output.', boost: {}, other: -0.15, stability: 6, defence: 1.6 },
};

export const DESIGNATION_IDS = Object.keys(DESIGNATIONS) as DesignationId[];
/** Days before a world's designation can change again. */
export const DESIGNATION_COOLDOWN = 360;
export const DESIGNATION_COST = 25; // influence
