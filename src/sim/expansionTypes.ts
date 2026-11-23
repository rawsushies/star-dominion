// State of the Grand Expansion: the High Conclave, the Stagnant Ascendancies (Precursors), the
// cosmic threats (Void Devourer, Sentinels) and the Omega Incursion. Plain JSON like the rest of
// GameState. Every field has a safe default (see expansion.ts ensureExpansion), so saves written
// before the expansion load with the systems in their starting state.

export type PrecursorId = 'veil' | 'automata';
export type PrecursorStatus = 'dormant' | 'stirring' | 'awakened' | 'watchful' | 'fallen' | 'absent';

export interface PressureSource { tick: number; label: string; amount: number; empireId: number | null }

export interface PrecursorState {
  id: PrecursorId;
  /** the precursor realm (Empire.kind 'precursor'), or -1 if it could not be placed */
  empireId: number;
  status: PrecursorStatus;
  /** 0..100; at 100 the power awakens */
  pressure: number;
  /** realm -> pressure that realm caused (who the precursor blames) */
  blame: Record<number, number>;
  /** the last pressure changes, newest last (bounded) */
  sources: PressureSource[];
  /** highest warning threshold already announced (0, 50 or 75) */
  warned: number;
  awakenedTick: number | null;
  /** protected systems (the enclave) */
  sacred: number[];
  /** sacred worlds outside the enclave (the Archons' holy sites; empty for Automata Prime) */
  sacredWorlds: number[];
  /** realm -> consecutive months its warships have intruded into protected space */
  intrusion: Record<number, number>;
  /** Automata Prime: realm -> tick by which a technology tribute is due */
  demands: Record<number, number>;
  /** sponsored sovereigns: realm -> since, obligation strikes */
  sponsored: Record<number, { since: number; strikes: number }>;
  /** realm -> tick before which restricted knowledge will not be shared again */
  knowledgeCooldown: Record<number, number>;
  /** realm -> tick before which another tribute brings no further calm */
  tributeCooldown: Record<number, number>;
  /** tick before which a precursor-held system cannot be salvaged again (keyed `${empire}:${system}`) */
  salvaged: Record<string, number>;
  /** last tick the awakened power was at war (it returns to watchfulness after a long peace) */
  lastWarTick: number | null;
}

export interface WarInHeavenState {
  active: boolean;
  warId: number | null;
  startTick: number | null;
  /** younger realm -> the side it pledged to */
  pledges: Record<number, PrecursorId>;
  /** realms in the independent coalition: neutral, but they defend one another against either power */
  coalition: number[];
  ended: null | { tick: number; victor: PrecursorId | null; text: string };
}

export type DirectiveKind = 'containment' | 'embargo' | 'naval_accords' | 'ascension_injunction' | 'repeal';
export type InjunctionProject = 'continuum_engine' | 'dyson_swarm' | 'omega_theorem';
export type CosmicTarget = 'omega' | 'devourer';

export interface Resolution {
  kind: DirectiveKind;
  /** containment or embargo: the realm targeted */
  target?: number;
  /** containment against a cosmic threat */
  cosmic?: CosmicTarget;
  /** ascension injunction: the project regulated */
  project?: InjunctionProject;
  /** repeal: the directive repealed */
  directiveId?: number;
}

export type Vote = 'yea' | 'nay' | 'abstain' | 'veto';

export interface ConclaveSession {
  id: number;
  resolution: Resolution;
  proposer: number;
  emergency: boolean;
  opened: number;
  deadline: number;
  /** voting weights, frozen when the session opened */
  weights: Record<number, number>;
  votes: Record<number, Vote>;
  /** AI member -> lean added by lobbying (+ towards yea, - towards nay) */
  lobby: Record<number, number>;
  /** `${lobbier}:${target}` pairs already used this session */
  lobbied: string[];
}

export interface Directive {
  id: number;
  resolution: Resolution;
  enacted: number;
  expires: number;
  /** realms that voted for it (a containment war's coalition) */
  supporters: number[];
  /** members who declared defiance and are not bound by it */
  defiant: number[];
}

