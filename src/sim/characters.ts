// Characters: creation, effective stats, effects on the simulation, experience
// and skills, loyalty and ambitions, recruitment pools, capture and captives,
// equipment, and the monthly update (including AI management of its people).
//
// Effects reach the simulation through narrow hooks:
//   - fleet leaders (admiral / general / explorer)  -> fleetLeaderBonus()
//   - council seats                                 -> councilMods() (empire modifiers)
//   - provincial governors                          -> governorBonus()
//   - planet industrialists                         -> industrialistBonus()
//   - envoys                                        -> monthly opinion memories

import { ROLES, TRAIT_BY_ID, SKILL_BY_ID, ITEM_BY_ID, ATTRS, ADMIRAL_TRAITS, FIRST_NAMES, LAST_NAMES, ORIGINS, TRAITS, ROLE_ORDER, type Attr, type CharRole, type AmbitionKind, type EquipSlot } from './data/characters';
import { COUNCIL_SEATS, SEAT_BY_ID } from './data/council';
import { chance, int, next, pick } from './rng';
import { log, nextId } from './util';
import type { Character, CharAssignment, Empire, Fleet, GameState, LegacyAdmiral } from './types';

// ---------------------------------------------------------------- lookup

const byIdCache = new WeakMap<Character[], { len: number; map: Map<number, Character> }>();
export function charById(state: GameState, id: number | null | undefined): Character | null {
  if (id == null) return null;
  const list = state.characters;
  let c = byIdCache.get(list);
  if (!c || c.len !== list.length) {
    c = { len: list.length, map: new Map(list.map((x) => [x.id, x])) };
    byIdCache.set(list, c);
  }
  return c.map.get(id) ?? null;
}

export function charactersOf(state: GameState, empireId: number, status: Character['status'] | 'any' = 'active'): Character[] {
  return state.characters.filter((c) => c.ownerId === empireId && (status === 'any' || c.status === status));
}
export function captivesHeldBy(state: GameState, empireId: number): Character[] {
  return state.characters.filter((c) => c.status === 'captive' && c.captorId === empireId);
}

/** Roster limit for active characters (raised by the capital's Hall of Heroes). */
export function rosterLimit(state: GameState, e: Empire): number {
  return 8 + (e.capital?.buildings.hall_of_heroes?.level ?? 0) * 2;
}

// ---------------------------------------------------------------- creation

const AMBITIONS_FOR: Record<CharRole, AmbitionKind[]> = {
  admiral: ['glory', 'power', 'wealth'], general: ['glory', 'land', 'wealth'], governor: ['land', 'power', 'wealth'],
  scientist: ['knowledge', 'power', 'wealth'], diplomat: ['power', 'wealth', 'land'], chancellor: ['power', 'wealth', 'land'],
  industrialist: ['wealth', 'power', 'land'], explorer: ['knowledge', 'glory', 'wealth'], spymaster: ['power', 'wealth', 'knowledge'],
};

export function createCharacter(state: GameState, ownerId: number, role: CharRole, opts: { level?: number; status?: Character['status']; trait?: string; name?: string } = {}): Character {
  const rng = state.rng;
  const e = state.empires[ownerId];
  const attrs = {} as Record<Attr, number>;
  for (const a of ATTRS) attrs[a] = int(rng, 2, 6);
  const def = ROLES[role];
  attrs[def.primary[0]] += int(rng, 3, 6);
  if (def.primary[1]) attrs[def.primary[1]] += int(rng, 1, 4);
  const traits: string[] = [];
  if (opts.trait) traits.push(opts.trait);
  else if (role === 'admiral') traits.push(pick(rng, ADMIRAL_TRAITS));
  const pool = TRAITS.filter((t) => !ADMIRAL_TRAITS.includes(t.id) && t.id !== 'disgraced');
  while (traits.length < (chance(rng, 0.45) ? 2 : 1) + (role === 'admiral' ? 1 : 0)) {
    const t = pick(rng, pool).id;
    if (!traits.includes(t)) traits.push(t);
  }
  const level = opts.level ?? int(rng, 1, 3);
  for (let l = 1; l < level; l++) attrs[def.primary[l % def.primary.length]]++;
  const home = e?.capitalSystemId != null ? state.galaxy.systems[e.capitalSystemId].name : 'the frontier';
  const c: Character = {
    id: nextId(state),
    ownerId,
    originId: ownerId,
    name: opts.name ?? `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`,
    role,
    level,
    xp: 0,
    skillPoints: level - 1,
    skills: {},
    attrs,
    traits,
    loyalty: 55 + int(rng, -10, 15),
    ambition: { kind: pick(rng, AMBITIONS_FOR[role]), unmetMonths: 0 },
    status: opts.status ?? 'active',
    captorId: null,
    assignment: null,
    equipment: {},
    born: state.tick - int(rng, 25, 55) * 360,
    houseId: null,
    bio: [],
    record: { battlesWon: 0, battlesLost: 0, worldsTaken: 0, monthsServed: 0 },
  };
  if (e?.houses?.length && chance(rng, 0.35)) c.houseId = pick(rng, e.houses).id;
  const origin = pick(rng, ORIGINS).replace('{home}', home).replace('{realm}', e?.name ?? 'the crown');
  c.bio.push({ tick: state.tick, text: `${c.name}, ${origin}, ${opts.status === 'candidate' ? 'seeks a place in the service of' : 'serves'} the ${e?.name ?? 'realm'} as ${def.label.toLowerCase()}.` });
  state.characters.push(c);
  return c;
}

