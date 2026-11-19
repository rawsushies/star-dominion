// Character definitions: roles, attributes, traits, skill trees, ambitions,
// equipment and name pools. Characters are the notable people of a realm —
// commanders, governors, scholars, envoys and agents — and replace the old
// admiral list (admirals are characters with the 'admiral' role).

export type CharRole = 'admiral' | 'general' | 'governor' | 'scientist' | 'diplomat' | 'chancellor' | 'industrialist' | 'explorer' | 'spymaster';
export type Attr = 'martial' | 'command' | 'cunning' | 'diplomacy' | 'stewardship' | 'science';
export const ATTRS: Attr[] = ['martial', 'command', 'cunning', 'diplomacy', 'stewardship', 'science'];
export const ATTR_LABEL: Record<Attr, string> = { martial: 'Martial', command: 'Command', cunning: 'Cunning', diplomacy: 'Diplomacy', stewardship: 'Stewardship', science: 'Science' };

export interface RoleDef {
  id: CharRole;
  label: string;
  plural: string;
  /** attributes this role relies on, most important first */
  primary: Attr[];
  /** where the role can serve */
  serves: string;
  description: string;
}

export const ROLES: Record<CharRole, RoleDef> = {
  admiral: { id: 'admiral', label: 'Admiral', plural: 'Admirals', primary: ['command', 'martial', 'cunning'], serves: 'Commands a fleet', description: 'Raises fleet damage, accuracy and evasion; the right admiral turns a close battle.' },
  general: { id: 'general', label: 'General', plural: 'Generals', primary: ['martial', 'command'], serves: 'Leads the troops of a fleet', description: 'Strengthens invasions launched by the fleet they ride with.' },
  governor: { id: 'governor', label: 'Governor', plural: 'Governors', primary: ['stewardship', 'diplomacy'], serves: 'Administers a province (sector)', description: 'Raises output and stability on every colony in their province.' },
  scientist: { id: 'scientist', label: 'Scientist', plural: 'Scientists', primary: ['science', 'cunning'], serves: 'Leads the research directorate', description: 'Speeds research across the realm.' },
  diplomat: { id: 'diplomat', label: 'Diplomat', plural: 'Diplomats', primary: ['diplomacy', 'cunning'], serves: 'Envoy to a foreign court', description: 'Improves a foreign realm\'s opinion of you every month.' },
  chancellor: { id: 'chancellor', label: 'Chancellor', plural: 'Chancellors', primary: ['stewardship', 'diplomacy'], serves: 'Royal council', description: 'Runs the treasury and the court: taxes, influence and administration.' },
  industrialist: { id: 'industrialist', label: 'Industrialist', plural: 'Industrialists', primary: ['stewardship', 'science'], serves: 'Directs industry on a world', description: 'Speeds construction and raises refined output on their world.' },
  explorer: { id: 'explorer', label: 'Explorer', plural: 'Explorers', primary: ['cunning', 'science'], serves: 'Leads a survey fleet', description: 'Extends sensors and speed and finds more in ruins and derelicts.' },
  spymaster: { id: 'spymaster', label: 'Spymaster', plural: 'Spymasters', primary: ['cunning', 'diplomacy'], serves: 'Royal council', description: 'Sharpens intelligence on rivals and guards against plots.' },
};
export const ROLE_ORDER: CharRole[] = ['admiral', 'general', 'governor', 'scientist', 'diplomat', 'chancellor', 'industrialist', 'explorer', 'spymaster'];

export interface TraitDef { id: string; label: string; good: boolean; description: string; attrs?: Partial<Record<Attr, number>>; loyalty?: number; effect?: Record<string, number> }

/** Effects keys used by traits/skills/items (read by sim/characters.ts):
 *  dmg, tracking, evasion, speed, supply, retreat, troops, sensor, discovery,
 *  output, stability, admin, research, opinion, tax, influence, build, intel, xp */
