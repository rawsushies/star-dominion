// Development check: run all-AI campaigns on several seeds and print each galaxy's political
// history (pacts, betrayals, accords, the ancients' stance), to see that campaigns diverge.
// Usage: npm run probe:politics -- [years] [size] [seed...]
import { newGame, step } from '../src/sim/engine';
import { serialize, deserialize, fingerprint } from '../src/sim/save';
import { PRIORITY_LABEL } from '../src/sim/data/politics';
const years = Number(process.argv[2] ?? 40);
const size = (process.argv[3] ?? 'medium') as 'small' | 'medium' | 'large' | 'milky';
const seeds = process.argv.slice(4).map(Number);
for (const seed of seeds.length ? seeds : [101, 202, 303]) {
  const g = newGame({ seed, galaxySize: size, aiCount: 5 });
  g.empires[g.playerId].isPlayer = false; // AI plays every realm
  const t0 = Date.now();
  for (let d = 0; d < 360 * years && !g.gameOver; d++) step(g);
  const p = g.expansion!.politics;
  const kinds: Record<string, number> = {};
  for (const h of p.history) kinds[h.kind] = (kinds[h.kind] ?? 0) + 1;
  console.log(`\n=== seed ${seed}: ${years}y in ${((Date.now() - t0) / 1000).toFixed(1)}s ${g.gameOver ? `(game over: ${g.gameOver.reason})` : ''}`);
  console.log('ancients:', g.expansion!.precursors.map((x) => `${x.id}:${x.status}`).join(' '), '| pacts now:', p.pacts.map((x) => `${x.kind}[${x.members.join(',')}${x.target != null ? '→' + x.target : ''}]`).join(' ') || 'none');
  console.log('history kinds:', JSON.stringify(kinds));
  console.log('agendas:', Object.entries(p.agendas).map(([id, a]) => `${g.empires[+id].name.split(' ').pop()}=${PRIORITY_LABEL[a.priority]}`).join(', '));
  for (const h of p.history.slice(-30)) console.log(`  y${Math.floor(h.tick / 360) + 1} [${h.kind}] ${h.title}`);
  const back = deserialize(serialize(g));
  console.log('roundtrip', fingerprint(back) === fingerprint(g));
}
