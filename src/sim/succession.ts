// Royal succession. Every sovereign ages and eventually dies; the crown passes to the named heir,
// or, without one, to a claimant put forward by the strongest Great House. A named heir backed by
// loyal houses means a smooth coronation; an empty succession means a crisis: house loyalty falls,
// stability suffers for two years, and a disaffected house may rise for its own pretender.

import { RULER_FIRST, RULER_LAST } from './data/names';
import { charById, unassign } from './characters';
import { chance, int, pick } from './rng';
import { log } from './util';
import type { Character, Empire, GameState } from './types';

export const HEIR_COST = 10; // influence

export function rulerAge(state: GameState, e: Empire): number {
  return Math.floor((state.tick - (e.rulerBorn ?? state.tick - 40 * 360)) / 360);
}

/** Older saves and new realms: give the sovereign a birth date and an empty heir slot (no RNG use). */
export function ensureRuler(state: GameState, e: Empire) {
  e.rulerBorn ??= state.tick - (36 + ((e.id * 7) % 15)) * 360;
  if (e.heirId === undefined) e.heirId = null;
  e.reignStart ??= state.tick;
}

/** The named heir, if they are still alive and serving this realm. */
export function heirOf(state: GameState, e: Empire): Character | null {
  const c = charById(state, e.heirId);
  return c && c.status === 'active' && c.ownerId === e.id ? c : null;
}

/** Monthly chance that a sovereign of this age dies (accidents always possible, old age dominates). */
export function deathChance(age: number): number {
  return 0.0005 + Math.max(0, age - 55) ** 2 * 0.00005;
}

export function designateHeir(state: GameState, e: Empire, charId: number | null): string | null {
  if (charId == null) { e.heirId = null; return null; }
  const c = charById(state, charId);
  if (!c || c.ownerId !== e.id || c.status !== 'active') return 'Only one of your active people can be named heir';
  if (e.heirId === c.id) return null;
  if (e.stock.influence < HEIR_COST) return `Naming an heir costs ${HEIR_COST} influence`;
  e.stock.influence -= HEIR_COST;
  e.heirId = c.id;
  c.bio.push({ tick: state.tick, text: `Named heir to the throne of the ${e.name}.` });
  // the heir's house rejoices; rival houses grumble a little
  for (const h of e.houses ?? []) h.loyalty = Math.max(0, Math.min(100, h.loyalty + (h.id === c.houseId ? 6 : -1)));
  return null;
}

/** The crown passes on. Returns the new sovereign's name. */
export function succeed(state: GameState, e: Empire, cause: string): string {
  const old = e.ruler;
  const heir = heirOf(state, e);
  const houses = e.houses ?? [];
  const avgLoyalty = houses.length ? houses.reduce((a, h) => a + h.loyalty, 0) / houses.length : 60;
  let name: string, born: number, houseId: number | null = null, smooth: boolean;
  if (heir) {
    name = heir.name; born = heir.born; houseId = heir.houseId ?? null;
    unassign(state, heir);
    heir.status = 'retired';
    heir.bio.push({ tick: state.tick, text: `Ascended the throne of the ${e.name}.` });
    smooth = avgLoyalty >= 40;
  } else {
    // a claimant from the strongest house still loyal enough to be heard, else a distant relation
    const backer = [...houses].filter((h) => h.loyalty >= 35).sort((a, b) => b.power - a.power)[0];
    name = `${pick(state.rng, RULER_FIRST)} ${backer ? backer.name.replace(/^House /, '') : pick(state.rng, RULER_LAST)}`;
    born = state.tick - int(state.rng, 24, 48) * 360;
    houseId = backer?.id ?? null;
    smooth = false;
  }
  e.ruler = name; e.rulerBorn = born; e.reignStart = state.tick; e.heirId = null;
  const until = state.tick + 360 * (smooth ? 1 : 2);
  if (smooth) {
    for (const h of houses) h.loyalty = Math.max(0, Math.min(100, h.loyalty + (h.id === houseId ? 10 : -2)));
    e.timedMods.push({ key: 'stability', value: 3, until, label: 'Coronation' });
  } else {
    for (const h of houses) h.loyalty = Math.max(0, h.loyalty - (h.id === houseId ? 2 : 15));
    e.timedMods.push({ key: 'stability', value: -8, until, label: 'Succession crisis' });
    // the most powerful disaffected house rises for its own pretender
    const rebel = [...houses].filter((h) => h.loyalty < 30 && h.id !== houseId).sort((a, b) => b.power - a.power)[0];
    if (rebel) rebel.revoltUntil = state.tick + 360;
  }
  const player = e.id === state.playerId;
  log(state, {
    kind: 'succession', severity: player ? (smooth ? 'warn' : 'danger') : 'info',
    title: smooth ? `${name} is crowned` : `Succession crisis in the ${e.name}`,
    text: `${old} has ${cause}. ${heir ? `The named heir, ${name}, takes the throne` : `No heir was named; ${name} claims the throne`}${smooth ? ' with the support of the great houses.' : ', and the great houses are divided.'}`,
    empires: e.kind === 'major' ? [] : [e.id],
  });
  return name;
}

/** Monthly: sovereigns age, heirs who died or left are cleared, and death comes when it comes. */
export function successionMonthly(state: GameState) {
  for (const e of state.empires) {
    ensureRuler(state, e);
    if (!e.alive || (e.kind !== 'major' && e.kind !== 'minor')) continue;
    if (e.heirId != null && !heirOf(state, e)) {
      e.heirId = null;
      if (e.id === state.playerId) log(state, { kind: 'succession', severity: 'warn', title: 'The heir is lost', text: 'Your named heir can no longer inherit. Name another before the throne falls empty.', empires: [e.id] });
    }
    const age = rulerAge(state, e);
    if (chance(state.rng, deathChance(age))) succeed(state, e, age >= 60 ? 'died in old age' : 'died suddenly');
  }
}
