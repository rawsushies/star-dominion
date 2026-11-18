import type { Cost, GovernmentId } from '../types';

export interface GovernmentDef {
  id: GovernmentId;
  label: string;
  ruler: string; // title of the ruler
  mods: Record<string, number>;
  summary: string[];
  description: string;
}

export const GOVERNMENTS: Record<GovernmentId, GovernmentDef> = {
  monarchy: {
    id: 'monarchy', label: 'Imperial Monarchy', ruler: 'Sovereign',
    mods: { stability: 5, 'output.influence': 0.2, admin: 2 },
    summary: ['+5 stability', '+20% influence', '+2 admin capacity'],
    description: 'A hereditary crown commands unquestioned loyalty and a tidy chain of authority.',
  },
  republic: {
    id: 'republic', label: 'Democratic Republic', ruler: 'First Consul',
    mods: { stability: 3, 'output.research': 0.1, tradeValue: 0.15, warExhaustion: 0.3, growth: 0.1 },
    summary: ['+3 stability', '+10% research', '+15% trade value', '+10% growth', '+30% war exhaustion'],
    description: 'Elected assemblies foster innovation and commerce, but tire quickly of war.',
  },
  junta: {
    id: 'junta', label: 'Military Dictatorship', ruler: 'Marshal',
    mods: { navalCap: 12, shipBuildSpeed: 0.2, shipDamage: 0.05, upkeepShips: -0.15, stability: -5, 'output.research': -0.1, garrison: 0.25 },
    summary: ['+12 naval capacity', '+20% ship build speed', '+5% weapon damage', '-15% fleet upkeep', '-5 stability', '-10% research'],
    description: 'The admiralty rules. Fleets are cheap and plentiful; dissent is not tolerated.',
  },
  technocracy: {
    id: 'technocracy', label: 'Technocratic State', ruler: 'Chancellor of Science',
    mods: { 'output.research': 0.25, buildSpeed: 0.1, 'output.influence': -0.15 },
    summary: ['+25% research', '+10% construction speed', '-15% influence'],
    description: 'Governance by expert councils and predictive models. Progress above all.',
  },
  corporate: {
    id: 'corporate', label: 'Corporate Federation', ruler: 'Chief Executive',
    mods: { tradeValue: 0.3, tax: 0.1, marketFee: -0.5, stability: -2 },
    summary: ['+30% trade value', '+10% taxes', 'Halved market fees', '-2 stability'],
    description: 'Charter companies run the worlds as shareholdings. Profit is patriotism.',
  },
  feudal: {
    id: 'feudal', label: 'Feudal Kingdom', ruler: 'High King',
    mods: { admin: 6, garrison: 0.3, claimCost: -0.2, 'output.research': -0.1, tax: -0.1 },
    summary: ['+6 admin capacity', '+30% garrisons', '-20% outpost cost', '-10% research', '-10% taxes'],
    description: 'Sworn lords hold distant worlds in fief, extending the crown’s reach cheaply.',
  },
};

export interface PolicyOption {
  id: string;
  label: string;
  mods: Record<string, number>;
  costPerColony?: Cost; // monthly cost per colony
  costFlat?: Cost; // monthly flat cost
  description: string;
}

export interface PolicyDef {
  id: string;
  label: string;
  ministry: MinistryId;
  defaultOption: string;
  options: PolicyOption[];
}

export type MinistryId = 'treasury' | 'defense' | 'industry' | 'science' | 'foreign' | 'interior';

export const MINISTRIES: { id: MinistryId; label: string; brief: string }[] = [
  { id: 'treasury', label: 'Ministry of the Treasury', brief: 'Taxation, trade and the royal coffers.' },
  { id: 'defense', label: 'Ministry of Defence', brief: 'Fleet budgets, garrisons and border security.' },
  { id: 'industry', label: 'Ministry of Industry', brief: 'Production subsidies and construction programmes.' },
  { id: 'science', label: 'Ministry of Science', brief: 'Research funding and academic priorities.' },
  { id: 'foreign', label: 'Ministry of Foreign Affairs', brief: 'Diplomatic posture and intelligence services.' },
  { id: 'interior', label: 'Ministry of the Interior', brief: 'Population, colonisation and administration.' },
];

