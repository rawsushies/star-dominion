// Evidence for the living galaxy: run all-AI campaigns for a century (or as long as asked) on
// several seeds and print, decade by decade, what the economy, trade, migration and the arcs of
// realms actually did, then the galactic history. Usage:
//   npm run probe:life -- [years] [size] [seed...]
import { newGame, step } from '../src/sim/engine';
import { serialize, deserialize, fingerprint } from '../src/sim/save';
import { routeVolume } from '../src/sim/life';
import { PHASE_LABEL } from '../src/sim/data/life';
import type { GameState } from '../src/sim/types';

const years = Number(process.argv[2] ?? 100);
const size = (process.argv[3] ?? 'medium') as 'small' | 'medium' | 'large' | 'milky';
const seeds = process.argv.slice(4).map(Number);

function snapshot(g: GameState) {
  const L = g.life!;
  const inter = L.routes.filter((r) => r.a !== r.b);
  const status: Record<string, number> = {};
  for (const r of L.routes) status[r.status] = (status[r.status] ?? 0) + 1;
  const realms = g.empires.filter((e) => e.alive && (e.kind === 'major' || e.kind === 'minor' || e.kind === 'rebels'));
  let short = 0, wrecked = 0, cols = 0, cutShort = 0;
  for (const p of g.planets) if (p.colony) { cols++; if ((p.colony.supply ?? 1) < 0.6) { short++; if (L.routes.some((r) => r.to === p.id && (r.status === 'blockaded' || r.status === 'severed'))) cutShort++; } if ((p.colony.devastation ?? 0) > 35) wrecked++; }
  return {
    routes: L.routes.length, inter: inter.length, vol: Math.round(inter.reduce((a, r) => a + routeVolume(r), 0)), status,
    pairs: inter.map((r) => `${Math.min(r.a, r.b)}-${Math.max(r.a, r.b)}`),
    realms: realms.map((e) => `${e.name.split(' ').slice(-1)[0]}(${e.kind[0]}${e.id}) ${PHASE_LABEL[L.arcs[e.id]?.phase ?? 'founding']} sys${e.stats.systems} pop${Math.round(e.stats.population)} pr${L.arcs[e.id]?.prosperity ?? '?'}`),
    short, cutShort, wrecked, cols, wars: g.wars.length,
    prices: ['food', 'alloys', 'electronics', 'rare'].map((k) => `${k}=${g.market.price[k as 'food'].toFixed(2)}`).join(' '),
  };
}

for (const seed of seeds.length ? seeds : [101, 202, 303]) {
  const g = newGame({ seed, galaxySize: size, aiCount: 5 });
  g.empires[g.playerId].isPlayer = false; // AI plays every realm
  const t0 = Date.now();
  let migrations = 0, migrated = 0, seenMig = -1;
  const pairsEver = new Set<string>();
  let prevPairs = new Set<string>();
  console.log(`\n=== seed ${seed}, ${size}`);
  const endings: string[] = [];
  for (let d = 1; d <= 360 * years; d++) {
    step(g);
    // a victory is recorded, but the galaxy keeps living so the century can be observed
    if (g.gameOver) { if (!endings.some((x) => x.endsWith(g.gameOver!.reason))) endings.push(`y${Math.floor(g.tick / 360)}: ${g.gameOver.reason}`); g.gameOver = null; }
    for (const m of g.life!.migrations) if (m.id > seenMig) { migrations++; migrated += m.pops; seenMig = Math.max(seenMig, m.id); }
    if (d % 360 === 0) for (const r of g.life!.routes) if (r.a !== r.b) pairsEver.add(`${Math.min(r.a, r.b)}-${Math.max(r.a, r.b)}`);
    if (d % (360 * 10) === 0) {
      const s = snapshot(g);
      const now = new Set(s.pairs);
      const gained = [...now].filter((x) => !prevPairs.has(x)).length, lost = [...prevPairs].filter((x) => !now.has(x)).length;
      prevPairs = now;
      console.log(`-- year ${d / 360}: routes ${s.routes} (interstellar ${s.inter}, ${s.vol} u/mo; +${gained}/-${lost} realm pairs this decade) status ${JSON.stringify(s.status)} | worlds short ${s.short}/${s.cols} (${s.cutShort} by cut lanes), wrecked ${s.wrecked} | wars ${s.wars} | ${s.prices}`);
      console.log(`   migrations so far ${migrations} (${Math.round(migrated)} M people) | ${s.realms.join(' · ')}`);
    }
  }
  const L = g.life!;
  const kinds: Record<string, number> = {};
  for (const h of L.history) kinds[h.kind] = (kinds[h.kind] ?? 0) + 1;
  console.log(`ran ${Math.floor(g.tick / 360)}y in ${((Date.now() - t0) / 1000).toFixed(1)}s ${endings.length ? `(victories, play continued: ${endings.slice(0, 3).join(' | ')})` : ''}; realm pairs that ever traded: ${pairsEver.size}`);
  console.log('history kinds:', JSON.stringify(kinds));
  for (const h of L.history.filter((x) => x.weight >= 2).slice(-25)) console.log(`  y${Math.floor(h.tick / 360) + 1} [${h.kind}] ${h.title} — ${h.cause} ${h.effect}`);
  const back = deserialize(serialize(g));
  console.log('save roundtrip identical:', fingerprint(back) === fingerprint(g));
}
