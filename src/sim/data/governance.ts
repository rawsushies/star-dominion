import { CHAIN_STAGES } from './chains';
// Governance content: royal decrees, the noble houses of a realm and the
// matters brought before the royal council. Effects use empire modifier keys
// (see sim/modifiers.ts); values are scaled by the council member named in
// `seat` (see sim/governance.ts).

import type { Attr } from './characters';
import type { GreatHouse } from '../types';

export type HouseAmbition = GreatHouse['ambition'];

export interface DecreeDef {
  id: string;
  label: string;
  description: string;
  /** influence (and optionally other resources) paid when issued */
  cost: Record<string, number>;
  days: number;
  /** cooldown after expiry before it can be issued again */
  cooldown: number;
  mods: Record<string, number>;
  /** council seat whose holder strengthens the decree, and by which attribute */
  seat: string;
  attr: Attr;
  /** opinion change for houses by ambition (applied once, on issue) */
  houses?: Partial<Record<HouseAmbition | 'all', number>>;
  /** only while at war */
  war?: boolean;
}

export const DECREES: DecreeDef[] = [
  { id: 'tax_levy', label: 'Extraordinary levy', description: 'Raises taxes sharply for a year. The nobility resents it.', cost: { influence: 40 }, days: 360, cooldown: 360, mods: { tax: 0.25, stability: -5 }, seat: 'chancellor', attr: 'stewardship', houses: { low_taxes: -20, wealth: -8 } },
  { id: 'tax_relief', label: 'Tax relief', description: 'Lowers taxes for a year to win back the provinces.', cost: { influence: 25 }, days: 360, cooldown: 180, mods: { tax: -0.15, stability: 6 }, seat: 'chancellor', attr: 'diplomacy', houses: { low_taxes: 15, piety: 5 } },
  { id: 'festival', label: 'Royal festival', description: 'Games and feasts across the realm.', cost: { influence: 20, credits: 300 }, days: 180, cooldown: 360, mods: { stability: 8 }, seat: 'chancellor', attr: 'diplomacy', houses: { all: 4, piety: 6 } },
  { id: 'research_grant', label: 'Grand research endowment', description: 'Crown funding for the academies.', cost: { influence: 30, credits: 400 }, days: 360, cooldown: 360, mods: { 'output.research': 0.15 }, seat: 'archscholar', attr: 'science' },
  { id: 'building_programme', label: 'Public works programme', description: 'Builders and engineers are conscripted to the great projects.', cost: { influence: 35 }, days: 360, cooldown: 360, mods: { buildSpeed: 0.25, stability: -2 }, seat: 'steward', attr: 'stewardship', houses: { wealth: 6 } },
  { id: 'forge_quotas', label: 'Forge quotas', description: 'The foundries work in three shifts.', cost: { influence: 30 }, days: 270, cooldown: 270, mods: { 'output.alloys': 0.2, stability: -3 }, seat: 'steward', attr: 'stewardship' },
  { id: 'trade_charter', label: 'Merchant charter', description: 'Monopolies and protections for the trading houses.', cost: { influence: 30 }, days: 360, cooldown: 360, mods: { tradeValue: 0.2 }, seat: 'envoy_general', attr: 'diplomacy', houses: { wealth: 12 } },
  { id: 'conscription', label: 'Conscription', description: 'Every province sends its sons and daughters to the fleet.', cost: { influence: 40 }, days: 360, cooldown: 360, mods: { navalCap: 8, garrison: 0.25, stability: -4 }, seat: 'marshal', attr: 'command', houses: { war: 12, piety: -5 } },
  { id: 'war_footing', label: 'War footing', description: 'The whole realm turns to the war effort.', cost: { influence: 50 }, days: 360, cooldown: 360, mods: { shipDamage: 0.1, repair: 0.25, warExhaustion: -0.25, stability: -3 }, seat: 'marshal', attr: 'martial', houses: { war: 15 }, war: true },
  { id: 'martial_law', label: 'Martial law', description: 'Troops in the streets keep order, at a cost to industry.', cost: { influence: 30 }, days: 180, cooldown: 360, mods: { stability: 14, 'output.minerals': -0.08, 'output.alloys': -0.08, tradeValue: -0.1 }, seat: 'spymaster', attr: 'cunning', houses: { all: -6 } },
  { id: 'census', label: 'Imperial census', description: 'Counting every soul makes the realm easier to rule.', cost: { influence: 25, credits: 150 }, days: 720, cooldown: 360, mods: { admin: 4 }, seat: 'chancellor', attr: 'stewardship' },
  { id: 'informant_network', label: 'Informant network', description: 'Eyes and ears in every court.', cost: { influence: 30 }, days: 360, cooldown: 360, mods: { intel: 20, stability: 3 }, seat: 'spymaster', attr: 'cunning', houses: { all: -3 } },
];
export const DECREE_BY_ID: Record<string, DecreeDef> = Object.fromEntries(DECREES.map((d) => [d.id, d]));
export const MAX_DECREES = 3;

