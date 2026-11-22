// Structured, JSON-serialisable game state. No Maps/Sets/classes: the whole
// GameState can be saved with JSON.stringify and restored verbatim.

import type { RngState } from './rng';

export const RESOURCES = [
  'credits', 'minerals', 'energy', 'food', 'alloys',
  'electronics', 'components', 'rare', 'influence',
] as const;
export type ResId = (typeof RESOURCES)[number];
export type Stock = Record<ResId, number>;
export type Cost = Partial<Record<ResId, number>>;

export type PlanetType =
  | 'temperate' | 'ocean' | 'jungle' | 'desert' | 'arid' | 'tundra' | 'frozen'
  | 'volcanic' | 'toxic' | 'barren' | 'gas_giant' | 'gaia';

export type Climate = 'wet' | 'dry' | 'cold';

export type StarType = 'yellow' | 'orange' | 'red' | 'white' | 'blue' | 'neutron' | 'black_hole';

export type SystemFeature =
  | 'ancient_ruins' | 'jump_nexus' | 'rare_cluster' | 'nebula' | 'derelict' | 'pulsar' | 'guardian';

export type BuildingId =
  | 'capital' | 'residential' | 'agri' | 'mining' | 'power' | 'refinery' | 'electronics_fab'
  | 'component_works' | 'rare_extractor' | 'research_lab' | 'spaceport' | 'shipyard'
  | 'orbital_defense' | 'planetary_shield' | 'garrison' | 'admin_center' | 'commerce_hub'
  | 'storage_depot' | 'entertainment' | 'hydroponics' | 'fusion_plant' | 'arcology';

export type ShipClass =
  | 'scout' | 'corvette' | 'frigate' | 'destroyer' | 'cruiser' | 'battlecruiser'
  | 'battleship' | 'carrier' | 'dreadnought' | 'logistics' | 'transport'
  | 'constructor' | 'colony';

export type GovernmentId = 'monarchy' | 'republic' | 'junta' | 'technocracy' | 'corporate' | 'feudal';

export type StationKind = 'mining' | 'energy' | 'research' | 'gas';
export type OpMode = 'standard' | 'surge' | 'sustain' | 'halted';
/** A controllable resource operation on an uncolonised body (sim/operations.ts). */
export interface ResourceOp { level: number; mode: OpMode; reserve: number; founded: number }

export interface Deposits { minerals: number; energy: number; food: number; rare: number; research: number }

export interface ConstructionItem {
  kind: 'building' | 'ship';
  id: BuildingId | ShipClass;
  progress: number; // days elapsed
  total: number; // days required
  paid: boolean; // cost is deducted when work begins
  targetFleetId?: number | null;
  demolish?: boolean;
}

export interface Colony {
  ownerId: number;
  pops: number;
  buildings: Partial<Record<BuildingId, number>>;
  queue: ConstructionItem[];
  shipQueue: ConstructionItem[];
  stability: number;
  resistance: number; // occupation resistance 0..100
  originalOwnerId: number | null; // set when conquered
  foundedTick: number;
  lowStabilityMonths: number;
  defenseDamage: number; // 0..1 fraction of orbital defences currently destroyed
  /** province role (absent = balanced); set with the setDesignation command */
  designation?: import('./data/designations').DesignationId;
  designationTick?: number;
  shieldDown?: number; // 0..1 fraction of battery shields depleted
  // Cached last-month figures for UI (written by the economy step)
  lastJobs?: number;
  lastHousing?: number;
}

export interface Planet {
  id: number;
  systemId: number;
  name: string;
  type: PlanetType;
  size: number; // district capacity
  orbit: number; // visual orbit index
  moonOf: number | null;
  deposits: Deposits;
  colony: Colony | null;
  station: StationKind | null; // orbital extractor on an uncolonised body
  /** level, mode and reserve of the station's operation */
  op?: ResourceOp;
  colonizing: { empireId: number; progress: number; total: number } | null;
}

export interface MegaInstance {
  id: string; // megastructure def id
  ownerId: number;
  stage: number; // completed stages
  progress: number; // days into current stage
  building: boolean;
}

export interface StarSystem {
  id: number;
  name: string;
  x: number;
  y: number;
  star: StarType;
  planetIds: number[];
  asteroidBelts: number;
  /** galactic sector index (see galaxy.ts) */
  sector?: number;
  /** height above/below the galactic plane (absent in pre-3D saves = 0) */
  z?: number;
  /** planets generated (lazy galaxies); absent in eager galaxies and older saves */
  bodiesReady?: boolean;
  owner: number | null;
  starbase: number; // 0 none, 1 outpost, 2 starport, 3 citadel
  starbaseDamage: number; // 0..1
  starbaseShieldDown?: number; // 0..1 fraction of shields depleted
  features: SystemFeature[];
  megastructures: MegaInstance[];
  outpostProject: { empireId: number; progress: number; total: number } | null;
  starbaseUpgrade: { progress: number; total: number } | null;
  ruinsSurveyed: boolean;
}

