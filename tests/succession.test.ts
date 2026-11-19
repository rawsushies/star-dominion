import { describe, expect, it } from 'vitest';
import { newGame, runDays } from '../src/sim/engine';
import { execute } from '../src/sim/commands';
import { serialize, deserialize, fingerprint } from '../src/sim/save';
import { succeed, rulerAge, heirOf, deathChance } from '../src/sim/succession';
import { charactersOf } from '../src/sim/characters';

describe('royal succession', () => {
  it('a named heir inherits smoothly: the heir leaves the roster, their house is pleased', () => {
    const s = newGame({ seed: 71 });
    const e = s.empires[s.playerId];
    e.stock.influence = 100;
    const heir = charactersOf(s, e.id).find((c) => c.status === 'active')!;
    if (e.houses?.length) heir.houseId = e.houses[0].id;
    expect(execute(s, e.id, { type: 'designateHeir', charId: heir.id }).ok).toBe(true);
    expect(heirOf(s, e)?.id).toBe(heir.id);
    const houseBefore = e.houses?.[0].loyalty ?? 0;
    succeed(s, e, 'died in old age');
    expect(e.ruler).toBe(heir.name);
    expect(heir.status).toBe('retired');
    expect(e.heirId).toBeNull();
    expect(e.timedMods.some((t) => t.label === 'Coronation')).toBe(true);
    if (e.houses?.length) expect(e.houses[0].loyalty).toBeGreaterThan(houseBefore);
    expect(s.events.some((ev) => ev.kind === 'succession')).toBe(true);
  });

  it('an empty throne causes a crisis: loyalty falls and stability suffers', () => {
    const s = newGame({ seed: 72 });
    const e = s.empires[s.playerId];
    const before = (e.houses ?? []).map((h) => h.loyalty);
    const old = e.ruler;
    succeed(s, e, 'died suddenly');
    expect(e.ruler).not.toBe(old);
    expect(e.timedMods.some((t) => t.label === 'Succession crisis' && t.value < 0)).toBe(true);
    (e.houses ?? []).forEach((h, i) => expect(h.loyalty).toBeLessThanOrEqual(before[i]));
  });

  it('only own active people can be named; the heir costs influence', () => {
    const s = newGame({ seed: 73 });
    const e = s.empires[s.playerId];
    const other = s.empires.find((x) => x.kind === 'major' && x.id !== e.id)!;
    const theirs = charactersOf(s, other.id)[0];
    e.stock.influence = 5;
    expect(execute(s, e.id, { type: 'designateHeir', charId: theirs.id }).ok).toBe(false);
    expect(execute(s, e.id, { type: 'designateHeir', charId: charactersOf(s, e.id)[0].id }).ok).toBe(false); // too poor
  });

  it('old age kills, the young rarely die, and over decades realms see successions; saves round-trip', () => {
    expect(deathChance(30)).toBeLessThan(0.001);
    expect(deathChance(80)).toBeGreaterThan(0.03);
    const s = newGame({ seed: 74 });
    for (const e of s.empires) if (e.kind === 'major') e.rulerBorn = s.tick - 70 * 360;
    runDays(s, 360 * 5);
    const crowned = s.events.filter((ev) => ev.kind === 'succession');
    expect(crowned.length).toBeGreaterThan(0);
    for (const e of s.empires.filter((x) => x.kind === 'major' && x.alive)) expect(rulerAge(s, e)).toBeGreaterThanOrEqual(0);
    // AI realms with old rulers name heirs
    const ai = s.empires.filter((x) => x.kind === 'major' && x.alive && !x.isPlayer && rulerAge(s, x) >= 45);
    if (ai.length) expect(ai.some((x) => heirOf(s, x))).toBe(true);
    const b = deserialize(serialize(s));
    expect(fingerprint(b)).toBe(fingerprint(s));
  });
});
