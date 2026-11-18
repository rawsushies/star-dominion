import { useState } from 'react';
import { useUI, useGame } from '../store';
import { SHIPS, SHIP_ORDER } from '../../sim/data/ships';
import { fleetPower, admiralOf, shipStats, fleetSpeed, fleetCommand } from '../../sim/fleets';
import { ADMIRAL_COST } from '../../sim/commands';
import { getLedger } from '../../sim/engine';
import { costValue } from '../../sim/util';
import { Sheet, Section, Meter, CostView, cls, fmt } from '../components/common';
import { orderText } from '../components/ContextPanel';
import { focusSystem } from '../components/MapView';
import type { Fleet } from '../../sim/types';

export function FleetsScreen() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const L = getLedger(g, me);
  const fleets = Object.values(g.fleets).filter((f) => f.ownerId === g.playerId).sort((a, b) => fleetPower(g, b) - fleetPower(g, a));
  const sel = fleets.find((f) => f.id === ui.fleetId) ?? fleets[0];
  const admirals = g.admirals.filter((a) => a.ownerId === g.playerId && a.alive);
  return (
    <Sheet title="Fleet management" lede={`${fleets.length} fleets, ${fleets.reduce((a, f) => a + f.ships.length, 0)} ships. Naval capacity ${L.navalUsed}/${L.navalCap}.`}>
      <div className="cols side">
        <div style={{ alignSelf: 'start' }}>
          <div className="list">
            {fleets.map((f) => (
              <div key={f.id} className={cls('li', sel?.id === f.id && 'sel')} onClick={() => ui.set({ fleetId: f.id })}>
                <div className="grow">
                  <div className="row between"><span>{f.name}</span><span className="num">{fleetPower(g, f)}</span></div>
                  <div className="hint">{f.ships.length} ships · {orderText(g, f)}</div>
                </div>
              </div>
            ))}
          </div>
          <Section title="Admiralty" aside={`${admirals.length}/6`}>
            {admirals.map((a) => (
              <div key={a.id} className="row between" style={{ padding: '3px 0' }}>
                <span>Admiral {a.name} <span className="faint">· skill {a.skill} · {a.trait}</span></span>
                <span className="hint">{a.fleetId != null && g.fleets[a.fleetId] ? g.fleets[a.fleetId].name : 'Unassigned'}</span>
              </div>
            ))}
            <div className="row" style={{ marginTop: 6 }}><button className="btn small" onClick={() => ui.cmd({ type: 'recruitAdmiral' })}>Recruit admiral</button><CostView cost={ADMIRAL_COST} empire={me} /></div>
            <p className="hint">Admirals add 3% damage per skill level plus a trait. They gain skill in battle and may die with their fleet.</p>
          </Section>
        </div>
        {sel ? <FleetDetail f={sel} /> : <div className="empty">No fleets. Build ships at a shipyard.</div>}
      </div>
    </Sheet>
  );
}

