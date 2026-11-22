// Campaign statistics: runs whole campaigns with every realm AI-driven and measures how the game
// plays out per difficulty: economy, expansion, eras, wars, survival, megastructures and victories.
// The player's realm is played by the AI at the "standard" skill (a stand-in for a competent
// player), so the numbers show how hard the rivals at each difficulty push that realm.
//
// Usage: npx vite-node scripts/campaign.ts -- [years=60] [difficulties=relaxed,standard,hard] [seeds=101,202,303] [size=medium]
import { newGame, step } from '../src/sim/engine';
import { victoryStatus } from '../src/sim/victory';
import type { GameState } from '../src/sim/types';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const years = Number(argv[0] ?? 60);
const diffs = (argv[1] ?? 'relaxed,standard,hard').split(',') as GameState['settings']['difficulty'][];
const seeds = (argv[2] ?? '101,202,303').split(',').map(Number);
const size = (argv[3] ?? 'medium') as GameState['settings']['galaxySize'];

const CHECKPOINTS = [30, 60, 100];
interface Run {
  seed: number; diff: string; year: number;
  wars: number; warsOnPlayer: number; joins: number; letters: number; demands: number; vassals: number; conquests: number; falls: number; revolts: number; betrayals: number; coalitions: number;
  playerAlive: boolean; playerRank: number; playerK: number; playerSys: number; playerEra: number;
  meanK: number; topK: number; minK: number; maxEra: number; megaStages: number; topShare: number; snowball: number;
  passiveRivalYears: number; vassalYears: number; aliveMajors: number; majors: number;
  victory: { year: number; who: string; kind: string } | null;
  firstContactYear: number | null; firstWarYear: number | null; firstWarOnPlayerYear: number | null;
}

function megaStages(s: GameState) { let n = 0; for (const sys of s.galaxy.systems) for (const m of sys.megastructures) n += m.stage; return n; }

function play(seed: number, diff: GameState['settings']['difficulty']): Run[] {
  const snaps: Run[] = [];
  const s = newGame({ seed, galaxySize: size, aiCount: 4, difficulty: diff });
  s.empires[0].isPlayer = false; // the AI plays the player's realm at standard skill
  const run: Run = {
    seed, diff, year: 0, wars: 0, warsOnPlayer: 0, joins: 0, letters: 0, demands: 0, vassals: 0, conquests: 0, falls: 0, revolts: 0, betrayals: 0, coalitions: 0,
    playerAlive: true, playerRank: 0, playerK: 0, playerSys: 0, playerEra: 0, meanK: 0, topK: 0, minK: 0, maxEra: 0, megaStages: 0, topShare: 0, snowball: 0,
    passiveRivalYears: 0, vassalYears: 0, aliveMajors: 0, majors: 0, victory: null, firstContactYear: null, firstWarYear: null, firstWarOnPlayerYear: null,
  };
  let seen = 0;
  const lastActive: Record<number, { sys: number; tick: number }> = {};
  for (let y = 1; y <= years; y++) {
    for (let d = 0; d < 360; d++) {
      step(s);
      if (s.gameOver) s.gameOver = null;
    }
    for (const ev of s.events) {
      if (ev.id <= seen) continue;
      seen = ev.id;
      if (ev.kind === 'war' && /joins the/.test(ev.title)) { run.joins++; continue; }
      if (ev.kind === 'envoy') run.letters++;
      if (ev.kind === 'diplomacy' && /demands tribute/.test(ev.title)) run.demands++;
      if (ev.kind === 'war' && !ev.title.includes('Independence')) {
        run.wars++;
        run.firstWarYear ??= y;
        if (ev.text.includes(s.empires[0].name) && /declares war on/.test(ev.title)) { run.warsOnPlayer += ev.title.endsWith(s.empires[0].name) ? 1 : 0; if (ev.title.endsWith(s.empires[0].name)) run.firstWarOnPlayerYear ??= y; }
      }
      if (ev.kind === 'conquest' || /captured|conquered|falls to/i.test(ev.title)) run.conquests++;
      if (ev.kind === 'fall') run.falls++;
      if (ev.kind === 'rebellion') run.revolts++;
      if (ev.kind === 'betrayal') run.betrayals++;
      if (ev.kind === 'coalition') run.coalitions++;
    }
    if (run.firstContactYear == null && s.empires.some((o) => o.id !== 0 && o.kind === 'major' && s.opinions[`0>${o.id}`] !== undefined)) run.firstContactYear = y;
    // passive rivals: a living major that neither gained a system nor fought for 10 years
    for (const e of s.empires) {
      if (e.kind !== 'major' || !e.alive) continue;
      const fighting = s.wars.some((w) => w.attackers.includes(e.id) || w.defenders.includes(e.id));
      const la = lastActive[e.id];
      if (!la || fighting || e.stats.systems > la.sys) lastActive[e.id] = { sys: Math.max(e.stats.systems, la?.sys ?? 0), tick: s.tick };
      else if (s.tick - la.tick >= 3600 && !run.victory) {
        // a vassal that sits still is subordinate, not passive: counted apart
        if (s.treaties.some((t) => t.type === 'vassal' && t.b === e.id)) run.vassalYears++;
        else run.passiveRivalYears++;
      }
    }
    if (CHECKPOINTS.includes(y) || y === years) snaps.push(snapshot(s, { ...run, year: y }));
    if (!run.victory) {
      for (const e of s.empires) {
        if (e.kind !== 'major' || !e.alive) continue;
        const v = victoryStatus(s, e).achieved;
        if (v) { run.victory = { year: y, who: e.id === 0 ? 'player' : e.name, kind: v }; break; }
      }
    }
  }
  return snaps;
}