/** Convert pre-character admirals into characters (save migration). */
export function migrateAdmirals(state: GameState & { admirals?: LegacyAdmiral[] }) {
  if (!Array.isArray(state.characters)) state.characters = [];
  const legacy = state.admirals;
  if (!legacy) return;
  for (const a of legacy) {
    const attrs = { martial: 4, command: 4 + a.skill, cunning: 4, diplomacy: 3, stewardship: 3, science: 3 } as Record<Attr, number>;
    state.characters.push({
      id: a.id, ownerId: a.ownerId, originId: a.ownerId, name: a.name, role: 'admiral',
      level: Math.max(1, a.skill), xp: a.xp * 8, skillPoints: Math.max(0, a.skill - 1), skills: {}, attrs,
      traits: [a.trait], loyalty: 60, ambition: { kind: 'glory', unmetMonths: 0 },
      status: a.alive ? 'active' : 'dead', captorId: null,
      assignment: a.alive && a.fleetId != null && state.fleets[a.fleetId] ? { kind: 'fleet', fleetId: a.fleetId } : null,
      equipment: {}, born: state.tick - 40 * 360, houseId: null,
      bio: [{ tick: state.tick, text: `${a.name} has served in the admiralty since before the records of this reign were kept.` }],
      record: { battlesWon: 0, battlesLost: 0, worldsTaken: 0, monthsServed: 0 },
    });
  }
  delete state.admirals;
}

// ---------------------------------------------------------------- effective stats

export function effectiveAttrs(c: Character): Record<Attr, number> {
  const out = { ...c.attrs };
  for (const t of c.traits) for (const [k, v] of Object.entries(TRAIT_BY_ID[t]?.attrs ?? {})) out[k as Attr] += v;
  for (const id of Object.values(c.equipment)) if (id) for (const [k, v] of Object.entries(ITEM_BY_ID[id]?.attrs ?? {})) out[k as Attr] += v;
  return out;
}

/** Sum of a named effect from traits, skills and equipment. */
export function charEffect(c: Character, key: string): number {
  let v = 0;
  for (const t of c.traits) v += TRAIT_BY_ID[t]?.effect?.[key] ?? 0;
  for (const [sid, rank] of Object.entries(c.skills)) v += (SKILL_BY_ID[sid]?.perRank[key] ?? 0) * rank;
  for (const id of Object.values(c.equipment)) if (id) v += ITEM_BY_ID[id]?.effect?.[key] ?? 0;
  return v;
}

/** Disloyal servants do half-hearted work: 0.6 at zero loyalty, 1.0 at 60+. */
export function effectiveness(c: Character): number {
  return 0.6 + 0.4 * Math.min(1, Math.max(0, c.loyalty) / 60);
}

