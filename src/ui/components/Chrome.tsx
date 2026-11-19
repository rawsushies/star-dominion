import { useEffect, useState } from 'react';
import { useUI, saveGame, loadGame, type ScreenId } from '../store';
import { formatDate } from '../../sim/util';
import { serialize, deserialize } from '../../sim/save';
import { listSaves, deleteSave, type SaveMeta } from '../../persistence/idb';
import { cls } from './common';
import { focusSystem } from './MapView';
import { AccountPanel } from './Account';
import { AudioSettings } from './AudioSettings';
import { audio } from '../../audio/manager';
import { assetFailures, onAssetFailure, type AssetFailure } from '../render/assets/loader';

export const NAV: { id: ScreenId; label: string; key?: string }[] = [
  { id: 'map', label: 'Galaxy', key: 'F1' },
  { id: 'throne', label: 'Throne room' },
  { id: 'kingdom', label: 'Kingdom' },
  { id: 'council', label: 'Council' },
  { id: 'capital', label: 'Capital' },
  { id: 'planets', label: 'Planets' },
  { id: 'system', label: 'Systems' },
  { id: 'fleets', label: 'Fleets' },
  { id: 'heroes', label: 'Hall of Heroes' },
  { id: 'military', label: 'Military' },
  { id: 'warroom', label: 'War room' },
  { id: 'economy', label: 'Economy' },
  { id: 'industry', label: 'Industry' },
  { id: 'operations', label: 'Operations' },
  { id: 'construction', label: 'Construction' },
  { id: 'trade', label: 'Trade' },
  { id: 'research', label: 'Research' },
  { id: 'techtree', label: 'Tech tree' },
  { id: 'diplomacy', label: 'Diplomacy' },
  { id: 'intel', label: 'Intelligence' },
  { id: 'journal', label: 'Journal' },
  { id: 'chronicle', label: 'Chronicle' },
  { id: 'codex', label: 'Imperial Codex', key: 'F2' },
];

export function jumpTo(ev: { systemId?: number; planetId?: number; battleId?: number; kind: string }) {
  const ui = useUI.getState();
  const g = ui.game!;
  if (ev.battleId != null) { ui.set({ battleId: ev.battleId, screen: 'military' }); return; }
  if (ev.kind === 'diplomacy' || ev.kind === 'treaty') { ui.set({ screen: 'diplomacy' }); return; }
  if (ev.kind === 'research') { ui.set({ screen: 'research' }); return; }
  if (ev.kind === 'council' || ev.kind === 'government') { ui.openScreen('council'); return; }
  if (ev.kind === 'capital' && ev.planetId == null) { ui.openScreen('capital'); return; }
  if (ev.kind === 'character' || ev.kind === 'capture') { ui.openScreen('heroes'); return; }
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

/** Names any 3D model that failed to load, so a placeholder is never shown without explanation. */
export function AssetNotice() {
  const [failed, setFailed] = useState<AssetFailure[]>(() => assetFailures());
  const [hidden, setHidden] = useState(false);
  useEffect(() => onAssetFailure(() => { setFailed(assetFailures()); setHidden(false); }), []);
  if (!failed.length || hidden) return null;
  const names = failed.map((f) => f.id.replace(/_/g, ' '));
  return (
    <div className="asset-notice" role="status" data-testid="asset-notice">
      <span>{failed.length === 1 ? '1 3D model' : `${failed.length} 3D models`} could not be loaded ({names.slice(0, 3).join(', ')}{names.length > 3 ? ', …' : ''}). A simple placeholder shape is shown in their place.</span>
      <button className="btn sm" onClick={() => setHidden(true)}>Dismiss</button>
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
      else if (e.key === 'F2') { e.preventDefault(); ui.openCodex(); }
      else if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) { audio.unlock(); audio.set({ muted: !audio.settings.muted }); }
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
            <h3><span>Cloud</span><span className="aside">Google account</span></h3>
            <AccountPanel />
          </div>
          <div className="section">
            <h3><span>Files</span></h3>
            <div className="row wrap">
              <button className="btn" onClick={exportFile}>Export save file</button>
              <label className="btn">Import save file<input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} /></label>
            </div>
          </div>
          <div className="section">
            <h3><span>Sound</span></h3>
            <AudioSettings compact />
          </div>
          <div className="section">
            <h3><span>Options</span></h3>
            <label className="row"><input type="checkbox" checked={ui.pauseOnEvents} onChange={(e) => ui.set({ pauseOnEvents: e.target.checked })} /> Pause automatically on war, invasion and rebellion</label>
            <div className="row" style={{ marginTop: 8 }}><button className="btn small" onClick={() => { ui.set({ menuOpen: false }); ui.openCodex(null, 'settings'); }}>Guidance settings and lessons</button></div>
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