export interface Sector { id: number; name: string; x: number; y: number; z: number; systems: number }

export interface Galaxy {
  width: number;
  height: number;
  systems: StarSystem[];
  lanes: [number, number][];
  /** named galactic sectors (navigation and province grouping) */
  sectors?: Sector[];
  /** planets are generated on first exploration (large galaxies) */
  lazyBodies?: boolean;
  /** parameters the renderer needs to reproduce the visual starfield */
  shape?: { R: number; barAngle: number; seed: number };
  /** real stars each simulated system stands for (aggregate model; default 1) */
  starsPerSystem?: number;
}

export interface Ship {
  id: number;
  cls: ShipClass;
  hull: number;
  armor: number;
  shields: number;
  xp: number;
}

export type FleetOrder =
  | { type: 'idle' }
  | { type: 'move'; target: number }
  | { type: 'patrol'; a: number; b: number; leg: 0 | 1 }
  | { type: 'invade'; planetId: number }
  | { type: 'colonize'; planetId: number }
  | { type: 'outpost'; systemId: number }
  | { type: 'blockade'; systemId: number };

export interface Fleet {
  id: number;
  ownerId: number;
  name: string;
  systemId: number;
  path: number[]; // remaining system ids to travel through (next hop first)
  progress: number; // distance travelled toward path[0]
  ships: Ship[];
  admiralId: number | null;
  stance: 'aggressive' | 'defensive' | 'passive';
  order: FleetOrder;
  supply: number; // 0..100
  troops: number; // embarked troops (transports)
  retreatCooldown: number;
}

export type CharAssignment =
  | { kind: 'fleet'; fleetId: number }
  | { kind: 'province'; sectorId: number }
  | { kind: 'planet'; planetId: number }
  | { kind: 'envoy'; empireId: number }
  | { kind: 'council'; seat: string };

/** A notable person of a realm: commander, governor, scholar, envoy or agent. */
export interface Character {
  id: number;
  /** realm the character serves (or, for a candidate, the realm they may join) */
  ownerId: number;
  /** realm the character was born to */
  originId: number;
  name: string;
  role: import('./data/characters').CharRole;
  level: number;
  xp: number;
  skillPoints: number;
  skills: Record<string, number>;
  attrs: Record<import('./data/characters').Attr, number>;
  traits: string[];
  loyalty: number;
  ambition: { kind: import('./data/characters').AmbitionKind; unmetMonths: number };
  status: 'candidate' | 'active' | 'captive' | 'dead' | 'retired';
  /** realm holding a captive */
  captorId?: number | null;
  capturedTick?: number;
  assignment: CharAssignment | null;
  equipment: Partial<Record<import('./data/characters').EquipSlot, string>>;
  born: number;
  /** great house (governance) */
  houseId?: number | null;
  bio: { tick: number; text: string }[];
  /** stats for the record */
  record: { battlesWon: number; battlesLost: number; worldsTaken: number; monthsServed: number };
}

/** Imperial capital city (sim/capital.ts). */
export interface CapitalBuilding { level: number; plot: number }
export interface CapitalJob { building: string; toLevel: number; plot: number; progress: number; total: number }
export interface CapitalState {
  buildings: Record<string, CapitalBuilding>;
  queue: CapitalJob[];
}

export interface ActiveDecree { id: string; until: number; strength: number }
export interface Petition { id: number; def: string; houseId: number | null; memberId: number | null; sectorId: number | null; tick: number; expires: number; /** event chains: the world the matter concerns */ planetId?: number | null }

/** A noble house of the realm (sim/governance.ts). */
export interface GreatHouse {
  id: number;
  name: string;
  motto: string;
  color: string;
  /** influence at court and in the provinces, 0..100 */
  power: number;
  /** loyalty to the crown, 0..100 */
  loyalty: number;
  /** what the house wants */
  ambition: 'seat' | 'war' | 'low_taxes' | 'province' | 'wealth' | 'piety';
  /** months the current ambition has been ignored */
  grievance: number;
  /** provinces (sectors) where the house holds land */
  provinces: number[];
  /** tick until which the house is in open revolt (0 = at peace) */
  revoltUntil: number;
}