export const POLICIES: PolicyDef[] = [
  {
    id: 'taxation', label: 'Taxation', ministry: 'treasury', defaultOption: 'standard',
    options: [
      { id: 'low', label: 'Low', mods: { tax: -0.35, stability: 8, growth: 0.05 }, description: '-35% taxes, +8 stability.' },
      { id: 'standard', label: 'Standard', mods: {}, description: 'Balanced levy.' },
      { id: 'high', label: 'High', mods: { tax: 0.35, stability: -8 }, description: '+35% taxes, -8 stability.' },
      { id: 'extortionate', label: 'Extortionate', mods: { tax: 0.7, stability: -20, growth: -0.2 }, description: '+70% taxes, -20 stability, -20% growth.' },
    ],
  },
  {
    id: 'trade_law', label: 'Trade Law', ministry: 'treasury', defaultOption: 'regulated',
    options: [
      { id: 'protectionist', label: 'Protectionist', mods: { tradeValue: -0.15, 'output.alloys': 0.05, 'output.electronics': 0.05 }, description: '-15% trade value, +5% alloys and electronics.' },
      { id: 'regulated', label: 'Regulated', mods: {}, description: 'Standard tariffs.' },
      { id: 'free', label: 'Free Markets', mods: { tradeValue: 0.15, marketFee: -0.3, stability: -2 }, description: '+15% trade value, cheaper market, -2 stability.' },
    ],
  },
  {
    id: 'military_budget', label: 'Military Budget', ministry: 'defense', defaultOption: 'standard',
    options: [
      { id: 'reduced', label: 'Reduced', mods: { upkeepShips: -0.15, shipBuildSpeed: -0.2, shipDamage: -0.05 }, description: '-15% fleet upkeep, slower shipbuilding, -5% damage.' },
      { id: 'standard', label: 'Standard', mods: {}, description: 'Peacetime readiness.' },
      { id: 'increased', label: 'Increased', mods: { shipBuildSpeed: 0.2, navalCap: 6, shipDamage: 0.05 }, costPerColony: { credits: 1.5 }, description: '+20% shipbuilding, +6 naval cap, +5% damage. 1.5 credits/colony.' },
      { id: 'war_economy', label: 'War Economy', mods: { shipBuildSpeed: 0.4, navalCap: 12, shipDamage: 0.1, stability: -6, 'output.research': -0.1 }, costPerColony: { credits: 3, alloys: 0.3 }, description: '+40% shipbuilding, +12 naval cap, +10% damage, -6 stability.' },
    ],
  },
  {
    id: 'border_security', label: 'Border Security', ministry: 'defense', defaultOption: 'standard',
    options: [
      { id: 'standard', label: 'Standard', mods: {}, description: 'Routine patrols.' },
      { id: 'fortified', label: 'Fortified Borders', mods: { defensePlatform: 0.2, starbase: 0.2, garrison: 0.2, resistanceDecay: 0.5 }, costPerColony: { credits: 1, energy: 0.5 }, description: '+20% defences, faster pacification of occupied worlds.' },
    ],
  },
  {
    id: 'subsidies', label: 'Industrial Subsidies', ministry: 'industry', defaultOption: 'none',
    options: [
      { id: 'none', label: 'None', mods: {}, description: 'Market-led production.' },
      { id: 'subsidized', label: 'Subsidised Industry', mods: { 'output.minerals': 0.1, 'output.alloys': 0.15, 'output.electronics': 0.15, 'output.components': 0.15 }, costPerColony: { credits: 2.5 }, description: '+10% minerals, +15% alloys/electronics/components. 2.5 credits/colony.' },
    ],
  },
  {
    id: 'construction', label: 'Construction Programme', ministry: 'industry', defaultOption: 'balanced',
    options: [
      { id: 'balanced', label: 'Balanced', mods: {}, description: 'Standard building codes.' },
      { id: 'crash', label: 'Crash Programme', mods: { buildSpeed: 0.35, buildCost: 0.2 }, description: '+35% construction speed, +20% construction cost.' },
      { id: 'austere', label: 'Austerity', mods: { buildSpeed: -0.25, buildCost: -0.2, upkeepBuildings: -0.1 }, description: '-25% speed, -20% cost, -10% building upkeep.' },
    ],
  },
  {
    id: 'research_priority', label: 'Research Funding', ministry: 'science', defaultOption: 'standard',
    options: [
      { id: 'standard', label: 'Standard', mods: {}, description: 'Baseline grants.' },
      { id: 'prioritized', label: 'Prioritised', mods: { 'output.research': 0.2 }, costPerColony: { credits: 2, electronics: 0.1 }, description: '+20% research. 2 credits and 0.1 electronics per colony.' },
      { id: 'grand', label: 'Grand Academies', mods: { 'output.research': 0.4, stability: -2 }, costPerColony: { credits: 4, electronics: 0.25 }, description: '+40% research. 4 credits and 0.25 electronics per colony.' },
    ],
  },
  {
    id: 'diplomatic_stance', label: 'Diplomatic Stance', ministry: 'foreign', defaultOption: 'balanced',
    options: [
      { id: 'isolationist', label: 'Isolationist', mods: { 'output.influence': 0.15, diploOpinion: -10, stability: 2 }, description: '+15% influence, -10 opinion abroad.' },
      { id: 'balanced', label: 'Balanced', mods: {}, description: 'Pragmatic engagement.' },
      { id: 'outreach', label: 'Diplomatic Outreach', mods: { diploOpinion: 15, acceptance: 10 }, costFlat: { influence: 0.6, credits: 4 }, description: '+15 opinion abroad, AI more receptive. Costs influence.' },
    ],
  },
  {
    id: 'intelligence', label: 'Intelligence Service', ministry: 'foreign', defaultOption: 'standard',
    options: [
      { id: 'minimal', label: 'Minimal', mods: { intel: -20 }, description: 'Limited insight into rivals.' },
      { id: 'standard', label: 'Standard', mods: {}, description: 'Embassies and listening posts.' },
      { id: 'expanded', label: 'Expanded Network', mods: { intel: 30, sensor: 1 }, costFlat: { credits: 6, influence: 0.2 }, description: '+30 intel on all empires, +1 sensor range.' },
    ],
  },
  {
    id: 'population', label: 'Population Policy', ministry: 'interior', defaultOption: 'standard',
    options: [
      { id: 'standard', label: 'Standard', mods: {}, description: 'No intervention.' },
      { id: 'growth', label: 'Growth Incentives', mods: { growth: 0.35, foodUpkeep: 0.1 }, costPerColony: { credits: 1 }, description: '+35% growth, pops eat 10% more food.' },
      { id: 'rationing', label: 'Rationing', mods: { growth: -0.3, foodUpkeep: -0.25, stability: -5 }, description: '-25% food consumption, -30% growth, -5 stability.' },
    ],
  },
  {
    id: 'colonization', label: 'Expansion Doctrine', ministry: 'interior', defaultOption: 'measured',
    options: [
      { id: 'consolidate', label: 'Consolidation', mods: { admin: 3, stability: 3, claimCost: 0.3 }, description: '+3 admin cap, +3 stability, outposts cost 30% more.' },
      { id: 'measured', label: 'Measured', mods: {}, description: 'Sustainable expansion.' },
      { id: 'drive', label: 'Colonisation Drive', mods: { colonyCost: -0.25, claimCost: -0.2, colonizeSpeed: 0.25 }, costFlat: { influence: 0.4 }, description: 'Cheaper colonies and outposts. Costs influence.' },
    ],
  },
];

export const POLICY_BY_ID: Record<string, PolicyDef> = Object.fromEntries(POLICIES.map((p) => [p.id, p]));

export function defaultPolicies(): Record<string, string> {
  return Object.fromEntries(POLICIES.map((p) => [p.id, p.defaultOption]));
}
