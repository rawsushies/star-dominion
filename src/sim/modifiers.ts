// Central modifier aggregation. Every bonus in the game (government, policies,
// technology, megastructures, timed events, difficulty) is expressed as a
// named additive modifier so that all systems read from one place.

import { GOVERNMENTS, POLICY_BY_ID } from './data/governments';
import { TECH_BY_ID } from './data/techs';
import { MEGA_BY_ID } from './data/megastructures';
import { ERAS } from './data/eras';
import type { Empire, GameState } from './types';

export type Mods = Record<string, number>;

const cache = new WeakMap<Empire, { sig: string; mods: Mods; flags: Set<string> }>();

/** Systems that host any megastructure, rebuilt at most once per tick. */
const megaHosts = new WeakMap<GameState, { tick: number; hosts: number[] }>();
export function megastructureHosts(state: GameState): number[] {
  let c = megaHosts.get(state);
  if (!c || c.tick !== state.tick) {
    const hosts: number[] = [];
    for (const sys of state.galaxy.systems) if (sys.megastructures.length) hosts.push(sys.id);
    c = { tick: state.tick, hosts };
    megaHosts.set(state, c);
  }
  return c.hosts;
}

function megaStages(state: GameState, empireId: number): { id: string; stage: number }[] {
  const out: { id: string; stage: number }[] = [];
  for (const sid of megastructureHosts(state)) {
    for (const m of state.galaxy.systems[sid].megastructures) if (m.ownerId === empireId && m.stage > 0) out.push({ id: m.id, stage: m.stage });
  }
  return out;
}

function signature(state: GameState, e: Empire, megas: { id: string; stage: number }[]): string {
  return [
    e.government,
    Object.values(e.policies).join(','),
    e.research.done.length,
    e.timedMods.map((t) => t.key + t.value).join(','),
    megas.map((m) => m.id + m.stage).join(','),
    state.settings.difficulty,
    e.isPlayer ? 1 : 0,
    e.era ?? 0,
  ].join('|');
}

export function empireMods(state: GameState, e: Empire): Mods {
  return compute(state, e).mods;
}

export function hasFlag(state: GameState, e: Empire, flag: string): boolean {
  return compute(state, e).flags.has(flag);
}

export function hasTech(e: Empire, tech: string | undefined): boolean {
  return !tech || e.research.done.includes(tech);
}

function compute(state: GameState, e: Empire) {
  const megas = megaStages(state, e.id);
  const sig = signature(state, e, megas);
  const hit = cache.get(e);
  if (hit && hit.sig === sig) return hit;
  const mods: Mods = {};
  const add = (src: Record<string, number> | undefined, mult = 1) => {
    if (!src) return;
    for (const k in src) mods[k] = (mods[k] ?? 0) + src[k] * mult;
  };
  add(GOVERNMENTS[e.government]?.mods);
  for (const pid in e.policies) {
    const def = POLICY_BY_ID[pid];
    const opt = def?.options.find((o) => o.id === e.policies[pid]);
    add(opt?.mods);
  }
  const flags = new Set<string>();
  for (const t of e.research.done) {
    const def = TECH_BY_ID[t];
    add(def?.mods);
    def?.flags?.forEach((f) => flags.add(f));
  }
  for (const m of megas) add(MEGA_BY_ID[m.id]?.modsPerStage, m.stage);
  for (let i = 1; i <= (e.era ?? 0) && i < ERAS.length; i++) add(ERAS[i].mods);
  for (const tm of e.timedMods) mods[tm.key] = (mods[tm.key] ?? 0) + tm.value;
  // Difficulty: AI bonuses (never applied to the player).
  if (!e.isPlayer && e.kind === 'major') {
    const d = state.settings.difficulty;
    const b = d === 'hard' ? 0.25 : d === 'relaxed' ? -0.15 : 0;
    if (b) for (const k of ['output.minerals', 'output.energy', 'output.food', 'output.alloys', 'output.research', 'tax']) mods[k] = (mods[k] ?? 0) + b;
  }
  const entry = { sig, mods, flags };
  cache.set(e, entry);
  return entry;
}

export function mod(m: Mods, key: string): number {
  return m[key] ?? 0;
}