export type SeatTier = 'founder' | 'great' | 'sponsored' | 'delegate' | 'observer';

export interface ConclaveRecord {
  id: number;
  resolution: Resolution;
  proposer: number;
  tick: number;
  emergency: boolean;
  result: 'passed' | 'failed' | 'vetoed' | 'withdrawn' | 'no_quorum';
  yea: number;
  nay: number;
  abstain: number;
  vetoedBy?: number;
}

export interface ConclaveState {
  /** tick the Conclave was founded, or null before */
  founded: number | null;
  /** permanent seats */
  founders: number[];
  /** current seats (recomputed monthly outside sessions, and when a session opens) */
  seats: Record<number, SeatTier>;
  /** rotation of the regional delegate seats */
  delegateCursor: number;
  nextRotation: number;
  session: ConclaveSession | null;
  directives: Directive[];
  history: ConclaveRecord[];
  /** no ordinary motion may be tabled before this tick */
  nextOrdinary: number;
  /** `${proposer}:${kind}` -> tick before which the same motion cannot be tabled again */
  motionCooldown: Record<string, number>;
  /** founder -> tick of the last veto */
  vetoUsed: Record<number, number>;
  /** realm -> tick until which its seat is suspended */
  suspended: Record<number, number>;
  /** realm -> ticks of each defiance (recent ones count towards suspension) */
  defiance: Record<number, number[]>;
}

export type SentinelKind = 'gateway' | 'relic_vault' | 'shipyard' | 'archive';
export interface SentinelSite { kind: SentinelKind; claimedBy?: number; tick?: number }

export interface DevourerState {
  /** the cosmic realm that owns the Devourer's fleet */
  empireId: number;
  fleetId: number | null;
  status: 'unborn' | 'roaming' | 'slain' | 'departed';
  /** tick at which it enters the galaxy */
  spawnAt: number;
  /** tick of its next move, and the system it will move to (announced in advance) */
  nextMoveTick: number;
  target: number | null;
  /** systems it fed on: systemId -> tick the scar fades */
  scars: Record<number, number>;
  /** systems visited, newest last (bounded) */
  trail: number[];
  fed: number;
  /** consecutive moves without feeding */
  hungry: number;
  bornTick: number | null;
  slainBy: number | null;
  endTick: number | null;
}

export type OmegaStage = 'dormant' | 'anomalies' | 'warnings' | 'rift' | 'incursion' | 'resolved';
export type OmegaResolution = 'sealed' | 'destroyed' | 'exploited' | 'consumed';

export interface OmegaState {
  stage: OmegaStage;
  /** the cosmic realm that owns the incursion's fleets */
  empireId: number;
  trigger: null | { empireId: number; cause: 'theorem' | 'engine'; tick: number };
  stageTick: number;
  rift: number | null;
  /** 0..100: the rift's integrity; sieges wear it down */
  integrity: number;
  /** escalation: grows every month of the incursion */
  strength: number;
  /** systemId -> tick corrupted */
  corrupted: Record<number, number>;
  /** colony planetId -> months corrupted with no defender */
  neglect: Record<number, number>;
  nextWave: number;
  /** the sealing project, if one is under way */
  project: null | { empireId: number; progress: number; total: number };
  resolution: null | { kind: OmegaResolution; empireId: number | null; tick: number };
  /** systemId -> tick its recovery completes */
  recovery: Record<number, number>;
  /** realm -> crisis credit (fleets at the rift, contributions) */
  credit: Record<number, number>;
  /** realms whose intelligence contribution reveals the fronts to every member, -> tick it lapses */
  intel: Record<number, number>;
  /** tick until which a containment lattice slows the spread */
  lattice: number;
  /** fractional systems of corruption owed (spread accumulates month by month) */
  spread: number;
  losses: { colonies: number; systems: number };
  /** realm that bound the rift (the exploit choice), and when its backlash may strike */
  exploiter: number | null;
  /** how many times the rift has reopened */
  reopened: number;
}

export interface Boon { key: string; value: number; label: string }

// ------------------------------------------------------------------ emergent politics (sim/politics.ts)

