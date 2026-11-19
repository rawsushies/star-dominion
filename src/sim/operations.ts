// Resource operations: the orbital stations on uncolonised bodies, run as
// controllable operations. Each has a level (1–5), a mode and a reserve that
// heavy extraction drains. What an operation produces reaches the realm only
// through its logistics: the supply network, freighter capacity (spaceports,
// imperial shipyards, logistics tenders) and freedom from blockade. Output
// is written into the ordinary economy ledger (economy.ts), never a separate one.

import { STAR_TYPES } from './data/planets';
import { mod, type Mods } from './modifiers';
import { hostileArmedPresence } from './territory';
import { industrialistBonus } from './characters';
import type { Empire, GameState, OpMode, Planet, ResourceOp, StationKind } from './types';
import type { LedgerKey } from './economy';

export const OP_MAX_LEVEL = 5;

export const OP_KINDS: Record<StationKind, { label: string; produces: string; description: string }> = {
  mining: { label: 'Mining operation', produces: 'minerals, rare elements', description: 'Strip-mines the body\'s mineral and rare deposits.' },
  energy: { label: 'Energy collector', produces: 'energy', description: 'Collects stellar energy; brighter stars yield more.' },
  research: { label: 'Research outpost', produces: 'research', description: 'Studies an anomaly on the body.' },
  gas: { label: 'Gas harvester', produces: 'energy, rare elements', description: 'Skims a gas giant\'s atmosphere for fuel and exotic gases.' },
};

export const OP_MODES: Record<OpMode, { label: string; output: number; upkeep: number; reserve: number; description: string }> = {
  standard: { label: 'Standard', output: 1, upkeep: 1, reserve: -0.004, description: 'Steady extraction; the reserve falls slowly.' },
  surge: { label: 'Surge', output: 1.6, upkeep: 2, reserve: -0.025, description: '+60% output at double upkeep; the reserve drains fast.' },
  sustain: { label: 'Sustain', output: 0.7, upkeep: 0.8, reserve: 0.01, description: '-30% output while the reserve recovers.' },
  halted: { label: 'Halted', output: 0, upkeep: 0, reserve: 0.015, description: 'No output or upkeep; frees logistics capacity.' },
};

export function defaultOp(tick: number): ResourceOp {
  return { level: 1, mode: 'standard', reserve: 1, founded: tick };
}

/** Migrate stations from before operations existed. */
export function ensureOps(state: GameState) {
  for (const p of state.planets) if (p.station && !p.op) p.op = defaultOp(state.tick);
}

export function opUpgradeCost(level: number): Record<string, number> {
  const m = Math.pow(1.6, level - 1);
  const c: Record<string, number> = { minerals: Math.round(100 * m), credits: Math.round(40 * m) };
  if (level >= 3) c.alloys = 30 * (level - 2);
  return c;
}

export function canBuildStationOn(p: Planet, kind: StationKind): string | null {
  if (p.colony) return 'Colonised worlds cannot host extractors';
  if (p.station) return 'A station already exists';
  if (kind === 'research' && p.deposits.research <= 0) return 'No research anomaly here';
  if (kind === 'gas' && p.type !== 'gas_giant') return 'Only gas giants can be harvested';
  if (kind !== 'gas' && p.type === 'gas_giant' && kind === 'mining') return 'Gas giants have no surface to mine';
  return null;
}

/** Operations of a realm (stations in systems it owns). */
export function opsOf(state: GameState, empireId: number): Planet[] {
  const out: Planet[] = [];
  for (const p of state.planets) if (p.station && !p.colony && state.galaxy.systems[p.systemId].owner === empireId) out.push(p);
  return out;
}

