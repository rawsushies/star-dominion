import { useUI } from './store';
import { MainMenu } from './components/MainMenu';
import { MapView } from './components/MapView';
import { Toasts, AssetNotice, GameMenu, useHotkeys } from './components/Chrome';
import { Neocom, LocationHud, ResourceStrip, ThroneDial, Dispatches, Overview, WindowLayer } from './components/Hud';
import { ContextPanel } from './components/ContextPanel';
import { GameOver } from './screens/GameOver';
import { EraDawn } from './components/Evolution';
import { GuidanceStack } from './components/Guidance';
import { lazy, Suspense } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';

// The capital city view is large (its renderer and models); fetch it the first time it opens.
const loadCapitalScene = () => import('./screens/CapitalScene');
const CapitalScene = lazy(() => loadCapitalScene().then((m) => ({ default: m.CapitalScene })));
// once a reign is running, fetch the capital's code in idle time: it opens at once later, and the
// offline cache holds it even if the player never opened the capital while online
let warmed = false;
function warmCapital() {
  if (warmed) return;
  warmed = true;
  const go = () => { loadCapitalScene().catch(() => { warmed = false; }); };
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(go, { timeout: 8000 }); else setTimeout(go, 3000);
}

export function App() {
  const game = useUI((s) => s.game);
  const menuOpen = useUI((s) => s.menuOpen);
  const capital = useUI((s) => s.view === 'capital');
  useHotkeys();
  if (!game) return <MainMenu />;
  warmCapital();
  return (
    <div className={capital ? 'shell in-capital' : 'shell'}>
      <MapView />
      {capital && <ErrorBoundary where="capital view"><Suspense fallback={<div className="capital-loading">Loading the capital…</div>}><CapitalScene /></Suspense></ErrorBoundary>}
      <LocationHud />
      <ResourceStrip />
      <Dispatches />
      <GuidanceStack />
      <ThroneDial />
      <div className="right-col" hidden={capital}>
        <ContextPanel />
        <Overview />
      </div>
      <WindowLayer />
      <Neocom />
      <Toasts />
      <AssetNotice />
      <EraDawn />
      <GameOver />
      {menuOpen && <GameMenu />}
    </div>
  );
}