export function loyaltyTarget(state: GameState, c: Character): number {
  const e = state.empires[c.ownerId];
  let t = 55;
  for (const tr of c.traits) t += TRAIT_BY_ID[tr]?.loyalty ?? 0;
  t += charEffect(c, 'loyalty');
  if (ambitionMet(state, c)) t += 15;
  else if (c.ambition.unmetMonths > 12) t -= Math.min(20, (c.ambition.unmetMonths - 12));
  if (e && e.stock.credits <= 0) t -= c.traits.includes('greedy') ? 25 : 15;
  if (c.assignment) t += 5;
  if (c.houseId != null && e?.houses) {
    const h = e.houses.find((x) => x.id === c.houseId);
    if (h) t += (h.loyalty - 50) * 0.3;
  }
  return Math.max(0, Math.min(100, t));
}

export function ambitionMet(state: GameState, c: Character): boolean {
  const a = c.assignment;
  switch (c.ambition.kind) {
    case 'glory': return a?.kind === 'fleet' && c.record.battlesWon > 0;
    case 'power': return a?.kind === 'council';
    case 'wealth': return (state.empires[c.ownerId]?.stock.credits ?? 0) > 1500;
    case 'knowledge': return (a?.kind === 'council' && a.seat === 'archscholar') || (a?.kind === 'fleet' && c.role === 'explorer');
    case 'land': return a?.kind === 'province';
  }
}

export function salary(c: Character): number {
  return (0.6 + c.level * 0.25) * (c.traits.includes('greedy') ? 2 : 1);
}

export function xpForLevel(level: number): number { return 80 + level * 60; }
export const MAX_LEVEL = 20;

// ---------------------------------------------------------------- simulation hooks

export interface LeaderBonus { dmg: number; tracking: number; evasion: number; speed: number; supply: number; troops: number; sensor: number; discovery: number; retreat: boolean }
const NO_BONUS: LeaderBonus = { dmg: 0, tracking: 0, evasion: 0, speed: 0, supply: 0, troops: 0, sensor: 0, discovery: 0, retreat: false };

export function fleetLeader(state: GameState, f: Fleet): Character | null {
  const c = charById(state, f.admiralId);
  return c && c.status === 'active' && c.ownerId === f.ownerId ? c : null;
}

export function fleetLeaderBonus(state: GameState, f: Fleet): LeaderBonus {
  const c = fleetLeader(state, f);
  if (!c) return NO_BONUS;
  const a = effectiveAttrs(c);
  const k = effectiveness(c);
  const b = { ...NO_BONUS };
  if (c.role === 'admiral') {
    b.dmg = (a.command * 0.01 + c.level * 0.012 + charEffect(c, 'dmg')) * k;
    b.tracking = (a.cunning * 0.002 + charEffect(c, 'tracking')) * k;
    b.evasion = (charEffect(c, 'evasion')) * k;
  } else if (c.role === 'general') {
    b.troops = (a.martial * 0.02 + c.level * 0.02 + charEffect(c, 'troops')) * k;
    b.dmg = a.command * 0.004 * k;
  } else if (c.role === 'explorer') {
    b.sensor = Math.round(1 + charEffect(c, 'sensor'));
    b.discovery = (a.science * 0.02 + charEffect(c, 'discovery')) * k;
  }
  b.speed = charEffect(c, 'speed') * k;
  b.supply = charEffect(c, 'supply');
  b.retreat = charEffect(c, 'retreat') > 0;
  if (c.role !== 'admiral') { b.tracking += charEffect(c, 'tracking') * k; b.dmg += charEffect(c, 'dmg') * k; }
  return b;
}

/** Governor of the province (sector) a planet lies in. */
export function provinceGovernor(state: GameState, empireId: number, sectorId: number | undefined): Character | null {
  if (sectorId == null) return null;
  return state.characters.find((c) => c.status === 'active' && c.ownerId === empireId && c.assignment?.kind === 'province' && c.assignment.sectorId === sectorId) ?? null;
}

export function governorBonus(state: GameState, empireId: number, sectorId: number | undefined): { output: number; stability: number; admin: number; name: string | null } {
  const c = provinceGovernor(state, empireId, sectorId);
  if (!c) return { output: 0, stability: 0, admin: 0, name: null };
  const a = effectiveAttrs(c), k = effectiveness(c);
  return {
    output: (a.stewardship * 0.008 + charEffect(c, 'output')) * k,
    stability: (a.diplomacy * 0.4 + charEffect(c, 'stability')) * k,
    admin: Math.round(charEffect(c, 'admin')),
    name: c.name,
  };
}

