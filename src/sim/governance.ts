// Governance: royal decrees, the great houses of the realm, matters brought
// before the royal council, and provincial administration. Everything here
// works through empire modifiers (sim/modifiers.ts), character effects and
// validated commands, so the player and the AI play by the same rules.

import { DECREES, DECREE_BY_ID, HOUSE_NAMES, HOUSE_MOTTOS, HOUSE_COLORS, PETITIONS, PETITION_BY_ID, type DecreeDef, type HouseAmbition, type PetitionOption } from './data/governance';
import { charById, effectiveAttrs, effectiveness, governorBonus } from './characters';
import { warBetweenAny } from './territory';
import { chance, int, pick } from './rng';
import { log, nextId } from './util';
import type { Empire, GameState, GreatHouse, Petition } from './types';

const AMBITIONS: HouseAmbition[] = ['seat', 'war', 'low_taxes', 'province', 'wealth', 'piety'];

export function governs(e: Empire): boolean {
  return e.alive && (e.kind === 'major' || e.kind === 'minor');
}

/** Sectors in which the realm holds at least one system. */
export function provincesOf(state: GameState, empireId: number): number[] {
  const out = new Set<number>();
  for (const s of state.galaxy.systems) if (s.owner === empireId && s.sector != null) out.add(s.sector);
  return [...out].sort((a, b) => a - b);
}

/** Found the great houses of a realm (new games, and older saves on load). */
export function ensureHouses(state: GameState, e: Empire) {
  e.decrees ??= [];
  e.decreeCooldowns ??= {};
  e.petitions ??= [];
  if (e.houses || !governs(e)) return;
  const n = e.kind === 'major' ? 3 : 2;
  const provs = provincesOf(state, e.id);
  const used = new Set(state.empires.flatMap((x) => x.houses ?? []).map((h) => h.name));
  e.houses = [];
  for (let i = 0; i < n; i++) {
    let name = pick(state.rng, HOUSE_NAMES);
    for (let k = 0; k < 8 && used.has(name); k++) name = pick(state.rng, HOUSE_NAMES);
    used.add(name);
    e.houses.push({
      id: nextId(state), name, motto: pick(state.rng, HOUSE_MOTTOS), color: HOUSE_COLORS[(e.id * 3 + i) % HOUSE_COLORS.length],
      power: int(state.rng, 25, 60), loyalty: int(state.rng, 50, 70), ambition: pick(state.rng, AMBITIONS),
      grievance: 0, provinces: provs.length ? [provs[i % provs.length]] : [], revoltUntil: 0,
    });
  }
}

export function houseById(e: Empire, id: number | null | undefined): GreatHouse | null {
  return id == null ? null : e.houses?.find((h) => h.id === id) ?? null;
}

export function houseAmbitionMet(state: GameState, e: Empire, h: GreatHouse): boolean {
  switch (h.ambition) {
    case 'seat': return Object.values(e.council ?? {}).some((id) => charById(state, id)?.houseId === h.id);
    case 'province': return state.characters.some((c) => c.status === 'active' && c.ownerId === e.id && c.houseId === h.id && c.assignment?.kind === 'province');
    case 'war': return warBetweenAny(state, e.id);
    case 'low_taxes': return !e.decrees?.some((d) => d.id === 'tax_levy');
    case 'wealth': return e.stock.credits > 1200;
    case 'piety': return (e.stats?.avgStability ?? 50) >= 60;
  }
}

export function inRevolt(state: GameState, h: GreatHouse): boolean {
  return h.revoltUntil > state.tick;
}

// ---------------------------------------------------------------- decrees

/** How strongly a decree takes effect: the presiding council member's attribute and loyalty. */
export function decreeStrength(state: GameState, e: Empire, d: DecreeDef): number {
  const c = charById(state, e.council?.[d.seat]);
  if (!c || c.status !== 'active') return 0.8;
  return Math.min(1.6, 1 + effectiveAttrs(c)[d.attr] * 0.03 * effectiveness(c));
}

export function canIssueDecree(state: GameState, e: Empire, id: string): string | null {
  const d = DECREE_BY_ID[id];
  if (!d) return 'Unknown decree';
  if (!governs(e)) return 'Only a sovereign realm can issue decrees';
  if (e.decrees?.some((x) => x.id === id)) return 'Already in force';
  if ((e.decrees?.length ?? 0) >= maxDecrees(state, e)) return `At most ${maxDecrees(state, e)} decrees can be in force`;
  const cd = e.decreeCooldowns?.[id] ?? 0;
  if (cd > state.tick) return `Available again in ${Math.ceil((cd - state.tick) / 30)} months`;
  if (d.war && !warBetweenAny(state, e.id)) return 'Only in time of war';
  for (const [k, v] of Object.entries(d.cost)) if ((e.stock[k as keyof typeof e.stock] ?? 0) < v) return `Requires ${v} ${k}`;
  return null;
}

