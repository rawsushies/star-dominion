import { describe, expect, it } from 'vitest';
import { MetroLine, STATIONS, LINE_END, direction } from '../src/ui/render/metro';

describe('elevated metro', () => {
  it('trains stop at every station, open doors only while stopped, then leave; they turn back at the ends', () => {
    const line = new MetroLine(2);
    const stops: Record<number, number[]> = { 0: [], 1: [] };
    const reversals = [0, 0];
    let prevTrack = line.trains.map((t) => t.track);
    for (let step = 0; step < 20 * 600; step++) {
      line.step(1 / 20, step / 20);
      line.trains.forEach((t, i) => {
        if (t.doors > 0) {
          expect(t.speed).toBe(0);
          expect(STATIONS).toContain(t.x);
        }
        if (t.phase === 'opening' && t.timer === 1 / 20) stops[i].push(t.served!);
        if (t.track !== prevTrack[i]) reversals[i]++;
        expect(Math.abs(t.x)).toBeLessThanOrEqual(LINE_END + 1e-6);
      });
      prevTrack = line.trains.map((t) => t.track);
    }
    for (const i of [0, 1]) {
      expect(reversals[i]).toBeGreaterThanOrEqual(2);
      // both stations served in each direction, in order of travel
      expect(new Set(stops[i])).toEqual(new Set([0, 1]));
      expect(stops[i].length).toBeGreaterThanOrEqual(4);
    }
    expect(line.events.length).toBeGreaterThan(6);
    expect(direction(0)).toBe(1);
  });
});
