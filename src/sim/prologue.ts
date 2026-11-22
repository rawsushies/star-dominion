// The Prologue: a starter quest for a new player. A pretender to the player's crown holds one
// weak world a few jumps away. Five stages lead from putting the realm in order to taking that
// world, each with a clear objective and a reward. While the prologue runs (at most a few years),
// the great realms leave the player alone; when it ends, "the real game begins".
//
// Only reigns started with `settings.prologue` have one, so other games, saves and the campaign
// statistics are untouched.

import { grantRelics } from './relics';
import type { Empire, GameState, Cost } from './types';
import { jumpDistances } from './galaxy';
import { fleetPower, createFleet } from './fleets';
import { log } from './util';
import { pick } from './rng';

export interface PrologueStage {
  id: string;
  title: string;
  /** what to do, in plain words */
  goal: string;
  reward: Cost;
  rewardText: string;
}

export const PROLOGUE_STAGES: PrologueStage[] = [
  { id: 'steady', title: 'Put the realm in order', goal: 'Start a research project and order a new district on your home planet.', reward: { minerals: 100, alloys: 100 }, rewardText: '100 minerals, 100 alloys (metal for ships)' },
  { id: 'borders', title: 'Mark your borders', goal: 'Own 3 star systems (claim free ones with your construction ship).', reward: { influence: 60, alloys: 120 }, rewardText: '60 influence, 120 alloys' },
  { id: 'find', title: 'Find the Pretender', goal: 'Send your scout to find the Pretender\'s world.', reward: { alloys: 120, food: 60, credits: 100 }, rewardText: '120 alloys, 60 food, 100 credits' },
  { id: 'fleet', title: 'Raise a fleet', goal: 'Build warships and troop transports: enough strength to beat the Pretender\'s guard, and enough soldiers to land.', reward: { credits: 150, influence: 40 }, rewardText: '150 credits, 40 influence (enough to declare war)' },
  { id: 'crown', title: 'Take back the crown world', goal: 'Declare war on the Pretender and capture his world.', reward: { credits: 500, alloys: 200, influence: 100 }, rewardText: '500 credits, 200 alloys, 100 influence' },
];

/** The great realms ignore the player for at most this long, even if the prologue is unfinished. */
export const PROLOGUE_MAX_YEARS = 6;

export function pretenderOf(state: GameState): Empire | null {
  const id = state.prologue?.pretenderId;
  return id != null ? state.empires[id] ?? null : null;
}

/** Is the prologue still running (and so the player still protected)? */
export function prologueActive(state: GameState): boolean {
  const p = state.prologue;
  return !!p && !p.done && state.tick < 360 * PROLOGUE_MAX_YEARS;
}

export function currentStage(state: GameState): PrologueStage | null {
  const p = state.prologue;
  return p && !p.done ? PROLOGUE_STAGES[p.stage] ?? null : null;
}

/** Fleet strength the player should bring against the Pretender's world. */
export function pretenderStrength(state: GameState): number {
  const pr = pretenderOf(state);
  if (!pr?.alive || pr.capitalSystemId == null) return 0;
  const sys = state.galaxy.systems[pr.capitalSystemId];
  let v = 0;
  for (const f of Object.values(state.fleets)) if (f.ownerId === pr.id) v += fleetPower(state, f);
  if (sys.owner === pr.id) v += [0, 30, 110, 320][sys.starbase] * (1 - sys.starbaseDamage);
  return v;
}

/** Called from newGame: seat the Pretender on a weak world two or three jumps from the player. */
export function setupPrologue(state: GameState, makeRealm: (sysId: number) => Empire) {
  const me = state.empires[state.playerId];
  if (me.capitalSystemId == null) return;
  const d = jumpDistances(state.galaxy, [me.capitalSystemId]);
  const others = state.empires.filter((e) => e.id !== me.id && e.capitalSystemId != null).map((e) => e.capitalSystemId!);
  const od = others.length ? jumpDistances(state.galaxy, others) : null;
  const sites = state.galaxy.systems.filter((s) => (d[s.id] === 2 || d[s.id] === 3) && s.owner == null && !s.features.includes('guardian') && s.star !== 'black_hole' && s.planetIds.length >= 2 && (!od || od[s.id] >= 2));
  const site = sites.length ? pick(state.rng, sites) : state.galaxy.systems.find((s) => d[s.id] >= 2 && s.owner == null && s.planetIds.length >= 1);
  if (!site) return;
  const pr = makeRealm(site.id);
  pr.role = 'pretender';
  pr.personality = { aggression: 0, expansion: 0, mercantile: 0.2, science: 0.1, diplomacy: 0, doctrine: 'balanced' };
  // weak by design: a small world, a light guard, no defence platforms
  const home = state.planets[pr.capitalPlanetId!];
  const c = home.colony!;
  // about 5 defenders: one troop transport (8 soldiers) wins with room to spare
  c.pops = 10;
  delete c.buildings.orbital_defense;
  delete c.buildings.garrison;
  delete c.buildings.capital;
  c.buildings.residential = 1;
  site.starbase = 1;
  for (const f of Object.values(state.fleets)) if (f.ownerId === pr.id) delete state.fleets[f.id];
  createFleet(state, pr.id, site.id, ['corvette'], 'Pretender\'s Guard').stance = 'defensive';
  state.prologue = { pretenderId: pr.id, crownPlanetId: pr.capitalPlanetId ?? undefined, stage: 0, done: false, startBuildings: buildingsOf(state, me) };
}

