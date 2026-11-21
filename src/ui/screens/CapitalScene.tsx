// The imperial capital as a full-screen scene: the city fills the viewport behind the HUD, and
// compact floating panels carry the management. Every control issues the same simulation
// commands as before (capitalBuild, capitalCancel); plots, levels and queues are the game's own.
//   - title card (top left): the world, Citadel level, open plots, builders, and the toolbar
//   - builders' queue (under the title card): progress and cancel
//   - contextual panel (right; a bottom sheet on narrow screens): the selected building, an open
//     plot's build list, a sealed plot, or the city overview

import { useEffect, useRef, useState } from 'react';
import { useUI, useGame } from '../store';
import { Term } from '../components/Guidance';
import { CostView, Meter, cls } from '../components/common';
import { CAPITAL_BUILDINGS, CAPITAL_BY_ID, CITADEL_MAX, CITADEL_PLOT, PLOT_COLS, PLOT_ROWS, plotsUnlocked } from '../../sim/data/capital';
import { capLevel, openPlots, plotOccupant, canQueueCapital, capitalCost, capitalDays, plannedLevel, citadelRequirements, maxQueue, builders, capitalMods } from '../../sim/capital';
import { CityCanvas, BuildingCard, type CityView } from './Capital';
import { modText } from './Council';
import type { Empire, GameState } from '../../sim/types';

type PanelMode = 'auto' | 'build' | 'effects';

export function CapitalScene() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const plot = ui.capitalPlot;
  const view = useRef<CityView | null>(null);
  const [mode, setMode] = useState<PanelMode>('auto');
  // on a phone the panel opens only for a selection, so the city has the screen
  const [panelOpen, setPanelOpen] = useState(() => plot != null || !(typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)').matches));
  const select = (p: number | null) => { ui.set({ capitalPlot: p }); setMode('auto'); setPanelOpen(true); };
  // selecting a plot (in the scene, a label or the panel) glides the camera to it
  useEffect(() => { if (plot != null) (view.current as { focusPlot?(p: number): void } | null)?.focusPlot?.(plot); }, [plot]);
  if (!me.capital) {
    return (
      <section className="capital-scene" aria-label="Capital">
        <div className="cap-title glass"><h1>Imperial capital</h1><p className="hint">Your realm has no capital city.</p>
          <button className="btn small" onClick={() => ui.leaveCapital()}>Return to the galaxy</button></div>
      </section>
    );
  }
  const cap = me.capital;
  const cit = capLevel(me, 'citadel');
  const open = openPlots(me);
  const world = me.capitalPlanetId != null ? g.planets[me.capitalPlanetId] : null;
  const freePlot = open.find((p) => !plotOccupant(cap, p));
  return (
    <section className="capital-scene" aria-label="Capital">
      <div className="cap-canvas"><CityCanvas sel={plot} onPick={select} height="100%" onView={(v) => { view.current = v; }} /></div>

      <div className="cap-title glass" data-testid="capital-title">
        <div className="row between">
          <h1>Imperial capital</h1>
          <button className="wbtn" onClick={() => ui.leaveCapital()} aria-label="Return to the galaxy" title="Return to the galaxy (Esc)">×</button>
        </div>
        <div className="cap-facts">
          <span>{world?.name ?? 'The capital'}</span>
          <span><Term entry="mech.capital">Citadel</Term> <b>{cit}</b>/{CITADEL_MAX}</span>
          <span><b>{open.length}</b>/{PLOT_COLS * PLOT_ROWS} plots</span>
          <span><b>{builders(me)}</b> builder crew{builders(me) > 1 ? 's' : ''}</span>
        </div>
        <div className="cap-tools" role="toolbar" aria-label="Capital actions">
          <button className={cls('btn small', plot === CITADEL_PLOT && 'on')} onClick={() => select(CITADEL_PLOT)}>Citadel</button>
          <button className={cls('btn small', mode === 'build' && 'on')} onClick={() => { ui.set({ capitalPlot: freePlot ?? null }); setMode('build'); setPanelOpen(true); }} disabled={freePlot == null} title={freePlot == null ? 'Every open plot is built on: raise the Citadel to open more' : 'Choose a building for the next free plot'}>Build</button>
          <button className={cls('btn small', mode === 'effects' && 'on')} onClick={() => { ui.set({ capitalPlot: null }); setMode('effects'); setPanelOpen(true); }}>City effects</button>
          <button className="btn small" onClick={() => { ui.set({ capitalPlot: null }); setMode('auto'); (view.current as { frameCity?(): void } | null)?.frameCity?.(); }}>Whole city</button>
        </div>
        <Queue />
      </div>

      {panelOpen && (
        <aside className="cap-panel glass" aria-label="Capital panel" data-guide="capital-build">
          <button className="wbtn cap-panel-x" onClick={() => { setPanelOpen(false); ui.set({ capitalPlot: null }); }} aria-label="Close the panel">×</button>
          <PanelBody plot={plot} mode={mode} onSelect={select} />
        </aside>
      )}
    </section>
  );
}

