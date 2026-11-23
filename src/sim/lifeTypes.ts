// State of the living galaxy (sim/life.ts): merchant routes and their convoys,
// migrants in transit, the arcs of civilisations and the galactic history.
// Plain JSON, saved with the game; absent in older saves until loaded.

import type { ResId } from './types';

export const TRADE_GOODS = ['food', 'minerals', 'energy', 'alloys', 'electronics', 'components', 'rare'] as const;
export type TradeGood = (typeof TRADE_GOODS)[number] & ResId;

/** open: cargo flows; raided: corsairs take a share; blockaded / severed: nothing gets through */
export type RouteStatus = 'open' | 'raided' | 'blockaded' | 'severed';

/**
 * A standing merchant route between two worlds. Its convoys sail a fixed schedule: each convoy
 * leaves the origin every `days * 2 / convoys` days and the renderer places them from that schedule,
 * so every cargo ship on the map is a run of this route.
 */
export interface TradeRoute {
  id: number;
  /** origin and destination worlds (planet ids) */
  from: number;
  to: number;
  /** exporting and importing realms (equal for an internal supply route) */
  a: number;
  b: number;
  /** units per month the route is meant to carry */
  cargo: Partial<Record<TradeGood, number>>;
  /** systems from origin to destination */
  path: number[];
  /** one-way travel time in days */
  days: number;
  since: number;
  status: RouteStatus;
  statusSince: number;
  /** who blocks or raids it (empire id), when known */
  blocker?: number | null;
  /** months the route has had no reason to exist (retired after a few) */
  idle: number;
  /** cumulative units delivered */
  carried: number;
}

/** Settlers or refugees aboard transports: the pops left `from` and arrive on `to` at `arrive`. */
export interface Migration {
  id: number;
  from: number;
  to: number;
  pops: number;
  depart: number;
  arrive: number;
  kind: 'settlers' | 'refugees' | 'labour';
  /** owner of the destination world when they set out */
  owner: number;
}

export type RealmPhase = 'founding' | 'rising' | 'golden' | 'stable' | 'declining' | 'collapsing' | 'recovering';

export interface RealmArc {
  phase: RealmPhase;
  since: number;
  /** yearly economic score (last 30 years) */
  econ: number[];
  /** yearly population (last 30 years) */
  pop: number[];
  peakEcon: number;
  /** months in crisis (collapsing conditions) */
  crisis: number;
  /** pressure of overcrowded, jobless people wanting new worlds */
  pressure: number;
  /** average colony prosperity */
  prosperity: number;
  /** tick the realm was first seen (or founded) */
  born?: number;
  /** last golden age (tick) */
  goldenTick?: number;
  /** last secession (tick) */
  splitTick?: number;
}

export type HistoryKind =
  | 'trade' | 'blockade' | 'famine' | 'migration' | 'refugees' | 'rise' | 'decline' | 'golden'
  | 'collapse' | 'recovery' | 'secession' | 'recognition' | 'ascendant' | 'depletion' | 'devastation' | 'rebuilt' | 'boom' | 'bust';

/** A remembered event of galactic history: what happened, why, to whom, and what came of it. */
export interface HistoryEntry {
  id: number;
  tick: number;
  kind: HistoryKind;
  title: string;
  cause: string;
  effect: string;
  who: number[];
  systemId?: number;
  planetId?: number;
  /** 1 (minor) .. 3 (epochal): decides what survives when the record is trimmed */
  weight: number;
}

export interface LifeState {
  routes: TradeRoute[];
  migrations: Migration[];
  arcs: Record<string, RealmArc>;
  history: HistoryEntry[];
  /** systems whose worlds were abandoned or depopulated: tick, former owner, why */
  ruins: Record<string, { tick: number; owner: number; cause: string }>;
  /** galactic trade volume per month, last 120 months (for the chronicle) */
  volume: number[];
  /** de-duplication of notices: key -> tick */
  noticed: Record<string, number>;
}
