import { useUI } from './store';
import { MainMenu } from './components/MainMenu';
import { MapView } from './components/MapView';
import { TopBar, Rail, Ticker, Toasts, GameMenu, useHotkeys } from './components/Chrome';
import { ContextPanel } from './components/ContextPanel';
import { SCREENS } from './screens';
import { GameOver } from './screens/GameOver';

export function App() {
  const game = useUI((s) => s.game);
  const screen = useUI((s) => s.screen);
  const menuOpen = useUI((s) => s.menuOpen);
  useHotkeys();
  if (!game) return <MainMenu />;
  const Screen = screen !== 'map' ? SCREENS[screen] : null;
  return (
    <div className="shell">
      <MapView />
      <TopBar />
      <Rail />
      <ContextPanel />
      {Screen && <Screen />}
      <Ticker />
      <Toasts />
      <GameOver />
      {menuOpen && <GameMenu />}
    </div>
  );
}