export function maxDecrees(state: GameState, e: Empire): number {
  return 3 + ((e.capital?.buildings.throne_hall?.level ?? 0) >= 10 ? 1 : 0);
}

export function issueDecree(state: GameState, e: Empire, id: string) {
  const d = DECREE_BY_ID[id];
  for (const [k, v] of Object.entries(d.cost)) (e.stock as Record<string, number>)[k] -= v;
  const strength = decreeStrength(state, e, d);
  (e.decrees ??= []).push({ id, until: state.tick + d.days, strength });
  for (const h of e.houses ?? []) {
    const dv = (d.houses?.[h.ambition] ?? 0) + (d.houses?.all ?? 0);
    if (dv) h.loyalty = clamp(h.loyalty + dv);
  }
  if (e.isPlayer) log(state, { kind: 'government', severity: 'info', title: `Decree: ${d.label}`, text: `${d.description} In force for ${Math.round(d.days / 30)} months at ${Math.round(strength * 100)}% strength.`, empires: [e.id] });
}

export function revokeDecree(state: GameState, e: Empire, id: string) {
  const d = DECREE_BY_ID[id];
  e.decrees = (e.decrees ?? []).filter((x) => x.id !== id);
  (e.decreeCooldowns ??= {})[id] = state.tick + (d?.cooldown ?? 180);
}

// ---------------------------------------------------------------- modifiers

const govCache = new WeakMap<Empire, { key: string; mods: Record<string, number> }>();

/** Empire modifiers from decrees, houses and provincial governors. */
export function governanceMods(state: GameState, e: Empire): Record<string, number> {
  const key = governanceSig(state, e);
  const hit = govCache.get(e);
  if (hit && hit.key === key) return hit.mods;
  const out: Record<string, number> = {};
  const add = (k: string, v: number) => { if (v) out[k] = (out[k] ?? 0) + v; };
  for (const d of e.decrees ?? []) {
    const def = DECREE_BY_ID[d.id];
    if (!def) continue;
    // drawbacks (negative stability) are not amplified by a skilled minister
    for (const [k, v] of Object.entries(def.mods)) add(k, v < 0 && k === 'stability' ? v : v * d.strength);
  }
  for (const h of e.houses ?? []) {
    add('stability', ((h.loyalty - 50) / 50) * (h.power / 100) * 6);
    if (inRevolt(state, h)) { add('stability', -8); add('tax', -0.1); }
  }
  // provincial administration: a governed province is easier to rule
  for (const c of state.characters) {
    if (c.status !== 'active' || c.ownerId !== e.id || c.assignment?.kind !== 'province') continue;
    add('admin', 1 + governorBonus(state, e.id, c.assignment.sectorId).admin);
  }
  govCache.set(e, { key, mods: out });
  return out;
}

export function governanceSig(state: GameState, e: Empire): string {
  let s = '';
  for (const d of e.decrees ?? []) s += d.id + d.strength.toFixed(3);
  for (const h of e.houses ?? []) s += `|${h.loyalty.toFixed(2)}:${h.power.toFixed(1)}:${inRevolt(state, h) ? 1 : 0}`;
  let g = 0;
  for (const c of state.characters) if (c.status === 'active' && c.ownerId === e.id && c.assignment?.kind === 'province') g = (g * 31 + c.id * 7 + c.assignment.sectorId + Object.values(c.skills).reduce((a, b) => a + b, 0) * 1000) | 0;
  return s + '#' + g;
}

// ---------------------------------------------------------------- petitions

function petitionText(state: GameState, e: Empire, p: Petition, s: string): string {
  const h = houseById(e, p.houseId);
  const m = charById(state, p.memberId);
  return s.replace(/\{house\}/g, h?.name ?? 'a noble house').replace(/\{member\}/g, m?.name ?? 'A councillor')
    .replace(/\{province\}/g, p.sectorId != null ? state.galaxy.sectors?.[p.sectorId]?.name ?? 'the provinces' : 'the provinces');
}

export function describePetition(state: GameState, e: Empire, p: Petition) {
  const def = PETITION_BY_ID[p.def];
  return {
    title: def.title,
    text: petitionText(state, e, p, def.text),
    options: def.options.map((o, i) => ({ index: i, label: petitionText(state, e, p, o.label), option: o, scale: petitionScale(state, p, def.attr), why: canChoose(e, o) })),
  };
}

