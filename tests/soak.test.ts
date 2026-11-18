declare const process: { env: Record<string, string | undefined> };
import { it, expect } from 'vitest';
import { newGame, step, getLedger } from '../src/sim/engine';
import { RESOURCES } from '../src/sim/types';

// Long-run health check: runs 30 years with an idle player and reports the state of the galaxy.
it('soak: 30 years of AI-driven simulation stays healthy', () => {
  const s = newGame({ seed: Number(process.env.SEED ?? 2024), galaxySize: 'medium', aiCount: 4 });
  // Observer mode: the player's realm is run by the AI so the whole galaxy evolves.
  if (!process.env.IDLE_PLAYER) { s.empires[0].isPlayer = false; s.empires[0].personality = { aggression: 0.5, expansion: 0.7, mercantile: 0.5, science: 0.5, diplomacy: 0.5, doctrine: 'balanced' }; }
  const t0 = Date.now();
  for (let y = 1; y <= 30; y++) {
    for (let d = 0; d < 360; d++) { step(s); if (!process.env.IDLE_PLAYER) s.gameOver = null; }
    if (y % 5 === 0 || process.env.VERBOSE) {
      const rows = s.empires.filter((e) => e.kind === 'major' || e.kind === 'minor' || e.kind === 'rebels').map((e) => {
        const L = e.alive ? getLedger(s, e) : null;
        const net = L ? RESOURCES.map((r) => `${r.slice(0, 3)}:${Math.round(L.net[r])}`).join(' ') : '';
        return `${e.alive ? ' ' : '✝'} ${e.name.padEnd(28).slice(0, 28)} sys ${String(e.stats.systems).padStart(3)} col ${String(e.stats.colonies).padStart(2)} pop ${String(Math.round(e.stats.population)).padStart(4)} mil ${String(e.stats.militaryPower).padStart(5)} stab ${String(e.stats.avgStability).padStart(3)} tech ${String(e.research.done.length).padStart(2)} | ${net}`;
      });
      console.log(`\n=== Year ${2400 + y} (${s.wars.length} wars, ${s.treaties.length} treaties, ${Object.keys(s.fleets).length} fleets) ===\n` + rows.join('\n'));
    }
  }
  const kinds: Record<string, number> = {};
  for (const e of s.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  console.log('event kinds (last 600):', JSON.stringify(kinds));
  console.log('wars now:', s.wars.map((w) => `${w.name} score ${Math.round(w.score)}`).join('; '));
  console.log('treaties:', s.treaties.map((t) => `${t.type}:${t.a}-${t.b}`).join(' '));
  console.log(`elapsed ${Date.now() - t0}ms for ${s.tick} days`);
  expect(s.empires.filter((e) => e.kind === 'major' && e.alive).length).toBeGreaterThanOrEqual(2);
}, 600000);
