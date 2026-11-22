// The Relic Vault: the player earns relics by playing (quests, ambitions, eras, won wars and
// battles) and spends them on draws. A draw reveals a resource cache, a veteran warship or hero,
// an elite flagship or hero, or a unique legendary one. Odds are published, every tenth draw is
// at least epic, and a legendary is guaranteed within 40 draws. No real money is involved.

import type { Empire, GameState, ShipClass, Cost } from './types';
import type { CharRole } from './data/characters';
import { SHIPS } from './data/ships';
import { createFleet, makeShip, shipStats } from './fleets';
import { createCharacter } from './characters';
import { log } from './util';
import { next, pick } from './rng';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export const RARITY_ODDS: Record<Rarity, number> = { common: 0.6, rare: 0.28, epic: 0.1, legendary: 0.02 };
export const RARITY_LABEL: Record<Rarity, string> = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
/** combat bonus (damage and hull) of a relic warship */
export const SHIP_BONUS: Record<Rarity, number> = { common: 0, rare: 0.15, epic: 0.3, legendary: 0.6 };
export const EPIC_PITY = 10;
export const LEGEND_PITY = 40;
export const START_RELICS = 3;

export interface RelicDraw { tick: number; rarity: Rarity; kind: 'cache' | 'ship' | 'hero'; title: string; text: string }

const SHIP_NAMES = ['Thistle', 'Highland Fury', 'Saltire', 'Morningstar', 'Iron Lament', 'Bannockburn', 'Silver Kestrel', 'Grey Corrie', 'Stormwake', 'Clachan', 'Wild Heather', 'Ember of Skye'];
const LEGEND_SHIPS = ['The Unbroken', 'Crown of Ash', 'Aurora Regalis', 'Last Light', 'Caledonia', 'Starwarden'];
const LEGEND_HEROES: { name: string; role: CharRole; trait: string; title: string }[] = [
  { name: 'Ailsa Dunmore', role: 'admiral', trait: 'tactician', title: 'the Storm of Kessan' },
  { name: 'Corvin Ash', role: 'general', trait: 'iron_willed', title: 'who never lost a landing' },
  { name: 'Mireille Vasquez', role: 'scientist', trait: 'brilliant', title: 'who mapped the precursor gates' },
  { name: 'Tobias Rennick', role: 'governor', trait: 'just', title: 'the Builder of Halden' },
  { name: 'Sabine Okafor', role: 'diplomat', trait: 'charismatic', title: 'who ended the Hundred-Day War' },
  { name: 'Ewan Blackwood', role: 'spymaster', trait: 'schemer', title: 'whom nobody ever saw' },
];
const HERO_ROLES: CharRole[] = ['admiral', 'general', 'governor', 'scientist', 'diplomat', 'industrialist'];

export function relicsOf(e: Empire): number { return e.relics ?? 0; }

/** Earn relics (the player only). */
export function grantRelics(state: GameState, e: Empire, n: number, why: string) {
  if (!e.isPlayer || n <= 0) return;
  e.relics = relicsOf(e) + n;
  log(state, { kind: 'relic', severity: 'good', title: `+${n} relic${n > 1 ? 's' : ''}`, text: `${why}. Spend them in the Relic Vault.`, empires: [e.id] });
}

function rollRarity(state: GameState, e: Empire): Rarity {
  const p = (e.relicPity ??= { sinceEpic: 0, sinceLegend: 0 });
  p.sinceEpic++; p.sinceLegend++;
  let r: Rarity;
  if (p.sinceLegend >= LEGEND_PITY) r = 'legendary';
  else {
    const x = next(state.rng);
    r = x < RARITY_ODDS.legendary ? 'legendary' : x < RARITY_ODDS.legendary + RARITY_ODDS.epic ? 'epic' : x < 1 - RARITY_ODDS.common ? 'rare' : 'common';
    if (p.sinceEpic >= EPIC_PITY && (r === 'common' || r === 'rare')) r = 'epic';
  }
  if (r === 'epic' || r === 'legendary') p.sinceEpic = 0;
  if (r === 'legendary') p.sinceLegend = 0;
  return r;
}

function bestWarship(e: Empire, big: boolean): ShipClass {
  const order: ShipClass[] = big ? ['battleship', 'cruiser', 'destroyer', 'frigate', 'corvette'] : ['destroyer', 'frigate', 'corvette'];
  return order.find((c) => !SHIPS[c].tech || e.research.done.includes(SHIPS[c].tech!)) ?? 'corvette';
}