function petitionScale(state: GameState, p: Petition, attr: keyof ReturnType<typeof effectiveAttrs>): number {
  const m = charById(state, p.memberId);
  if (!m || m.status !== 'active') return 1;
  return Math.min(1.5, 1 + effectiveAttrs(m)[attr] * 0.025 * effectiveness(m));
}

function canChoose(e: Empire, o: PetitionOption): string | null {
  for (const [k, v] of Object.entries(o.cost ?? {})) if ((e.stock[k as keyof typeof e.stock] ?? 0) < v) return `Requires ${v} ${k}`;
  return null;
}

/** Default answer when the council lets a matter lapse: the first option that costs nothing. */
export function defaultOption(defId: string): number {
  const opts = PETITION_BY_ID[defId].options;
  const refuse = opts.findIndex((o, j) => j > 0 && !o.cost);
  if (refuse >= 0) return refuse;
  const free = opts.findIndex((o) => !o.cost);
  return free >= 0 ? free : opts.length - 1;
}

export function canResolvePetition(e: Empire, petitionId: number, option: number): string | null {
  const p = e.petitions?.find((x) => x.id === petitionId);
  if (!p) return 'No such matter before the council';
  const o = PETITION_BY_ID[p.def]?.options[option];
  if (!o) return 'No such answer';
  return canChoose(e, o);
}

export function resolvePetition(state: GameState, e: Empire, petitionId: number, option: number) {
  const p = e.petitions!.find((x) => x.id === petitionId)!;
  const def = PETITION_BY_ID[p.def];
  const o = def.options[option];
  const scale = petitionScale(state, p, def.attr);
  for (const [k, v] of Object.entries(o.cost ?? {})) (e.stock as Record<string, number>)[k] -= v;
  for (const [k, v] of Object.entries(o.gain ?? {})) (e.stock as Record<string, number>)[k] += Math.round(v * scale);
  if (o.timed) {
    for (const [k, v] of Object.entries(o.timed.mods)) e.timedMods.push({ key: k, value: v > 0 ? v * scale : v, until: state.tick + o.timed.days, label: o.timed.label });
  }
  const h = houseById(e, p.houseId);
  if (h && o.house) { h.loyalty = clamp(h.loyalty + o.house); if (o.house > 0) h.grievance = Math.max(0, h.grievance - 6); }
  if (o.allHouses) for (const x of e.houses ?? []) x.loyalty = clamp(x.loyalty + o.allHouses);
  const m = charById(state, p.memberId);
  if (m && o.member) m.loyalty = clamp(m.loyalty + o.member);
  e.petitions = e.petitions!.filter((x) => x !== p);
}

function raisePetition(state: GameState, e: Empire) {
  const atWar = warBetweenAny(state, e.id);
  const eligible = PETITIONS.filter((d) => {
    if (d.war != null && d.war !== atWar) return false;
    if (e.petitions!.some((p) => p.def === d.id)) return false;
    if (d.from === 'house') return (e.houses?.length ?? 0) > 0;
    const holder = charById(state, e.council?.[d.from === 'chancellor' && d.war ? 'chancellor' : d.from]);
    return !!holder && holder.status === 'active';
  });
  if (!eligible.length) return;
  const d = pick(state.rng, eligible);
  const h = e.houses?.length ? pick(state.rng, e.houses) : null;
  const memberSeat = d.from === 'house' ? null : d.from;
  const provs = provincesOf(state, e.id);
  const p: Petition = {
    id: nextId(state), def: d.id, houseId: h?.id ?? null,
    memberId: memberSeat ? e.council?.[memberSeat] ?? null : null,
    sectorId: provs.length ? pick(state.rng, provs) : null,
    tick: state.tick, expires: state.tick + 90,
  };
  e.petitions!.push(p);
  if (e.isPlayer) log(state, { kind: 'council', severity: 'warn', title: `Before the council: ${d.title}`, text: petitionText(state, e, p, d.text) + ' Decide in the Council chamber within three months.', empires: [e.id] });
}

// ---------------------------------------------------------------- monthly