export const HOUSE_AMBITIONS: Record<HouseAmbition, { label: string; want: string }> = {
  seat: { label: 'A seat at court', want: 'Wants one of its members on the royal council.' },
  war: { label: 'Glory in war', want: 'Wants the realm at war, or armed for it.' },
  low_taxes: { label: 'Low taxes', want: 'Wants no extraordinary levy and a treasury that is not squeezing them.' },
  province: { label: 'Land', want: 'Wants one of its members to govern a province.' },
  wealth: { label: 'Wealth', want: 'Wants a rich realm with a full treasury.' },
  piety: { label: 'Order', want: 'Wants a calm, stable realm.' },
};

export const HOUSE_NAMES = ['Varenne', 'Okafor', 'Drachenfels', 'Imrahil', 'Castellane', 'Morrow', 'Aldric', 'Sarnai', 'Valois', 'Kestrel', 'Thorne', 'Ishikawa', 'Belisar', 'Oduya', 'Marchetti', 'Rhosyn', 'Halvorsen', 'Delacroix', 'Zahir', 'Montclair'];
export const HOUSE_MOTTOS = ['We endure', 'Steel and starlight', 'First to the void', 'By ledger and law', 'Our word is iron', 'The long night ends', 'Ever vigilant', 'Fortune favours the bold', 'From ash, a crown', 'Knowledge is dominion', 'We hold the line', 'The stars remember'];
export const HOUSE_COLORS = ['#b8873b', '#4f7fb8', '#8c4f9e', '#3f9e7a', '#b84f4f', '#9e9a4f', '#4f9eb0', '#b06a3a'];

/** A matter brought before the council. Options apply effects to the realm. */
export interface PetitionOption {
  label: string;
  /** resources paid */
  cost?: Record<string, number>;
  /** timed modifiers (days, mods) */
  timed?: { days: number; mods: Record<string, number>; label: string };
  /** opinion of the petitioning house */
  house?: number;
  /** opinion of all houses */
  allHouses?: number;
  /** loyalty change of the council member who brought it */
  member?: number;
  /** resources gained, scaled by the presenting member's attribute */
  gain?: Record<string, number>;
  /** event chains: effects on the world the matter concerns */
  planet?: { pops?: number; stability?: number; resistance?: number };
  /** research progress gained on the current project */
  research?: number;
  /** corsair bands that gather on the realm's border */
  raiders?: number;
  /** opinion of every other great realm */
  reputation?: number;
  /** ships that join the realm at its capital */
  fleet?: import('../types').ShipClass[];
  /** the next stage of the chain, raised after `days` (with `chance`, else the `else` stage if any) */
  next?: { def: string; days: number; chance?: number; else?: string };
}
export interface PetitionDef {
  id: string;
  /** who brings it: a council seat or a house */
  from: 'house' | string;
  title: string;
  text: string;
  options: PetitionOption[];
  attr: Attr;
  /** only if the realm is at war / at peace */
  war?: boolean;
  /** a stage of an event chain (sim/chains.ts), never raised at random */
  chain?: boolean;
}

