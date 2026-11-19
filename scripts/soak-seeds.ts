// Multi-seed long-run integrity check: runs several galaxies for many years with every realm
// AI-driven and checks invariants each year. Usage: npm run soak:seeds -- [years] [seed...]
import { newGame, step, getLedger } from '../src/sim/engine';
import { serialize, deserialize, fingerprint } from '../src/sim/save';
import { RESOURCES, type GameState } from '../src/sim/types';
import { opsOf } from '../src/sim/operations';
import { charactersOf } from '../src/sim/characters';
import { CITADEL_MAX } from '../src/sim/data/capital';

const args = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
const years = args[0] ?? 30;
const seeds = args.length > 1 ? args.slice(1) : [101, 202, 303];
let failures = 0;

function check(s: GameState, label: string) {
  const bad: string[] = [];
  for (const e of s.empires) {
    for (const r of RESOURCES) if (!Number.isFinite(e.stock[r])) bad.push(`${e.name} stock.${r}=${e.stock[r]}`);
    if (!e.alive) continue;
    for (const [k, v] of Object.entries(e.stats)) if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${e.name} stats.${k}=${v}`);
    for (const h of e.houses ?? []) if (!(h.loyalty >= 0 && h.loyalty <= 100)) bad.push(`${e.name} house loyalty ${h.loyalty}`);
    const k = e.stats.kardashev ?? 0;
    if (!(k >= 0 && k < 6)) bad.push(`${e.name} kardashev ${k}`);
    const cit = e.capital?.buildings.citadel?.level ?? 0;
    if (cit > CITADEL_MAX) bad.push(`${e.name} citadel ${cit}`);
    if (!e.isPlayer) { const L = getLedger(s, e); if (L.logisticsUsed > L.logisticsCap + 1) bad.push(`${e.name} logistics ${L.logisticsUsed}/${L.logisticsCap}`); }
  }
  for (const p of s.planets) {
    if (p.colony && !(p.colony.pops >= 0 && Number.isFinite(p.colony.stability))) bad.push(`planet ${p.id} colony state`);
    if (p.op && !(p.op.reserve >= 0 && p.op.reserve <= 1)) bad.push(`planet ${p.id} reserve ${p.op.reserve}`);
    if (p.station && p.colony) bad.push(`planet ${p.id} has both station and colony`);
  }
  for (const c of s.characters) {
    if (c.status === 'active' && c.assignment?.kind === 'fleet' && s.fleets[c.assignment.fleetId]?.ownerId !== c.ownerId) bad.push(`character ${c.id} leads a fleet it does not own`);
    if (!(c.loyalty >= 0 && c.loyalty <= 100)) bad.push(`character ${c.id} loyalty ${c.loyalty}`);
  }
  for (const f of Object.values(s.fleets)) if (!f.ships.length) bad.push(`empty fleet ${f.id}`);
  if (bad.length) { failures += bad.length; console.log(`  ✗ ${label}: ${bad.slice(0, 6).join('; ')}${bad.length > 6 ? ` (+${bad.length - 6})` : ''}`); }
}

for (const seed of seeds) {
  const t0 = Date.now();
  const s = newGame({ seed, galaxySize: 'medium', aiCount: 4 });
  s.empires[0].isPlayer = false;
  s.empires[0].personality = { aggression: 0.5, expansion: 0.7, mercantile: 0.5, science: 0.5, diplomacy: 0.5, doctrine: 'balanced' };
  for (let y = 1; y <= years; y++) {
    for (let d = 0; d < 360; d++) { step(s); s.gameOver = null; }
    check(s, `seed ${seed} year ${y}`);
    if (y % 10 === 0) {
      const json = serialize(s);
      const back = deserialize(json);
      if (fingerprint(back) !== fingerprint(s)) { failures++; console.log(`  ✗ seed ${seed} year ${y}: save round-trip changed the state`); }
    }
  }
  const majors = s.empires.filter((e) => e.kind === 'major');
  const summary = majors.map((e) => {
    const L = e.alive ? getLedger(s, e) : null;
    return `${e.alive ? ' ' : '✝'}${e.name.slice(0, 22).padEnd(22)} K${(e.stats.kardashev ?? 0).toFixed(2)} era${e.era} sys${String(e.stats.systems).padStart(3)} cit${e.capital?.buildings.citadel?.level ?? 0} ops${opsOf(s, e.id).length} log${L ? `${L.logisticsUsed}/${L.logisticsCap}` : '-'} chars${charactersOf(s, e.id).length} decrees${e.decrees?.length ?? 0}`;
  });
  console.log(`seed ${seed}: ${years} years in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${s.wars.length} wars, ${s.battles.length} battle reports, save ${(serialize(s).length / 1e6).toFixed(2)} MB, chronicle ${s.chronicle?.length} years\n` + summary.join('\n'));
}
console.log(failures ? `\nFAILED: ${failures} invariant violations` : '\nAll invariants held.');
process.exit(failures ? 1 : 0);