/**
 * compact:   an open league of realms against a common foe (an ancient power or a younger realm):
 *            members come to one another's aid against it and do not plan war on one another.
 * collusion: a secret pact between a younger realm and an ancient power against another realm.
 * concord:   a crisis truce: realms threatened by a cosmic crisis set their wars aside until it ends.
 * accord:    an understanding between the two ancient powers (a truce, or an alliance).
 */
export type PactKind = 'compact' | 'collusion' | 'concord' | 'accord';

export interface Pact {
  id: number;
  kind: PactKind;
  members: number[];
  /** the realm the pact is aimed at (compact, collusion) */
  target: number | null;
  crisis?: 'omega' | 'devourer';
  /** accord: a truce or a full alliance between the ancients */
  depth?: 'truce' | 'alliance';
  secret: boolean;
  /** realms that know of a secret pact (its members always do) */
  knownBy: number[];
  founded: number;
  /** member -> was it at war with the target last month (to notice a separate peace) */
  fighting: Record<number, boolean>;
  /** 0..100: conflicting interests build strain; at 100 the pact fractures */
  strain: number;
  reason: string;
}

export type OfferKind =
  | 'alliance' // an ancient power and a younger realm: a full alliance
  | 'protection' // an ancient power shelters a younger realm (a mutual defence pact)
  | 'gift' // an ancient power hands a younger realm an exclusive technology
  | 'submission' // the ancient power submits to the younger realm as its vassal
  | 'clientage' // the younger realm becomes the ancient power's vassal and military partner
  | 'compact' | 'collusion' | 'concord' | 'accord';

export interface PoliticalOffer {
  id: number;
  kind: OfferKind;
  from: number;
  to: number;
  target: number | null;
  crisis?: 'omega' | 'devourer';
  tick: number;
  expires: number;
  /** why the proposer makes it (its own reckoning, shown to the recipient) */
  motives: [string, number][];
  text: string;
}

/** How an ancient power regards a younger realm, each 0..100. */
export interface Regard { respect: number; fear: number; admiration: number }

export type AgendaPriority = 'survival' | 'containment' | 'conquest' | 'ascension' | 'prosperity' | 'expansion' | 'preservation' | 'dominion';

/** A great realm's motives as they stand this month. */
export interface Agenda {
  priority: AgendaPriority;
  /** what it wants, strongest first */
  interests: { label: string; weight: number }[];
  /** whom it fears, strongest first */
  fears: { id: number; weight: number; why: string }[];
  /** realms it is bound to (allies, pact partners, sponsor, overlord) */
  loyalties: number[];
  /** the realm it regards as its rival, if any */
  rival: number | null;
  /** how it would end the Omega Incursion */
  vision: 'seal' | 'destroy' | 'exploit';
  since: number;
}

export interface PoliticalRecord { id: number; tick: number; kind: string; title: string; text: string; actors: number[] }

export interface PoliticsState {
  pacts: Pact[];
  offers: PoliticalOffer[];
  /** `${precursorId}:${realm}` -> regard */
  regard: Record<string, Regard>;
  agendas: Record<number, Agenda>;
  /** the history of the galaxy's politics, newest last (bounded) */
  history: PoliticalRecord[];
  /** `${actor}:${kind}:${other}` -> tick before which the same overture is not repeated */
  cooldown: Record<string, number>;
  /** the realm leading the struggle against the Omega Incursion, and its claim's rival */
  warden: number | null;
  claimant: number | null;
  /** last tick the player was told a realm's priorities changed: realm -> tick */
  noticed: Record<number, number>;
}

export interface ExpansionState {
  version: 1;
  precursors: PrecursorState[];
  heaven: WarInHeavenState;
  conclave: ConclaveState;
  devourer: DevourerState;
  /** guardian lair systemId -> what the Sentinels guard */
  sentinels: Record<number, SentinelSite>;
  omega: OmegaState;
  /** galactic reputation, -100..100 */
  reputation: Record<number, number>;
  /** permanent rewards entering the modifier system: realm -> boons */
  boons: Record<number, Boon[]>;
  /** emergent diplomacy: pacts, overtures, the ancients' regard, motives and political history */
  politics: PoliticsState;
}
