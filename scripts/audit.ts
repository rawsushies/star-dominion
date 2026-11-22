// Bug audit: plays many reigns with a player that issues random commands (valid and invalid ids
// drawn from the live state) and checks, every month, that no command or simulation step throws
// and that the state stays consistent. Saves are round-tripped along the way.
//   npx vite-node scripts/audit.ts -- [years=15] [sizes=small,medium] [seeds=1,2,3] [cmdsPerMonth=25]
import { newGame, step } from '../src/sim/engine';
import { execute } from '../src/sim/commands';
import { serialize, deserialize, fingerprint } from '../src/sim/save';
import type { GameState } from '../src/sim/types';
import { randomCommand, invariants, report, problems } from '../tests/fixtures/fuzz';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const years = Number(argv[0] ?? 15);
const sizes = (argv[1] ?? 'small,medium').split(',') as GameState['settings']['galaxySize'][];
const seeds = (argv[2] ?? '1,2,3').split(',').map(Number);
const perMonth = Number(argv[3] ?? 25);
const diffs: GameState['settings']['difficulty'][] = ['relaxed', 'standard', 'hard'];

const errOut = new Map<string, number>();
for (const size of sizes) for (const seed of seeds) for (const difficulty of diffs) {
  const label0 = `${size}/${difficulty}/${seed}`;
  const t0 = Date.now();
  let g = newGame({ seed, galaxySize: size, aiCount: size === 'small' ? 3 : 5, difficulty, prologue: seed % 2 === 1 });
  let ended = '';
  try {
    for (let m = 0; m < years * 12; m++) {
      if (!g.empires[g.playerId].alive) { ended = `player fell y${(g.tick / 360).toFixed(1)}`; break; }
      for (let k = 0; k < perMonth; k++) {
        const cmd = randomCommand(g);
        try {
          const res = execute(g, g.playerId, cmd);
          if (res.ok === false && !res.message) report('command failure without a message', cmd.type);
          if (!res.ok) errOut.set(cmd.type, (errOut.get(cmd.type) ?? 0) + 1);
        } catch (err) { report(`THROW in command ${cmd.type}`, `${label0} m${m}: ${(err as Error).stack?.split('\n').slice(0, 4).join(' | ')} :: ${JSON.stringify(cmd)}`); }
      }
      for (let d = 0; d < 30; d++) {
        try { step(g); } catch (err) { report('THROW in step', `${label0} tick ${g.tick}: ${(err as Error).stack?.split('\n').slice(0, 5).join(' | ')}`); throw err; }
        if (g.gameOver) { if (!ended) ended = `game over y${(g.tick / 360).toFixed(1)}: ${g.gameOver.reason.slice(0, 60)}`; g.gameOver = null; }
      }
      invariants(g, `${label0} y${(g.tick / 360).toFixed(1)}`);
      if (m % 60 === 59) {
        const back = deserialize(serialize(g));
        if (fingerprint(back) !== fingerprint(g)) report('save round-trip changed the state', label0);
        g = back;
      }
    }
  } catch { ended = 'CRASHED'; }
  console.log(`${label0.padEnd(22)} ${((Date.now() - t0) / 1000).toFixed(0)}s ${ended}`);
}
console.log(`\n${problems.size} problem kinds`);
for (const [k, v] of [...problems.entries()].sort((a, b) => b[1].count - a[1].count)) console.log(`- [${v.count}] ${k}\n    ${v.first.slice(0, 600)}`);
