import { useEffect, useMemo, useRef, useState } from 'react';
import { useUI, loadGame } from '../store';
import { newGame, DEFAULT_SETTINGS } from '../../sim/engine';
import { GOVERNMENTS } from '../../sim/data/governments';
import { drawGalaxy } from '../render/galaxyRenderer';
import { listSaves, type SaveMeta } from '../../persistence/idb';
import { formatDate } from '../../sim/util';
import { cls } from './common';
import { beginTutorial } from './Tutorial';
import { AccountPanel } from './Account';
import type { Climate, GameSettings, GovernmentId } from '../../sim/types';

const CLIMATES: { id: Climate; label: string; note: string }[] = [
  { id: 'wet', label: 'Verdant', note: 'Thrive on temperate, ocean and jungle worlds.' },
  { id: 'dry', label: 'Arid', note: 'Thrive on desert and arid worlds. Start with hydroponics.' },
  { id: 'cold', label: 'Boreal', note: 'Thrive on tundra and frozen worlds. Start with hydroponics.' },
];

export function MainMenu() {
  const start = useUI((s) => s.start);
  const [s, setS] = useState<GameSettings>({ ...DEFAULT_SETTINGS, seed: Math.floor(Math.random() * 1e6) });
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [guided, setGuided] = useState(true);
  const [err, setErr] = useState('');
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { listSaves().then(setSaves).catch(() => {}); }, []);
  const preview = useMemo(() => newGame({ ...s, playerName: s.playerName || 'Your realm' }), [s.seed, s.galaxySize, s.aiCount, s.playerClimate]);

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    let raf = 0;
    const draw = (t: number) => {
      const r = cv.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = preview.galaxy;
      const zoom = Math.min(r.width, r.height) / g.width * 1.15;
      // reveal the whole map for the preview
      const p = preview.empires[0];
      p.explored = g.systems.map((x) => x.id);
      drawGalaxy(ctx, preview, { w: r.width, h: r.height, dpr, cam: { x: g.width / 2 + Math.sin(t / 9000) * 20 + r.width * 0.12 / zoom, y: g.height / 2, zoom }, selectedSystem: null, selectedFleet: null, hoverSystem: null, mode: 'political', time: t });
      // vignette for legibility
      const v = ctx.createLinearGradient(0, 0, r.width, 0);
      v.addColorStop(0, 'rgba(7,11,20,0.75)'); v.addColorStop(0.45, 'rgba(7,11,20,0.15)'); v.addColorStop(1, 'rgba(7,11,20,0.7)');
      ctx.fillStyle = v; ctx.fillRect(0, 0, r.width, r.height);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [preview]);

  const up = (p: Partial<GameSettings>) => setS({ ...s, ...p });
  return (
    <div className="title-screen">
      <canvas ref={ref} aria-hidden />
      <div className="title-mark">
        <h1>Star<br />Dominion</h1>
        <p>A young crown, one world, and a galaxy that will not wait.</p>
      </div>
      <form className="setup frame" style={{ padding: '20px 22px', overflowY: 'auto' }} onSubmit={(e) => { e.preventDefault(); start({ ...s, playerName: s.playerName.trim() || 'Aurelian Throne' }); const g = useUI.getState().game; if (g && guided) { beginTutorial(g); useUI.getState().bump(); } }}>
        <div className="section" style={{ marginTop: 0, marginBottom: 14 }}>
          <h3><span>Your account</span></h3>
          <AccountPanel compact />
        </div>
        <h2 className="serif" style={{ fontSize: 28, margin: '0 0 14px', fontWeight: 600 }}>Found your realm</h2>
        <div className="field">
          <label htmlFor="realm">Name of the realm</label>
          <input id="realm" value={s.playerName} maxLength={32} onChange={(e) => up({ playerName: e.target.value })} />
        </div>
        <div className="field">
          <label>Government</label>
          <select value={s.playerGovernment} onChange={(e) => up({ playerGovernment: e.target.value as GovernmentId })}>
            {Object.values(GOVERNMENTS).map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
          <span className="hint">{GOVERNMENTS[s.playerGovernment].description} {GOVERNMENTS[s.playerGovernment].summary.join(', ')}.</span>
        </div>
        <div className="field">
          <label>Your people</label>
          <div className="seg">{CLIMATES.map((c) => <button type="button" key={c.id} className={cls(s.playerClimate === c.id && 'on')} onClick={() => up({ playerClimate: c.id })}>{c.label}</button>)}</div>
          <span className="hint">{CLIMATES.find((c) => c.id === s.playerClimate)!.note}</span>
        </div>
        <div className="field">
          <label>Galaxy</label>
          <div className="seg">{(['small', 'medium', 'large'] as const).map((z) => <button type="button" key={z} className={cls(s.galaxySize === z && 'on')} onClick={() => up({ galaxySize: z })}>{z === 'small' ? '30 stars' : z === 'medium' ? '60 stars' : '120 stars'}</button>)}</div>
        </div>
        <div className="field">
          <label>Rival kingdoms</label>
          <div className="seg">{[2, 3, 4, 5].map((n) => <button type="button" key={n} className={cls(s.aiCount === n && 'on')} onClick={() => up({ aiCount: n })}>{n}</button>)}</div>
        </div>
        <div className="field">
          <label>Rival strength</label>
          <div className="seg">{(['relaxed', 'standard', 'hard'] as const).map((d) => <button type="button" key={d} className={cls(s.difficulty === d && 'on')} onClick={() => up({ difficulty: d })}>{d[0].toUpperCase() + d.slice(1)}</button>)}</div>
        </div>
        <div className="field">
          <label htmlFor="seed">Galaxy seed</label>
          <div className="row"><input id="seed" className="grow num" value={s.seed} onChange={(e) => up({ seed: Math.abs(parseInt(e.target.value) || 0) })} /><button type="button" className="btn" onClick={() => up({ seed: Math.floor(Math.random() * 1e6) })}>New galaxy</button></div>
        </div>
        <label className="row guided"><input type="checkbox" checked={guided} onChange={(e) => setGuided(e.target.checked)} /> <span><b>Guided first reign</b><span className="hint" style={{ display: 'block' }}>A royal advisor walks you through exploring, building, expanding and diplomacy.</span></span></label>
        <button className="btn primary" type="submit" style={{ padding: '10px 14px', fontSize: 17, marginTop: 4 }}>Begin the reign</button>
        {saves.length > 0 && (
          <div className="section">
            <h3><span>Continue a reign</span></h3>
            <div className="list">
              {saves.slice(0, 5).map((sv) => (
                <div key={sv.slot} className="li" onClick={() => loadGame(sv.slot).catch((e) => setErr(String(e)))}>
                  <div className="grow"><div>{sv.name}</div><div className="hint">{sv.realm} · {formatDate(sv.tick)}</div></div>
                  <span className="brass num">Load</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {err && <div className="neg hint">{err}</div>}
      </form>
    </div>
  );
}
