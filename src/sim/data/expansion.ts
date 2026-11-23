// Static definitions for the Grand Expansion: the two Stagnant Ascendancies, the Conclave's
// directives, what the Sentinels guard, and the tuning of the cosmic threats.

import type { Cost, ShipClass } from '../types';
import type { DirectiveKind, InjunctionProject, PrecursorId, SeatTier, SentinelKind } from '../expansionTypes';

export interface PrecursorDef {
  id: PrecursorId;
  name: string;
  adjective: string;
  color: string;
  ruler: string;
  epithet: string;
  lore: string;
  /** what wakes them, in plain words (shown in the UI) */
  wakes: string[];
  /** ancient technology: permanent combat modifiers of their hosts */
  mods: Record<string, number>;
  /** the dormant guard of the enclave and the host raised on awakening (repeated to strength) */
  guard: ShipClass[];
  host: ShipClass[];
  /** offering that calms them */
  tribute: Cost;
  /** research progress taken by a technology tribute (Automata Prime) */
  tributeResearch: number;
  /** what sponsorship gives, and what it demands */
  sponsorBoons: { key: string; value: number; label: string }[];
  sponsorDuty: string;
  /** months of intrusion into protected space before they strike */
  intrusionPatience: number;
}

export const PRECURSORS: Record<PrecursorId, PrecursorDef> = {
  veil: {
    id: 'veil', name: 'Archons of Veil', adjective: 'Archon', color: '#8fd3e8', ruler: 'The Ninefold Choir', epithet: 'Psionic ascendancy',
    lore: 'A psionic civilisation older than the hyperlanes, sealed in a handful of sacred systems. They speak rarely, guard their holy worlds jealously, and keep relics no younger people understands.',
    wakes: ['Settling their sacred worlds', 'Warships in their sacred systems', 'Englobing stars with Dyson Swarms', 'Realms reaching the Galactic Hegemony', 'Continuum Engine work', 'The Omega Incursion'],
    mods: { shipShields: 1.2, shipHull: 0.6, shipDamage: 0.5, evasion: 0.1, garrison: 5, starbase: 1.5, defensePlatform: 1.5 },
    guard: ['battleship', 'cruiser', 'cruiser', 'destroyer', 'destroyer'],
    host: ['battleship', 'battleship', 'cruiser', 'cruiser', 'carrier', 'destroyer'],
    tribute: { rare: 150, influence: 30 },
    tributeResearch: 0,
    sponsorBoons: [{ key: 'output.research', value: 0.1, label: 'Archon tutelage' }, { key: 'stability', value: 3, label: 'Archon blessing' }],
    sponsorDuty: 'Settle none of their sacred worlds and raise no Dyson Swarm.',
    intrusionPatience: 1,
  },
  automata: {
    id: 'automata', name: 'Automata Prime', adjective: 'Automata', color: '#c6a46a', ruler: 'The Prime Directive', epithet: 'Machine ascendancy',
    lore: 'An ancient machine civilisation that repairs itself, builds gateways between stars and remembers the makers of the Sentinels. It demands tribute in technology and destroys any thinking machine it calls forbidden.',
    wakes: ['Forbidden machine intelligence (Sentient Research Engines, the Grand Archive)', 'Destroying Sentinels', 'Unpaid technology tribute', 'Warships in their gateway systems', 'Realms reaching the Galactic Hegemony', 'Continuum Engine work', 'The Omega Incursion'],
    mods: { shipArmor: 1.4, shipHull: 0.9, shipDamage: 0.4, repair: 1.5, garrison: 5, starbase: 1.5, defensePlatform: 1.5 },
    guard: ['battleship', 'battleship', 'cruiser', 'destroyer'],
    host: ['dreadnought', 'battleship', 'battleship', 'cruiser', 'cruiser', 'destroyer'],
    tribute: { components: 120, electronics: 200 },
    tributeResearch: 300,
    sponsorBoons: [{ key: 'buildSpeed', value: 0.15, label: 'Automata gateways' }, { key: 'admin', value: 2, label: 'Automata gateways' }, { key: 'repair', value: 0.5, label: 'Automata self-repair' }],
    sponsorDuty: 'Research no forbidden machine intelligence and pay a tithe of 5% of your credit income.',
    intrusionPatience: 3,
  },
};

export const PRECURSOR_IDS: PrecursorId[] = ['veil', 'automata'];

/** Pressure thresholds: a warning, a final warning, and the awakening. */
export const PRESSURE = { stir: 50, final: 75, awaken: 100, decay: 0.35 };

/** influence a realm needs to seek sponsorship, and the opinion the precursor must hold of it */
export const SPONSOR_COST = 100;
export const SPONSOR_OPINION = 30;
export const KNOWLEDGE_COST = 50;
export const KNOWLEDGE_OPINION = 15;
export const KNOWLEDGE_COOLDOWN = 360 * 3;
/** years of peace after which an awakened power settles back into watchfulness */
export const WATCHFUL_YEARS = 3;

// ------------------------------------------------------------------ the High Conclave

