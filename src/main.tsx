import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/barlow-condensed/400.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import './ui/styles.css';
import { App } from './ui/App';
import { startLoop, useUI } from './ui/store';

startLoop();
createRoot(document.getElementById('root')!).render(<App />);

// Debug/test hook: lets automated checks drive the game without the UI.
(window as any).__sd = useUI;