export const TRAITS: TraitDef[] = [
  { id: 'tactician', label: 'Tactician', good: true, description: '+5% fleet evasion.', effect: { evasion: 0.05 } },
  { id: 'aggressive', label: 'Aggressive', good: true, description: '+12% fleet damage, but rarely retreats.', effect: { dmg: 0.12 } },
  { id: 'logistician', label: 'Logistician', good: true, description: '+10% fleet speed, -40% supply drain.', effect: { speed: 0.1, supply: -0.4 } },
  { id: 'cautious', label: 'Cautious', good: true, description: 'Withdraws a losing fleet early and intact.', effect: { retreat: 1 } },
  { id: 'gunner', label: 'Gunnery expert', good: true, description: '+10% fleet damage.', effect: { dmg: 0.1 } },
  { id: 'brilliant', label: 'Brilliant', good: true, description: '+3 Science, +10% research when leading it.', attrs: { science: 3 }, effect: { research: 0.1 } },
  { id: 'just', label: 'Just', good: true, description: '+2 Stewardship, +5 stability where they govern.', attrs: { stewardship: 2 }, effect: { stability: 5 } },
  { id: 'charismatic', label: 'Charismatic', good: true, description: '+3 Diplomacy.', attrs: { diplomacy: 3 } },
  { id: 'loyal', label: 'Loyal', good: true, description: '+20 loyalty.', loyalty: 20 },
  { id: 'industrious', label: 'Industrious', good: true, description: '+10% output where they serve.', effect: { output: 0.1 } },
  { id: 'pathfinder', label: 'Pathfinder', good: true, description: '+1 sensor range and +15% speed on survey fleets.', effect: { sensor: 1, speed: 0.15 } },
  { id: 'iron_willed', label: 'Iron-willed', good: true, description: '+2 Martial, +15% invasion strength.', attrs: { martial: 2 }, effect: { troops: 0.15 } },
  { id: 'schemer', label: 'Schemer', good: true, description: '+3 Cunning, -10 loyalty.', attrs: { cunning: 3 }, loyalty: -10 },
  { id: 'ambitious', label: 'Ambitious', good: false, description: '+15% experience, -15 loyalty.', effect: { xp: 0.15 }, loyalty: -15 },
  { id: 'greedy', label: 'Greedy', good: false, description: 'Demands double pay, -10 loyalty when unpaid.', loyalty: -5 },
  { id: 'reckless', label: 'Reckless', good: false, description: '+8% damage, -8% evasion.', effect: { dmg: 0.08, evasion: -0.08 } },
  { id: 'lazy', label: 'Indolent', good: false, description: '-10% output where they serve.', effect: { output: -0.1 } },
  { id: 'disgraced', label: 'Disgraced', good: false, description: 'Once captured in battle. -5 loyalty.', loyalty: -5 },
];
export const TRAIT_BY_ID: Record<string, TraitDef> = Object.fromEntries(TRAITS.map((t) => [t.id, t]));
export const ADMIRAL_TRAITS = ['tactician', 'aggressive', 'logistician', 'cautious', 'gunner'];

export interface SkillDef { id: string; role: CharRole; label: string; tier: 1 | 2 | 3; requires?: string; maxRank: number; perRank: Record<string, number>; description: string }

