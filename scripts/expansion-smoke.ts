// Development check: run an all-AI game for many years and print the state of the Grand Expansion
// each year, then verify a save round-trip. Usage: npm run soak:expansion -- [seed] [years] [size]
import { newGame, step } from '../src/sim/engine';
import { serialize, deserialize, fingerprint } from '../src/sim/save';
const seed = Number(process.argv[2] ?? 7);
const years = Number(process.argv[3] ?? 30);
const size = (process.argv[4] ?? 'medium') as 'small' | 'medium' | 'large' | 'milky';
const g = newGame({ seed, galaxySize: size, aiCount: 4 });
g.empires[g.playerId].isPlayer = false; // AI plays every realm
const t0 = Date.now();
for (let y = 1; y <= years; y++) {
  for (let d = 0; d < 360; d++) step(g);
  const x = g.expansion!;
  const pre = x.precursors.map((p) => `${p.id}:${p.status}:${p.pressure.toFixed(0)}`).join(' ');
  const c = x.conclave;
  console.log(`y${y} ${pre} | conclave ${c.founded != null ? 'F' : '-'} seats=${Object.keys(c.seats).length} dir=${c.directives.map((d) => d.resolution.kind).join(',')} hist=${c.history.length} | dev ${x.devourer.status} fed=${x.devourer.fed} | omega ${x.omega.stage} int=${x.omega.integrity.toFixed(0)} corr=${Object.keys(x.omega.corrupted).length} | wars=${g.wars.length} ${g.gameOver ? 'GAMEOVER ' + g.gameOver.reason : ''}`);
}
const s = serialize(g);
const back = deserialize(s);
console.log('roundtrip', fingerprint(back) === fingerprint(g), ((Date.now() - t0) / 1000).toFixed(1) + 's');
