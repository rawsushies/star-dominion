// Era progression: requirement tracking, the Kardashev rating shown to the
// player, and the monthly check that advances a civilisation to its next age.

import { ERAS, MAX_ERA, type EraDef } from './data/eras';
import { TECH_BY_ID } from './data/techs';
import { MEGA_BY_ID } from './data/megastructures';
import { log } from './util';
import { civilisationPower, kardashevType } from './power';
import type { Empire, GameState } from './types';

export interface ReqStatus { label: string; have: number; need: number; done: boolean }

function megaStagesOf(state: GameState, e: Empire, id?: string): number {
  let n = 0;
  for (const s of state.galaxy.systems) for (const m of s.megastructures) if (m.ownerId === e.id && (!id || m.id === id)) n += m.stage;
  return n;
}

export function eraRequirements(state: GameState, e: Empire, era: EraDef): ReqStatus[] {
  const r = era.req;
  const out: ReqStatus[] = [];
  const push = (label: string, have: number, need: number) => out.push({ label, have, need, done: have >= need });
  if (r.techs) push(`${r.techs} technologies researched`, e.research.done.length, r.techs);
  if (r.systems) push(`${r.systems} systems held`, e.stats.systems, r.systems);
  if (r.galaxyShare) {
    const need = Math.ceil(state.galaxy.systems.length * r.galaxyShare);
    push(`${Math.round(r.galaxyShare * 100)}% of the galaxy held (${need} systems)`, e.stats.systems, need);
  }
  if (r.pops) push(`${r.pops} population`, Math.round(e.stats.population), r.pops);
  if (r.tech) push(`Breakthrough: ${TECH_BY_ID[r.tech]?.name ?? r.tech}`, e.research.done.includes(r.tech) ? 1 : 0, 1);
  if (r.megaStages) push(`${r.megaStages} megastructure stages completed`, megaStagesOf(state, e), r.megaStages);
  if (r.minK != null) {
    const k = civilisationPower(state, e).k;
    out.push({ label: `Kardashev ${r.minK.toFixed(1)} (${kardashevType(r.minK).label}) from usable power`, have: Math.round(k * 100) / 100, need: r.minK, done: k >= r.minK });
  }
  if (r.mega) push(`${MEGA_BY_ID[r.mega.id]?.label ?? r.mega.id}: ${r.mega.stages} ${r.mega.stages === 1 ? 'stage' : 'stages'}`, megaStagesOf(state, e, r.mega.id), r.mega.stages);
  return out;
}

/** 0..1 progress toward the next era (mean of capped requirement fractions). */
export function eraProgress(state: GameState, e: Empire): number {
  const era = e.era ?? 0;
  if (era >= MAX_ERA) return 1;
  const reqs = eraRequirements(state, e, ERAS[era + 1]);
  if (!reqs.length) return 1;
  return reqs.reduce((a, q) => a + Math.min(1, q.have / q.need), 0) / reqs.length;
}

/** Scientific Kardashev index from real usable power (see power.ts). */
export function kardashev(state: GameState, e: Empire): number {
  return civilisationPower(state, e).k;
}

export function eraMonthly(state: GameState) {
  for (const e of state.empires) {
    if (!e.alive || e.kind !== 'major') continue;
    const era = e.era ?? 0;
    if (era >= MAX_ERA) continue;
    const next = ERAS[era + 1];
    if (eraRequirements(state, e, next).every((q) => q.done)) {
      e.era = era + 1;
      e.stats.kardashev = Math.round(kardashev(state, e) * 100) / 100;
      log(state, {
        kind: 'era', severity: e.isPlayer ? 'good' : 'warn',
        title: e.isPlayer ? `A new age: ${next.name}` : `${e.name} enters the ${next.name}`,
        text: e.isPlayer ? next.dawn : `${e.name} has become a ${next.epithet}.`,
        empires: e.isPlayer ? [e.id] : [],
      });
    }
  }
}
