// The capital's elevated metro (pure simulation; capitalMetro.ts draws it with tevy's viaduct,
// platforms and metro cars). One double-track line runs above the street at z = LINE_Z, from the
// far west of the outer city to the far east. Trains of three cars run each way; at every
// station they slow to a stop, open the doors on the platform side, let passengers off and on,
// close the doors and leave. Beyond the outer city (in the haze) a train crosses to the other
// track and comes back.

import { M } from './cityRoads';
import { CELL } from './megacityLayout';

export const LINE_Z = -2 * CELL;
export const LINE_END = 320;
/** Track centre lines either side of the viaduct's axis (tevy's span carries two tracks). */
export const TRACK_OFFSET = 2.25 * M;
export const CAR_LENGTH = 19.6 * M;
export const CARS = 3;
export const TRAIN_LENGTH = CAR_LENGTH * CARS;
/** Stations sit mid-block, where the viaduct's piers are clear of the junctions. */
export const STATIONS = [-CELL / 2, 2.5 * CELL];

const CRUISE = 9;   // units per second
const ACCEL = 1.6;  // units per second²
export const DWELL = { open: 1.6, board: 7, close: 1.6 };
const DWELL_TOTAL = DWELL.open + DWELL.board + DWELL.close;

export type TrainPhase = 'running' | 'opening' | 'boarding' | 'closing';
export interface Train {
  id: number;
  track: 0 | 1;     // 0: eastbound on the north track, 1: westbound on the south track
  x: number;        // centre of the train
  speed: number;
  phase: TrainPhase;
  timer: number;    // seconds into the current dwell
  served: number | null; // station index being served (or last served, so it is not served twice)
  doors: number;    // 0 closed .. 1 fully open
}

export function trackZ(track: 0 | 1) { return LINE_Z + (track === 0 ? -TRACK_OFFSET : TRACK_OFFSET); }
export function direction(track: 0 | 1) { return track === 0 ? 1 : -1; }

export class MetroLine {
  trains: Train[];
  /** passengers boarding/alighting events since the last read, per station (for the platform crowds) */
  events: { station: number; track: 0 | 1; at: number }[] = [];
  constructor(count = 2) {
    this.trains = Array.from({ length: count }, (_, i) => ({
      id: i, track: (i % 2) as 0 | 1, x: (i % 2 ? 1 : -1) * (LINE_END - 40) + (Math.floor(i / 2) * 140) * (i % 2 ? -1 : 1),
      speed: CRUISE, phase: 'running' as TrainPhase, timer: 0, served: null, doors: 0,
    }));
  }

  /** The next station ahead of a train, and the distance to its stopping point. */
  nextStation(t: Train): { index: number; dist: number } | null {
    const d = direction(t.track);
    let best: { index: number; dist: number } | null = null;
    STATIONS.forEach((sx, index) => {
      const dist = (sx - t.x) * d;
      if (dist < -0.05 || index === t.served) return;
      if (!best || dist < best.dist) best = { index, dist };
    });
    return best;
  }

  step(dt: number, time = 0) {
    for (const t of this.trains) {
      if (t.phase !== 'running') {
        t.timer += dt;
        if (t.phase === 'opening') { t.doors = Math.min(1, t.timer / DWELL.open); if (t.timer >= DWELL.open) { t.phase = 'boarding'; t.timer = 0; this.events.push({ station: t.served!, track: t.track, at: time }); } }
        else if (t.phase === 'boarding') { if (t.timer >= DWELL.board) { t.phase = 'closing'; t.timer = 0; } }
        else if (t.phase === 'closing') { t.doors = Math.max(0, 1 - t.timer / DWELL.close); if (t.timer >= DWELL.close) { t.phase = 'running'; t.timer = 0; t.doors = 0; } }
        continue;
      }
      const next = this.nextStation(t);
      let target = CRUISE;
      if (next) target = Math.min(CRUISE, Math.sqrt(2 * ACCEL * Math.max(0, next.dist)));
      t.speed += Math.max(-ACCEL * 1.5 * dt, Math.min(ACCEL * dt, target - t.speed));
      if (next && next.dist < 0.06 && t.speed < 0.5) {
        // stopped at the platform
        t.x = STATIONS[next.index]; t.speed = 0; t.phase = 'opening'; t.timer = 0; t.served = next.index;
        continue;
      }
      t.speed = Math.max(t.speed, next && next.dist < 0.06 ? 0 : 0.4);
      t.x += t.speed * direction(t.track) * dt;
      // past the far end: cross over and come back on the other track
      if (Math.abs(t.x) > LINE_END) { t.track = (1 - t.track) as 0 | 1; t.x = Math.sign(t.x) * LINE_END; t.served = null; t.speed = CRUISE * 0.6; }
    }
  }
}

export const DWELL_SECONDS = DWELL_TOTAL;
