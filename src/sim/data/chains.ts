// Connected event chains. Each stage is a matter laid before the council (it reuses the petition
// machinery and the Council screen); an answer can schedule the next stage months later, so a
// choice made now comes back to the realm. Stages are never raised at random: sim/chains.ts
// starts a chain when the realm's situation calls for it.
import type { PetitionDef } from './governance';

export const CHAIN_STAGES: PetitionDef[] = [
  // ---- the precursor vault: what a realm does with an ancient find
  { id: 'precursor_signal', chain: true, from: 'event', title: 'A sealed precursor structure', attr: 'science',
    text: 'Surveyors on {planet} have found a sealed structure older than any known realm. Something inside still draws power.',
    options: [
      { label: 'Fund an excavation', cost: { credits: 250 }, next: { def: 'precursor_vault', days: 180, chance: 0.65, else: 'precursor_guardians' } },
      { label: 'Sell the coordinates to foreign scholars', gain: { credits: 350 }, reputation: 4 },
      { label: 'Seal it and post a guard', allHouses: 2 },
    ] },
  { id: 'precursor_guardians', chain: true, from: 'event', title: 'The dig site wakes', attr: 'command',
    text: 'The excavation on {planet} woke automated defences. Precursor drones are cutting through the dig.',
    options: [
      { label: 'Hold the line and keep digging', cost: { alloys: 60 }, raiders: 1, next: { def: 'precursor_vault', days: 120 } },
      { label: 'Evacuate the site', planet: { pops: -1, stability: -5 } },
    ] },
  { id: 'precursor_vault', chain: true, from: 'event', title: 'The vault is open', attr: 'science',
    text: 'The vault on {planet} lies open: star charts, weapon schematics and an archive in a language no one can read.',
    options: [
      { label: 'Study the archive', research: 500, timed: { days: 1800, mods: { 'output.research': 0.08 }, label: 'Precursor archive' } },
      { label: 'Reverse-engineer the weapons', timed: { days: 3600, mods: { shipDamage: 0.08 }, label: 'Precursor weapon designs' }, reputation: -6 },
      { label: 'Share the find with every court', gain: { influence: 40 }, reputation: 15 },
    ] },
  // ---- the fever: an epidemic that a realm can contain, cure or let spread
  { id: 'fever_outbreak', chain: true, from: 'event', title: 'Fever on {planet}', attr: 'stewardship',
    text: 'A fever is spreading through the lower districts of {planet}. The physicians ask for authority to act.',
    options: [
      { label: 'Quarantine the world', cost: { energy: 80 }, planet: { stability: -8 } },
      { label: 'Fund the search for a cure', cost: { credits: 300 }, next: { def: 'fever_cure', days: 240 } },
      { label: 'Keep the ports open', planet: { stability: 2 }, next: { def: 'fever_spread', days: 90, chance: 0.7 } },
    ] },
  { id: 'fever_spread', chain: true, from: 'event', title: 'The fever spreads', attr: 'stewardship',
    text: 'Ships from {planet} carried the fever to the shipping lanes. Hospitals are overwhelmed.',
    options: [
      { label: 'Emergency quarantine of the lanes', cost: { energy: 150, influence: 20 }, planet: { pops: -1 } },
      { label: 'Let it burn itself out', planet: { pops: -3 }, allHouses: -4, timed: { days: 720, mods: { growth: -0.2 }, label: 'Fever years' } },
    ] },
  { id: 'fever_cure', chain: true, from: 'event', title: 'A cure for the fever', attr: 'science',
    text: 'Our physicians have a cure for the fever of {planet}. Foreign courts are already asking for it.',
    options: [
      { label: 'Give it to every realm', reputation: 10, timed: { days: 1080, mods: { growth: 0.1 }, label: 'The cure' } },
      { label: 'Sell it dearly', gain: { credits: 600 }, reputation: -5 },
    ] },
  // ---- separatists: a restless world asks to go its own way
  { id: 'separatists', chain: true, from: 'event', title: 'Separatists on {planet}', attr: 'diplomacy',
    text: 'Agitators on {planet} call for independence, and crowds fill the squares.',
    options: [
      { label: 'Grant local autonomy', cost: { influence: 30 }, planet: { stability: 15, resistance: -20 } },
      { label: 'Arrest the leaders', planet: { stability: -6 }, next: { def: 'separatist_uprising', days: 120, chance: 0.5 } },
      { label: 'Ignore them', next: { def: 'separatist_uprising', days: 180, chance: 0.7 } },
    ] },
  { id: 'separatist_uprising', chain: true, from: 'event', title: 'Uprising on {planet}', attr: 'command',
    text: 'The separatists of {planet} have taken the spaceport. The governor asks for orders.',
    options: [
      { label: 'Send in the garrison', cost: { alloys: 80 }, planet: { stability: 10, resistance: -10 }, reputation: -3 },
      { label: 'Negotiate a settlement', cost: { influence: 40 }, planet: { stability: 20 } },
      { label: 'Let the world decide its fate', planet: { stability: -30 } },
    ] },
  // ---- the merchant guilds' loan
  { id: 'guild_charter', chain: true, from: 'event', title: 'The guilds offer a loan', attr: 'stewardship',
    text: 'The merchant guilds offer the crown a generous loan, secured against future trade.',
    options: [
      { label: 'Accept the loan', gain: { credits: 600 }, next: { def: 'guild_due', days: 720 } },
      { label: 'Decline politely' },
    ] },
  { id: 'guild_due', chain: true, from: 'event', title: 'The guilds come to collect', attr: 'stewardship',
    text: 'Two years on, the guilds present their bill, with interest.',
    options: [
      { label: 'Repay with interest', cost: { credits: 800 }, allHouses: 2 },
      { label: 'Grant them a trade monopoly instead', timed: { days: 1080, mods: { tax: -0.1 }, label: 'Guild monopoly' } },
      { label: 'Default on the loan', allHouses: -8, reputation: -8, timed: { days: 720, mods: { tradeValue: -0.2 }, label: 'Defaulted on the guilds' } },
    ] },
  // ---- the corsair warlord
  { id: 'corsair_envoy', chain: true, from: 'event', title: 'A corsair warlord offers terms', attr: 'command',
    text: 'A Void Corsair warlord offers peace on our lanes, for a price.',
    options: [
      { label: 'Pay the tribute', cost: { credits: 300 }, next: { def: 'corsair_return', days: 540, chance: 0.6 } },
      { label: 'Hire them as privateers', cost: { credits: 500, influence: 20 }, fleet: ['corvette', 'corvette', 'corvette', 'frigate'], reputation: -5 },
      { label: 'Refuse and prepare for raids', raiders: 1 },
    ] },
  { id: 'corsair_return', chain: true, from: 'event', title: 'The warlord returns', attr: 'command',
    text: 'The corsair warlord is back, and the price has doubled.',
    options: [
      { label: 'Pay again', cost: { credits: 600 } },
      { label: 'Refuse him to his face', raiders: 2 },
    ] },
];