function buildingsOf(state: GameState, e: Empire): number {
  let n = 0;
  for (const p of state.planets) if (p.colony?.ownerId === e.id) n += Object.values(p.colony.buildings).reduce((a, b) => a + (b ?? 0), 0) + p.colony.queue.length;
  return n;
}

function stageMet(state: GameState, id: string): boolean {
  const me = state.empires[state.playerId];
  const pr = pretenderOf(state);
  switch (id) {
    case 'steady': return (!!me.research.current || me.research.done.length > 0 || me.research.queue.length > 0) && buildingsOf(state, me) > (state.prologue!.startBuildings ?? 0);
    case 'borders': return me.stats.systems >= 3;
    case 'find': return !pr?.alive || (pr.capitalSystemId != null && me.explored.includes(pr.capitalSystemId));
    case 'fleet': {
      if (!pr?.alive) return true;
      const troops = Object.values(state.fleets).reduce((a, f) => a + (f.ownerId === me.id ? f.troops : 0), 0);
      const mine = Object.values(state.fleets).reduce((a, f) => a + (f.ownerId === me.id ? fleetPower(state, f) : 0), 0);
      return mine >= Math.max(40, pretenderStrength(state) * 1.6) && troops >= 8;
    }
    case 'crown': return !pr?.alive || state.planets[pr.capitalPlanetId ?? -1]?.colony?.ownerId === me.id;
  }
  return false;
}

function grant(e: Empire, c: Cost) {
  for (const [k, v] of Object.entries(c)) (e.stock as Record<string, number>)[k] = ((e.stock as Record<string, number>)[k] ?? 0) + (v ?? 0);
}

/** Daily check (cheap): advance through every stage that is met, paying each reward once. */
export function prologueTick(state: GameState) {
  const p = state.prologue;
  if (!p || p.done) return;
  const me = state.empires[state.playerId];
  // the Pretender's world stays small, so the soldiers the player was told to bring stay enough
  const pr = pretenderOf(state);
  const crown = pr?.alive && pr.capitalPlanetId != null ? state.planets[pr.capitalPlanetId].colony : null;
  if (crown && crown.ownerId === pr!.id && crown.pops > 10) crown.pops = 10;
  for (let guard = 0; guard < PROLOGUE_STAGES.length && !p.done; guard++) {
    const st = PROLOGUE_STAGES[p.stage];
    // taking the crown world early settles every stage before it
    if (!stageMet(state, st.id) && !stageMet(state, 'crown')) break;
    grant(me, st.reward);
    grantRelics(state, me, 1, `Quest done: ${st.title}`);
    p.stage++;
    log(state, { kind: 'quest', severity: 'good', title: `Quest: ${st.title}`, text: `Done. Reward: ${st.rewardText}.`, empires: [me.id] });
    if (p.stage >= PROLOGUE_STAGES.length) {
      // the crown world welcomes its rightful ruler: no occupation resistance, no separatists
      const crownWorld = p.crownPlanetId != null ? state.planets[p.crownPlanetId]?.colony : null;
      if (crownWorld && crownWorld.ownerId === me.id) { crownWorld.resistance = 0; crownWorld.originalOwnerId = null; crownWorld.stability = Math.max(crownWorld.stability, 65); }
      p.done = true;
      p.doneTick = state.tick;
      grantRelics(state, me, 2, 'The Prologue is complete');
      log(state, { kind: 'quest', severity: 'good', title: 'The Prologue is over', text: 'The Pretender is broken and the great realms have taken notice of you. From here on, they may come for you too.', empires: [me.id] });
    }
  }
}

/** The Pretender keeps to itself: it never expands and never starts a war. */
export function isPretender(e: Empire): boolean {
  return e.role === 'pretender';
}

/** Other realms leave the Pretender to the player while the prologue runs. */
export function protectedPrey(state: GameState, targetId: number): boolean {
  return prologueActive(state) && state.prologue!.pretenderId === targetId;
}