export function planetIndustrialist(state: GameState, planetId: number): Character | null {
  return state.characters.find((c) => c.status === 'active' && c.role === 'industrialist' && c.assignment?.kind === 'planet' && c.assignment.planetId === planetId) ?? null;
}

export function industrialistBonus(state: GameState, planetId: number): { output: number; build: number } {
  const c = planetIndustrialist(state, planetId);
  const pl = state.planets[planetId];
  if (!c || (pl.colony?.ownerId !== c.ownerId && !(pl.station && state.galaxy.systems[pl.systemId].owner === c.ownerId))) return { output: 0, build: 0 };
  const a = effectiveAttrs(c), k = effectiveness(c);
  return { output: (a.stewardship * 0.01 + charEffect(c, 'output')) * k, build: (a.science * 0.01 + charEffect(c, 'build')) * k };
}

/** Empire modifiers from the royal council. */
export function councilMods(state: GameState, e: Empire): Record<string, number> {
  const out: Record<string, number> = {};
  if (!e.council) return out;
  for (const seat of COUNCIL_SEATS) {
    const c = charById(state, e.council[seat.id]);
    if (!c || c.status !== 'active' || c.ownerId !== e.id) continue;
    const a = effectiveAttrs(c), k = effectiveness(c);
    for (const p of seat.perAttr) out[p.key] = (out[p.key] ?? 0) + a[p.attr] * p.per * k;
    // role skills on the council
    const add = (key: string, v: number) => { if (v) out[key] = (out[key] ?? 0) + v * k; };
    add('tax', charEffect(c, 'tax'));
    add('output.research', charEffect(c, 'research'));
    add('admin', charEffect(c, 'admin'));
    add('intel', charEffect(c, 'intel'));
    add('stability', seat.id === 'spymaster' ? charEffect(c, 'stability') : 0);
  }
  return out;
}

/** Cheap signature of everything councilMods depends on (for the modifier cache). */
export function councilSig(state: GameState, e: Empire): string {
  if (!e.council) return '';
  let s = '';
  for (const seat of COUNCIL_SEATS) {
    const c = charById(state, e.council[seat.id]);
    if (c && c.status === 'active') s += `${seat.id}${c.id}:${c.level}:${Object.keys(c.skills).length}:${Object.values(c.skills).join('')}:${effectiveness(c).toFixed(5)}:${c.traits.join(",")}:${Object.values(c.equipment).join('')};`;
  }
  return s;
}

// ---------------------------------------------------------------- assignments

export function canAssign(state: GameState, c: Character, a: CharAssignment | null): string | null {
  if (c.status !== 'active') return 'Only active characters can be assigned';
  if (!a) return null;
  if (a.kind === 'fleet') {
    const f = state.fleets[a.fleetId];
    if (!f || f.ownerId !== c.ownerId) return 'Not your fleet';
    if (!['admiral', 'general', 'explorer'].includes(c.role)) return `${ROLES[c.role].plural} do not lead fleets`;
  } else if (a.kind === 'province') {
    if (c.role !== 'governor') return 'Only governors administer provinces';
    if (!state.galaxy.systems.some((s) => s.sector === a.sectorId && s.owner === c.ownerId)) return 'You hold no systems in that province';
  } else if (a.kind === 'planet') {
    if (c.role !== 'industrialist') return 'Only industrialists direct a world\'s industry';
    const pl = state.planets[a.planetId];
    if (pl?.colony?.ownerId !== c.ownerId && !(pl?.station && state.galaxy.systems[pl.systemId].owner === c.ownerId)) return 'Not your colony or operation';
  } else if (a.kind === 'envoy') {
    if (c.role !== 'diplomat') return 'Only diplomats serve as envoys';
    const t = state.empires[a.empireId];
    if (!t || !t.alive || t.id === c.ownerId || (t.kind !== 'major' && t.kind !== 'minor')) return 'No court to send an envoy to';
  } else if (a.kind === 'council') {
    const seat = SEAT_BY_ID[a.seat];
    if (!seat) return 'No such seat';
    if (!seat.roles.includes(c.role)) return `The ${seat.label} must be a ${seat.roles.map((r) => ROLES[r].label.toLowerCase()).join(' or ')}`;
  }
  return null;
}

