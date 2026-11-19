import { useEffect, useRef, useState } from 'react';
import { Term } from '../components/Guidance';
import { useUI, useGame } from '../store';
import { CAPITAL_BUILDINGS, CAPITAL_BY_ID, CITADEL_MAX, PLOT_COLS, PLOT_ROWS, plotsUnlocked } from '../../sim/data/capital';
import { CapitalView3D, type CapitalLabel } from '../render/capital3d';
import {
  capLevel, openPlots, plotOccupant, canQueueCapital, capitalCost, capitalDays, plannedLevel, citadelRequirements, maxQueue, builders, capitalMods,
} from '../../sim/capital';
import { Sheet, Section, Meter, CostView, cls } from '../components/common';
import { modText } from './Council';

export function CityCanvas({ sel, onPick, height = 420 }: { sel: number | null; onPick?: (p: number | null) => void; height?: number }) {
  const g = useGame();
  const me = g.empires[g.playerId];
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const view = useRef<CapitalView3D | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    if (!canvas.current || !overlay.current) return;
    const v = new CapitalView3D(canvas.current, overlay.current, me.color, (p) => pick.current?.(p));
    view.current = v;
    (window as unknown as { __sdCapital?: CapitalView3D }).__sdCapital = v;
    return () => { v.dispose(); view.current = null; };
  }, [me.color]);
  useEffect(() => {
    const cap = me.capital;
    if (!view.current || !cap) return;
    const labels: CapitalLabel[] = [];
    const seen = new Set<string>();
    for (const [id, b] of Object.entries(cap.buildings)) {
      const job = cap.queue.find((j) => j.building === id);
      labels.push({ plot: b.plot, name: CAPITAL_BY_ID[id].label, level: b.level, building: !!job, progress: job ? job.progress / job.total : 0, days: job ? job.total - job.progress : 0 });
      seen.add(id);
    }
    for (const j of cap.queue) if (!seen.has(j.building)) { seen.add(j.building); labels.push({ plot: j.plot, name: CAPITAL_BY_ID[j.building].label, level: 0, building: true, progress: j.progress / j.total, days: j.total - j.progress }); }
    view.current.sync(me, labels, sel);
  });
  return (
    <div data-guide="capital-plots" style={{ position: 'relative', height, overflow: 'hidden' }}>
      <canvas ref={canvas} data-testid="city" style={{ width: '100%', height: '100%', display: 'block', cursor: onPick ? 'pointer' : 'grab', touchAction: 'none' }} />
      <div ref={overlay} className="cap-overlay" />
      <div className="cap-help">Drag to turn the city, scroll to zoom, select a plot to build.</div>
    </div>
  );
}

