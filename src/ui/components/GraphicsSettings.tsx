// Graphics settings: the capital's look and its render quality. Used in the Chancery and the
// Codex settings tab; kept in this browser (src/ui/graphics.ts).

import { useEffect, useState } from 'react';
import { currentDevice, graphics, onGraphicsChange, resolveCapital, setGraphics, viewQuality, type CapitalStyle, type QualityPref, type MotionPref, type TrafficPref } from '../graphics';

const STYLES: { value: CapitalStyle; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'megacity', label: 'Imperial megacity' },
  { value: 'classic', label: 'Classic city (lighter)' },
];
const QUALITY: { value: QualityPref; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'mobile', label: 'Low (phones, tablets, older laptops)' },
  { value: 'medium', label: 'Medium' },
  { value: 'desktop', label: 'High (dedicated graphics card)' },
];
const TIER = { mobile: 'low', medium: 'medium', desktop: 'high' } as const;

export function GraphicsSettings() {
  const [s, setS] = useState(graphics);
  useEffect(() => onGraphicsChange(() => setS(graphics())), []);
  const d = currentDevice();
  const r = resolveCapital(s, d);
  const now = r.style === 'megacity' ? `The capital is drawn as the imperial megacity at ${TIER[r.quality]} quality.` : 'The capital is drawn as the classic city.';
  return (
    <div className="graphics-settings" data-testid="graphics-settings">
      <div className="field">
        <label htmlFor="gfx-capital">Capital city</label>
        <select id="gfx-capital" value={s.capital} onChange={(e) => setGraphics({ capital: e.target.value as CapitalStyle })}>
          {STYLES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="gfx-quality">Graphics quality</label>
        <select id="gfx-quality" value={s.quality} onChange={(e) => setGraphics({ quality: e.target.value as QualityPref })}>
          {QUALITY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="gfx-motion">Map animation</label>
        <select id="gfx-motion" data-testid="gfx-motion" value={s.motion} onChange={(e) => setGraphics({ motion: e.target.value as MotionPref })}>
          <option value="auto">Automatic (follow system setting)</option>
          <option value="full">Full</option>
          <option value="reduced">Reduced motion</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="gfx-traffic">Map traffic</label>
        <select id="gfx-traffic" data-testid="gfx-traffic" value={s.traffic} onChange={(e) => setGraphics({ traffic: e.target.value as TrafficPref })}>
          <option value="low">Light (fewer ships drawn)</option>
          <option value="normal">Normal</option>
          <option value="high">Every convoy</option>
        </select>
      </div>
      <label className="row setting">
        <input type="checkbox" checked={s.stats} onChange={(e) => setGraphics({ stats: e.target.checked })} />
        <span>Show frame rate and draw calls in the capital</span>
      </label>
      <p className="hint" data-testid="graphics-now">
        {now}
        {` The galaxy map, portraits and battle replays render at ${TIER[viewQuality(s, d).tier]} quality. If the game feels slow, choose Low.`}
        {s.capital === 'auto' && d.software && ' This browser draws 3D in software, so the lighter city and low quality are used.'}
        {s.quality === 'auto' && !d.software && d.integrated && ' Integrated graphics detected, so low quality is used.'}
      </p>
    </div>
  );
}
