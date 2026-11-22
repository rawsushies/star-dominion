import { describe, expect, it } from 'vitest';
import { newGame } from '../src/sim/engine';
import { execute } from '../src/sim/commands';
import { fleetPower } from '../src/sim/fleets';
import { serialize, deserialize, fingerprint } from '../src/sim/save';
import { EPIC_PITY, LEGEND_PITY, START_RELICS, drawRelics, grantRelics } from '../src/sim/relics';

describe('the Relic Vault', () => {
  it('starts each reign with a few relics and a draw spends them', () => {
    const g = newGame({ seed: 71, galaxySize: 'small', aiCount: 2 });
    const me = g.empires[g.playerId];
    expect(me.relics).toBe(START_RELICS);
    expect(g.empires.filter((e) => !e.isPlayer).every((e) => !e.relics)).toBe(true);
    expect(execute(g, g.playerId, { type: 'drawRelic', count: 1 }).ok).toBe(true);
    expect(me.relics).toBe(START_RELICS - 1);
    expect(me.relicLog).toHaveLength(1);
    expect(execute(g, g.playerId, { type: 'drawRelic', count: 10 }).ok).toBe(false);
  });

  it('keeps its promises: an epic within every ten draws, a legendary within forty, each legendary once', () => {
    const g = newGame({ seed: 72, galaxySize: 'small', aiCount: 2 });
    const me = g.empires[g.playerId];
    me.relics = 400;
    const all = drawRelics(g, me, 10).concat(...Array.from({ length: 39 }, () => drawRelics(g, me, 10)));
    let sinceEpic = 0, sinceLegend = 0, maxEpicGap = 0, maxLegendGap = 0;
    for (const d of all) {
      sinceEpic++; sinceLegend++;
      if (d.rarity === 'epic' || d.rarity === 'legendary') { maxEpicGap = Math.max(maxEpicGap, sinceEpic); sinceEpic = 0; }
      if (d.rarity === 'legendary') { maxLegendGap = Math.max(maxLegendGap, sinceLegend); sinceLegend = 0; }
    }
    expect(maxEpicGap).toBeLessThanOrEqual(EPIC_PITY);
    expect(maxLegendGap).toBeLessThanOrEqual(LEGEND_PITY);
    const legends = all.filter((d) => d.rarity === 'legendary' && d.kind !== 'cache').map((d) => d.title);
    expect(legends.length).toBeGreaterThan(0);
    expect(new Set(legends).size).toBe(legends.length);
    // the published odds hold roughly over 400 draws
    const commons = all.filter((d) => d.rarity === 'common').length / all.length;
    expect(commons).toBeGreaterThan(0.45);
    expect(commons).toBeLessThan(0.7);
  });

  it('a relic warship really is stronger than a plain one of its class, and survives a save', () => {
    const g = newGame({ seed: 73, galaxySize: 'small', aiCount: 2 });
    const me = g.empires[g.playerId];
    me.relics = 200;
    let ship = null;
    for (let i = 0; i < 40 && !ship; i++) { drawRelics(g, me, 1); ship = Object.values(g.fleets).find((f) => f.ownerId === me.id && f.ships.some((s) => s.relic && s.relic.rarity !== 'common')); }
    expect(ship).toBeTruthy();
    const relicShip = ship!.ships[0];
    const plain = { ...ship!, ships: [{ ...relicShip, relic: undefined, hull: relicShip.hull / (1 + relicShip.relic!.bonus) }] };
    expect(fleetPower(g, ship!)).toBeGreaterThan(fleetPower(g, plain));
    expect(fingerprint(deserialize(serialize(g)))).toBe(fingerprint(g));
  });

  it('relics are earned by playing', () => {
    const g = newGame({ seed: 74, galaxySize: 'small', aiCount: 2 });
    const me = g.empires[g.playerId];
    grantRelics(g, me, 2, 'Test');
    expect(me.relics).toBe(START_RELICS + 2);
    grantRelics(g, g.empires[1], 2, 'Not for the AI');
    expect(g.empires[1].relics).toBeUndefined();
  });
});
