import { describe, expect, it } from 'vitest';
import { newGame, runDays } from '../src/sim/engine';
import { execute } from '../src/sim/commands';
import { serialize, deserialize } from '../src/sim/save';
import { BUILDINGS } from '../src/sim/data/buildings';
import { SHIP_ORDER, SHIPS } from '../src/sim/data/ships';
import { TECHS } from '../src/sim/data/techs';
import { MEGASTRUCTURES } from '../src/sim/data/megastructures';
import { CAPITAL_BUILDINGS } from '../src/sim/data/capital';
import { ERAS } from '../src/sim/data/eras';
import { availableTechs } from '../src/sim/research';
import type { GameState } from '../src/sim/types';
import type { UIState } from '../src/ui/store';
import { CHAPTERS, CHAPTER_BY_ID } from '../src/guidance/chapters';
import { activeStep, chapterStatus, declineOffer, evaluateLesson, finishLesson, nextStep, prevStep, recommendation, recordFlag, resetGuidance, setPaused, skipLesson, startLesson } from '../src/guidance/lessons';
import { guidanceOf } from '../src/guidance/state';
import { currentHints, snoozeHint } from '../src/guidance/hints';
import { SCREEN_INFO } from '../src/guidance/screens';
import { codexEntries, codexEntry, searchCodex, CODEX_CATS } from '../src/guidance/codex';

const SCREENS = ['kingdom', 'planets', 'system', 'fleets', 'military', 'economy', 'industry', 'research', 'techtree', 'diplomacy', 'intel', 'construction', 'trade', 'journal', 'heroes', 'council', 'capital', 'operations', 'throne', 'warroom', 'chronicle', 'codex', 'conclave', 'cosmos'];
const ui = (p: Partial<UIState> = {}) => ({ speed: 0, windows: [], view: 'galaxy', screen: 'map', systemId: null, planetId: null, fleetId: null, rev: 0, ...p }) as unknown as UIState;
const fresh = () => newGame({ seed: 7, galaxySize: 'small', aiCount: 2 });

