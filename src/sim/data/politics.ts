// Tuning of the emergent politics layer (sim/politics.ts).

import type { OfferKind, PactKind, AgendaPriority } from '../expansionTypes';
import type { Boon, PrecursorId } from '../expansionTypes';

/** influence the proposer pays when an overture is accepted (the ancients pay nothing) */
export const OFFER_COST: Record<OfferKind, number> = {
  alliance: 40, protection: 30, gift: 0, submission: 20, clientage: 0, compact: 25, collusion: 30, concord: 10, accord: 0,
};

/** days an overture to the player stays open */
export const OFFER_DAYS = 120;
/** days before the same realm makes the same overture to the same partner again */
export const OFFER_COOLDOWN = 360;
/** a proposer's own desire must reach this before it makes an overture */
export const PROPOSE_THRESHOLD = 15;
/** bounded political history */
export const HISTORY_MAX = 240;
/** months a pact member may ignore a call to honour it before the pact casts it out */
export const HONOUR_MONTHS = 3;

export const OFFER_LABEL: Record<OfferKind, string> = {
  alliance: 'Alliance', protection: 'Protection', gift: 'Exclusive knowledge', submission: 'Submission of an ancient power',
  clientage: 'Clientage', compact: 'Compact', collusion: 'Secret collusion', concord: 'Crisis concord', accord: 'Accord of the ancients',
};

export const PACT_LABEL: Record<PactKind, string> = { compact: 'Compact', collusion: 'Collusion', concord: 'Crisis concord', accord: 'Accord of the ancients' };

export const PRIORITY_LABEL: Record<AgendaPriority, string> = {
  survival: 'Survival', containment: 'Containment', conquest: 'Conquest', ascension: 'Ascension', prosperity: 'Prosperity',
  expansion: 'Expansion', preservation: 'Preservation', dominion: 'Dominion',
};

export const PRIORITY_TEXT: Record<AgendaPriority, string> = {
  survival: 'fights for its life and will take help from anyone',
  containment: 'seeks partners against the power it fears',
  conquest: 'means to take land by war',
  ascension: 'pours its wealth into the eras and great works',
  prosperity: 'builds and trades, and avoids entanglements',
  expansion: 'settles every free system in reach',
  preservation: 'guards its enclave and its sacred order',
  dominion: 'means to bend the younger realms to its will',
};

/** the exclusive technology each ancient power can bestow (once per realm) */
export const ANCIENT_GIFTS: Record<PrecursorId, Boon[]> = {
  veil: [{ key: 'shipShields', value: 0.25, label: 'Archon veil-shields' }, { key: 'stability', value: 3, label: 'Archon wardsong' }],
  automata: [{ key: 'buildSpeed', value: 0.12, label: 'Automata fabricators' }, { key: 'repair', value: 0.5, label: 'Automata self-repair lattice' }],
};
