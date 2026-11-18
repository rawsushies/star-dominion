import { useEffect, useState } from 'react';
import { useUI, useGame, SPEEDS, saveGame, loadGame, type ScreenId } from '../store';
import { getLedger } from '../../sim/engine';
import { formatDate } from '../../sim/util';
import { GOVERNMENTS } from '../../sim/data/governments';
import { RESOURCES } from '../../sim/types';
import type { LedgerKey } from '../../sim/economy';
import { serialize, deserialize } from '../../sim/save';
import { listSaves, deleteSave, type SaveMeta } from '../../persistence/idb';
import { ResGlyph, RES_META, Tip, fmt, signed, cls, Emblem } from './common';
import { ScreenIcon, PlayIcon } from './icons';
import { focusSystem } from './MapView';

export function TopBar() {
  const g = useGame();
  const ui = useUI();
  const e = g.empires[g.playerId];
  const L = getLedger(g, e);
  const keys: LedgerKey[] = [...RESOURCES, 'research'];
  return (
    <div className="topbar">
      <div className="crest" onClick={() => ui.openScreen('kingdom')} title="Kingdom overview">
        <Emblem empire={e} size={30} />
        <div>
          <div className="realm">{e.name}</div>
          <div className="gov">{GOVERNMENTS[e.government].label}</div>
        </div>
      </div>
      <div className="resources">
        {keys.map((k) => {
          const stock = k === 'research' ? null : e.stock[k];
          const net = L.net[k];
          const cap = k === 'research' ? 0 : L.cap[k];
          const short = k !== 'research' && L.shortages.includes(k as any);
          const lines = L.lines.filter((l) => l.key === k).sort((a, b) => b.amount - a.amount);
          return (
            <Tip key={k} content={
              <div>
                <h4>{RES_META[k].label}</h4>
                {k === 'research' ? <div className="muted">Research points per month toward the current project.</div> : <div className="muted">Stored {fmt(stock!)} of {fmt(cap)} capacity.</div>}
                <div className="kv">
                  {lines.slice(0, 14).map((l) => [<span key={l.label + 'a'}>{l.label}</span>, <span key={l.label + 'b'} className={l.amount >= 0 ? 'pos' : 'neg'}>{signed(l.amount)}</span>])}
                  <span style={{ color: 'var(--vellum)' }}>Net per month</span><span className={net >= 0 ? 'pos' : 'neg'}>{signed(net)}</span>
                </div>
                {short && <div className="neg" style={{ marginTop: 6 }}>Shortage: dependent production is crippled.</div>}
              </div>
            }>
              <div className={cls('res', short && 'short')}>
                <div className="lab"><ResGlyph r={k} />{RES_META[k].label.split(' ')[0]}</div>
                <div className="val">
                  {k === 'research' ? signed(net, 0).replace('+', '') : fmt(stock!)}
                  {k !== 'research' && <small className={net >= 0 ? 'pos' : 'neg'}>{signed(net, Math.abs(net) < 10 ? 1 : 0)}</small>}
                </div>
                {k !== 'research' && k !== 'credits' && k !== 'influence' && <div className="bar"><i className={stock! >= cap * 0.95 ? 'full' : ''} style={{ width: `${Math.min(100, (stock! / cap) * 100)}%` }} /></div>}
              </div>
            </Tip>
          );
        })}
      </div>
      <div className="clock">
        <span className={cls('date', ui.speed === 0 && 'paused')} title={ui.speed === 0 ? 'Paused (Space)' : `${SPEEDS[ui.speed]} days per second`}>{formatDate(g.tick)}</span>
        {[0, 1, 2, 3].map((n) => (
          <button key={n} className={cls('speed', ui.speed === n && 'on')} onClick={() => ui.setSpeed(n)} title={n === 0 ? 'Pause (Space)' : ['', 'Normal (1)', 'Fast (2)', 'Very fast (3)'][n]} aria-label={n === 0 ? 'Pause' : `Speed ${n}`}>
            <PlayIcon n={n} />
          </button>
        ))}
      </div>
      <button className="menu-btn" onClick={() => ui.set({ menuOpen: true, speed: 0 })} aria-label="Game menu">
        <svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
    </div>
  );
}

