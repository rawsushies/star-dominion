import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { newGame, runDays } from '../src/sim/engine';
import { deserialize, serialize, fingerprint } from '../src/sim/save';

describe('chronicle', () => {
  it('records every sovereign realm once a year with that year’s headlines', () => {
    const s = newGame({ seed: 71 });
    expect(s.chronicle!.length).toBe(1);
    runDays(s, 360 * 3 + 2);
    expect(s.chronicle!.length).toBe(4);
    const ticks = s.chronicle!.map((y) => y.tick);
    expect(ticks).toEqual([0, 360, 720, 1080]);
    for (const y of s.chronicle!) {
      expect(y.stats.length).toBe(s.empires.filter((e) => e.kind === 'major' || e.kind === 'minor').length);
      for (const h of y.headlines) expect(h.tick).toBeLessThanOrEqual(y.tick);
    }
    // headlines are not repeated across years
    const seen = new Set<string>();
    for (const y of s.chronicle!) for (const h of y.headlines) { const k = `${h.tick}:${h.title}`; expect(seen.has(k)).toBe(false); seen.add(k); }
    const me = s.chronicle![3].stats.find((x) => x.id === s.playerId)!;
    expect(me.k).toBeGreaterThan(0.5);
    expect(me.citadel).toBeGreaterThanOrEqual(1);
    const b = deserialize(serialize(s));
    expect(fingerprint(b)).toBe(fingerprint(s));
  });

  it('older saves start with an empty chronicle and grow it', () => {
    const s = deserialize(gunzipSync(readFileSync('tests/fixtures/save-v1-small.json.gz')).toString('utf8'));
    expect(Array.isArray(s.chronicle)).toBe(true);
    const n = s.chronicle!.length;
    runDays(s, 361);
    expect(s.chronicle!.length).toBe(n + 1);
  });
});
