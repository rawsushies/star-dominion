import { useEffect, useMemo, useRef, useState } from 'react';
import { useUI, loadGame } from '../store';
import { newGame, DEFAULT_SETTINGS } from '../../sim/engine';
import { GOVERNMENTS } from '../../sim/data/governments';
import { GalaxyView3D, galaxyCam } from '../render/galaxy3d';
import { generateGalaxy, GALAXY_LABELS } from '../../sim/galaxy';
import { makeRng } from '../../sim/rng';
import type { GameState } from '../../sim/types';
import { listSaves, type SaveMeta } from '../../persistence/idb';
import { formatDate } from '../../sim/util';
import { cls } from './common';
import { beginGuidedReign } from './Guidance';
import { guidancePrefs } from '../../guidance/state';
import { AccountPanel } from './Account';
import { MuteButton } from './AudioSettings';
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
  const [guided, setGuided] = useState(() => guidancePrefs().lessons);
  const [err, setErr] = useState('');
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { listSaves().then(setSaves).catch(() => {}); }, []);
  // Large galaxies preview the generated galaxy alone (fast); small ones show the starting kingdoms too.
  const preview = useMemo<GameState>(() => {
    if (s.galaxySize !== 'milky') return newGame({ ...s, playerName: s.playerName || 'Your realm' });
    const { galaxy, planets } = generateGalaxy(makeRng(s.seed), 'milky', s.seed);
    return { galaxy, planets, empires: [], fleets: {}, battles: [], playerId: 0, settings: { ...s }, tick: 0 } as unknown as GameState;
  }, [s.seed, s.galaxySize, s.aiCount, s.playerClimate]);

  useEffect(() => {
    const cv = ref.current!;
    let view: GalaxyView3D | null = null;
    try { view = new GalaxyView3D(cv); } catch { view = null; }
    let raf = 0;
    const R = preview.galaxy.shape?.R ?? preview.galaxy.width / 2;
    const draw = (t: number) => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      galaxyCam.tx = preview.galaxy.width / 2 - R * 0.28; galaxyCam.ty = preview.galaxy.height / 2; galaxyCam.tz = 0;
      galaxyCam.dist = R * 2.1; galaxyCam.pitch = 0.62; galaxyCam.yaw = 0.4 + t / 60000;
      view?.frame(preview, { w: r.width, h: r.height, dpr, time: t, selectedSystem: null, selectedFleet: null, hoverSystem: null, mode: 'political', preview: true }, null);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); view?.dispose(); };
  }, [preview]);

  const up = (p: Partial<GameSettings>) => setS({ ...s, ...p });
  return (
    <div className="title-screen">
      <canvas ref={ref} aria-hidden />
      <div className="title-audio"><MuteButton className="btn small" /></div>
      <div className="title-mark">
        <h1>Star<br />Dominion</h1>
        <p>A young crown, one world, and a galaxy that will not wait.</p>
      </div>
      <form className="setup frame" style={{ padding: '20px 22px', overflowY: 'auto' }} onSubmit={(e) => { e.preventDefault(); start({ ...s, playerName: s.playerName.trim() || 'Aurelian Throne' }); if (guided) beginGuidedReign(); }}>
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
          <div className="seg">{(['small', 'medium', 'large', 'milky'] as const).map((z) => <button type="button" key={z} className={cls(s.galaxySize === z && 'on')} onClick={() => up({ galaxySize: z })}>{z === 'milky' ? 'Milky Way' : GALAXY_LABELS[z]}</button>)}</div>
          {s.galaxySize === 'milky' && <span className="hint">10,000 star systems in a barred spiral. Your kingdom and its rivals start together in an outer arm; the rest of the galaxy is frontier.</span>}
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
        <label className="row guided"><input type="checkbox" checked={guided} onChange={(e) => setGuided(e.target.checked)} /> <span><b>Guided first reign</b><span className="hint" style={{ display: 'block' }}>Ten short lessons teach the game as you play: the galaxy, your capital, the economy, expansion, war, research, diplomacy, your people and great works. Pause, skip or replay them any time from the Codex.</span></span></label>
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