export const SKILLS: SkillDef[] = [
  // admiral
  { id: 'adm_gunnery', role: 'admiral', label: 'Fire control', tier: 1, maxRank: 3, perRank: { dmg: 0.05 }, description: '+5% fleet damage per rank.' },
  { id: 'adm_screens', role: 'admiral', label: 'Screening doctrine', tier: 1, maxRank: 3, perRank: { evasion: 0.03 }, description: '+3% evasion per rank.' },
  { id: 'adm_targeting', role: 'admiral', label: 'Predictive targeting', tier: 2, requires: 'adm_gunnery', maxRank: 2, perRank: { tracking: 0.05 }, description: '+5% accuracy per rank.' },
  { id: 'adm_logistics', role: 'admiral', label: 'Fleet logistics', tier: 2, requires: 'adm_screens', maxRank: 2, perRank: { speed: 0.06, supply: -0.15 }, description: '+6% speed and -15% supply drain per rank.' },
  { id: 'adm_grand', role: 'admiral', label: 'Grand strategy', tier: 3, requires: 'adm_targeting', maxRank: 1, perRank: { dmg: 0.1, evasion: 0.05 }, description: '+10% damage and +5% evasion.' },
  // general
  { id: 'gen_assault', role: 'general', label: 'Assault drills', tier: 1, maxRank: 3, perRank: { troops: 0.08 }, description: '+8% invasion strength per rank.' },
  { id: 'gen_siege', role: 'general', label: 'Siegecraft', tier: 2, requires: 'gen_assault', maxRank: 2, perRank: { troops: 0.1 }, description: '+10% invasion strength per rank.' },
  { id: 'gen_occupation', role: 'general', label: 'Occupation law', tier: 3, requires: 'gen_siege', maxRank: 1, perRank: { troops: 0.15, stability: 3 }, description: '+15% invasion strength; conquered worlds settle faster.' },
  // governor
  { id: 'gov_admin', role: 'governor', label: 'Provincial administration', tier: 1, maxRank: 3, perRank: { admin: 1 }, description: '+1 administrative capacity per rank.' },
  { id: 'gov_agrarian', role: 'governor', label: 'Agrarian reform', tier: 1, maxRank: 2, perRank: { output: 0.04 }, description: '+4% output in the province per rank.' },
  { id: 'gov_order', role: 'governor', label: 'Public order', tier: 2, requires: 'gov_admin', maxRank: 2, perRank: { stability: 3 }, description: '+3 stability in the province per rank.' },
  { id: 'gov_prosperity', role: 'governor', label: 'Provincial prosperity', tier: 3, requires: 'gov_agrarian', maxRank: 1, perRank: { output: 0.1 }, description: '+10% output in the province.' },
  // scientist
  { id: 'sci_theory', role: 'scientist', label: 'Theoretical rigour', tier: 1, maxRank: 3, perRank: { research: 0.04 }, description: '+4% research per rank.' },
  { id: 'sci_applied', role: 'scientist', label: 'Applied engineering', tier: 2, requires: 'sci_theory', maxRank: 2, perRank: { research: 0.05 }, description: '+5% research per rank.' },
  { id: 'sci_genius', role: 'scientist', label: 'Paradigm shift', tier: 3, requires: 'sci_applied', maxRank: 1, perRank: { research: 0.12 }, description: '+12% research.' },
  // diplomat
  { id: 'dip_courtesy', role: 'diplomat', label: 'Court etiquette', tier: 1, maxRank: 3, perRank: { opinion: 1 }, description: '+1 monthly opinion with the host court per rank.' },
  { id: 'dip_networks', role: 'diplomat', label: 'Informant networks', tier: 2, requires: 'dip_courtesy', maxRank: 2, perRank: { intel: 10 }, description: '+10 intelligence on the host realm per rank.' },
  { id: 'dip_treaties', role: 'diplomat', label: 'Treaty craft', tier: 3, requires: 'dip_networks', maxRank: 1, perRank: { opinion: 3, influence: 0.5 }, description: '+3 monthly opinion and +0.5 influence.' },
  // chancellor
  { id: 'chn_tax', role: 'chancellor', label: 'Tax assessment', tier: 1, maxRank: 3, perRank: { tax: 0.04 }, description: '+4% tax income per rank.' },
  { id: 'chn_court', role: 'chancellor', label: 'Court patronage', tier: 2, requires: 'chn_tax', maxRank: 2, perRank: { influence: 0.5 }, description: '+0.5 influence per month per rank.' },
  { id: 'chn_bureau', role: 'chancellor', label: 'Imperial bureaucracy', tier: 3, requires: 'chn_court', maxRank: 1, perRank: { admin: 3 }, description: '+3 administrative capacity.' },
  // industrialist
  { id: 'ind_methods', role: 'industrialist', label: 'Production methods', tier: 1, maxRank: 3, perRank: { output: 0.05 }, description: '+5% output on their world per rank.' },
  { id: 'ind_logistics', role: 'industrialist', label: 'Site logistics', tier: 2, requires: 'ind_methods', maxRank: 2, perRank: { build: 0.15 }, description: '+15% construction speed on their world per rank.' },
  { id: 'ind_titan', role: 'industrialist', label: 'Industrial titan', tier: 3, requires: 'ind_logistics', maxRank: 1, perRank: { output: 0.12 }, description: '+12% output on their world.' },
  // explorer
  { id: 'exp_survey', role: 'explorer', label: 'Survey methods', tier: 1, maxRank: 3, perRank: { discovery: 0.25 }, description: '+25% value from ruins and derelicts per rank.' },
  { id: 'exp_sensors', role: 'explorer', label: 'Deep-space sensors', tier: 2, requires: 'exp_survey', maxRank: 2, perRank: { sensor: 1 }, description: '+1 sensor range per rank.' },
  { id: 'exp_trailblazer', role: 'explorer', label: 'Trailblazer', tier: 3, requires: 'exp_sensors', maxRank: 1, perRank: { speed: 0.25 }, description: '+25% speed for the survey fleet.' },
  // spymaster
  { id: 'spy_networks', role: 'spymaster', label: 'Agent networks', tier: 1, maxRank: 3, perRank: { intel: 8 }, description: '+8 intelligence on every realm per rank.' },
  { id: 'spy_counter', role: 'spymaster', label: 'Counter-intelligence', tier: 2, requires: 'spy_networks', maxRank: 2, perRank: { stability: 2 }, description: 'Plots fail more often; +2 stability realm-wide per rank.' },
  { id: 'spy_web', role: 'spymaster', label: 'The web', tier: 3, requires: 'spy_counter', maxRank: 1, perRank: { intel: 20 }, description: '+20 intelligence on every realm.' },
];
export const SKILL_BY_ID: Record<string, SkillDef> = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

