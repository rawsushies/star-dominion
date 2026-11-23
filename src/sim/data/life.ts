// Tuning of the living galaxy (sim/life.ts).

/** merchant convoys travel this many galaxy units a day */
export const CONVOY_SPEED = 10;
/** a world's surplus or deficit below this (units a month) is handled by local traders */
export const TRADE_MIN = 0.6;
/** most supply routes a world draws on */
export const SOURCES_PER_WORLD = 3;
/** realm reserves the capital depot ships out each month: stock / DEPOT_SHARE, up to DEPOT_MAX */
export const DEPOT_SHARE = 6;
export const DEPOT_MAX = 400;
export const DEPOT_MIN_STOCK = 60;
/** routes between realms */
export const INTERSTELLAR_PER_REALM = 3;
export const INTERSTELLAR_MAX = 80;
export const INTERSTELLAR_JUMPS = 30;
/** months a route may carry nothing before it is retired */
export const ROUTE_IDLE_MONTHS = 3;
/** share of cargo that reaches its destination by status */
export const ROUTE_EFF = { open: 1, raided: 0.5, blockaded: 0, severed: 0 } as const;
/** routes between realms pay the exporter the market price; trade treaties add this tariff share to both */
export const TARIFF = 0.1;
/** internal shipping earns its owner this share of the cargo's market value */
export const SHIPPING_SHARE = 0.04;
/** convoys per route: one per this many units a month (1..8) */
export const CARGO_PER_CONVOY = 6;
/** devastation added per five days of battle in the system, of siege, and on conquest */
export const DEVASTATION = { battle: 2, siege: 0.6, corruption: 0.5, conquest: 20 } as const;
/** most pops one migration moves, and flows per realm per month */
export const MIGRATION_MAX = 2.5;
export const MIGRATIONS_PER_REALM = 3;
/** years a rebel state must endure to be recognised as sovereign */
export const RECOGNITION_YEARS = 8;
/** years between secessions from one realm */
export const SECESSION_GAP_YEARS = 15;
/** months of crisis before a realm can fracture */
export const SECESSION_CRISIS = 12;
/** bounded galactic history */
export const HISTORY_MAX = 400;

export const PHASE_LABEL = {
  founding: 'Founding', rising: 'Rising', golden: 'Golden age', stable: 'Stable', declining: 'Declining', collapsing: 'Collapsing', recovering: 'Recovering',
} as const;
