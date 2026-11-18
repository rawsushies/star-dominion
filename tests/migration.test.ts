import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { deserialize, serialize } from '../src/sim/save';
import { runDays } from '../src/sim/engine';
import { civilisationPower } from '../src/sim/power';

const v1 = () => gunzipSync(readFileSync('tests/fixtures/save-v1-small.json.gz')).toString('utf8');

describe('save migration from the pre-3D release (v1 fixture)', () => {
  it('loads, gains the new fields with safe defaults, and keeps simulating', () => {
    const raw = JSON.parse(v1());
    expect(raw.galaxy.sectors).toBeUndefined();
    expect(raw.galaxy.systems[0].z).toBeUndefined();
    const s = deserialize(v1());
    expect(s.empires.every((e) => typeof e.era === 'number')).toBe(true);
    expect(s.galaxy.sectors!.length).toBeGreaterThan(0);
    expect(s.galaxy.systems.every((x) => x.z === 0 && typeof x.sector === 'number')).toBe(true);
    // pre-3D galaxies keep their eagerly generated planets
    expect(s.galaxy.lazyBodies).toBeUndefined();
    expect(s.planets.length).toBe(raw.planets.length);
    const k = civilisationPower(s, s.empires[0]).k;
    expect(k).toBeGreaterThan(0.5);
    runDays(s, 120);
    expect(s.tick).toBe(raw.tick + 120);
    const again = deserialize(serialize(s));
    expect(again.tick).toBe(s.tick);
  });
});