/** Remove a character from their post (and the post from them). */
export function unassign(state: GameState, c: Character) {
  const a = c.assignment;
  if (!a) return;
  const e = state.empires[c.ownerId];
  if (a.kind === 'fleet') { const f = state.fleets[a.fleetId]; if (f && f.admiralId === c.id) f.admiralId = null; }
  if (a.kind === 'council' && e?.council && e.council[a.seat] === c.id) e.council[a.seat] = null;
  c.assignment = null;
}

export function assign(state: GameState, c: Character, a: CharAssignment | null) {
  unassign(state, c);
  if (!a) return;
  const e = state.empires[c.ownerId];
  if (a.kind === 'fleet') {
    const f = state.fleets[a.fleetId];
    const prev = charById(state, f.admiralId);
    if (prev) unassign(state, prev);
    f.admiralId = c.id;
  } else if (a.kind === 'council') {
    e.council ??= {};
    const prev = charById(state, e.council[a.seat]);
    if (prev) unassign(state, prev);
    e.council[a.seat] = c.id;
  } else if (a.kind === 'province' || a.kind === 'planet' || a.kind === 'envoy') {
    const prev = state.characters.find((x) => x !== c && x.status === 'active' && x.ownerId === c.ownerId && x.assignment && JSON.stringify(x.assignment) === JSON.stringify(a));
    if (prev) unassign(state, prev);
  }
  c.assignment = a;
}

export function describeAssignment(state: GameState, a: CharAssignment | null): string {
  if (!a) return 'Unassigned';
  switch (a.kind) {
    case 'fleet': return `Commands ${state.fleets[a.fleetId]?.name ?? 'a lost fleet'}`;
    case 'province': return `Governs ${state.galaxy.sectors?.[a.sectorId]?.name ?? 'a province'}`;
    case 'planet': return `Directs industry on ${state.planets[a.planetId]?.name ?? 'a world'}`;
    case 'envoy': return `Envoy to the ${state.empires[a.empireId]?.name ?? 'a lost court'}`;
    case 'council': return SEAT_BY_ID[a.seat]?.label ?? 'Royal council';
  }
}

// ---------------------------------------------------------------- experience & skills

export function grantXp(state: GameState, c: Character, amount: number) {
  if (c.status !== 'active' || c.level >= MAX_LEVEL) return;
  c.xp += amount * (1 + charEffect(c, 'xp') + (state.empires[c.ownerId]?.capital?.buildings.military_academy?.level ?? 0) * 0.05);
  while (c.xp >= xpForLevel(c.level) && c.level < MAX_LEVEL) {
    c.xp -= xpForLevel(c.level);
    c.level++;
    c.skillPoints++;
    const prim = ROLES[c.role].primary;
    c.attrs[prim[c.level % prim.length]]++;
    if (c.level % 5 === 0) {
      const options = TRAITS.filter((t) => t.good && !c.traits.includes(t.id) && t.id !== 'loyal' && !ADMIRAL_TRAITS.includes(t.id));
      if (options.length && c.traits.length < 4) {
        const t = pick(state.rng, options);
        c.traits.push(t.id);
        c.bio.push({ tick: state.tick, text: `Became known as ${t.label.toLowerCase()}.` });
      }
    }
    c.bio.push({ tick: state.tick, text: `Rose to level ${c.level}.` });
    if (c.ownerId === state.playerId) log(state, { kind: 'character', severity: 'good', title: `${c.name} reaches level ${c.level}`, text: `Your ${ROLES[c.role].label.toLowerCase()} has a new skill point to spend in the Hall of Heroes.`, empires: [c.ownerId] });
  }
}

export function canLearn(c: Character, skillId: string): string | null {
  const s = SKILL_BY_ID[skillId];
  if (!s) return 'Unknown skill';
  if (s.role !== c.role) return `Only ${ROLES[s.role].plural.toLowerCase()} learn this`;
  if (c.skillPoints <= 0) return 'No skill points';
  if ((c.skills[skillId] ?? 0) >= s.maxRank) return 'Already mastered';
  if (s.requires && !(c.skills[s.requires] > 0)) return `Requires ${SKILL_BY_ID[s.requires].label}`;
  const minLevel = s.tier === 1 ? 1 : s.tier === 2 ? 4 : 8;
  if (c.level < minLevel) return `Requires level ${minLevel}`;
  return null;
}

// ---------------------------------------------------------------- capture

