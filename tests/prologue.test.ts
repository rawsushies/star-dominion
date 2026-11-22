import { describe, expect, it } from 'vitest';
import { newGame, runDays } from '../src/sim/engine';
import { execute, type Command } from '../src/sim/commands';
import { jumpDistances } from '../src/sim/galaxy';
import { serialize, deserialize, fingerprint } from '../src/sim/save';
import { PROLOGUE_STAGES, currentStage, pretenderOf, prologueActive } from '../src/sim/prologue';
import { CHAPTER_BY_ID } from '../src/guidance/chapters';
import { conquestFocus } from '../src/guidance/conquest';
import type { GameState } from '../src/sim/types';

const run = (g: GameState, cmds: Command[]) => { for (const c of cmds) execute(g, g.playerId, c); };

describe('the Prologue', () => {
  it('exists only when asked for, so other games are unchanged', () => {
    const a = newGame({ seed: 41, galaxySize: 'small', aiCount: 2 });
    const b = newGame({ seed: 41, galaxySize: 'small', aiCount: 2 });
    expect(a.prologue).toBeUndefined();
    expect(a.empires.some((e) => e.role === 'pretender')).toBe(false);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('seats a weak Pretender two or three jumps from the player', () => {
    for (const seed of [41, 42, 43, 44]) {
      const g = newGame({ seed, galaxySize: 'small', aiCount: 2, prologue: true });
      const pr = pretenderOf(g)!;
      expect(pr, `seed ${seed}`).not.toBeNull();
      const d = jumpDistances(g.galaxy, [g.empires[g.playerId].capitalSystemId!]);
      expect([2, 3]).toContain(d[pr.capitalSystemId!]);
      expect(g.planets[pr.capitalPlanetId!].colony!.buildings.orbital_defense ?? 0).toBe(0);
      expect(currentStage(g)?.id).toBe('steady');
      expect(prologueActive(g)).toBe(true);
    }
  });

  it('can be played through: every stage pays once, the Pretender falls, and the great realms then take notice', () => {
    const g = newGame({ seed: 42, galaxySize: 'small', aiCount: 2, prologue: true, difficulty: 'hard' });
    const me = g.empires[g.playerId];
    const pr = pretenderOf(g)!;
    const crown = pr.capitalPlanetId!;
    // stage 1: research and a district, through the lesson's own "Do it for me" orders
    run(g, CHAPTER_BY_ID.welcome.steps[2].auto!(g));
    run(g, CHAPTER_BY_ID.welcome.steps[3].auto!(g));
    runDays(g, 10);
    expect(g.prologue!.stage).toBe(1);
    expect(g.events.some((e) => e.kind === 'quest' && e.title.includes('Put the realm in order'))).toBe(true);
    // let the realm grow and the player play the conquest lesson's orders until the crown world falls
    me.explored = g.galaxy.systems.map((s) => s.id);
    Object.assign(me.stock, { credits: 9000, alloys: 9000, minerals: 9000, food: 9000, influence: 300 });
    const steps = CHAPTER_BY_ID.conquest.steps;
    for (let day = 0; day < 360 * 5 && pr.alive && g.planets[crown].colony?.ownerId !== me.id; day += 10) {
      if (pr.alive) expect(conquestFocus(g)?.empireId).toBe(pr.id);
      if (day % 60 === 0) for (const s of steps) if (s.auto && !s.autoFirst) run(g, s.auto(g));
      // claim free neighbours for the borders stage
      if (day % 60 === 0) run(g, CHAPTER_BY_ID.grow.steps[2].auto!(g));
      if (process.env.TRACE && day % 120 === 0) console.log('T', day, JSON.stringify(Object.values(g.fleets).filter((f) => f.ownerId === me.id).map((f) => [f.name, f.systemId, f.ships.map((x) => x.cls[0]).join(''), f.troops, f.order.type, f.path.length])), 'target', g.planets[crown].systemId);
      runDays(g, 10);
    }
    runDays(g, 10);
    if (process.env.TRACE) console.log(JSON.stringify({ tick: g.tick, alive: pr.alive, id: pr.id, stage: g.prologue, wars: g.wars.map((w) => [w.attackers, w.defenders]), ev: g.events.filter((e) => /nvasion|captured|Quest|repulsed/.test(e.title)).map((e) => e.tick + ' ' + e.title + ': ' + e.text) }));
    expect(g.planets[crown].colony?.ownerId).toBe(me.id);
    expect(g.events.filter((e) => e.kind === 'quest').length).toBeGreaterThanOrEqual(PROLOGUE_STAGES.length);
    expect(g.prologue!.done).toBe(true);
    expect(prologueActive(g)).toBe(false);
    // nobody attacked the player while the prologue ran
    expect(g.events.some((e) => e.kind === 'war' && e.title.endsWith(me.name) && e.tick < g.prologue!.doneTick!)).toBe(false);
    const back = deserialize(serialize(g));
    expect(fingerprint(back)).toBe(fingerprint(g));
  }, 120000);
});
