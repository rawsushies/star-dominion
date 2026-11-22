import { describe, expect, it } from 'vitest';
import { newGame, runDays } from '../src/sim/engine';
import { execute, type Command } from '../src/sim/commands';
import { declareWar } from '../src/sim/diplomacy';
import type { GameState } from '../src/sim/types';
import type { UIState } from '../src/ui/store';
import { CHAPTER_BY_ID } from '../src/guidance/chapters';
import { activeStep, evaluateLesson, startLesson, lessonCtx } from '../src/guidance/lessons';
import { guidanceOf } from '../src/guidance/state';
import { SIMPLE_START, setSimple, visibleScreens, hiddenCount } from '../src/guidance/path';
import { currentMoment, dismissMoment } from '../src/guidance/moments';
import { captured, conquestFocus, pickTarget } from '../src/guidance/conquest';

const ui = { speed: 0, windows: [], view: 'galaxy', screen: 'map', systemId: null, planetId: null, fleetId: null, rev: 0 } as unknown as UIState;
const fresh = (seed = 21) => newGame({ seed, galaxySize: 'small', aiCount: 2 });
const run = (g: GameState, cmds: Command[]) => cmds.map((c) => execute(g, g.playerId, c));

describe('beginner mode', () => {
  it('starts with a handful of screens and adds the rest when they matter', () => {
    const g = fresh();
    expect(visibleScreens(g)).toBeNull(); // off unless the guided reign turns it on
    setSimple(g, true);
    expect([...visibleScreens(g)!].sort()).toEqual([...SIMPLE_START].sort());
    expect(hiddenCount(g)).toBeGreaterThan(12);
    // meeting another realm brings Diplomacy, and a card says what it is for
    const other = g.empires.find((e) => e.kind === 'major' && !e.isPlayer)!;
    const me = g.empires[g.playerId];
    me.explored.push(...g.galaxy.systems.filter((s) => s.owner === other.id).map((s) => s.id));
    expect(visibleScreens(g)!.has('diplomacy')).toBe(true);
    let m = currentMoment(g);
    expect(m?.id).toBe('first-contact');
    dismissMoment(g, m!);
    m = currentMoment(g);
    expect(m?.id).toBe('unlock-diplomacy');
    dismissMoment(g, m!);
    expect(guidanceOf(g).seen).toContain('unl:diplomacy');
  });

  it('a war declared on the player explains itself first, pauses, and is shown once', () => {
    const g = fresh();
    const foe = g.empires.find((e) => e.kind === 'major' && !e.isPlayer)!;
    foe.stock.influence = 100;
    declareWar(g, foe.id, g.playerId);
    const m = currentMoment(g)!;
    expect(m).toMatchObject({ id: 'war-on-you', pause: true, danger: true });
    expect(m.text).not.toMatch(/undefined|NaN/);
    dismissMoment(g, m);
    expect(currentMoment(g)?.id).not.toBe('war-on-you');
  });
});

describe('Your First War', () => {
  it('"Do it for me" carries a real conquest through, step by step, with no cheating by the lesson', () => {
    const g = fresh(31);
    const me = g.empires[g.playerId];
    // a realm the player knows about, and the means to fight (the lesson itself grants nothing)
    me.explored = g.galaxy.systems.map((s) => s.id);
    Object.assign(me.stock, { credits: 20000, alloys: 20000, minerals: 20000, food: 20000, energy: 20000, electronics: 5000, influence: 400 });
    const target = pickTarget(g);
    expect(target).not.toBeNull();
    guidanceOf(g).done.push('welcome', 'grow');
    expect(CHAPTER_BY_ID.conquest.unlock(g, guidanceOf(g).done)).toBe(true);
    startLesson(g, 'conquest');
    const seen: string[] = [];
    for (let day = 0; day < 360 * 6 && guidanceOf(g).active === 'conquest'; day++) {
      const step = activeStep(g)!;
      if (!seen.includes(step.title)) {
        seen.push(step.title);
        const text = typeof step.text === 'function' ? step.text(lessonCtx(g, ui)) : step.text;
        expect(text).not.toMatch(/undefined|NaN/);
        if (step.auto) {
          const cmds = step.auto(g);
          const res = run(g, step.autoFirst ? cmds.slice(0, 1) : cmds);
          if (step.autoFirst) for (let i = 1; i < cmds.length && !res.some((r) => r.ok); i++) res.push(execute(g, g.playerId, cmds[i]));
        }
      }
      if (!step.done) { guidanceOf(g).step++; continue; }
      if (evaluateLesson(g, ui)) continue;
      // repeat the step's orders now and then (ships finish, fleets arrive)
      if (step.auto && day % 30 === 29) run(g, step.autoFirst ? [] : step.auto(g));
      runDays(g, 1);
    }
    if (process.env.TRACE) console.log(JSON.stringify({ days: g.tick, seen, target: conquestFocus(g), owner: g.empires[target!.empireId].kind, events: g.events.filter((e) => /captured|repulsed|Peace|declares war/i.test(e.title)).map((e) => e.title) }));
    expect(seen).toContain("Land the soldiers");
    expect(captured(g, conquestFocus(g))).toBe(true);
  }, 120000);
});