function snapshot(s: GameState, run: Run): Run {
  run = { ...run };
  const majors = s.empires.filter((e) => e.kind === 'major');
  const alive = majors.filter((e) => e.alive);
  const ks = alive.map((e) => e.stats.kardashev ?? 0);
  const sysTotal = s.galaxy.systems.length;
  const p = s.empires[0];
  run.majors = majors.length;
  run.vassals = s.treaties.filter((t) => t.type === 'vassal' && s.empires[t.b].kind === 'major').length;
  run.aliveMajors = alive.length;
  run.playerAlive = p.alive;
  run.playerK = p.stats.kardashev ?? 0;
  run.playerSys = p.stats.systems;
  run.playerEra = p.era;
  run.playerRank = p.alive ? 1 + alive.filter((e) => e.id !== 0 && e.stats.systems > p.stats.systems).length : majors.length;
  run.meanK = ks.reduce((a, b) => a + b, 0) / Math.max(1, ks.length);
  run.topK = Math.max(...ks);
  run.minK = Math.min(...ks);
  run.maxEra = Math.max(...alive.map((e) => e.era));
  run.megaStages = megaStages(s);
  const sysSorted = alive.map((e) => e.stats.systems).sort((a, b) => b - a);
  run.topShare = sysSorted[0] / sysTotal;
  run.snowball = sysSorted[0] / Math.max(1, sysSorted[Math.floor(sysSorted.length / 2)]);
  return run;
}

const fmt = (n: number, d = 2) => n.toFixed(d);
const all: Run[] = [];
for (const diff of diffs) {
  for (const seed of seeds) {
    const t0 = Date.now();
    const snaps = play(seed, diff);
    all.push(...snaps);
    for (const r of snaps) console.log(`${diff.padEnd(8)} seed ${seed} ${r.year}y (${((Date.now() - t0) / 1000).toFixed(0)}s): wars ${r.wars} joins ${r.joins} letters ${r.letters} demands ${r.demands} (on player ${r.warsOnPlayer}, first y${r.firstWarYear ?? '-'}) falls ${r.falls} revolts ${r.revolts} betrayals ${r.betrayals} coalitions ${r.coalitions} | player ${r.playerAlive ? 'alive' : 'DEAD'} rank ${r.playerRank}/${r.majors} K${fmt(r.playerK)} sys ${r.playerSys} era ${r.playerEra} | K mean ${fmt(r.meanK)} top ${fmt(r.topK)} min ${fmt(r.minK)} era≤${r.maxEra} mega ${r.megaStages} top share ${fmt(r.topShare * 100, 0)}% snowball ${fmt(r.snowball, 1)}x passive ${r.passiveRivalYears} vassal-idle ${r.vassalYears} alive ${r.aliveMajors}/${r.majors} | victory ${r.victory ? `${r.victory.kind} by ${r.victory.who} y${r.victory.year}` : 'none'}`);
  }
}
console.log('\nsummary');
for (const year of [...new Set(all.map((r) => r.year))].sort((a, b) => a - b)) for (const diff of diffs) {
  const rs = all.filter((r) => r.diff === diff && r.year === year);
  const avg = (f: (r: Run) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
  console.log(`${String(year).padStart(3)}y ${diff.padEnd(8)} n=${rs.length} vassals ${fmt(avg((r) => r.vassals), 1)} wars ${fmt(avg((r) => r.wars), 1)} joins ${fmt(avg((r) => r.joins), 1)} letters ${fmt(avg((r) => r.letters), 1)} on-player ${fmt(avg((r) => r.warsOnPlayer), 1)} falls ${fmt(avg((r) => r.falls), 1)} player survival ${fmt(avg((r) => +r.playerAlive) * 100, 0)}% rank ${fmt(avg((r) => r.playerRank), 1)} player K ${fmt(avg((r) => r.playerK))} | mean K ${fmt(avg((r) => r.meanK))} top K ${fmt(avg((r) => r.topK))} max era ${fmt(avg((r) => r.maxEra), 1)} mega ${fmt(avg((r) => r.megaStages), 1)} top share ${fmt(avg((r) => r.topShare) * 100, 0)}% snowball ${fmt(avg((r) => r.snowball), 1)}x passive ${fmt(avg((r) => r.passiveRivalYears), 1)} vassal-idle ${fmt(avg((r) => r.vassalYears), 1)} | victories ${rs.filter((r) => r.victory).map((r) => `${r.victory!.kind}/${r.victory!.who === 'player' ? 'P' : 'AI'}@${r.victory!.year}`).join(' ') || 'none'}`);
}