export const SEAT_LABEL: Record<SeatTier, string> = { founder: 'Founding Sovereign', great: 'Great Power', sponsored: 'Sponsored Sovereign', delegate: 'Regional Delegate', observer: 'Observer' };
/** multiplier on a seat's computed weight */
export const SEAT_FACTOR: Record<SeatTier, number> = { founder: 1.5, great: 1.25, sponsored: 1, delegate: 0.8, observer: 0 };
export const VOTING_TIERS: SeatTier[] = ['founder', 'great', 'sponsored', 'delegate'];
/** no member may hold more than this share of the total vote */
export const WEIGHT_CAP = 0.34;

export interface DirectiveDef { kind: DirectiveKind; label: string; summary: string; cost: number; years: number }
export const DIRECTIVES: Record<DirectiveKind, DirectiveDef> = {
  containment: { kind: 'containment', label: 'Containment War', cost: 30, years: 10, summary: 'The members who vote for it go to war against the target together. Their fleets are supplied in one another\'s space and they share sight of the target\'s fleets. Members who voted against are not compelled.' },
  embargo: { kind: 'embargo', label: 'Market Embargo', cost: 25, years: 10, summary: 'Bound members suspend trade agreements and resource contracts with the target and refuse new ones. The target pays more on the galactic market and its trade routes earn less.' },
  naval_accords: { kind: 'naval_accords', label: 'Naval Accords', cost: 25, years: 10, summary: 'Bound members may not build warships beyond their naval capacity, and hold at most (2 + era) battleships and dreadnoughts. Suspended for a member at war with a precursor or a cosmic threat, and during emergency containment.' },
  ascension_injunction: { kind: 'ascension_injunction', label: 'Ascension Injunction', cost: 30, years: 10, summary: 'Bound members may not start or advance the regulated project. A member may defy the injunction, at a price.' },
  repeal: { kind: 'repeal', label: 'Repeal', cost: 20, years: 0, summary: 'Ends a directive in force.' },
};
export const INJUNCTION_LABEL: Record<InjunctionProject, string> = { continuum_engine: 'the Continuum Engine', dyson_swarm: 'Dyson Swarms', omega_theorem: 'the Omega Theorem' };

export const SESSION_DAYS = 60;
export const EMERGENCY_DAYS = 20;
/** minimum days between ordinary sessions */
export const ORDINARY_GAP = 240;
export const MOTION_COOLDOWN = 360 * 2;
export const VETO_COST = 60;
export const VETO_COOLDOWN = 360 * 5;
export const LOBBY_COST: Cost = { influence: 15, credits: 150 };
export const QUORUM = 0.4;
export const SUSPENSION_DAYS = 360 * 5;
/** founding: the Conclave forms in the third year once a realm reaches the Imperium, or in the eighth regardless */
export const FOUNDING = { earliest: 360 * 3, latest: 360 * 8 };

// ------------------------------------------------------------------ Sentinels

export interface SentinelDef { kind: SentinelKind; label: string; reward: string }
export const SENTINEL_SITES: Record<SentinelKind, SentinelDef> = {
  gateway: { kind: 'gateway', label: 'Sentinel gateway', reward: 'A charted gateway: the system becomes a jump nexus and the victor\'s fleets move 10% faster.' },
  relic_vault: { kind: 'relic_vault', label: 'Relic vault', reward: 'Relics and a burst of research for the victor.' },
  shipyard: { kind: 'shipyard', label: 'Ancient shipyard', reward: 'Two Sentinel-forged warships join the victor, and its naval capacity grows by 6.' },
  archive: { kind: 'archive', label: 'Research archive', reward: 'A technology unlocked outright, and +5% research for good.' },
};
export const SENTINEL_KINDS: SentinelKind[] = ['gateway', 'relic_vault', 'shipyard', 'archive'];

// ------------------------------------------------------------------ the Void Devourer

export const DEVOURER = {
  /** years after the start before it can appear (drawn per game within this range) */
  earliestYear: 20, latestYear: 30,
  /** days between moves (its next destination is announced a full move ahead) */
  moveDays: 40,
  /** energy output in the system it occupies, and in a system it scarred */
  drain: 0.15, scar: 0.7, scarYears: 8,
  /** after this many years it leaves the galaxy */
  lifespanYears: 16,
  maxShips: 8,
};

// ------------------------------------------------------------------ the Omega Incursion

export const OMEGA = {
  anomalyMonths: 8,
  warningMonths: 6,
  riftMonths: 3,
  /** corruption that claims this share of claimed space consumes the galaxy */
  consumeShare: 0.45,
  /** systems corrupted per month: base + per point of strength, scaled by galaxy size */
  spreadBase: 0.2, spreadPerStrength: 0.1,
  /** months a corrupted colony survives with no defender */
  neglectMonths: 6,
  sealCost: { rare: 400, components: 300, influence: 50 } as Cost,
  sealDays: 180,
  sealIntegrity: 60,
  breachIntegrity: 20,
  exploitIntegrity: 70,
  exploitCost: { influence: 100 } as Cost,
  recoveryYears: { sealed: 6, destroyed: 3, exploited: 8 },
};

export const CONTRIBUTIONS = {
  resources: { cost: { alloys: 300, energy: 300, credits: 300 } as Cost, credit: 20, label: 'Resources to the crisis fund' },
  intel: { cost: { influence: 30 } as Cost, credit: 10, label: 'Intelligence on the fronts' },
  infrastructure: { cost: { alloys: 400, components: 100 } as Cost, credit: 25, label: 'A containment lattice' },
};
