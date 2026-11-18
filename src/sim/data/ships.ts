import type { Cost, ShipClass } from '../types';

export type HullSize = 'S' | 'M' | 'L' | 'XL' | 'civ';

export interface ShipDef {
  id: ShipClass;
  label: string;
  size: HullSize;
  role: string;
  cost: Cost;
  days: number;
  upkeep: Cost; // per month
  hull: number;
  armor: number;
  shields: number;
  damage: number; // per round, direct weapons
  tracking: number; // 0..1 accuracy vs evasive targets
  evasion: number; // 0..1
  strike?: number; // carrier strike craft damage (high tracking, PD can intercept)
  pointDefense?: number; // fraction of incoming strike damage intercepted (stacks with diminishing returns)
  pierce?: number; // fraction of damage that bypasses shields
  speed: number; // galaxy units per day
  command: number; // naval capacity used
  troops?: number;
  supplyAura?: boolean;
  sensor?: number; // jumps of vision
  tech?: string;
  civilian?: boolean;
  /** preferred target sizes for weighting */
  prefers: HullSize[];
  description: string;
}

const S = (d: ShipDef) => d;

export const SHIPS: Record<ShipClass, ShipDef> = {
  scout: S({
    id: 'scout', label: 'Scout', size: 'S', role: 'Exploration & intelligence',
    cost: { alloys: 25, credits: 25 }, days: 30, upkeep: { credits: 0.4 },
    hull: 80, armor: 0, shields: 20, damage: 2, tracking: 0.5, evasion: 0.6, speed: 11, command: 1, sensor: 2,
    prefers: ['S'], description: 'Long-range sensor skiff. Charts unknown systems and reveals fleets.',
  }),
  corvette: S({
    id: 'corvette', label: 'Corvette', size: 'S', role: 'Screening & raiding',
    cost: { alloys: 40, electronics: 6, credits: 10 }, days: 40, upkeep: { credits: 0.6, alloys: 0.05 },
    hull: 220, armor: 20, shields: 60, damage: 12, tracking: 0.65, evasion: 0.45, speed: 9, command: 1,
    prefers: ['S', 'civ', 'M'], description: 'Nimble attack craft. Hard to hit for heavy guns, weak to flak.',
  }),
  frigate: S({
    id: 'frigate', label: 'Frigate', size: 'S', role: 'Torpedo strike',
    cost: { alloys: 70, electronics: 10, credits: 15 }, days: 55, upkeep: { credits: 0.9, alloys: 0.08 },
    hull: 360, armor: 50, shields: 80, damage: 22, tracking: 0.4, evasion: 0.35, pierce: 0.6, speed: 8.5, command: 2,
    prefers: ['M', 'L'], description: 'Torpedo boat that punches above its weight against capital hulls.',
    tech: 'wpn_torpedoes',
  }),
  destroyer: S({
    id: 'destroyer', label: 'Destroyer', size: 'M', role: 'Escort & point defence',
    cost: { alloys: 120, electronics: 20, credits: 20 }, days: 70, upkeep: { credits: 1.2, alloys: 0.1 },
    hull: 650, armor: 120, shields: 150, damage: 30, tracking: 0.85, evasion: 0.25, pointDefense: 0.25,
    speed: 8, command: 2, prefers: ['S', 'M'], description: 'Flak-armed escort. Shreds corvettes and intercepts strike craft.',
    tech: 'eng_destroyers',
  }),
  cruiser: S({
    id: 'cruiser', label: 'Cruiser', size: 'M', role: 'Line combatant',
    cost: { alloys: 220, electronics: 40, components: 10, credits: 30 }, days: 100, upkeep: { credits: 2, alloys: 0.2 },
    hull: 1300, armor: 300, shields: 300, damage: 58, tracking: 0.45, evasion: 0.15, speed: 7.5, command: 4,
    prefers: ['M', 'L'], description: 'Versatile workhorse of the line with balanced protection.',
    tech: 'eng_cruisers',
  }),
  battlecruiser: S({
    id: 'battlecruiser', label: 'Battlecruiser', size: 'L', role: 'Fast heavy strike',
    cost: { alloys: 380, electronics: 60, components: 30, credits: 40 }, days: 140, upkeep: { credits: 3, alloys: 0.3 },
    hull: 2000, armor: 400, shields: 520, damage: 96, tracking: 0.35, evasion: 0.1, speed: 7.5, command: 6,
    prefers: ['M', 'L'], description: 'Battleship firepower on a lighter, faster hull.',
    tech: 'eng_battlecruisers',
  }),
  battleship: S({
    id: 'battleship', label: 'Battleship', size: 'L', role: 'Heavy line',
    cost: { alloys: 560, electronics: 80, components: 50, credits: 60 }, days: 180, upkeep: { credits: 4, alloys: 0.45 },
    hull: 3400, armor: 800, shields: 700, damage: 145, tracking: 0.2, evasion: 0.05, speed: 6, command: 8,
    prefers: ['L', 'XL', 'M'], description: 'Armoured gun platform. Devastating against large hulls, clumsy against small.',
    tech: 'eng_battleships',
  }),
  carrier: S({
    id: 'carrier', label: 'Carrier', size: 'L', role: 'Strike craft',
    cost: { alloys: 480, electronics: 120, components: 60, credits: 60 }, days: 170, upkeep: { credits: 4, alloys: 0.4 },
    hull: 2600, armor: 500, shields: 600, damage: 30, strike: 95, tracking: 0.3, evasion: 0.05, speed: 6.5, command: 8,
    prefers: ['S', 'M', 'L'], description: 'Launches fighter wings that hunt small and medium hulls. Vulnerable to flak.',
    tech: 'eng_carriers',
  }),
  dreadnought: S({
    id: 'dreadnought', label: 'Dreadnought', size: 'XL', role: 'Flagship',
    cost: { alloys: 1400, electronics: 260, components: 180, rare: 60, credits: 150 }, days: 320,
    upkeep: { credits: 10, alloys: 1, rare: 0.1 },
    hull: 9500, armor: 2200, shields: 2000, damage: 380, tracking: 0.25, evasion: 0.02, pointDefense: 0.2,
    speed: 5, command: 16, prefers: ['XL', 'L', 'M'], description: 'A sovereign’s statement. Lances capable of gutting a battle line.',
    tech: 'eng_dreadnoughts',
  }),
  logistics: S({
    id: 'logistics', label: 'Logistics Tender', size: 'M', role: 'Supply & repair',
    cost: { alloys: 100, electronics: 30, credits: 30 }, days: 60, upkeep: { credits: 1 },
    hull: 500, armor: 60, shields: 120, damage: 0, tracking: 0, evasion: 0.2, speed: 8, command: 2, supplyAura: true,
    prefers: [], description: 'Keeps fleets supplied and repaired far from friendly space.',
    tech: 'prop_logistics',
  }),
  transport: S({
    id: 'transport', label: 'Troop Transport', size: 'M', role: 'Invasion',
    cost: { alloys: 60, food: 40, credits: 40 }, days: 45, upkeep: { credits: 0.8 },
    hull: 320, armor: 30, shields: 40, damage: 0, tracking: 0, evasion: 0.2, speed: 8, command: 1, troops: 8,
    prefers: [], description: 'Carries assault divisions to seize enemy worlds.',
  }),
  constructor: S({
    id: 'constructor', label: 'Construction Ship', size: 'civ', role: 'Outposts', civilian: true,
    cost: { alloys: 60, credits: 50 }, days: 50, upkeep: { credits: 0.5 },
    hull: 150, armor: 0, shields: 30, damage: 0, tracking: 0, evasion: 0.3, speed: 9, command: 0,
    prefers: [], description: 'Deploys starbase outposts to claim star systems.',
  }),
  colony: S({
    id: 'colony', label: 'Colony Ship', size: 'civ', role: 'Colonisation', civilian: true,
    cost: { alloys: 120, food: 120, credits: 150 }, days: 90, upkeep: { credits: 0.5 },
    hull: 250, armor: 20, shields: 40, damage: 0, tracking: 0, evasion: 0.15, speed: 7, command: 0,
    prefers: [], description: 'Carries settlers, seed banks and prefab habitats to found a colony.',
  }),
};

export const SHIP_ORDER: ShipClass[] = [
  'scout', 'corvette', 'frigate', 'destroyer', 'cruiser', 'battlecruiser', 'battleship',
  'carrier', 'dreadnought', 'logistics', 'transport', 'constructor', 'colony',
];

export const SIZE_WEIGHT: Record<HullSize, number> = { S: 1, M: 2, L: 3, XL: 4, civ: 1 };

/** Starbase combat profile by level (acts like a stationary ship). */
export const STARBASE = [
  null,
  { label: 'Outpost', hull: 1200, armor: 150, shields: 400, damage: 25, tracking: 0.5, upgrade: { alloys: 0, credits: 0 }, days: 0 },
  { label: 'Starport', hull: 4000, armor: 500, shields: 1200, damage: 90, tracking: 0.45, upgrade: { alloys: 250, credits: 150 }, days: 180 },
  { label: 'Citadel', hull: 12000, armor: 1400, shields: 3200, damage: 260, tracking: 0.4, upgrade: { alloys: 700, electronics: 120, components: 60, credits: 300 }, days: 360 },
] as const;

export const DEFENSE_PLATFORM = { hull: 900, armor: 250, shields: 300, damage: 45, tracking: 0.5 };