/** A fleet's leader when the fleet is destroyed: captured, killed, or escapes. */
export function leaderOfLostFleet(state: GameState, f: Fleet, captorId: number | null) {
  const c = fleetLeader(state, f);
  if (!c) return;
  unassign(state, c);
  c.record.battlesLost++;
  const surv = charEffect(c, 'survive');
  const roll = next(state.rng);
  const captor = captorId != null ? state.empires[captorId] : null;
  const canCapture = captor && (captor.kind === 'major' || captor.kind === 'minor');
  if (canCapture && roll < 0.5) {
    c.status = 'captive';
    c.captorId = captorId;
    c.capturedTick = state.tick;
    c.assignment = null;
    if (!c.traits.includes('disgraced')) c.traits.push('disgraced');
    c.bio.push({ tick: state.tick, text: `Captured by the ${captor!.name} when ${f.name} was destroyed.` });
    log(state, { kind: 'capture', severity: c.ownerId === state.playerId ? 'danger' : captorId === state.playerId ? 'good' : 'info', title: `${c.name} taken prisoner`, text: `${ROLES[c.role].label} ${c.name} of the ${state.empires[c.ownerId].name} is now a prisoner of the ${captor!.name}.`, empires: [c.ownerId, captorId!] });
  } else if (roll < 0.8 - surv) {
    c.status = 'dead';
    c.bio.push({ tick: state.tick, text: `Fell with ${f.name}.` });
    log(state, { kind: 'admiral', severity: 'danger', title: `${c.name} has fallen`, text: `${ROLES[c.role].label} ${c.name} died when ${f.name} was destroyed.`, empires: [c.ownerId] });
  } else {
    c.bio.push({ tick: state.tick, text: `Escaped the destruction of ${f.name}.` });
  }
}

export function releaseCaptive(state: GameState, c: Character, reason: string) {
  c.status = state.empires[c.ownerId]?.alive ? 'active' : 'retired';
  c.captorId = null;
  c.assignment = null;
  c.bio.push({ tick: state.tick, text: reason });
}

/** Chance that a captive agrees to serve their captor. */
export function recruitChance(state: GameState, c: Character): number {
  const months = Math.max(0, (state.tick - (c.capturedTick ?? state.tick)) / 30);
  const homeAlive = state.empires[c.ownerId]?.alive;
  let p = 0.15 + Math.min(0.35, months * 0.03) + (homeAlive ? 0 : 0.35);
  if (c.traits.includes('loyal')) p -= 0.15;
  if (c.traits.includes('schemer') || c.traits.includes('ambitious')) p += 0.1;
  return Math.max(0.05, Math.min(0.9, p));
}

export function ransomPrice(c: Character): number {
  return Math.round(120 + c.level * 60);
}

// ---------------------------------------------------------------- equipment

export function equip(c: Character, e: Empire, itemId: string): string | null {
  const it = ITEM_BY_ID[itemId];
  if (!it) return 'Unknown item';
  e.armory ??= [];
  const idx = e.armory.indexOf(itemId);
  if (idx < 0) return 'Not in your armoury';
  e.armory.splice(idx, 1);
  const prev = c.equipment[it.slot];
  if (prev) e.armory.push(prev);
  c.equipment[it.slot] = itemId;
  return null;
}

export function unequip(c: Character, e: Empire, slot: EquipSlot) {
  const prev = c.equipment[slot];
  if (!prev) return;
  delete c.equipment[slot];
  (e.armory ??= []).push(prev);
}

// ---------------------------------------------------------------- monthly