/** Freighter capacity of a realm, in operation levels. */
export function logisticsCapacity(state: GameState, e: Empire, mods: Mods): number {
  let cap = 4;
  for (const p of state.planets) if (p.colony?.ownerId === e.id && p.colony.buildings.spaceport) cap += 2;
  cap += Math.floor((e.capital?.buildings.imperial_shipyards?.level ?? 0) / 2);
  for (const id in state.fleets) {
    const f = state.fleets[id];
    if (f.ownerId === e.id) for (const s of f.ships) if (s.cls === 'logistics') cap += 3;
  }
  return Math.round(cap + mod(mods, 'logistics'));
}

export function logisticsUsed(state: GameState, empireId: number): number {
  let n = 0;
  for (const p of opsOf(state, empireId)) if (p.op && p.op.mode !== 'halted') n += p.op.level;
  return n;
}

export type OpStatus = 'running' | 'halted' | 'cut off' | 'blockaded';
export interface OpReport {
  planetId: number;
  status: OpStatus;
  /** combined output factor (level, mode, reserve, supply, logistics, industrialist) */
  factor: number;
  output: [LedgerKey, number][];
  upkeep: [LedgerKey, number][];
  notes: string[];
}

/** What an operation delivers to the realm this month. */
export function opReport(state: GameState, e: Empire, p: Planet, mods: Mods, ctx: { network: Set<number>; logisticsEff: number }): OpReport {
  const op = p.op ?? defaultOp(state.tick);
  const sys = state.galaxy.systems[p.systemId];
  const mode = OP_MODES[op.mode];
  const notes: string[] = [];
  let status: OpStatus = 'running';
  let f = (1 + 0.6 * (op.level - 1)) * mode.output * (0.3 + 0.7 * op.reserve);
  if (op.mode === 'halted') status = 'halted';
  if (!ctx.network.has(p.systemId)) { f *= 0.5; status = status === 'running' ? 'cut off' : status; notes.push('Outside the supply network: half the output gets through'); }
  if (hostileArmedPresence(state, e.id, p.systemId)) { f = 0; status = 'blockaded'; notes.push('Hostile warships in the system stop all shipments'); }
  if (ctx.logisticsEff < 1 && op.mode !== 'halted') { f *= ctx.logisticsEff; notes.push(`Freighters overstretched: ${Math.round(ctx.logisticsEff * 100)}% delivered`); }
  const ind = industrialistBonus(state, p.id).output;
  if (ind) { f *= 1 + ind; notes.push(`Industrialist: +${Math.round(ind * 100)}%`); }
  if (op.reserve < 0.4) notes.push('Reserve running low');
  const out: [LedgerKey, number][] = [];
  const o = (k: LedgerKey, v: number) => { if (v * f > 1e-6) out.push([k, v * f * (1 + mod(mods, `output.${k}`))]); };
  switch (p.station) {
    case 'mining': o('minerals', p.deposits.minerals + 1); if (p.deposits.rare) o('rare', p.deposits.rare * 0.6); break;
    case 'energy': o('energy', (p.deposits.energy + 1) * STAR_TYPES[sys.star].energy); break;
    case 'research': o('research', p.deposits.research * 1.5 + 1); break;
    case 'gas': o('energy', 0.8 + p.deposits.energy * 0.5); o('rare', 0.4 + p.deposits.rare * 0.3); break;
  }
  const up = mode.upkeep * op.level;
  const upkeep: [LedgerKey, number][] = up ? [['energy', -0.3 * up], ['credits', -0.2 * up]] : [];
  return { planetId: p.id, status, factor: f, output: out, upkeep, notes };
}

/** Monthly: reserves fall or recover with each operation's mode. */
export function operationsMonthly(state: GameState) {
  for (const p of state.planets) {
    if (!p.station || !p.op) continue;
    if (p.colony) { p.station = null; delete p.op; continue; }
    const r = OP_MODES[p.op.mode].reserve * (p.op.mode === 'standard' || p.op.mode === 'surge' ? 1 + (p.op.level - 1) * 0.25 : 1);
    p.op.reserve = Math.max(0.05, Math.min(1, p.op.reserve + r));
  }
}
