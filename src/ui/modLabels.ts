// Human-readable names for empire modifier keys (sim/modifiers.ts), shared by the Kingdom window and the Codex.

export const INTEGER_MODS = new Set(['stability', 'admin', 'navalCap', 'diploOpinion', 'acceptance', 'intel', 'sensor']);
export const NEGATIVE_GOOD = new Set(['buildCost', 'shipCost', 'upkeepShips', 'upkeepBuildings', 'claimCost', 'colonyCost', 'marketFee', 'supplyDrain', 'foodUpkeep', 'warExhaustion']);

export function modLabel(k: string): string {
  const map: Record<string, string> = {
    stability: 'Stability', admin: 'Admin capacity', navalCap: 'Naval capacity', tax: 'Taxes', tradeValue: 'Trade value', growth: 'Population growth',
    buildSpeed: 'Construction speed', buildCost: 'Construction cost', shipBuildSpeed: 'Shipbuilding speed', shipCost: 'Ship cost', shipDamage: 'Weapon damage',
    shipHull: 'Ship hull', shipArmor: 'Ship armour', shipShields: 'Ship shields', shipSpeed: 'Fleet speed', tracking: 'Weapon tracking', evasion: 'Evasion',
    strikeDamage: 'Strike craft damage', upkeepShips: 'Fleet upkeep', upkeepBuildings: 'Building upkeep', garrison: 'Garrisons', defensePlatform: 'Defence batteries',
    starbase: 'Starbases', habitability: 'Habitability', claimCost: 'Outpost cost', colonyCost: 'Colony ship cost', colonizeSpeed: 'Colonisation speed',
    marketFee: 'Market fees', supplyDrain: 'Supply drain', repair: 'Repair rate', sensor: 'Sensor range', intel: 'Intelligence', diploOpinion: 'Opinion abroad',
    acceptance: 'Diplomatic acceptance', foodUpkeep: 'Food consumption', warExhaustion: 'War exhaustion gain', resistanceDecay: 'Pacification speed', storage: 'Storage',
  };
  if (k.startsWith('output.')) return `${k.slice(7)[0].toUpperCase()}${k.slice(8)} output`;
  return map[k] ?? k;
}

/** "+12% Taxes", "+3 Stability": a modifier value as the player reads it. */
export function modText(k: string, v: number): string {
  const pct = Math.abs(v) < 1.5 && !INTEGER_MODS.has(k);
  const n = pct ? `${v > 0 ? '+' : ''}${Math.round(v * 1000) / 10}%` : `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}`;
  return `${n} ${modLabel(k).toLowerCase()}`;
}
