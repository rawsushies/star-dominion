import { useEffect, useState } from 'react';
import { slotForName } from '../../persistence/slots';
import { APP_VERSION } from '../../version';
import { useUI, saveGame, loadGame, type ScreenId } from '../store';
import { formatDate } from '../../sim/util';
import { serialize, deserialize } from '../../sim/save';
import { listSaves, deleteSave, type SaveMeta } from '../../persistence/idb';
import { cls } from './common';
import { focusSystem } from './MapView';
import { AccountPanel } from './Account';
import { AudioSettings } from './AudioSettings';
import { GraphicsSettings } from './GraphicsSettings';
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
  { id: 'vault', label: 'Relic Vault' },
  { id: 'conclave', label: 'High Conclave' },
  { id: 'cosmos', label: 'Ancients and threats' },
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
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      // leave browser and system shortcuts (Ctrl+1 switches tabs, ...) alone
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ui = useUI.getState();
      if (!ui.game) return;
      if (e.code === 'Space') { e.preventDefault(); (e.target as HTMLElement)?.blur?.(); ui.togglePause(); }
      else if (e.key === '1' || e.key === '2' || e.key === '3') ui.setSpeed(+e.key);
      else if (e.key === 'Escape') {
        if (ui.pendingOrder) ui.set({ pendingOrder: null });
        else if (ui.menuOpen) ui.set({ menuOpen: false });
        else if (ui.screen !== 'map') ui.set({ screen: 'map' });
        else if (ui.view === 'capital') { if (ui.capitalPlot != null) ui.set({ capitalPlot: null }); else ui.leaveCapital(); }
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
    const slot = slotForName(name);
    try { await saveGame(slot, name.trim() || 'Save'); setMsg(`Saved “${name}”.`); refresh(); } catch (err) { setMsg(String(err)); }
  };
  const exportFile = () => {
    const blob = new Blob([serialize(g)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `star-dominion-${formatDate(g.tick)}.json`;
    a.click();
    // revoking at once can cancel the download in some browsers
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const importFile = (f: File) => {
    f.text().then((t) => { try { ui.load(deserialize(t)); } catch (err) { setMsg(`Could not load that file: ${(err as Error).message}. Choose a save exported from Star Dominion.`); } }, () => setMsg('Could not read that file.'));
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
              <label className="btn">Import save file<input type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f); }} /></label>
            </div>
          </div>
          <div className="section">
            <h3><span>Sound</span></h3>
            <AudioSettings compact />
          </div>
          <div className="section">
            <h3><span>Graphics</span><span className="aside">Stored in this browser</span></h3>
            <GraphicsSettings />
          </div>
          <div className="section">
            <h3><span>Options</span></h3>
            <label className="row"><input type="checkbox" checked={ui.pauseOnEvents} onChange={(e) => ui.set({ pauseOnEvents: e.target.checked })} /> Pause automatically on war, invasion and rebellion</label>
            <div className="row" style={{ marginTop: 8 }}><button className="btn small" onClick={() => { ui.set({ menuOpen: false }); ui.openCodex(null, 'settings'); }}>Guidance settings and lessons</button></div>
          </div>
          <div className="section">
            <h3><span>Controls</span></h3>
            <table className="tbl keys-tbl">
              <tbody>
                <tr><td><kbd>Space</kbd></td><td>Pause or resume time</td></tr>
                <tr><td><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></td><td>Game speed: slow, normal, fast</td></tr>
                <tr><td><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>, <kbd>Q</kbd> <kbd>E</kbd></td><td>Move and turn the map camera (or drag with the mouse; scroll to zoom)</td></tr>
                <tr><td><kbd>Esc</kbd></td><td>Close the open window, cancel an order, or step back out</td></tr>
                <tr><td><kbd>F1</kbd> / <kbd>F2</kbd></td><td>Back to the map / open the Codex</td></tr>
                <tr><td><kbd>M</kbd></td><td>Mute or unmute sound</td></tr>
                <tr><td>Right-click</td><td>Send the selected fleet to a star</td></tr>
              </tbody>
            </table>
          </div>
          <div className="hint" style={{ marginTop: 10 }}>Star Dominion {APP_VERSION} · single-player · saves stay in this browser unless you sign in or export them.</div>
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