function Queue() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const cap = me.capital!;
  return (
    <div className="cap-queue" aria-label="Builders' queue">
      <div className="cap-queue-h"><span>Builders' queue</span><span className="hint">{cap.queue.length}/{maxQueue(me)}</span></div>
      {!cap.queue.length && <div className="hint">Nothing under construction.</div>}
      {cap.queue.map((j, i) => (
        <div key={i} className="cap-job" data-testid="capital-job">
          <button className="linkish grow" onClick={() => ui.set({ capitalPlot: j.plot })}>{CAPITAL_BY_ID[j.building].label} → {j.toLevel}</button>
          <span className="cap-job-bar"><Meter value={j.progress} max={j.total} /></span>
          <span className="hint num">{j.total - j.progress}d</span>
          <button className="wbtn" onClick={() => ui.cmd({ type: 'capitalCancel', index: i })} title="Cancel (returns 75% of the cost)" aria-label={`Cancel ${CAPITAL_BY_ID[j.building].label}`}>×</button>
        </div>
      ))}
    </div>
  );
}

function PanelBody({ plot, mode, onSelect }: { plot: number | null; mode: PanelMode; onSelect: (p: number | null) => void }) {
  const g = useGame();
  const me = g.empires[g.playerId];
  const cap = me.capital!;
  const cit = capLevel(me, 'citadel');
  const open = openPlots(me);
  if (mode === 'effects' && plot == null) return <Effects />;
  if (plot == null) {
    return (
      <>
        <h2>The city</h2>
        <p className="hint">Tap a building to manage it, or an open plot (gold kerb) to build there. Use Build to fill the next free plot.</p>
        <CitadelNext />
        <Effects compact />
      </>
    );
  }
  const occupant = plotOccupant(cap, plot);
  if (occupant) return <BuildingPanel id={occupant} />;
  if (!open.includes(plot)) {
    return (
      <>
        <h2>A sealed plot</h2>
        <p className="hint">Raise the Citadel to open more of the city. Level {cit + 1} opens {plotsUnlocked(cit + 1)} plots.</p>
        <button className="btn small primary" onClick={() => onSelect(CITADEL_PLOT)}>Go to the Citadel</button>
      </>
    );
  }
  return (
    <>
      <h2>An open plot</h2>
      <p className="hint">Choose a great work to raise here.</p>
      <Catalogue plot={plot} />
    </>
  );
}

function nextInfo(g: GameState, me: Empire, id: string, plot?: number) {
  const d = CAPITAL_BY_ID[id];
  const nl = plannedLevel(me, id) + 1;
  const cap = me.capital!;
  const usePlot = cap.buildings[id] || cap.queue.some((j) => j.building === id) ? undefined : plot;
  return { d, nl, usePlot, why: canQueueCapital(g, me, id, usePlot), done: nl > d.maxLevel };
}