export const NAV: { id: ScreenId; label: string; key?: string }[] = [
  { id: 'map', label: 'Galaxy', key: 'F1' },
  { id: 'kingdom', label: 'Kingdom' },
  { id: 'planets', label: 'Planets' },
  { id: 'system', label: 'Systems' },
  { id: 'fleets', label: 'Fleets' },
  { id: 'military', label: 'Military' },
  { id: 'economy', label: 'Economy' },
  { id: 'industry', label: 'Industry' },
  { id: 'construction', label: 'Construction' },
  { id: 'trade', label: 'Trade' },
  { id: 'research', label: 'Research' },
  { id: 'techtree', label: 'Tech tree' },
  { id: 'diplomacy', label: 'Diplomacy' },
  { id: 'intel', label: 'Intelligence' },
  { id: 'journal', label: 'Journal' },
];

export function Rail() {
  const g = useGame();
  const screen = useUI((s) => s.screen);
  const open = useUI((s) => s.openScreen);
  const inbox = g.proposals.filter((p) => p.to === g.playerId).length;
  const e = g.empires[g.playerId];
  const idleResearch = !e.research.current && !e.research.queue.length;
  return (
    <nav className="rail" aria-label="Screens">
      {NAV.map((n, i) => (
        <span key={n.id} style={{ display: 'contents' }}>
          {(i === 1 || i === 4 || i === 6 || i === 10 || i === 12) && <div className="sep" />}
          <button className={cls(screen === n.id && 'on')} onClick={() => open(n.id)} title={n.label}>
            <ScreenIcon id={n.id} />
            {n.label}
            {n.id === 'diplomacy' && inbox > 0 && <span className="badge">{inbox}</span>}
            {n.id === 'research' && idleResearch && <span className="badge">!</span>}
          </button>
        </span>
      ))}
    </nav>
  );
}

export function Ticker() {
  const g = useGame();
  const ui = useUI();
  const mine = g.events.filter((e) => e.empires.length === 0 || e.empires.includes(g.playerId)).slice(-8).reverse();
  return (
    <div className="ticker" aria-label="Latest dispatches">
      {mine.map((ev) => (
        <div key={ev.id} className="item" onClick={() => jumpTo(ev)} title={ev.text}>
          <span className={cls('sev', ev.severity)} />
          <span className="d">{formatDate(ev.tick)}</span>
          <span>{ev.title}</span>
        </div>
      ))}
      {ui.flash && <div className="item warn" style={{ marginLeft: 'auto' }}>{ui.flash}</div>}
    </div>
  );
}

export function jumpTo(ev: { systemId?: number; planetId?: number; battleId?: number; kind: string }) {
  const ui = useUI.getState();
  const g = ui.game!;
  if (ev.battleId != null) { ui.set({ battleId: ev.battleId, screen: 'military' }); return; }
  if (ev.kind === 'diplomacy' || ev.kind === 'treaty') { ui.set({ screen: 'diplomacy' }); return; }
  if (ev.kind === 'research') { ui.set({ screen: 'research' }); return; }
  if (ev.planetId != null) {
    ui.selectPlanet(ev.planetId);
    focusSystem(g.planets[ev.planetId].systemId);
    if (g.planets[ev.planetId].colony?.ownerId === g.playerId) ui.set({ screen: 'planets' });
    else ui.set({ screen: 'map' });
    return;
  }
  if (ev.systemId != null) { ui.selectSystem(ev.systemId); focusSystem(ev.systemId); ui.set({ screen: 'map', view: 'galaxy' }); }
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={cls('toast', t.ev.severity)} onClick={() => { jumpTo(t.ev); dismiss(t.id); }}>
          <div className="tt">{t.ev.title}</div>
          <div className="tx">{t.ev.text}</div>
        </div>
      ))}
    </div>
  );
}