describe('lessons', () => {
  it('has twelve chapters, beginner path first, whose references resolve', () => {
    expect(CHAPTERS.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(CHAPTERS.slice(0, 3).map((c) => c.id)).toEqual(['welcome', 'grow', 'conquest']);
    for (const c of CHAPTERS) {
      expect(c.steps.length).toBeGreaterThanOrEqual(4);
      for (const id of c.codex) expect(codexEntry(id), `${c.id} → ${id}`).not.toBeNull();
      for (const s of c.steps) if (s.open) expect(SCREENS).toContain(s.open);
    }
  });

  it('every step renders its text against a live game', () => {
    const g = fresh();
    for (const c of CHAPTERS) {
      startLesson(g, c.id);
      for (let i = 0; i < c.steps.length; i++) {
        const st = activeStep(g)!;
        const text = typeof st.text === 'function' ? st.text({ g, ui: ui(), base: {}, now: {}, has: () => false }) : st.text;
        expect(text.length, `${c.id}:${i}`).toBeGreaterThan(40);
        expect(text).not.toMatch(/undefined|NaN/);
        nextStep(g);
      }
      expect(guidanceOf(g).done).toContain(c.id);
    }
  });

  it('objectives complete from real actions, not from reading', () => {
    const g = fresh();
    startLesson(g, 'research');
    expect(evaluateLesson(g, ui())).toBe(false); // nothing done yet
    const tech = availableTechs(g.empires[g.playerId])[0];
    expect(execute(g, g.playerId, { type: 'setResearch', tech }).ok).toBe(true);
    expect(evaluateLesson(g, ui())).toBe(true);
    expect(guidanceOf(g).step).toBe(1);
    // the second step wants a queued technology or the tech tree
    expect(evaluateLesson(g, ui())).toBe(false);
    expect(evaluateLesson(g, ui({ windows: [{ id: 'techtree' }] as unknown as UIState['windows'] }))).toBe(true);
  });

  it('records flags and uses counters captured at the start of a step', () => {
    const g = fresh();
    startLesson(g, 'welcome', 1);
    expect(evaluateLesson(g, ui({ speed: 0 }))).toBe(false);
    recordFlag(g, 'ran');
    expect(evaluateLesson(g, ui({ speed: 2 }))).toBe(false); // still running
    expect(evaluateLesson(g, ui({ speed: 0 }))).toBe(true);
    // galaxy: exploring a system compares against the count when the step began
    startLesson(g, 'galaxy', 4);
    expect(evaluateLesson(g, ui())).toBe(false);
    const e = g.empires[g.playerId];
    const unexplored = g.galaxy.systems.find((s) => !e.explored.includes(s.id))!;
    e.explored.push(unexplored.id);
    expect(evaluateLesson(g, ui())).toBe(true);
  });

  it('can be paused, skipped, replayed and reset', () => {
    const g = fresh();
    startLesson(g, 'capital');
    setPaused(g, true);
    expect(evaluateLesson(g, ui({ windows: [{ id: 'capital' }] as unknown as UIState['windows'] }))).toBe(false); // paused lessons do not advance
    setPaused(g, false);
    nextStep(g); prevStep(g);
    expect(guidanceOf(g).step).toBe(0);
    const cap = CHAPTER_BY_ID.capital;
    skipLesson(g);
    expect(chapterStatus(g, cap)).toBe('skipped');
    startLesson(g, 'capital');
    finishLesson(g);
    expect(chapterStatus(g, cap)).toBe('done');
    startLesson(g, 'capital'); // replay
    expect(chapterStatus(g, cap)).toBe('active');
    resetGuidance(g);
    expect(guidanceOf(g)).toMatchObject({ active: null, done: [], skipped: [] });
  });

  it('unlocks progressively and offers each lesson once', () => {
    const g = fresh();
    expect(recommendation(g)?.id).toBe('welcome');
    expect(chapterStatus(g, CHAPTERS[1])).toBe('locked');
    startLesson(g, 'welcome'); finishLesson(g);
    expect(chapterStatus(g, CHAPTERS[1])).toBe('available');
    expect(recommendation(g)?.id).toBe('grow');
    declineOffer(g, 'grow');
    expect(recommendation(g)?.id).not.toBe('grow');
    // later lessons wait until the game makes them matter, not just until the previous one is done
    startLesson(g, 'grow'); finishLesson(g);
    expect(chapterStatus(g, CHAPTER_BY_ID.characters)).toBe('locked');
    g.tick = 360 * 2;
    expect(chapterStatus(g, CHAPTER_BY_ID.characters)).toBe('available');
  });

  it('persists through save and load, and migrates the old advisor', () => {
    const g = fresh();
    startLesson(g, 'economy', 2);
    recordFlag(g, 'intro:economy');
    const back = deserialize(serialize(g));
    expect(back.guidance).toMatchObject({ active: 'economy', step: 2 });
    expect(back.guidance!.seen).toContain('intro:economy');
    const legacy = JSON.parse(serialize(fresh())) as GameState;
    legacy.tutorial = { step: 3, base: { explored: 1, buildings: 0, ships: 3 } };
    const migrated = deserialize(JSON.stringify(legacy));
    expect(migrated.tutorial).toBeUndefined();
    expect(migrated.guidance?.active).toBe('welcome');
    // a save without guidance loads unchanged and gains it on first use
    const plain = deserialize(serialize(fresh()));
    expect(plain.guidance).toBeUndefined();
    expect(guidanceOf(plain).done).toEqual([]);
  });
});

describe('screen information', () => {
  it('covers every management window and links to real Codex entries and lessons', () => {
    for (const id of SCREENS) {
      const info = SCREEN_INFO[id as keyof typeof SCREEN_INFO];
      expect(info, id).toBeTruthy();
      expect(info!.controls.length).toBeGreaterThan(0);
      for (const c of info!.codex) expect(codexEntry(c), `${id} → ${c}`).not.toBeNull();
      if (info!.lesson) expect(CHAPTERS.some((c) => c.id === info!.lesson)).toBe(true);
    }
  });
});

describe('smart hints', () => {
  it('reports idle research only while it is true', () => {
    const g = fresh();
    expect(currentHints(g).some((h) => h.id === 'research-idle')).toBe(true);
    execute(g, g.playerId, { type: 'setResearch', tech: availableTechs(g.empires[g.playerId])[0] });
    expect(currentHints(g).some((h) => h.id === 'research-idle')).toBe(false);
  });

  it('reports a real shortage with its numbers, and can be snoozed', () => {
    const g = fresh();
    const e = g.empires[g.playerId];
    // make food run out: no stock, and a population that eats more than it grows
    e.stock.food = 0;
    for (const p of g.planets) if (p.colony?.ownerId === g.playerId) { p.colony.pops += 60; p.colony.buildings.agri = 0; }
    runDays(g, 1); // the engine refreshes the ledger each day
    e.stock.food = 0;
    const h = currentHints(g).find((x) => x.id === 'short-food');
    expect(h?.severity).toBe('danger');
    expect(h?.text).toMatch(/starving/);
    snoozeHint(g, 'short-food');
    expect(currentHints(g).some((x) => x.id === 'short-food')).toBe(false);
  });

  it('never reports an idle construction ship that has nowhere to go', () => {
    const g = fresh();
    const e = g.empires[g.playerId];
    e.stock.influence = 0; // cannot afford any claim
    expect(currentHints(g).some((h) => h.id.startsWith('ctor-'))).toBe(false);
  });

  it('stays quiet and fast over a long game', () => {
    const g = fresh();
    runDays(g, 720);
    const t0 = performance.now();
    const hints = currentHints(g);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(new Set(hints.map((h) => h.id)).size).toBe(hints.length);
  });
});

describe('Codex', () => {
  const all = codexEntries();
  it('has every category and unique ids, and every link resolves', () => {
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    for (const c of CODEX_CATS) expect(all.some((e) => e.cat === c.id), c.id).toBe(true);
    for (const e of all) for (const r of e.related) expect(codexEntry(r), `${e.id} → ${r}`).not.toBeNull();
    for (const e of all) if (e.screen) expect(SCREENS).toContain(e.screen);
  });

  it('has an entry for every building, ship, technology, era, megastructure and capital building', () => {
    for (const b of Object.keys(BUILDINGS)) expect(codexEntry(`bld.${b}`)).not.toBeNull();
    for (const s of SHIP_ORDER) expect(codexEntry(`ship.${s}`)).not.toBeNull();
    for (const t of TECHS) expect(codexEntry(`tech.${t.id}`)).not.toBeNull();
    for (const e of ERAS) expect(codexEntry(`era.${e.id}`)).not.toBeNull();
    for (const m of MEGASTRUCTURES) expect(codexEntry(`mega.${m.id}`)).not.toBeNull();
    for (const c of CAPITAL_BUILDINGS) expect(codexEntry(`cap.${c.id}`)).not.toBeNull();
  });

  it('quotes the game data exactly', () => {
    const res = codexEntry('bld.residential')!;
    expect(res.facts).toContainEqual(['Cost', '80 minerals, 30 credits']);
    expect(res.facts).toContainEqual(['Build time', '90 days (about 3 months)']);
    const corvette = codexEntry('ship.corvette')!;
    expect(corvette.facts).toContainEqual(['Hull / armour / shields', `${SHIPS.corvette.hull} / ${SHIPS.corvette.armor} / ${SHIPS.corvette.shields}`]);
    const last = codexEntry(`era.${ERAS.length - 1}`)!;
    expect(last.status).toBe('speculative');
    for (const e of all) for (const [, v] of e.facts ?? []) expect(v).not.toMatch(/undefined|NaN/);
  });

  it('searches by every word, titles first', () => {
    expect(searchCodex('invasion')[0].id).toBe('mech.invasion');
    expect(searchCodex('kardashev')[0].id).toBe('mech.kardashev');
    expect(searchCodex('ground invasion garrison').map((e) => e.id)).toContain('mech.invasion');
    expect(searchCodex('zzzz-no-such-thing')).toEqual([]);
    expect(searchCodex('', 'espionage').every((e) => e.cat === 'espionage')).toBe(true);
  });
});