/** @deprecated pre-character saves stored admirals separately; migrated on load. */
export interface LegacyAdmiral {
  id: number;
  ownerId: number;
  name: string;
  skill: number;
  xp: number;
  trait: 'tactician' | 'aggressive' | 'logistician' | 'cautious' | 'gunner';
  fleetId: number | null;
  alive: boolean;
}

export type CovertKind = 'gather_intel' | 'steal_tech' | 'sabotage' | 'incite_unrest';
export interface CovertOp { id: number; ownerId: number; targetId: number; kind: CovertKind; agentId: number; planetId: number | null; progress: number; total: number; started: number }

export interface TimedModifier { key: string; value: number; until: number; label: string }

export interface Personality {
  aggression: number; // 0..1
  expansion: number;
  mercantile: number;
  science: number;
  diplomacy: number; // willingness to sign treaties
  doctrine: 'swarm' | 'line' | 'carrier' | 'balanced';
}

export interface Empire {
  id: number;
  name: string;
  adjective: string;
  color: string;
  isPlayer: boolean;
  kind: 'major' | 'minor' | 'guardian' | 'raiders' | 'rebels';
  alive: boolean;
  capitalPlanetId: number | null;
  capitalSystemId: number | null;
  climate: Climate;
  government: GovernmentId;
  governmentChangedTick: number;
  policies: Record<string, string>;
  stock: Stock;
  research: { current: string | null; progress: number; queue: string[]; done: string[]; /** levels of repeatable future studies */ future?: number };
  explored: number[]; // system ids
  personality: Personality;
  timedMods: TimedModifier[];
  warExhaustion: number; // 0..100
  emblem: number; // emblem variant index
  ruler: string;
  /** tick the sovereign was born (succession.ts) */
  rulerBorn?: number;
  /** named heir (a character id), or null */
  heirId?: number | null;
  reignStart?: number;
  /** intelligence networks planted in rival realms: target empire id -> tick the network lapses */
  intelNetworks?: Record<number, number>;
  /** royal council: seat id -> character id */
  council?: Record<string, number | null>;
  /** commissioned or found equipment not yet worn */
  armory?: string[];
  /** imperial capital city */
  capital?: CapitalState;
  /** great houses of the realm */
  houses?: GreatHouse[];
  /** royal decrees in force */
  decrees?: ActiveDecree[];
  /** decree id -> tick from which it may be issued again */
  decreeCooldowns?: Record<string, number>;
  /** matters awaiting the council's decision */
  petitions?: Petition[];
  /** civilisational era index (see data/eras.ts) */
  era: number;
  aiNextTick: number;
  /** ambitions fulfilled (sim/ambitions.ts) */
  ambitions?: string[];
  /** wars ended on favourable terms */
  warsWon?: number;
  /** event-chain stages scheduled to come before the council (sim/chains.ts) */
  pendingChains?: { def: string; at: number; planetId: number | null }[];
  /** chain root id -> tick before which it cannot start again */
  chainCooldowns?: Record<string, number>;
  /** AI realms: the current strategic goal (sim/strategy.ts) */
  aiPlan?: AIPlan;
  /** tick from which the realm has met the domination thresholds (sim/victory.ts) */
  dominationSince?: number | null;
  /** victories this realm has been announced as nearing */
  victoryWarned?: string[];
  stats: EmpireStats; // cached each month for UI/AI
}

export type AIGoal = 'expand' | 'develop' | 'arm' | 'war' | 'recover' | 'ascend';
export interface AIPlan {
  goal: AIGoal;
  /** tick the goal was adopted */
  since: number;
  /** rival the realm is arming against or fighting */
  target: number | null;
  /** tick of the next strategic review */
  review: number;
  /** most systems held (to notice heavy losses) */
  peakSystems: number;
  /** troops the current invasion target needs (set by fleet operations) */
  troopsWanted?: number;
}

export interface EmpireStats {
  population: number;
  colonies: number;
  systems: number;
  militaryPower: number;
  economyScore: number;
  industry: number;
  research: number;
  navalUsed: number;
  navalCap: number;
  adminCap: number;
  avgStability: number;
  kardashev?: number;
  /** usable power in watts (sim/power.ts) */
  powerW?: number;
}

export type TreatyType = 'nap' | 'trade' | 'research' | 'defense' | 'alliance' | 'vassal';

export interface Treaty {
  type: TreatyType;
  a: number;
  b: number; // for vassal: a = overlord, b = vassal
  since: number;
}

export interface OpinionMemory { key: string; value: number; decayPerMonth: number; label: string }

export interface War {
  id: number;
  attackers: number[];
  defenders: number[];
  startTick: number;
  score: number; // positive favours attackers (-100..100)
  name: string;
}

