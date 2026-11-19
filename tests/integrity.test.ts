import { describe, expect, it } from 'vitest';
import { newGame, runDays, revolt } from '../src/sim/engine';
import { deserialize, serialize, fingerprint } from '../src/sim/save';

describe('save integrity', () => {
  it('a realm born mid-game (a rebel state) survives a save round-trip unchanged', () => {
    const s = newGame({ seed: 7 });
    runDays(s, 360 * 2);
    // push a settled, non-capital world to the brink of revolt
    const p = s.planets.find((x) => x.colony && s.empires[x.colony.ownerId].kind === 'major' && s.empires[x.colony.ownerId].capitalPlanetId !== x.id && x.colony.pops >= 2)!;
    expect(p).toBeTruthy();
    const owner = s.empires[p.colony!.ownerId];
    p.colony!.originalOwnerId = null;
    const before = s.empires.length;
    revolt(s, p.id);
    runDays(s, 60);
    expect(s.empires.length).toBe(before + 1);
    const rebels = s.empires[before];
    expect(rebels.kind).toBe('rebels');
    expect(owner.id).not.toBe(rebels.id);
    expect(fingerprint(deserialize(serialize(s)))).toBe(fingerprint(s));
  });
});