export function CapitalScreen() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const [plot, setPlot] = useState<number | null>(null);
  if (!me.capital) return <Sheet title="Imperial capital"><div className="empty">Your realm has no capital city.</div></Sheet>;
  const cap = me.capital;
  const cit = capLevel(me, 'citadel');
  const occupant = plot != null ? plotOccupant(cap, plot) : null;
  const open = openPlots(me);
  const freePlot = plot != null && open.includes(plot) && !occupant ? plot : open.find((p) => !plotOccupant(cap, p));
  const next = citadelRequirements(cit + 1);
  const mods = capitalMods(me);
  const world = me.capitalPlanetId != null ? g.planets[me.capitalPlanetId] : null;
  return (
    <Sheet title="Imperial capital" lede={`${world?.name ?? 'The capital'}: Citadel level ${cit} of ${CITADEL_MAX}. ${open.length} of ${PLOT_COLS * PLOT_ROWS} plots open. ${builders(me)} builder crew${builders(me) > 1 ? 's' : ''}, queue of ${maxQueue(me)}.`}>
      <div style={{ border: '1px solid var(--rule)', marginBottom: 10 }}><CityCanvas sel={plot} onPick={setPlot} /></div>
      <div className="cols c2">
        <div>
          <Section title={plot == null ? 'Choose a plot in the city' : occupant ? CAPITAL_BY_ID[occupant].label : open.includes(plot) ? 'An open plot' : 'A sealed plot'}>
            {plot == null && <p className="hint">Select a plot to build on it, or a building to upgrade it. New buildings are placed on the selected plot, or the nearest free one.</p>}
            {plot != null && !occupant && !open.includes(plot) && <p className="hint">Raise the Citadel to open more of the city. Level {cit + 1} opens {plotsUnlocked(cit + 1)} plots.</p>}
            {occupant && <BuildingCard id={occupant} />}
          </Section>
          <Section title="Builders' queue" aside={`${cap.queue.length}/${maxQueue(me)}`}>
            {!cap.queue.length && <div className="hint">Nothing under construction.</div>}
            {cap.queue.map((j, i) => (
              <div key={i} className="row" style={{ gap: 8, padding: '3px 0' }} data-testid="capital-job">
                <span className="grow">{CAPITAL_BY_ID[j.building].label} → level {j.toLevel}</span>
                <span style={{ width: 120 }}><Meter value={j.progress} max={j.total} /></span>
                <span className="hint" style={{ width: 70 }}>{j.total - j.progress} days</span>
                <button className="btn small" onClick={() => ui.cmd({ type: 'capitalCancel', index: i })} title="Returns 75% of the cost">Cancel</button>
              </div>
            ))}
          </Section>
          <Section title={<Term entry="mech.capital">What the city gives the realm</Term>}>
            <div className="row wrap" style={{ gap: '4px 14px' }}>{Object.entries(mods).filter(([, v]) => v).map(([k, v]) => <span key={k} className={v > 0 === (k !== 'shipCost') ? 'pos' : 'neg'}>{modText(k, v)}</span>)}</div>
          </Section>
        </div>
        <div>
          <Section title="Raise or extend" guide="capital-build">
            <div className="hint" style={{ marginBottom: 6 }}>Citadel {cit + 1} needs {next.otherLevels} levels of other buildings and a level {next.throneHall} throne hall.</div>
            <table className="t">
              <thead><tr><th>Building</th><th className="n">Level</th><th>Next level</th><th></th></tr></thead>
              <tbody>
                {CAPITAL_BUILDINGS.map((d) => {
                  const nl = plannedLevel(me, d.id) + 1;
                  const usePlot = cap.buildings[d.id] || cap.queue.some((j) => j.building === d.id) ? undefined : freePlot;
                  const why = canQueueCapital(g, me, d.id, usePlot);
                  return (
                    <tr key={d.id} className={cls(occupant === d.id && 'sel')} data-testid={`cap-${d.id}`}>
                      <td><div style={{ fontWeight: 600 }}><Term entry={`cap.${d.id}`}>{d.label}</Term></div><div className="hint">{Object.entries(d.perLevel).map(([k, v]) => modText(k, v)).join(', ')}{d.notes ? ` ${d.notes}` : ''} per level</div></td>
                      <td className="n">{capLevel(me, d.id)}/{d.maxLevel}</td>
                      <td>{nl <= d.maxLevel ? <><CostView cost={capitalCost(d, nl)} empire={me} /><div className="hint">{capitalDays(g, me, d, nl)} days</div></> : <span className="hint">Complete</span>}</td>
                      <td><button className="btn small" disabled={!!why} title={why ?? (nl === 1 ? 'Build on the selected or nearest free plot' : `Raise to level ${nl}`)} onClick={() => ui.cmd({ type: 'capitalBuild', building: d.id, plot: usePlot })}>{nl === 1 ? 'Build' : 'Upgrade'}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
        </div>
      </div>
    </Sheet>
  );
}

function BuildingCard({ id }: { id: string }) {
  const g = useGame();
  const me = g.empires[g.playerId];
  const d = CAPITAL_BY_ID[id];
  const lvl = capLevel(me, id);
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>{d.description}</p>
      <div className="kv">
        <span>Level</span><span>{lvl || 'Under construction'} of {d.maxLevel}</span>
        <span>Gives</span><span>{Object.entries(d.perLevel).map(([k, v]) => modText(k, v * Math.max(1, lvl))).join(', ') || '—'}</span>
      </div>
      {d.notes && <p className="hint">{d.notes}</p>}
    </>
  );
}
