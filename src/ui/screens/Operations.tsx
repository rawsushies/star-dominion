import { useState } from 'react';
import { useUI, useGame } from '../store';
import { OP_KINDS, OP_MODES, opsOf, opReport } from '../../sim/operations';
import { empireMods } from '../../sim/modifiers';
import { supplyNetwork } from '../../sim/territory';
import { getLedger } from '../../sim/engine';
import { planetIndustrialist } from '../../sim/characters';
import { Sheet, Section, Meter, cls, fmt } from '../components/common';
import { OpPanel } from '../components/OpControls';
import { focusSystem } from '../components/MapView';
import type { OpMode } from '../../sim/types';

export function OperationsScreen() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const L = getLedger(g, me);
  const ops = opsOf(g, me.id);
  const [sel, setSel] = useState<number | null>(null);
  const mods = empireMods(g, me);
  const net = supplyNetwork(g, me.id);
  const eff = L.logisticsUsed > L.logisticsCap ? L.logisticsCap / L.logisticsUsed : 1;
  const rows = ops.map((p) => ({ p, r: opReport(g, me, p, mods, { network: net, logisticsEff: eff }) }));
  const totals: Record<string, number> = {};
  for (const { r } of rows) for (const [k, v] of r.output) totals[k] = (totals[k] ?? 0) + v;
  const cur = ops.find((p) => p.id === sel) ?? ops[0];
  const setAll = (mode: OpMode) => { for (const p of ops) ui.cmd({ type: 'setOperationMode', planetId: p.id, mode }); };
  return (
    <Sheet title="Resource operations" lede={`${ops.length} operations on uncolonised worlds. Their output joins the realm's stockpiles through its freighters and supply lanes.`}>
      <div className="stat-strip">
        <div className="stat"><div className="k">Freighter capacity</div><div className={cls('v', L.logisticsUsed > L.logisticsCap && 'neg')}>{L.logisticsUsed}/{L.logisticsCap}</div><div className="s">{eff < 1 ? `Overstretched: ${Math.round(eff * 100)}% delivered` : 'Operation levels in service'}</div></div>
        {Object.entries(totals).map(([k, v]) => <div key={k} className="stat"><div className="k">{k}</div><div className="v">+{fmt(v, 1)}</div><div className="s">a month</div></div>)}
      </div>
      <p className="hint">Capacity: 4, plus 2 per spaceport, 1 per two levels of the imperial shipyards, and 3 per logistics tender. Operations outside the supply network deliver half; hostile warships in the system stop deliveries altogether.</p>
      <div className="row wrap" style={{ gap: 6, margin: '6px 0' }}>
        <span className="hint">Set every operation to:</span>
        {(Object.keys(OP_MODES) as OpMode[]).map((m) => <button key={m} className="btn small" onClick={() => setAll(m)}>{OP_MODES[m].label}</button>)}
      </div>
      <div className="cols c2">
        <div>
          <table className="t" data-testid="ops-table">
            <thead><tr><th>Site</th><th>Operation</th><th>Mode</th><th>Reserve</th><th>Delivers</th></tr></thead>
            <tbody>
              {rows.map(({ p, r }) => (
                <tr key={p.id} className={cls('click', cur?.id === p.id && 'sel')} onClick={() => setSel(p.id)}>
                  <td>{p.name}<div className="hint">{g.galaxy.systems[p.systemId].name}{planetIndustrialist(g, p.id) ? ' · industrialist' : ''}</div></td>
                  <td>{OP_KINDS[p.station!].label} {p.op!.level}</td>
                  <td className={cls(r.status !== 'running' && 'neg')}>{r.status === 'running' ? OP_MODES[p.op!.mode].label : r.status}</td>
                  <td style={{ width: 90 }}><Meter value={p.op!.reserve * 100} tone={p.op!.reserve < 0.3 ? 'r' : undefined} /></td>
                  <td className="hint">{r.output.map(([k, v]) => `${fmt(v, 1)} ${k}`).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!ops.length && <div className="empty">No operations yet. Select an uncolonised world in a system you own and found a mining operation, energy collector, gas harvester or research outpost.</div>}
        </div>
        <div>
          {cur && (
            <Section title={`${cur.name}`} aside={<button className="btn small" onClick={() => { focusSystem(cur.systemId); ui.set({ screen: 'map', view: 'system', systemId: cur.systemId, planetId: cur.id }); }}>Show on map</button>}>
              <OpPanel p={cur} />
            </Section>
          )}
        </div>
      </div>
    </Sheet>
  );
}
