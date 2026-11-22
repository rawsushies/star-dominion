// Serialisation. GameState is plain JSON, so saving is JSON.stringify; loading
// validates the version and structure, then restores derived caches lazily.

import { SAVE_VERSION, updateStats } from './engine';
import { ensureOps } from './operations';
import { ensureCapital } from './capital';
import { ensureHouses } from './governance';
import { ensureRuler } from './succession';
import type { GameState } from './types';
import { upgradeGalaxy } from './galaxy';
import { migrateAdmirals } from './characters';

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export function deserialize(json: string): GameState {
  let s: GameState;
  try { s = JSON.parse(json) as GameState; } catch { throw new Error('Not a Star Dominion save (the file is not valid JSON)'); }
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('Not a Star Dominion save');
  if (s.version !== SAVE_VERSION) throw new Error(`Unsupported save version ${s.version} (expected ${SAVE_VERSION})`);
  for (const k of ['galaxy', 'planets', 'empires', 'fleets', 'rng'] as const) {
    if (!(k in s)) throw new Error(`Corrupt save: missing ${k}`);
  }
  validateStructure(s);
  // forward-compatible defaults for fields added after a save was written
  for (const e of s.empires) if (e.era == null) e.era = 0;
  upgradeGalaxy(s.galaxy);
  ensureOps(s);
  s.chronicle ??= [];
  migrateAdmirals(s as GameState & { admirals?: never[] });
  for (const e of s.empires) { e.council ??= {}; e.armory ??= []; ensureHouses(s, e); ensureCapital(e); ensureRuler(s, e); }
  if (s.empires.some((e) => e.alive && e.kind === 'major' && e.stats?.powerW == null)) updateStats(s);
  // the old ten-step advisor becomes the first guided lesson
  if (s.tutorial) {
    s.guidance ??= { active: 'welcome', step: 0, paused: false, done: [], skipped: [], offered: [], seen: [], snoozed: {}, base: {} };
  }
  if ('tutorial' in s) delete s.tutorial;
  return s;
}

/**
 * Reject saves whose structure the game cannot run: wrong types, references to things that do not
 * exist, and numbers that are not numbers (JSON writes NaN and Infinity as null). It never edits
 * the save, and it deliberately does not police ranges (a stability of -0.6 is odd but harmless);
 * a legitimate save from any earlier version passes, because the fields checked here have existed
 * since the first release (fields added later are checked only when present).
 */
function validateStructure(s: GameState) {
  const bad = (what: string): never => { throw new Error(`Corrupt save: ${what}`); };
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const int = (v: unknown) => Number.isInteger(v);
  const obj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!num(s.tick) || s.tick < 0) bad('the date is not a number');
  if (!num(s.nextId)) bad('the id counter is not a number');
  if (!obj(s.rng) || !num((s.rng as { s?: unknown }).s)) bad('the random state is missing');
  if (!obj(s.galaxy) || !Array.isArray(s.galaxy.systems) || !Array.isArray(s.galaxy.lanes)) bad('the galaxy is malformed');
  if (!Array.isArray(s.planets)) bad('the planet list is malformed');
  if (!Array.isArray(s.empires) || s.empires.length === 0) bad('there are no realms');
  if (!obj(s.fleets)) bad('the fleet list is malformed');
  const nSys = s.galaxy.systems.length, nPl = s.planets.length, nEmp = s.empires.length;
  const sysOk = (id: unknown) => int(id) && (id as number) >= 0 && (id as number) < nSys;
  const plOk = (id: unknown) => int(id) && (id as number) >= 0 && (id as number) < nPl;
  const empOk = (id: unknown) => int(id) && (id as number) >= 0 && (id as number) < nEmp;
  if (!empOk(s.playerId)) bad('the player realm does not exist');
  for (const [i, sys] of s.galaxy.systems.entries()) {
    if (!obj(sys) || sys.id !== i) bad(`system ${i} is malformed`);
    if (!num(sys.x) || !num(sys.y)) bad(`system ${i} has no position`);
    if (!Array.isArray(sys.planetIds) || !sys.planetIds.every(plOk)) bad(`system ${i} lists a planet that does not exist`);
    if (sys.owner != null && !empOk(sys.owner)) bad(`system ${i} belongs to a realm that does not exist`);
    if (!num(sys.starbaseDamage)) bad(`system ${i} has no starbase condition`);
    if (!Array.isArray(sys.megastructures)) bad(`system ${i} has no megastructure list`);
  }
  for (const l of s.galaxy.lanes) if (!Array.isArray(l) || l.length !== 2 || !sysOk(l[0]) || !sysOk(l[1])) bad('a hyperlane joins a system that does not exist');
  for (const [i, p] of s.planets.entries()) {
    if (!obj(p) || p.id !== i) bad(`planet ${i} is malformed`);
    if (!sysOk(p.systemId)) bad(`planet ${i} is in a system that does not exist`);
    const c = p.colony;
    if (c != null) {
      if (!obj(c) || !empOk(c.ownerId)) bad(`the colony on planet ${i} belongs to a realm that does not exist`);
      if (!num(c.pops) || !num(c.stability)) bad(`the colony on planet ${i} has no population or stability`);
      if (!obj(c.buildings) || !Array.isArray(c.queue) || !Array.isArray(c.shipQueue)) bad(`the colony on planet ${i} is malformed`);
    }
  }
  for (const [i, e] of s.empires.entries()) {
    if (!obj(e) || e.id !== i) bad(`realm ${i} is malformed`);
    if (!obj(e.stock)) bad(`realm ${i} has no stockpile`);
    for (const [k, v] of Object.entries(e.stock)) if (!num(v)) bad(`realm ${i} has an unreadable ${k} stockpile`);
    if (e.capitalPlanetId != null && !plOk(e.capitalPlanetId)) bad(`realm ${i}'s capital does not exist`);
    if (e.capitalSystemId != null && !sysOk(e.capitalSystemId)) bad(`realm ${i}'s capital system does not exist`);
    if (!obj(e.research) || !Array.isArray(e.research.done)) bad(`realm ${i} has no research record`);
    if (!Array.isArray(e.explored)) bad(`realm ${i} has no map of explored space`);
  }
  for (const [k, f] of Object.entries(s.fleets)) {
    if (!obj(f)) bad(`fleet ${k} is malformed`);
    if (!empOk(f.ownerId)) bad(`fleet ${k} belongs to a realm that does not exist`);
    if (!sysOk(f.systemId)) bad(`fleet ${k} is in a system that does not exist`);
    if (!Array.isArray(f.ships) || !Array.isArray(f.path) || !f.path.every(sysOk)) bad(`fleet ${k} is malformed`);
    for (const sh of f.ships) if (!obj(sh) || !num(sh.hull)) bad(`a ship in fleet ${k} is malformed`);
  }
  if (s.market != null) {
    if (!obj(s.market) || !obj(s.market.price)) bad('the market is malformed');
    for (const [k, v] of Object.entries(s.market.price)) if (!num(v)) bad(`the market price of ${k} is unreadable`);
  }
  for (const k of ['treaties', 'wars', 'truces', 'tributes', 'tradeDeals', 'proposals', 'events', 'battles'] as const) {
    if (s[k] != null && !Array.isArray(s[k])) bad(`the ${k} list is malformed`);
  }
}

/** Cheap deterministic fingerprint of the whole state (used by tests and save metadata). */
export function fingerprint(state: GameState): string {
  const str = serialize(state);
  let h1 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h1 ^= str.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + ':' + str.length;
}