function cache(state: GameState, e: Empire): RelicDraw {
  const options: [string, Cost][] = [['A forgotten alloy depot', { alloys: 150 }], ['A merchant prince\'s strongbox', { credits: 300 }], ['An abandoned mining claim', { minerals: 300 }], ['A sealed archive of favours', { influence: 40 }], ['A derelict freighter\'s cargo', { alloys: 80, electronics: 40 }]];
  const [title, c] = pick(state.rng, options);
  for (const [k, v] of Object.entries(c)) (e.stock as Record<string, number>)[k] += v ?? 0;
  return { tick: state.tick, rarity: 'common', kind: 'cache', title, text: Object.entries(c).map(([k, v]) => `+${v} ${k}`).join(', ') };
}

function ship(state: GameState, e: Empire, rarity: Rarity): RelicDraw {
  const used = new Set(Object.values(state.fleets).flatMap((f) => f.ships.map((s) => s.relic?.name)).concat(e.relicLegends ?? []));
  const cls = bestWarship(e, rarity !== 'rare');
  const pool = rarity === 'legendary' ? LEGEND_SHIPS.filter((n) => !used.has(n)) : SHIP_NAMES.filter((n) => !used.has(n));
  const name = pool.length ? pick(state.rng, pool) : `${SHIPS[cls].label} ${state.nextId}`;
  if (rarity === 'legendary') (e.relicLegends ??= []).push(name);
  const s = makeShip(state, e, cls);
  s.relic = { name, rarity, bonus: SHIP_BONUS[rarity] };
  const st = shipStats(state, e, cls);
  s.hull = Math.round(st.hull * (1 + s.relic.bonus));
  const home = e.capitalSystemId ?? Object.values(state.fleets).find((f) => f.ownerId === e.id)?.systemId ?? 0;
  const fleet = createFleet(state, e.id, home, [], `${name} Squadron`);
  fleet.ships.push(s);
  return { tick: state.tick, rarity, kind: 'ship', title: `${rarity === 'legendary' ? 'The legendary ' : ''}${SHIPS[cls].label} “${name}”`, text: `Joins your fleet at the capital, with ${Math.round(s.relic.bonus * 100)}% more firepower and hull than any ship of her class.` };
}

function hero(state: GameState, e: Empire, rarity: Rarity): RelicDraw {
  if (rarity === 'legendary') {
    const left = LEGEND_HEROES.filter((h) => !(e.relicLegends ?? []).includes(h.name));
    if (left.length) {
      const h = pick(state.rng, left);
      (e.relicLegends ??= []).push(h.name);
      const c = createCharacter(state, e.id, h.role, { level: 8, trait: h.trait, name: h.name, status: 'active' });
      c.rarity = 'legendary';
      return { tick: state.tick, rarity, kind: 'hero', title: `${h.name}, ${h.title}`, text: `A legendary ${h.role} (level 8) joins your court. Give them a post in the Hall of Heroes.` };
    }
  }
  const role = pick(state.rng, HERO_ROLES);
  const level = rarity === 'rare' ? 3 : 5;
  const c = createCharacter(state, e.id, role, { level, status: 'active' });
  c.rarity = rarity;
  return { tick: state.tick, rarity, kind: 'hero', title: `${c.name}, ${role}`, text: `A level ${level} ${role} joins your court. Give them a post in the Hall of Heroes.` };
}

/** Spend relics on draws. Returns what was drawn (empty when there are not enough relics). */
export function drawRelics(state: GameState, e: Empire, count: number): RelicDraw[] {
  if (relicsOf(e) < count || count <= 0) return [];
  e.relics = relicsOf(e) - count;
  const out: RelicDraw[] = [];
  for (let i = 0; i < count; i++) {
    const r = rollRarity(state, e);
    out.push(r === 'common' ? cache(state, e) : next(state.rng) < 0.5 ? ship(state, e, r) : hero(state, e, r));
  }
  e.relicLog = [...out, ...(e.relicLog ?? [])].slice(0, 40);
  const best = out.find((d) => d.rarity === 'legendary') ?? out.find((d) => d.rarity === 'epic');
  if (best) log(state, { kind: 'relic', severity: 'good', title: `${RARITY_LABEL[best.rarity]} relic: ${best.title}`, text: best.text, empires: [e.id] });
  return out;
}