export type AmbitionKind = 'glory' | 'power' | 'wealth' | 'knowledge' | 'land';
export const AMBITIONS: Record<AmbitionKind, { label: string; want: string }> = {
  glory: { label: 'Glory', want: 'Wants to win battles at the head of a fleet.' },
  power: { label: 'Power', want: 'Wants a seat on the royal council.' },
  wealth: { label: 'Wealth', want: 'Wants generous pay from a full treasury.' },
  knowledge: { label: 'Knowledge', want: 'Wants to lead research or exploration.' },
  land: { label: 'Land', want: 'Wants to govern a province.' },
};

export type EquipSlot = 'weapon' | 'armour' | 'relic' | 'instrument';
export interface ItemDef { id: string; label: string; slot: EquipSlot; cost: Record<string, number>; attrs?: Partial<Record<Attr, number>>; effect?: Record<string, number>; description: string; findable?: boolean }

export const ITEMS: ItemDef[] = [
  { id: 'duelling_blade', label: 'Duelling blade', slot: 'weapon', cost: { alloys: 60, credits: 120 }, attrs: { martial: 2 }, description: '+2 Martial.' },
  { id: 'command_baton', label: 'Command baton', slot: 'weapon', cost: { alloys: 40, electronics: 30, credits: 150 }, attrs: { command: 2 }, description: '+2 Command.' },
  { id: 'aegis_mail', label: 'Aegis mail', slot: 'armour', cost: { alloys: 120, components: 10 }, effect: { survive: 0.3 }, description: 'Far likelier to survive the loss of their fleet.' },
  { id: 'court_regalia', label: 'Court regalia', slot: 'armour', cost: { credits: 300, rare: 20 }, attrs: { diplomacy: 2 }, description: '+2 Diplomacy.' },
  { id: 'tactical_lens', label: 'Tactical lens', slot: 'instrument', cost: { electronics: 60, components: 10 }, effect: { tracking: 0.04 }, description: '+4% accuracy for their fleet.' },
  { id: 'quantum_abacus', label: 'Quantum abacus', slot: 'instrument', cost: { electronics: 80, rare: 15 }, attrs: { stewardship: 2 }, description: '+2 Stewardship.' },
  { id: 'research_codex', label: 'Research codex', slot: 'instrument', cost: { electronics: 70, credits: 100 }, attrs: { science: 2 }, description: '+2 Science.' },
  { id: 'cipher_ring', label: 'Cipher ring', slot: 'relic', cost: { rare: 25, credits: 120 }, attrs: { cunning: 2 }, description: '+2 Cunning.' },
  { id: 'ancestral_seal', label: 'Ancestral seal', slot: 'relic', cost: { credits: 400, influence: 20 }, effect: { loyalty: 15 }, description: '+15 loyalty.' },
  { id: 'precursor_shard', label: 'Precursor shard', slot: 'relic', cost: {}, attrs: { science: 3, cunning: 1 }, findable: true, description: 'Found in ancient ruins. +3 Science, +1 Cunning.' },
  { id: 'sentinel_core', label: 'Sentinel core', slot: 'instrument', cost: {}, effect: { dmg: 0.08, tracking: 0.03 }, findable: true, description: 'Salvaged from a sentinel host. +8% damage, +3% accuracy.' },
  { id: 'derelict_charts', label: 'Derelict star charts', slot: 'instrument', cost: {}, effect: { speed: 0.1, sensor: 1 }, findable: true, description: 'Found on a derelict. +10% speed, +1 sensor range.' },
];
export const ITEM_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