function FleetDetail({ f }: { f: Fleet }) {
  const g = useGame();
  const ui = useUI();
  const e = g.empires[f.ownerId];
  const [name, setName] = useState(f.name);
  const [picked, setPicked] = useState<number[]>([]);
  const adm = admiralOf(g, f);
  const admirals = g.admirals.filter((a) => a.ownerId === g.playerId && a.alive);
  const counts: Record<string, number> = Object.create(null);
  for (const s of f.ships) counts[s.cls] = (counts[s.cls] ?? 0) + 1;
  let upkeep = 0, value = 0;
  for (const s of f.ships) { upkeep += SHIPS[s.cls].upkeep.credits ?? 0; value += costValue(SHIPS[s.cls].cost); }
  return (
    <div style={{ minWidth: 0 }}>
      <div className="row" style={{ gap: 8 }}>
        <input className="serif" style={{ fontSize: 30, fontWeight: 600, background: 'transparent', border: 0, borderBottom: '1px solid var(--rule)', color: 'var(--vellum)', flex: 1, minWidth: 0 }}
          value={name} onChange={(ev) => setName(ev.target.value)} onBlur={() => name !== f.name && ui.cmd({ type: 'renameFleet', fleetId: f.id, name })} aria-label="Fleet name" />
        <button className="btn" onClick={() => { focusSystem(f.systemId); ui.set({ screen: 'map', view: 'galaxy', fleetId: f.id, systemId: f.systemId }); }}>Show on map</button>
      </div>
      <div className="stat-strip" style={{ marginTop: 12 }}>
        <div className="stat"><div className="k">Strength</div><div className="v">{fleetPower(g, f)}</div></div>
        <div className="stat"><div className="k">Location</div><div className="v" style={{ fontSize: 18 }}>{g.galaxy.systems[f.systemId].name}</div><div className="s">{orderText(g, f)}</div></div>
        <div className="stat"><div className="k">Supply</div><div className={cls('v', f.supply < 25 && 'neg')}>{Math.round(f.supply)}%</div><div className="s">{f.supply <= 0 ? 'Attrition! Return to friendly space' : 'Drains outside your supply network'}</div></div>
        <div className="stat"><div className="k">Speed</div><div className="v">{fleetSpeed(g, f).toFixed(1)}</div><div className="s">limited by slowest hull</div></div>
        <div className="stat"><div className="k">Naval capacity</div><div className="v">{fleetCommand(f)}</div><div className="s">upkeep {upkeep.toFixed(1)} credits/month</div></div>
        <div className="stat"><div className="k">Replacement value</div><div className="v">{fmt(value)}</div><div className="s">lost if destroyed</div></div>
      </div>
      <div className="cols c2" style={{ marginTop: 4 }}>
        <div>
          <Section title="Ships" aside={picked.length ? `${picked.length} selected` : 'Select ships to split them off'}>
            <table className="t">
              <thead><tr><th></th><th>Class</th><th>Hull &amp; armour</th><th className="n">Shields</th><th className="n">XP</th></tr></thead>
              <tbody>
                {f.ships.slice().sort((a, b) => SHIP_ORDER.indexOf(a.cls) - SHIP_ORDER.indexOf(b.cls)).map((s) => {
                  const st = shipStats(g, e, s.cls, adm);
                  const on = picked.includes(s.id);
                  return (
                    <tr key={s.id} className={cls('click', on && 'sel')} onClick={() => setPicked(on ? picked.filter((x) => x !== s.id) : [...picked, s.id])}>
                      <td><input type="checkbox" readOnly checked={on} aria-label="Select ship" /></td>
                      <td>{SHIPS[s.cls].label}</td>
                      <td style={{ width: 140 }}><Meter value={s.hull + s.armor} max={st.hull + st.armor} tone={(s.hull + s.armor) / (st.hull + st.armor) < 0.4 ? 'r' : 'v'} /></td>
                      <td className="n">{Math.round(s.shields)}/{Math.round(st.shields)}</td>
                      <td className="n">{s.xp}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn small" disabled={!picked.length || picked.length === f.ships.length} onClick={() => { ui.cmd({ type: 'splitFleet', fleetId: f.id, shipIds: picked }); setPicked([]); }}>Split selected into new fleet</button>
              <button className="btn small danger" onClick={() => { if (confirm(`Scrap ${f.name}? Ships in your territory return 25% of their alloys.`)) ui.cmd({ type: 'disbandFleet', fleetId: f.id }); }}>Scrap fleet</button>
            </div>
          </Section>
        </div>
        <div>
          <Section title="Composition">
            <div className="kv">{SHIP_ORDER.filter((c) => counts[c]).map((c) => [<span key={c}>{SHIPS[c].label} <span className="faint">({SHIPS[c].role})</span></span>, <span key={c + 'n'}>{counts[c]}</span>])}</div>
          </Section>
          <Section title="Command">
            <div className="field">
              <label htmlFor="adm">Admiral</label>
              <select id="adm" value={f.admiralId ?? ''} onChange={(ev) => ui.cmd({ type: 'assignAdmiral', fleetId: f.id, admiralId: ev.target.value === '' ? null : +ev.target.value })}>
                <option value="">None</option>
                {admirals.map((a) => <option key={a.id} value={a.id}>{a.name} — skill {a.skill}, {a.trait}{a.fleetId != null && a.fleetId !== f.id && g.fleets[a.fleetId] ? ` (commands ${g.fleets[a.fleetId].name})` : ''}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Stance</label>
              <div className="seg">{(['aggressive', 'defensive', 'passive'] as const).map((s) => <button key={s} className={cls(f.stance === s && 'on')} onClick={() => ui.cmd({ type: 'setStance', fleetId: f.id, stance: s })}>{s[0].toUpperCase() + s.slice(1)}</button>)}</div>
            </div>
            <div className="row wrap">
              <button className="btn" onClick={() => ui.set({ screen: 'map', view: 'galaxy', fleetId: f.id, pendingOrder: { kind: 'move', fleetId: f.id } })}>Move…</button>
              <button className="btn" onClick={() => ui.set({ screen: 'map', view: 'galaxy', fleetId: f.id, pendingOrder: { kind: 'patrol', fleetId: f.id } })}>Patrol…</button>
              <button className="btn" onClick={() => ui.set({ screen: 'map', view: 'galaxy', fleetId: f.id, pendingOrder: { kind: 'blockade', fleetId: f.id } })}>Blockade…</button>
              <button className="btn" onClick={() => ui.cmd({ type: 'fleetOrder', fleetId: f.id, order: { type: 'idle' } })}>Halt</button>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>Patrolling keeps lanes safe for trade. A fleet sitting in an enemy system blockades its trade routes.</p>
          </Section>
        </div>
      </div>
    </div>
  );
}