export function charactersMonthly(state: GameState, addOpinion: (a: number, b: number, v: number, label: string) => void) {
  for (const c of state.characters) {
    if (c.status === 'active') {
      const e = state.empires[c.ownerId];
      if (!e?.alive) { c.status = 'retired'; c.assignment = null; continue; }
      // posts that vanished
      if (c.assignment?.kind === 'fleet' && !state.fleets[c.assignment.fleetId]) c.assignment = null;
      if (c.assignment?.kind === 'planet') { const pl = state.planets[c.assignment.planetId]; if (pl?.colony?.ownerId !== c.ownerId && !(pl?.station && state.galaxy.systems[pl.systemId].owner === c.ownerId)) c.assignment = null; }
      if (c.assignment?.kind === 'province' && !state.galaxy.systems.some((s) => s.sector === (c.assignment as { sectorId: number }).sectorId && s.owner === c.ownerId)) c.assignment = null;
      if (c.assignment?.kind === 'envoy' && !state.empires[c.assignment.empireId]?.alive) c.assignment = null;
      if (c.assignment) { c.record.monthsServed++; grantXp(state, c, 9); } else grantXp(state, c, 2);
      // envoys warm the host court
      if (c.assignment?.kind === 'envoy') {
        const a = effectiveAttrs(c);
        addOpinion(c.assignment.empireId, c.ownerId, (0.6 + a.diplomacy * 0.08 + charEffect(c, 'opinion')) * effectiveness(c) * (1 + (e.capital?.buildings.diplomatic_quarter?.level ?? 0) * 0.03), `Envoy ${c.name}`);
      }
      // ambition and loyalty
      c.ambition.unmetMonths = ambitionMet(state, c) ? 0 : c.ambition.unmetMonths + 1;
      const target = loyaltyTarget(state, c);
      c.loyalty += Math.sign(target - c.loyalty) * Math.min(2, Math.abs(target - c.loyalty));
      // old age
      const age = (state.tick - c.born) / 360;
      if (age > 70 && chance(state.rng, (age - 70) * 0.002)) {
        unassign(state, c);
        c.status = 'dead';
        c.bio.push({ tick: state.tick, text: `Died peacefully at the age of ${Math.floor(age)}.` });
        if (c.ownerId === state.playerId) log(state, { kind: 'character', severity: 'warn', title: `${c.name} has died`, text: `Your ${ROLES[c.role].label.toLowerCase()} died of old age.`, empires: [c.ownerId] });
        continue;
      }
      // disloyalty: desertion or defection
      if (c.loyalty < 15 && chance(state.rng, 0.06)) {
        const enemy = state.wars.flatMap((w) => (w.attackers.includes(c.ownerId) ? w.defenders : w.defenders.includes(c.ownerId) ? w.attackers : [])).map((id) => state.empires[id]).find((x) => x?.alive && x.kind === 'major');
        unassign(state, c);
        const from = state.empires[c.ownerId];
        if (enemy) {
          c.ownerId = enemy.id;
          c.loyalty = 40;
          c.bio.push({ tick: state.tick, text: `Defected from the ${from.name} to the ${enemy.name}.` });
          log(state, { kind: 'character', severity: from.id === state.playerId ? 'danger' : 'info', title: `${c.name} defects`, text: `${c.name} has abandoned the ${from.name} for the ${enemy.name}.`, empires: [from.id, enemy.id] });
        } else {
          c.status = 'retired';
          c.bio.push({ tick: state.tick, text: `Resigned from the service of the ${from.name} in disgust.` });
          log(state, { kind: 'character', severity: from.id === state.playerId ? 'warn' : 'info', title: `${c.name} resigns`, text: `${c.name} has left your service. Loyalty had fallen too far.`, empires: [from.id] });
        }
      }
    } else if (c.status === 'captive') {
      const holder = state.empires[c.captorId ?? -1];
      if (!holder?.alive) releaseCaptive(state, c, 'Freed when their captors fell.');
    }
  }
}

/** Yearly: refresh each realm's pool of candidates in the Hall of Heroes. */
export function refreshCandidates(state: GameState) {
  for (const e of state.empires) {
    if (!e.alive || (e.kind !== 'major' && e.kind !== 'minor')) continue;
    for (const c of state.characters) if (c.ownerId === e.id && c.status === 'candidate') c.status = 'retired';
    const n = e.kind === 'major' ? 4 : 1;
    const roles: CharRole[] = [];
    while (roles.length < n) {
      const r = pick(state.rng, ROLE_ORDER);
      if (!roles.includes(r)) roles.push(r);
    }
    const academy = Math.floor((e.capital?.buildings.military_academy?.level ?? 0) / 5);
    for (const r of roles) createCharacter(state, e.id, r, { status: 'candidate', level: int(state.rng, 1, 4) + academy });
  }
  // keep the list bounded: forget long-retired candidates without history
  if (state.characters.length > 600) state.characters = state.characters.filter((c) => !(c.status === 'retired' && c.record.monthsServed === 0));
}

export function recruitCost(c: Character): { credits: number; influence: number } {
  return { credits: 80 + c.level * 40, influence: 5 + c.level * 3 };
}