export interface Tribute { from: number; to: number; perMonth: number; until: number }

export type DealItem =
  | { kind: 'credits'; amount: number }
  | { kind: 'resource'; res: ResId; amount: number }
  | { kind: 'system'; systemId: number }
  | { kind: 'treaty'; treaty: TreatyType };

export interface Proposal {
  id: number;
  from: number;
  to: number;
  give: DealItem[]; // items `from` gives
  receive: DealItem[]; // items `from` receives
  tick: number;
  kind: 'deal' | 'peace';
  peaceTerm?: PeaceTerm;
  warId?: number;
}

export type PeaceTerm = 'status_quo' | 'tribute' | 'vassalize' | 'cede';

export interface TradeDeal { id: number; a: number; b: number; aGives: Cost; bGives: Cost; until: number }

export interface ChronicleStat { id: number; k: number; pop: number; systems: number; colonies: number; military: number; citadel: number; era: number; alive: boolean }
export interface ChronicleYear { tick: number; stats: ChronicleStat[]; headlines: { tick: number; title: string; kind: string; empires: number[] }[] }

export interface GameEvent {
  id: number;
  tick: number;
  kind: string;
  severity: 'info' | 'good' | 'warn' | 'danger';
  title: string;
  text: string;
  empires: number[]; // who receives it; empty = everyone
  systemId?: number;
  planetId?: number;
  battleId?: number;
}

export interface BattleShipSnap { id: number; cls: ShipClass; side: 0 | 1; owner: number; hp: number[] } // hp fraction per round
export interface BattleShot { r: number; from: number; to: number; dmg: number }

export interface BattleReport {
  id: number;
  tick: number;
  systemId: number;
  sides: [number[], number[]];
  ships: BattleShipSnap[];
  shots: BattleShot[];
  rounds: number;
  losses: [number, number]; // resource value lost
  shipsLost: [number, number];
  winner: 0 | 1 | -1;
  ongoing: boolean;
}

export interface Market { price: Record<ResId, number>; volume: Record<ResId, number> }

export interface GameSettings {
  seed: number;
  galaxySize: 'small' | 'medium' | 'large' | 'milky';
  aiCount: number;
  playerName: string;
  playerGovernment: GovernmentId;
  playerClimate: Climate;
  difficulty: 'relaxed' | 'standard' | 'hard';
}

export interface GameState {
  version: number;
  settings: GameSettings;
  tick: number;
  rng: RngState;
  galaxy: Galaxy;
  planets: Planet[];
  empires: Empire[];
  fleets: Record<string, Fleet>;
  characters: Character[];
  opinions: Record<string, OpinionMemory[]>; // key "a>b" = how a feels about b
  treaties: Treaty[];
  wars: War[];
  truces: { a: number; b: number; until: number }[];
  tributes: Tribute[];
  tradeDeals: TradeDeal[];
  proposals: Proposal[];
  events: GameEvent[];
  /** yearly record of every sovereign realm's standing and the year's headlines (sim/chronicle.ts) */
  chronicle?: ChronicleYear[];
  /** covert operations in progress (sim/espionage.ts); absent until the first is launched */
  covert?: CovertOp[];
  battles: BattleReport[];
  market: Market;
  nextId: number;
  patrolled: Record<string, number>; // `${empire}:${system}` -> tick last patrolled
  disruptedRoutes: Record<string, number>; // colony planet id -> tick disrupted (for event dedupe)
  playerId: number;
  gameOver: null | { won: boolean; reason: string; kind?: 'domination' | 'supremacy' | 'ascension'; winner?: number };
  /** @deprecated legacy guided first-reign progress; migrated to `guidance` on load */
  tutorial?: { step: number; base: { explored: number; buildings: number; ships: number } } | null;
  /** tutorial lessons, first-visit cards and hint snoozes (UI only, never read by the simulation) */
  guidance?: GuidanceState;
}

/** Player guidance progress, saved with the game (src/guidance). */
export interface GuidanceState {
  /** lesson (chapter) in progress, or null */
  active: string | null;
  step: number;
  /** the lesson panel is collapsed to a pill */
  paused: boolean;
  /** lessons finished, and lessons the player skipped */
  done: string[];
  skipped: string[];
  /** lessons offered to the player as the next recommended one (shown once) */
  offered: string[];
  /** first-visit cards already shown (screen ids, mechanic ids) */
  seen: string[];
  /** hint id -> tick until which it stays quiet */
  snoozed: Record<string, number>;
  /** counters captured when the current step began (objectives compare against them) */
  base: Record<string, number>;
}