export const PETITIONS: PetitionDef[] = [
  { id: 'house_land', from: 'house', title: 'A house asks for land', text: 'House {house} asks the crown to confirm its claim on new estates in {province}.', attr: 'diplomacy',
    options: [{ label: 'Confirm the claim', cost: { influence: 15 }, house: 18 }, { label: 'Refuse', house: -14 }] },
  { id: 'house_tax', from: 'house', title: 'Petition for tax relief', text: 'House {house} speaks for the provinces: the levies are ruinous and the harvest poor.', attr: 'stewardship',
    options: [{ label: 'Grant relief for a year', timed: { days: 360, mods: { tax: -0.08 }, label: 'Tax relief for the houses' }, house: 15, allHouses: 3 }, { label: 'The crown needs every credit', house: -12 }] },
  { id: 'house_feud', from: 'house', title: 'A feud between houses', text: 'House {house} accuses a rival of seizing a mining concession. Both demand the crown\'s judgement.', attr: 'diplomacy',
    options: [{ label: 'Rule for House {house}', house: 15, allHouses: -6 }, { label: 'Split the concession', cost: { influence: 10 }, allHouses: 4 }, { label: 'Seize it for the crown', gain: { minerals: 150 }, allHouses: -8 }] },
  { id: 'chancellor_bonds', from: 'chancellor', title: 'The chancellor proposes war bonds', text: '{member} believes the merchant guilds would lend generously against future taxes.', attr: 'stewardship',
    options: [{ label: 'Issue the bonds', gain: { credits: 500 }, timed: { days: 360, mods: { tax: -0.06 }, label: 'Repaying war bonds' }, member: 5 }, { label: 'Decline', member: -3 }] },
  { id: 'archscholar_expedition', from: 'archscholar', title: 'The archscholar requests an expedition', text: '{member} asks for funding to study an anomaly at the edge of known space.', attr: 'science',
    options: [{ label: 'Fund it', cost: { credits: 250 }, timed: { days: 360, mods: { 'output.research': 0.1 }, label: 'Archscholar\'s expedition' }, member: 8 }, { label: 'Not this year', member: -6 }] },
  { id: 'marshal_drills', from: 'marshal', title: 'The marshal wants fleet exercises', text: '{member} warns that the fleet has grown soft and asks for live-fire exercises.', attr: 'command',
    options: [{ label: 'Approve the exercises', cost: { energy: 120, alloys: 60 }, timed: { days: 360, mods: { shipDamage: 0.06, tracking: 0.03 }, label: 'Fleet exercises' }, member: 8 }, { label: 'Refuse', member: -6 }] },
  { id: 'steward_foundry', from: 'steward', title: 'The steward proposes new foundries', text: '{member} has plans for state foundries that would serve the whole realm.', attr: 'stewardship',
    options: [{ label: 'Build them', cost: { minerals: 300, credits: 150 }, timed: { days: 720, mods: { 'output.alloys': 0.1 }, label: 'State foundries' }, member: 6 }, { label: 'Too costly', member: -4 }] },
  { id: 'envoy_gifts', from: 'envoy_general', title: 'The envoy-general asks for gifts', text: '{member} believes lavish gifts to foreign courts would open doors.', attr: 'diplomacy',
    options: [{ label: 'Send the gifts', cost: { credits: 200 }, gain: { influence: 40 }, member: 6 }, { label: 'Refuse', member: -4 }] },
  { id: 'spymaster_plot', from: 'spymaster', title: 'A plot uncovered', text: '{member} has uncovered a conspiracy reaching into House {house}.', attr: 'cunning',
    options: [{ label: 'Arrest the plotters', house: -20, timed: { days: 360, mods: { stability: 5 }, label: 'Plot crushed' }, member: 6 }, { label: 'Pardon them publicly', house: 12, allHouses: 4, timed: { days: 180, mods: { stability: -3 }, label: 'Leniency to traitors' } }, { label: 'Turn them into informants', cost: { influence: 20 }, timed: { days: 720, mods: { intel: 15 }, label: 'Turned conspirators' }, member: 4 }] },
  { id: 'war_weariness', from: 'chancellor', title: 'The people tire of war', text: 'The provinces send word through {member}: the war has gone on too long.', attr: 'diplomacy', war: true,
    options: [{ label: 'Promise victory and pay for it', cost: { credits: 300 }, timed: { days: 180, mods: { stability: 6 }, label: 'Wartime largesse' } }, { label: 'Silence the complainers', allHouses: -5, timed: { days: 180, mods: { stability: -4 }, label: 'Wartime censorship' } }] },
];
export const PETITION_BY_ID: Record<string, PetitionDef> = Object.fromEntries([...PETITIONS, ...CHAIN_STAGES].map((p) => [p.id, p]));