export function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      const ui = useUI.getState();
      if (!ui.game) return;
      if (e.code === 'Space') { e.preventDefault(); ui.togglePause(); }
      else if (e.key === '1' || e.key === '2' || e.key === '3') ui.setSpeed(+e.key);
      else if (e.key === 'Escape') {
        if (ui.pendingOrder) ui.set({ pendingOrder: null });
        else if (ui.menuOpen) ui.set({ menuOpen: false });
        else if (ui.screen !== 'map') ui.set({ screen: 'map' });
        else if (ui.view === 'system') ui.set({ view: 'galaxy' });
        else ui.set({ systemId: null, fleetId: null, planetId: null });
      } else if (e.key === 'F1') { e.preventDefault(); ui.set({ screen: 'map' }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function GameMenu() {
  const ui = useUI();
  const g = ui.game!;
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [name, setName] = useState(`${g.empires[g.playerId].name} ${formatDate(g.tick)}`);
  const [msg, setMsg] = useState('');
  const refresh = () => listSaves().then(setSaves).catch(() => setMsg('Browser storage is unavailable; use export instead.'));
  useEffect(() => { refresh(); }, []);
  const doSave = async () => {
    const slot = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'save';
    try { await saveGame(slot, name.trim() || 'Save'); setMsg(`Saved “${name}”.`); refresh(); } catch (err) { setMsg(String(err)); }
  };
  const exportFile = () => {
    const blob = new Blob([serialize(g)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `star-dominion-${formatDate(g.tick)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importFile = (f: File) => {
    f.text().then((t) => { try { ui.load(deserialize(t)); } catch (err) { setMsg(`Could not load: ${(err as Error).message}`); } });
  };
  return (
    <div className="modal-back" onClick={() => ui.set({ menuOpen: false })}>
      <div className="modal sheet frame" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h1>Chancery</h1><div className="lede">Save, load or leave the realm. The game is paused.</div></div>
        <div className="sheet-body">
          <div className="field">
            <label htmlFor="savename">Save name</label>
            <div className="row"><input id="savename" className="grow" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn primary" onClick={doSave}>Save game</button></div>
          </div>
          <div className="section">
            <h3><span>Saved games</span><span className="aside">Stored in this browser</span></h3>
            {!saves.length && <div className="empty">No saved games yet.</div>}
            <div className="list">
              {saves.map((s) => (
                <div key={s.slot} className="li" style={{ cursor: 'default' }}>
                  <div className="grow"><div>{s.name}</div><div className="hint">{s.realm} · {formatDate(s.tick)} · saved {new Date(s.savedAt).toLocaleString()}</div></div>
                  <button className="btn small" onClick={() => loadGame(s.slot).catch((err) => setMsg(String(err)))}>Load</button>
                  <button className="btn small danger" onClick={() => deleteSave(s.slot).then(refresh)}>Delete</button>
                </div>
              ))}
            </div>
          </div>
          <div className="section">
            <h3><span>Files</span></h3>
            <div className="row wrap">
              <button className="btn" onClick={exportFile}>Export save file</button>
              <label className="btn">Import save file<input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} /></label>
            </div>
          </div>
          <div className="section">
            <h3><span>Options</span></h3>
            <label className="row"><input type="checkbox" checked={ui.pauseOnEvents} onChange={(e) => ui.set({ pauseOnEvents: e.target.checked })} /> Pause automatically on war, invasion and rebellion</label>
          </div>
          {msg && <div className="hint" style={{ marginTop: 10, color: 'var(--brass)' }}>{msg}</div>}
          <div className="row between" style={{ marginTop: 18 }}>
            <button className="btn danger" onClick={() => ui.quit()}>Quit to title</button>
            <button className="btn primary" onClick={() => ui.set({ menuOpen: false })}>Resume</button>
          </div>
        </div>
      </div>
    </div>
  );
}
