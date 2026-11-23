import { createRoot } from 'react-dom/client';
import '@fontsource/saira-semi-condensed/300.css';
import '@fontsource/saira-semi-condensed/400.css';
import '@fontsource/saira-semi-condensed/500.css';
import '@fontsource/saira-semi-condensed/600.css';
import './ui/styles.css';
import { App } from './ui/App';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { APP_VERSION } from './version';
import { startLoop, useUI } from './ui/store';
import { galaxyCam, renderStats } from './ui/render/galaxy3d';
import { audio, installAudioUnlock } from './audio/manager';
import { installAudioDirector, audioDebug } from './audio/director';

startLoop();
installAudioUnlock();
installAudioDirector();
createRoot(document.getElementById('root')!).render(<ErrorBoundary where="interface" root><App /></ErrorBoundary>);

// Offline play and asset caching in production builds (public/sw.js). Development and the
// browser tests run without it so they always see fresh files.
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(APP_VERSION)}`).catch(() => { /* offline play unavailable */ }); });
}

// Debug/test hook: lets automated checks drive the game without the UI.
(window as any).__sd = useUI;
(window as any).__sdCam = galaxyCam;
(window as any).__sdRender = renderStats;
(window as any).__sdAudio = { audio, debug: audioDebug };

// Development only (stripped from production builds): jump the player's capital to the
// laboratory's developed sample, for screenshots of a grown city.
if (import.meta.env.DEV) {
  (window as any).__sdDev = {
    developCapital: async () => {
      const { developCapital } = await import('./dev/sampleCapital');
      const ui = useUI.getState();
      if (ui.game) { developCapital(ui.game.empires[ui.game.playerId]); ui.bump(); }
    },
    /** fast-forward the simulation (browser tests) */
    runDays: async (days: number) => {
      const { runDays } = await import('./sim/engine');
      const ui = useUI.getState();
      if (ui.game) { runDays(ui.game, days); ui.bump(); }
    },
    /** put the Grand Expansion into a later state (browser tests) */
    expansion: async (what: 'conclave' | 'ancients' | 'omega' | 'devourer' | 'politics') => {
      const { expansionScenario } = await import('./dev/expansionScenario');
      const ui = useUI.getState();
      if (ui.game) { expansionScenario(ui.game, what); ui.bump(); }
    },
    /** lay an event-chain stage before the council (browser tests) */
    raiseChain: async (def: string, planetId: number | null = null) => {
      const { raiseStage } = await import('./sim/chains');
      const ui = useUI.getState();
      if (ui.game) { raiseStage(ui.game, ui.game.empires[ui.game.playerId], def, planetId); ui.bump(); }
    },
  };
}
