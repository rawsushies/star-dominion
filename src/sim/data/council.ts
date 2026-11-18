// Royal council seats. Each seat is filled by a character of a fitting role;
// the holder's attributes, skills, traits and loyalty decide the effect.

import type { Attr, CharRole } from './characters';

export interface SeatDef {
  id: string;
  label: string;
  roles: CharRole[];
  /** empire modifier keys gained per point of the listed attribute */
  perAttr: { attr: Attr; key: string; per: number }[];
  description: string;
}

export const COUNCIL_SEATS: SeatDef[] = [
  { id: 'chancellor', label: 'Chancellor of the Treasury', roles: ['chancellor', 'governor'], perAttr: [{ attr: 'stewardship', key: 'tax', per: 0.012 }, { attr: 'diplomacy', key: 'output.influence', per: 0.01 }], description: 'Taxes, the court and the royal purse.' },
  { id: 'marshal', label: 'Grand Marshal', roles: ['admiral', 'general'], perAttr: [{ attr: 'command', key: 'navalCap', per: 0.5 }, { attr: 'martial', key: 'garrison', per: 0.02 }], description: 'Naval capacity and planetary garrisons.' },
  { id: 'steward', label: 'High Steward of Industry', roles: ['industrialist', 'governor'], perAttr: [{ attr: 'stewardship', key: 'buildSpeed', per: 0.015 }, { attr: 'science', key: 'output.alloys', per: 0.008 }], description: 'Construction and the forges of the realm.' },
  { id: 'archscholar', label: 'Archscholar', roles: ['scientist'], perAttr: [{ attr: 'science', key: 'output.research', per: 0.012 }], description: 'Leads the research directorate.' },
  { id: 'envoy_general', label: 'Envoy-General', roles: ['diplomat', 'chancellor'], perAttr: [{ attr: 'diplomacy', key: 'output.influence', per: 0.015 }, { attr: 'cunning', key: 'intel', per: 1 }], description: 'Foreign affairs and the diplomatic corps.' },
  { id: 'spymaster', label: 'Spymaster', roles: ['spymaster'], perAttr: [{ attr: 'cunning', key: 'intel', per: 2 }, { attr: 'cunning', key: 'stability', per: 0.2 }], description: 'Intelligence, and the watch against plots at court.' },
];
export const SEAT_BY_ID: Record<string, SeatDef> = Object.fromEntries(COUNCIL_SEATS.map((x) => [x.id, x]));
