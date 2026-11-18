import { createRoot } from 'react-dom/client';
import '@fontsource/saira-semi-condensed/300.css';
import '@fontsource/saira-semi-condensed/400.css';
import '@fontsource/saira-semi-condensed/500.css';
import '@fontsource/saira-semi-condensed/600.css';
import './ui/styles.css';
import { App } from './ui/App';
import { startLoop, useUI } from './ui/store';
import { galaxyCam, renderStats } from './ui/render/galaxy3d';

startLoop();
createRoot(document.getElementById('root')!).render(<App />);

// Debug/test hook: lets automated checks drive the game without the UI.
(window as any).__sd = useUI;
(window as any).__sdCam = galaxyCam;
(window as any).__sdRender = renderStats;