function BuildingPanel({ id }: { id: string }) {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const { d, nl, why, done } = nextInfo(g, me, id);
  const job = me.capital!.queue.findIndex((j) => j.building === id);
  return (
    <>
      <h2><Term entry={`cap.${id}`}>{d.label}</Term></h2>
      <BuildingCard id={id} />
      {job >= 0 && (
        <div className="cap-inwork">
          <span>Raising to level {me.capital!.queue[job].toLevel}</span>
          <Meter value={me.capital!.queue[job].progress} max={me.capital!.queue[job].total} />
          <span className="hint">{me.capital!.queue[job].total - me.capital!.queue[job].progress} days</span>
          <button className="btn small" onClick={() => ui.cmd({ type: 'capitalCancel', index: job })} title="Returns 75% of the cost">Cancel</button>
        </div>
      )}
      {id === 'citadel' && <CitadelNext />}
      <div className="cap-next">
        {done ? <span className="hint">At its highest level.</span> : (
          <>
            <div className="cap-next-h">Level {nl}: <span className="hint">{capitalDays(g, me, d, nl)} days</span></div>
            <CostView cost={capitalCost(d, nl)} empire={me} />
            <div className="hint">+{Object.entries(d.perLevel).map(([k, v]) => modText(k, v)).join(', ')}</div>
            <button className="btn primary cap-act" disabled={!!why} title={why ?? `Raise to level ${nl}`} onClick={() => ui.cmd({ type: 'capitalBuild', building: id })} data-testid="capital-upgrade">Upgrade to level {nl}</button>
            {why && <div className="hint cap-why">{why}</div>}
          </>
        )}
      </div>
    </>
  );
}

function Catalogue({ plot }: { plot: number }) {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const fresh = CAPITAL_BUILDINGS.filter((d) => plannedLevel(me, d.id) === 0);
  if (!fresh.length) return <p className="hint">Every great work already stands in the city. Upgrade them instead.</p>;
  return (
    <div className="cap-cat">
      {fresh.map((d) => {
        const { why } = nextInfo(g, me, d.id, plot);
        return (
          <div key={d.id} className="cap-cat-li" data-testid={`cap-${d.id}`}>
            <div className="grow">
              <div className="cap-cat-n"><Term entry={`cap.${d.id}`}>{d.label}</Term></div>
              <div className="hint">{Object.entries(d.perLevel).map(([k, v]) => modText(k, v)).join(', ')} per level</div>
              <CostView cost={capitalCost(d, 1)} empire={me} /> <span className="hint">· {capitalDays(g, me, d, 1)} days</span>
            </div>
            <button className="btn small primary" disabled={!!why} title={why ?? 'Build on this plot'} onClick={() => ui.cmd({ type: 'capitalBuild', building: d.id, plot })}>Build</button>
          </div>
        );
      })}
    </div>
  );
}

function CitadelNext() {
  const g = useGame();
  const me = g.empires[g.playerId];
  const cit = capLevel(me, 'citadel');
  if (cit >= CITADEL_MAX) return null;
  const next = citadelRequirements(cit + 1);
  return (
    <p className="hint">{next.otherLevels || next.throneHall
      ? `Citadel ${cit + 1} needs ${[next.otherLevels ? `${next.otherLevels} levels of other buildings` : '', next.throneHall ? `a level ${next.throneHall} throne hall` : ''].filter(Boolean).join(' and ')}, and opens ${plotsUnlocked(cit + 1)} plots.`
      : `Citadel ${cit + 1} has no requirements beyond its cost, and opens ${plotsUnlocked(cit + 1)} plots.`}</p>
  );
}

function Effects({ compact = false }: { compact?: boolean }) {
  const g = useGame();
  const me = g.empires[g.playerId];
  const mods = Object.entries(capitalMods(me)).filter(([, v]) => v);
  return (
    <div className="cap-effects">
      {!compact && <h2>What the city gives the realm</h2>}
      {compact && <div className="cap-next-h">What the city gives the realm</div>}
      {!mods.length && <div className="hint">Nothing yet.</div>}
      <div className="row wrap" style={{ gap: '3px 12px' }}>{mods.map(([k, v]) => <span key={k} className={v > 0 === (k !== 'shipCost') ? 'pos' : 'neg'}>{modText(k, v)}</span>)}</div>
    </div>
  );
}
