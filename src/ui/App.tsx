import { useUI } from './store';
import { MainMenu } from './components/MainMenu';
import { MapView } from './components/MapView';
import { Toasts, GameMenu, useHotkeys } from './components/Chrome';
import { Neocom, LocationHud, ResourceStrip, ThroneDial, Dispatches, Overview, WindowLayer } from './components/Hud';
import { ContextPanel } from './components/ContextPanel';
import { GameOver } from './screens/GameOver';

export function App() {
  const game = useUI((s) => s.game);
  const menuOpen = useUI((s) => s.menuOpen);
  useHotkeys();
  if (!game) return <MainMenu />;
  return (
    <div className="shell">
      <MapView />
      <LocationHud />
      <ResourceStrip />
      <Dispatches />
      <ThroneDial />
      <div className="right-col">
        <ContextPanel />
        <Overview />
      </div>
      <WindowLayer />
      <Neocom />
      <Toasts />
      <GameOver />
      {menuOpen && <GameMenu />}
    </div>
  );
}
