import type { Climate, GovernmentId, Personality } from '../types';

export const STAR_NAMES = [
  'Aurelis', 'Vantor', 'Kestrel', 'Myrrha', 'Ostrava', 'Calyx', 'Theron', 'Ilvane', 'Sorrow’s Reach', 'Varkhul',
  'Pyrrhos', 'Elysande', 'Corvane', 'Halcyon', 'Drevin', 'Tessaly', 'Nyx Arden', 'Lumenor', 'Brask', 'Quelos',
  'Seraph', 'Ondrel', 'Kairo', 'Velloria', 'Mardun', 'Astrin', 'Yskar', 'Fenwick', 'Galeth', 'Hollis',
  'Isarn', 'Jadeport', 'Kovash', 'Lyrae', 'Morrow', 'Nemeth', 'Orisande', 'Pellucid', 'Rhovan', 'Sabine',
  'Talvar', 'Umbriel', 'Varenne', 'Wyrd', 'Xanthe', 'Ystrid', 'Zephra', 'Achren', 'Belisar', 'Cindral',
  'Dauntless', 'Eirene', 'Falkreth', 'Gorund', 'Hesper', 'Iolan', 'Jorvik', 'Kaelen', 'Lorin', 'Mekhet',
  'Nadir', 'Obsidia', 'Praxis', 'Qadir', 'Rook', 'Selene', 'Tarsis', 'Ulthar', 'Vigil', 'Wrenfall',
  'Xerath', 'Yarrow', 'Zenith', 'Arcturon', 'Bellatrix Minor', 'Cassiel', 'Durnhold', 'Ebonreach', 'Fyrdal', 'Glimmer',
  'Hadrian', 'Ixion', 'Jessamy', 'Korvath', 'Laureth', 'Mirelle', 'Noctis', 'Oberon’s Gate', 'Perdita', 'Quillon',
  'Ravenna', 'Sundral', 'Thule', 'Ursine', 'Valgard', 'Wyvern', 'Xylos', 'Yon', 'Zarek', 'Aldmere',
  'Briar', 'Caladrel', 'Dusk', 'Emberfall', 'Farrow', 'Grimsel', 'Harrow', 'Ithil', 'Juniper', 'Kharon',
  'Lantern', 'Malice', 'Nereid', 'Orrin', 'Palisade', 'Quorum', 'Revenant', 'Solace', 'Tamsin', 'Utopos',
  'Verdance', 'Wanderer', 'Xenia', 'Yewen', 'Zorya', 'Amaranth', 'Bastille', 'Cerulean', 'Dagon', 'Erebus',
  'Fathom', 'Gossamer', 'Helix', 'Inkwell', 'Jubal', 'Karst', 'Lethe', 'Meridian', 'Nimbus', 'Ossuary',
];

export const RULER_FIRST = ['Aurel', 'Seraphine', 'Cassius', 'Ilya', 'Theodora', 'Marek', 'Ysolde', 'Corvin', 'Livia', 'Darian', 'Nerys', 'Oren', 'Talia', 'Vesper', 'Kael', 'Mirela', 'Rhun', 'Sabeth'];
export const RULER_LAST = ['Valcourt', 'Drachen', 'Imris', 'Solenne', 'Kavar', 'Oduya', 'Thrane', 'Myrdin', 'Asterhal', 'Bellamy', 'Corsa', 'Venn'];
export const ADMIRAL_NAMES = ['Hale', 'Okonkwo', 'Varga', 'Steel', 'Morrow', 'Ishida', 'Kerensky', 'Laurent', 'Nakamura', 'Petrov', 'Quint', 'Rask', 'Sorel', 'Tamm', 'Ulric', 'Voss', 'Wren', 'Yeats', 'Zhao', 'Abara', 'Brennan', 'Castellan', 'Draven', 'Eskildsen'];

export interface CivTemplate {
  name: string;
  adjective: string;
  color: string;
  government: GovernmentId;
  climate: Climate;
  personality: Personality;
  lore: string;
}

export const CIV_TEMPLATES: CivTemplate[] = [
  {
    name: 'Varkhul Hegemony', adjective: 'Varkhul', color: '#c2453a', government: 'junta', climate: 'dry',
    personality: { aggression: 0.8, expansion: 0.7, mercantile: 0.2, science: 0.3, diplomacy: 0.2, doctrine: 'line' },
    lore: 'Desert-born warlords who measure honour in conquered worlds.',
  },
  {
    name: 'Celestine Concord', adjective: 'Celestine', color: '#3fa7a0', government: 'republic', climate: 'wet',
    personality: { aggression: 0.2, expansion: 0.6, mercantile: 0.7, science: 0.6, diplomacy: 0.8, doctrine: 'balanced' },
    lore: 'An ocean-world republic of traders and philosophers seeking federation.',
  },
  {
    name: 'Ixari Synod', adjective: 'Ixari', color: '#8a6bd1', government: 'technocracy', climate: 'cold',
    personality: { aggression: 0.4, expansion: 0.5, mercantile: 0.3, science: 0.9, diplomacy: 0.5, doctrine: 'carrier' },
    lore: 'Ice-world savants governed by predictive councils and ancient archives.',
  },
  {
    name: 'Orrin Mercantile Compact', adjective: 'Orrin', color: '#d18a2f', government: 'corporate', climate: 'dry',
    personality: { aggression: 0.35, expansion: 0.6, mercantile: 0.95, science: 0.4, diplomacy: 0.7, doctrine: 'swarm' },
    lore: 'Charter houses whose ledgers span a hundred trade routes.',
  },
  {
    name: 'Thule Dominion', adjective: 'Thulean', color: '#4f86c6', government: 'feudal', climate: 'cold',
    personality: { aggression: 0.6, expansion: 0.85, mercantile: 0.3, science: 0.35, diplomacy: 0.4, doctrine: 'line' },
    lore: 'Frost-kings bound by oaths of fealty, hungry for new fiefs.',
  },
  {
    name: 'Sylvane Accord', adjective: 'Sylvane', color: '#5fae5a', government: 'monarchy', climate: 'wet',
    personality: { aggression: 0.3, expansion: 0.5, mercantile: 0.5, science: 0.5, diplomacy: 0.65, doctrine: 'balanced' },
    lore: 'Jungle monarchs who rule through ancestral rites and quiet patience.',
  },
];

export const MINOR_NAMES = ['Free Haven of', 'Principality of', 'Republic of', 'Sovereign Port of', 'Holdfast of'];