export function governanceMonthly(state: GameState) {
  for (const e of state.empires) {
    if (!governs(e)) continue;
    ensureHouses(state, e);
    // expire decrees
    for (const d of e.decrees!.filter((x) => x.until <= state.tick)) {
      revokeDecree(state, e, d.id);
      if (e.isPlayer) log(state, { kind: 'government', severity: 'info', title: `Decree lapsed: ${DECREE_BY_ID[d.id]?.label}`, text: 'It can be issued again after a cooldown.', empires: [e.id] });
    }
    // lapse unanswered petitions
    for (const p of e.petitions!.filter((x) => x.expires <= state.tick)) {
      resolvePetition(state, e, p.id, defaultOption(p.def));
      if (e.isPlayer) log(state, { kind: 'council', severity: 'warn', title: 'A matter lapsed', text: `The council did not answer "${PETITION_BY_ID[p.def].title}". The default answer was taken.`, empires: [e.id] });
    }
    // houses
    const provs = new Set(provincesOf(state, e.id));
    for (const h of e.houses!) {
      h.provinces = h.provinces.filter((x) => provs.has(x));
      if (!h.provinces.length && provs.size) h.provinces.push([...provs][h.id % provs.size]);
      const met = houseAmbitionMet(state, e, h);
      h.grievance = met ? Math.max(0, h.grievance - 2) : h.grievance + 1;
      const target = 55 + (met ? 15 : -Math.min(30, h.grievance * 1.2));
      h.loyalty = clamp(h.loyalty + Math.sign(target - h.loyalty) * Math.min(1.5, Math.abs(target - h.loyalty)));
      h.power = Math.max(5, Math.min(100, h.power + Math.sign(25 + h.provinces.length * 8 - h.power) * 0.5));
      if (inRevolt(state, h)) {
        if (h.loyalty >= 45) endRevolt(state, e, h, 'reconciled with the crown');
      } else if (h.revoltUntil > 0 && h.revoltUntil <= state.tick) {
        endRevolt(state, e, h, 'laid down its arms');
      } else if (h.loyalty < 20 && h.power > 25 && chance(state.rng, 0.12)) {
        h.revoltUntil = state.tick + 360;
        log(state, { kind: 'rebellion', severity: e.isPlayer ? 'danger' : 'info', title: `House ${h.name} rises against the ${e.name}`, text: `Its grievance: ${h.ambition.replace('_', ' ')}. Stability and taxes suffer until the house is reconciled or suppressed.`, empires: [e.id] });
      }
      // every few years a house changes what it wants
      if (chance(state.rng, 1 / 60)) { h.ambition = pick(state.rng, AMBITIONS); h.grievance = 0; }
    }
    if (chance(state.rng, e.kind === 'major' ? 0.3 : 0.12) && e.petitions!.length < 3) raisePetition(state, e);
  }
}

function endRevolt(state: GameState, e: Empire, h: GreatHouse, how: string) {
  h.revoltUntil = 0;
  h.grievance = 0;
  log(state, { kind: 'government', severity: 'good', title: `House ${h.name} ${how}`, text: `The revolt against the ${e.name} is over.`, empires: [e.id] });
}

/** Crown actions towards a house. */
export function canActOnHouse(state: GameState, e: Empire, h: GreatHouse | null, action: 'grant' | 'suppress' | 'honour'): string | null {
  if (!h) return 'No such house';
  if (action === 'grant' && e.stock.influence < 30) return 'Requires 30 influence';
  if (action === 'honour' && e.stock.credits < 250) return 'Requires 250 credits';
  if (action === 'suppress') {
    if (!inRevolt(state, h) && h.loyalty >= 30) return 'Only a disloyal or rebellious house can be suppressed';
    if (e.stock.influence < 20) return 'Requires 20 influence';
    const strength = Object.values(state.fleets).filter((f) => f.ownerId === e.id && f.systemId === e.capitalSystemId).reduce((a, f) => a + f.ships.length, 0);
    if (strength < 3) return 'Requires at least three warships at the capital';
  }
  return null;
}

export function actOnHouse(state: GameState, e: Empire, h: GreatHouse, action: 'grant' | 'suppress' | 'honour') {
  if (action === 'grant') { e.stock.influence -= 30; h.loyalty = clamp(h.loyalty + 15); h.grievance = Math.max(0, h.grievance - 10); }
  else if (action === 'honour') { e.stock.credits -= 250; h.loyalty = clamp(h.loyalty + 8); }
  else {
    e.stock.influence -= 20;
    h.power = Math.max(5, h.power - 25);
    h.loyalty = clamp(Math.max(30, h.loyalty - 5));
    h.revoltUntil = 0; h.grievance = 0;
    for (const o of e.houses ?? []) if (o !== h) o.loyalty = clamp(o.loyalty - 5);
    log(state, { kind: 'government', severity: 'warn', title: `House ${h.name} suppressed`, text: 'Its estates are seized and its levies disbanded. The other houses take note.', empires: [e.id] });
  }
}

function clamp(v: number) { return Math.max(0, Math.min(100, v)); }

export { DECREES };
