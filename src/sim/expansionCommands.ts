// Commands of the Grand Expansion, dispatched from execute() (commands.ts). Each validates
// membership, authority, resources, targets and state before changing anything.

import type { Empire, GameState } from './types';
import type { PrecursorId, Resolution, Vote } from './expansionTypes';
import { ancientsAction, type AncientsAction } from './ancients';
import { castVote, complyDirective, defyDirective, lobbyMember, tableMotion, withdrawMotion } from './conclave';
import { contribute, omegaAction, type ContributionKind, type OmegaAction } from './omega';
import { PRECURSOR_IDS } from './data/expansion';

export type ExpansionCommand =
  | { type: 'conclave'; action: 'propose'; resolution: Resolution; emergency?: boolean }
  | { type: 'conclave'; action: 'vote'; vote: Vote }
  | { type: 'conclave'; action: 'lobby'; target: number; toward: 'yea' | 'nay' }
  | { type: 'conclave'; action: 'withdraw' }
  | { type: 'conclave'; action: 'defy' | 'comply'; directiveId: number }
  | { type: 'conclave'; action: 'contribute'; kind: ContributionKind; fleetId?: number }
  | { type: 'ancients'; precursor: PrecursorId; action: AncientsAction; systemId?: number }
  | { type: 'omega'; action: OmegaAction };

export function executeExpansion(state: GameState, e: Empire, cmd: ExpansionCommand): { ok: boolean; message?: string } {
  if (!state.expansion) return { ok: false, message: 'The expansion is not active in this game' };
  const done = (err: string | null | undefined, msg?: string) => (err ? { ok: false, message: err } : { ok: true, message: msg });
  switch (cmd.type) {
    case 'conclave':
      switch (cmd.action) {
        case 'propose': {
          if (!cmd.resolution || typeof cmd.resolution !== 'object') return done('No motion');
          return done(tableMotion(state, e, cmd.resolution, !!cmd.emergency), 'Motion tabled');
        }
        case 'vote': return done(castVote(state, e, cmd.vote), 'Vote cast');
        case 'lobby': return done(cmd.toward === 'yea' || cmd.toward === 'nay' ? lobbyMember(state, e, cmd.target, cmd.toward) : 'Lobby for yea or nay', 'Delegation lobbied');
        case 'withdraw': return done(withdrawMotion(state, e), 'Motion withdrawn');
        case 'defy': return done(defyDirective(state, e, cmd.directiveId), 'Directive defied');
        case 'comply': return done(complyDirective(state, e, cmd.directiveId), 'Compliance restored');
        case 'contribute': return done(contribute(state, e, cmd.kind, cmd.fleetId), 'Contribution made');
      }
      return done('Unknown Conclave action');
    case 'ancients': {
      if (!PRECURSOR_IDS.includes(cmd.precursor)) return done('Unknown power');
      const r = ancientsAction(state, e, cmd.precursor, cmd.action, cmd.systemId);
      return done(r.error, r.message);
    }
    case 'omega': return done(omegaAction(state, e, cmd.action), cmd.action === 'seal' ? 'Sealing begun' : cmd.action === 'breach' ? 'The rift is destroyed' : 'The rift is bound');
  }
  return done('Unknown command');
}
