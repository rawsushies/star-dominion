import { useUI, useGame } from '../store';
import { STATION_COST } from '../../sim/commands';
import { OP_KINDS, OP_MODES, OP_MAX_LEVEL, canBuildStationOn, opUpgradeCost, opReport, logisticsCapacity } from '../../sim/operations';
import { empireMods } from '../../sim/modifiers';
import { supplyNetwork } from '../../sim/territory';
import { getLedger } from '../../sim/engine';
import { CostView, Meter, Tip, cls, fmt } from './common';
import type { OpMode, Planet, StationKind } from '../../sim/types';

const KINDS: StationKind[] = ['mining', 'energy', 'gas', 'research'];

/** Buttons to found an operation on an uncolonised body the player owns. */
export function StationButtons({ p, small }: { p: Planet; small?: boolean }) {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  return (
    <>
      {KINDS.filter((k) => !canBuildStationOn(p, k)).map((k) => (
        <Tip key={k} content={<div><h4>{OP_KINDS[k].label}</h4><CostView cost={STATION_COST} empire={me} /><div className="hint">{OP_KINDS[k].description} Produces {OP_KINDS[k].produces}. Uses one level of freighter capacity.</div></div>}>
          <button className={cls('btn', small && 'small')} onClick={() => ui.cmd({ type: 'buildStation', planetId: p.id, kind: k })}>{OP_KINDS[k].label}</button>
        </Tip>
      ))}
    </>
  );
}

/** Live report and controls for one operation. */
export function OpPanel({ p }: { p: Planet }) {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  if (!p.station || !p.op) return null;
  const mods = empireMods(g, me);
  const L = getLedger(g, me);
  const eff = L.logisticsUsed > L.logisticsCap ? L.logisticsCap / L.logisticsUsed : 1;
  const r = opReport(g, me, p, mods, { network: supplyNetwork(g, me.id), logisticsEff: eff });
  const mine = g.galaxy.systems[p.systemId].owner === g.playerId;
  const next = p.op.level < OP_MAX_LEVEL ? opUpgradeCost(p.op.level + 1) : null;
  void logisticsCapacity;
  return (
    <div data-testid="op-panel">
      <div className="kv">
        <span>Operation</span><span>{OP_KINDS[p.station].label}, level {p.op.level}/{OP_MAX_LEVEL}</span>
        <span>Status</span><span className={cls(r.status !== 'running' && 'neg')}>{r.status[0].toUpperCase() + r.status.slice(1)}</span>
        <span>Delivers</span><span>{r.output.length ? r.output.map(([k, v]) => `${fmt(v, 1)} ${k}`).join(', ') : 'nothing'} a month</span>
        <span>Upkeep</span><span>{r.upkeep.length ? r.upkeep.map(([k, v]) => `${fmt(-v, 1)} ${k}`).join(', ') : 'none'}</span>
        <span>Reserve</span><span className="row" style={{ gap: 6 }}><span style={{ width: 90 }}><Meter value={p.op.reserve * 100} tone={p.op.reserve < 0.3 ? 'r' : undefined} /></span>{Math.round(p.op.reserve * 100)}%</span>
      </div>
      {r.notes.map((n) => <div key={n} className="hint">{n}.</div>)}
      {mine && (
        <>
          <div className="seg" style={{ marginTop: 6 }}>
            {(Object.keys(OP_MODES) as OpMode[]).map((m) => <button key={m} title={OP_MODES[m].description} className={cls(p.op!.mode === m && 'on')} onClick={() => ui.cmd({ type: 'setOperationMode', planetId: p.id, mode: m })}>{OP_MODES[m].label}</button>)}
          </div>
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            {next && <><button className="btn small" onClick={() => ui.cmd({ type: 'upgradeOperation', planetId: p.id })}>Upgrade to level {p.op.level + 1}</button><CostView cost={next} empire={me} /></>}
            <button className="btn small danger" onClick={() => { if (confirm('Dismantle this operation? A quarter of its minerals are recovered.')) ui.cmd({ type: 'dismantleOperation', planetId: p.id }); }}>Dismantle</button>
          </div>
        </>
      )}
    </div>
  );
}
