import type { ComponentType } from 'react';
import type { ScreenId } from '../store';
import { KingdomScreen } from './Kingdom';
import { PlanetsScreen } from './Planets';
import { SystemsScreen } from './Systems';
import { FleetsScreen } from './Fleets';
import { MilitaryScreen } from './Military';
import { EconomyScreen } from './Economy';
import { IndustryScreen } from './Industry';
import { ResearchScreen, TechTreeScreen } from './Research';
import { DiplomacyScreen } from './Diplomacy';
import { IntelScreen } from './Intel';
import { ConstructionScreen } from './Construction';
import { TradeScreen } from './Trade';
import { JournalScreen } from './Journal';
import { HeroesScreen } from './Heroes';
import { CouncilScreen } from './Council';
import { CapitalScreen } from './Capital';
import { OperationsScreen } from './Operations';
import { ThroneScreen } from './Throne';
import { WarRoomScreen } from './WarRoom';
import { ChronicleScreen } from './Chronicle';
import { CodexScreen } from './Codex';

export const SCREENS: Record<Exclude<ScreenId, 'map'>, ComponentType> = {
  kingdom: KingdomScreen,
  planets: PlanetsScreen,
  system: SystemsScreen,
  fleets: FleetsScreen,
  military: MilitaryScreen,
  economy: EconomyScreen,
  industry: IndustryScreen,
  research: ResearchScreen,
  techtree: TechTreeScreen,
  diplomacy: DiplomacyScreen,
  intel: IntelScreen,
  construction: ConstructionScreen,
  trade: TradeScreen,
  journal: JournalScreen,
  heroes: HeroesScreen,
  council: CouncilScreen,
  capital: CapitalScreen,
  operations: OperationsScreen,
  throne: ThroneScreen,
  warroom: WarRoomScreen,
  chronicle: ChronicleScreen,
  codex: CodexScreen,
};