export const FIRST_NAMES = ['Aurel', 'Seraphine', 'Cassius', 'Ilya', 'Theodora', 'Marek', 'Ysolde', 'Corvin', 'Livia', 'Darian', 'Nerys', 'Oren', 'Talia', 'Vesper', 'Kael', 'Mirela', 'Rhun', 'Sabeth', 'Ansel', 'Brynn', 'Caius', 'Delphine', 'Emeric', 'Fenna', 'Galen', 'Halvard', 'Isolde', 'Jorund', 'Katya', 'Leandros', 'Maren', 'Nikolai', 'Odessa', 'Perrin', 'Quill', 'Rosalind', 'Soren', 'Tamsin', 'Ulrich', 'Valka', 'Wren', 'Xanthe', 'Yorick', 'Zuleika', 'Amara', 'Bastien', 'Cyrene', 'Dario', 'Elowen', 'Florian'];
export const LAST_NAMES = ['Valcourt', 'Drachen', 'Imris', 'Solenne', 'Kavar', 'Oduya', 'Thrane', 'Myrdin', 'Asterhal', 'Bellamy', 'Corsa', 'Venn', 'Hale', 'Okonkwo', 'Varga', 'Steel', 'Morrow', 'Ishida', 'Kerensky', 'Laurent', 'Nakamura', 'Petrov', 'Quint', 'Rask', 'Sorel', 'Tamm', 'Ulric', 'Voss', 'Wren', 'Yeats', 'Zhao', 'Abara', 'Brennan', 'Castellan', 'Draven', 'Eskildsen', 'Falk', 'Grisham', 'Hawthorne', 'Ivarsen', 'Juarez', 'Kestrel', 'Lindqvist', 'Marchetti', 'Novak', 'Ostrander'];

export const ORIGINS = [
  'born to a minor noble house on {home}',
  'raised in the orbital docks above {home}',
  'the child of farmers from the outer settlements of {home}',
  'a foundling taken in by the academies of {home}',
  'heir to a merchant dynasty of {home}',
  'a veteran of the border militias of {home}',
  'schooled at the royal lyceum on {home}',
  'born in exile and returned to serve {realm}',
];
