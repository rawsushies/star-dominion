import type { ScreenId } from '../store';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const ICONS: Record<ScreenId, JSX.Element> = {
  map: <g {...P}><circle cx="12" cy="12" r="2" /><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(-25 12 12)" /><circle cx="18" cy="7" r="1" /><circle cx="6" cy="17" r="1" /></g>,
  kingdom: <g {...P}><path d="M4 18 L4 9 L8 12 L12 6 L16 12 L20 9 L20 18 Z" /><path d="M4 21 H20" /></g>,
  planets: <g {...P}><circle cx="12" cy="12" r="6" /><ellipse cx="12" cy="12" rx="10" ry="3" transform="rotate(-20 12 12)" /></g>,
  system: <g {...P}><circle cx="12" cy="12" r="2.4" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="9.5" strokeDasharray="2 3" /><circle cx="18" cy="12" r="1.2" fill="currentColor" /></g>,
  fleets: <g {...P}><path d="M4 8 L11 10 L4 12 L6 10 Z" /><path d="M12 13 L20 15 L12 17 L14 15 Z" /><path d="M10 4 L17 6 L10 8 L12 6 Z" /></g>,
  military: <g {...P}><path d="M5 19 L19 5 M15 5 H19 V9" /><path d="M19 19 L5 5 M5 9 V5 H9" /><path d="M8 16 L5 19 M16 16 L19 19" /></g>,
  economy: <g {...P}><path d="M4 19 H20" /><path d="M6 16 V11 M10 16 V7 M14 16 V10 M18 16 V5" /></g>,
  industry: <g {...P}><path d="M3 20 V11 L8 14 V11 L13 14 V8 H17 V20 Z" /><path d="M17 8 V4 H19 V8" /></g>,
  research: <g {...P}><path d="M9 3 H15 M10 3 V9 L5 19 H19 L14 9 V3" /><path d="M7.5 14 H16.5" /></g>,
  diplomacy: <g {...P}><path d="M3 12 L8 8 L12 10 L16 8 L21 12" /><path d="M8 8 L8 5 M16 8 L16 5" /><path d="M6 14 L10 18 L14 15 L18 18" /></g>,
  intel: <g {...P}><path d="M2 12 C5 6 19 6 22 12 C19 18 5 18 2 12 Z" /><circle cx="12" cy="12" r="3" /></g>,
  construction: <g {...P}><path d="M4 20 L14 10" /><path d="M13 5 L19 11 L16 14 L10 8 Z" /><path d="M4 20 H10" /></g>,
  trade: <g {...P}><circle cx="5" cy="17" r="2" /><circle cx="19" cy="7" r="2" /><path d="M7 16 C11 14 13 10 17 8" strokeDasharray="2 2.5" /><path d="M15 6 L17.5 8 L15 10" /></g>,
  journal: <g {...P}><path d="M6 3 H17 L19 5 V21 H6 Z" /><path d="M9 8 H16 M9 12 H16 M9 16 H13" /></g>,
  heroes: <g {...P}><circle cx="12" cy="8" r="3.5" /><path d="M5 21 C5 15 19 15 19 21" /><path d="M9 3.5 L10.5 5 L12 3 L13.5 5 L15 3.5" /></g>,
  council: <g {...P}><circle cx="12" cy="12" r="3" /><circle cx="12" cy="4.5" r="1.6" /><circle cx="19" cy="9" r="1.6" /><circle cx="17" cy="17.5" r="1.6" /><circle cx="7" cy="17.5" r="1.6" /><circle cx="5" cy="9" r="1.6" /></g>,
  capital: <g {...P}><path d="M3 21 H21" /><path d="M5 21 V12 H9 V21" /><path d="M10 21 V6 L12 3 L14 6 V21" /><path d="M15 21 V10 H19 V21" /></g>,
  operations: <g {...P}><circle cx="12" cy="12" r="3" /><path d="M12 3 V6 M12 18 V21 M3 12 H6 M18 12 H21 M5.6 5.6 L7.8 7.8 M16.2 16.2 L18.4 18.4 M5.6 18.4 L7.8 16.2 M16.2 7.8 L18.4 5.6" /></g>,
  throne: <g {...P}><path d="M7 21 V10 L5 6 L8 7.5 L12 3 L16 7.5 L19 6 L17 10 V21" /><path d="M7 15 H17 M5 21 H19" /></g>,
  warroom: <g {...P}><rect x="3" y="5" width="18" height="13" /><path d="M7 14 L10 10 L13 12 L17 8" /><path d="M9 21 H15" /></g>,
  chronicle: <g {...P}><path d="M5 4 H16 A3 3 0 0 1 16 10 H8 A3 3 0 0 0 8 16 H19" /><path d="M5 4 V20 H17" /></g>,
  codex: <g {...P}><path d="M4 4 H10 A2 2 0 0 1 12 6 V20 A2 2 0 0 0 10 18 H4 Z" /><path d="M20 4 H14 A2 2 0 0 0 12 6 V20 A2 2 0 0 1 14 18 H20 Z" /><path d="M15 8 H18 M15 11 H18" /></g>,
  techtree: <g {...P}><circle cx="5" cy="12" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="19" cy="18" r="2" /><circle cx="12" cy="12" r="2" /><path d="M7 12 H10 M14 12 L17 7 M14 12 L17 17" /></g>,
};

export function ScreenIcon({ id, size = 22 }: { id: ScreenId; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>{ICONS[id]}</svg>;
}

export function PlayIcon({ n }: { n: number }) {
  if (n === 0) return <svg width="14" height="14" viewBox="0 0 14 14"><rect x="3" y="2" width="3" height="10" fill="currentColor" /><rect x="8" y="2" width="3" height="10" fill="currentColor" /></svg>;
  return (
    <svg width="16" height="14" viewBox="0 0 16 14">
      {Array.from({ length: n }).map((_, i) => <path key={i} d={`M${2 + i * 4.5} 2 L${2 + i * 4.5 + 5} 7 L${2 + i * 4.5} 12 Z`} fill="currentColor" />)}
    </svg>
  );
}
