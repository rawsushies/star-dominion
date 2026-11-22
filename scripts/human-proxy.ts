// A "beginner" stand-in: plays only with what the guidance offers a new player (the lessons'
// "Do it for me" orders, the Next step box's "Do it for me", stewards on every colony, the
// Prologue), checking in once a month,
// answering council matters with their first option and accepting every peace offer.
// It answers: can a modest human-like player survive and grow on each difficulty?
//   npx vite-node scripts/human-proxy.ts -- [years=25] [difficulties] [seeds]
import { newGame, runDays } from '../src/sim/engine';
import { execute } from '../src/sim/commands';
import { CHAPTER_BY_ID } from '../src/guidance/chapters';
import { lessonCtx } from '../src/guidance/lessons';
import type { GameState } from '../src/sim/types';
import { currentHints } from '../src/guidance/hints';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const years = Number(argv[0] ?? 25);
const diffs = (argv[1] ?? 'relaxed,standard,hard').split(',') as GameState['settings']['difficulty'][];
const seeds = (argv[2] ?? '101,202,303').split(',').map(Number);
const W = CHAPTER_BY_ID.welcome.steps, G = CHAPTER_BY_ID.grow.steps, C = CHAPTER_BY_ID.conquest.steps;
const ui = { speed: 0, windows: [], view: 'galaxy', screen: 'map' } as never;

for (const difficulty of diffs) for (const seed of seeds) {
  const g = newGame({ seed, galaxySize: 'medium', aiCount: 4, difficulty, prologue: true });
  const me = g.empires[g.playerId];
  const run = (cmds: unknown[]) => { for (const c of cmds) execute(g, g.playerId, c as never); };
  const ctx = () => ({ ...lessonCtx(g, ui), base: {}, now: {} }) as never;
  let lost = 0;
  for (let d = 0; d < 360 * years && me.alive; d += 30) {
    run(W[2].auto!(g)); run(G[1].auto!(g)); run(G[2].auto!(g));
    execute(g, g.playerId, { type: 'setAutoBuild', planetId: 'all', on: true });
    if (!g.planets[me.capitalPlanetId!]?.colony?.queue.length) run(W[3].auto!(g));
    // the war lesson, step by step, against whatever it targets
    for (const i of [2, 3, 4, 5, 7]) { const st = C[i]; if (st.done!(ctx())) continue; run(st.auto!(g)); break; }
    // the Next step box: press "Do it for me" on the top two tips that offer it
    for (const h of currentHints(g).filter((x) => x.doIt).slice(0, 2)) run(h.doIt!);
    for (const p of me.petitions ?? []) execute(g, g.playerId, { type: 'resolvePetition', petitionId: p.id, option: 0 });
    for (const p of g.proposals.filter((x) => x.to === g.playerId)) execute(g, g.playerId, { type: 'respondProposal', id: p.id, accept: p.kind === 'peace' || !p.demand });
    const before = me.stats.systems;
    runDays(g, 30);
    if (g.gameOver) { if (!g.gameOver.won) { lost = g.tick; break; } g.gameOver = null; }
    void before;
  }
  const rank = 1 + g.empires.filter((e) => e.kind === 'major' && e.alive && e.id !== me.id && e.stats.systems > me.stats.systems).length;
  console.log(`${difficulty.padEnd(8)} seed ${seed}: ${me.alive ? 'alive' : 'FALLEN'}${lost ? ` (reign ended y${Math.floor(lost / 360)}: ${g.gameOver?.reason ?? ''})` : ''} systems ${me.stats.systems} rank ${rank}/5 era ${me.era} K ${(me.stats.kardashev ?? 0).toFixed(2)} prologue ${g.prologue?.done ? 'done' : `stage ${g.prologue?.stage}`} wars on me ${g.events.filter((e) => e.kind === 'war' && e.title.endsWith(me.name)).length}`);
}
