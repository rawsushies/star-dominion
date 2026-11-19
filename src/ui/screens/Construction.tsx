import { useState } from 'react';
import { Term } from '../components/Guidance';
import { useUI, useGame } from '../store';
import { BUILDINGS } from '../../sim/data/buildings';
import { SHIPS, STARBASE } from '../../sim/data/ships';
import { MEGASTRUCTURES, MEGA_BY_ID } from '../../sim/data/megastructures';
import { TECH_BY_ID } from '../../sim/data/techs';
import { STAR_TYPES } from '../../sim/data/planets';
import { hasTech } from '../../sim/modifiers';
import { Sheet, Section, Meter, CostView, fmt } from '../components/common';
import type { BuildingId, ShipClass } from '../../sim/types';

export function ConstructionScreen() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const colonies = g.planets.filter((p) => p.colony?.ownerId === g.playerId);
  const buildRows = colonies.flatMap((p) => p.colony!.queue.map((q, i) => ({ p, q, i })));
  const shipRows = colonies.flatMap((p) => p.colony!.shipQueue.map((q, i) => ({ p, q, i })));
  const outposts = g.galaxy.systems.filter((s) => s.outpostProject?.empireId === g.playerId);
  const settling = g.planets.filter((p) => p.colonizing?.empireId === g.playerId);
  const upgrades = g.galaxy.systems.filter((s) => s.owner === g.playerId && s.starbaseUpgrade);
  const megas = g.galaxy.systems.flatMap((s) => s.megastructures.filter((m) => m.ownerId === g.playerId).map((m) => ({ s, m })));
  const owned = g.galaxy.systems.filter((s) => s.owner === g.playerId);
  return (
    <Sheet title="Construction" lede="Every project underway across the realm. Costs are paid when work begins; a project without funds waits at the head of its queue.">
      <div className="cols c2">
        <div>
          <Section title="Planetary construction" aside={`${buildRows.length} projects`}>
            {!buildRows.length && <div className="empty">No buildings under construction. Queue them from Planet management.</div>}
            <table className="t">
              <tbody>
                {buildRows.map(({ p, q, i }) => (
                  <tr key={`${p.id}-${i}`}>
                    <td className="click"><button className="linkish" onClick={() => ui.set({ screen: 'planets', planetId: p.id })}>{p.name}</button></td>
                    <td>{q.demolish ? 'Demolish ' : ''}{BUILDINGS[q.id as BuildingId].label}</td>
                    <td style={{ width: 120 }}><Meter value={q.progress} max={q.total} /></td>
                    <td className="n faint">{i === 0 ? (q.paid ? `${Math.ceil(q.total - q.progress)} d` : 'Needs funds') : 'Queued'}</td>
                    <td><button className="btn small" onClick={() => ui.cmd({ type: 'cancelQueue', planetId: p.id, index: i })}>Cancel</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title="Shipyards" aside={`${shipRows.length} hulls`}>
            {!shipRows.length && <div className="empty">Shipyards are idle.</div>}
            <table className="t">
              <tbody>
                {shipRows.map(({ p, q, i }) => (
                  <tr key={`${p.id}-s${i}`}>
                    <td>{p.name}</td><td>{SHIPS[q.id as ShipClass].label}</td>
                    <td style={{ width: 120 }}><Meter value={q.progress} max={q.total} /></td>
                    <td className="n faint">{q.paid ? `${Math.ceil(q.total - q.progress)} d` : 'Waiting'}</td>
                    <td><button className="btn small" onClick={() => ui.cmd({ type: 'cancelQueue', planetId: p.id, index: i, ships: true })}>Cancel</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title="Expansion projects">
            {!outposts.length && !settling.length && !upgrades.length && <div className="empty">No outposts, colonies or starbase upgrades underway.</div>}
            {outposts.map((s) => <Row key={'o' + s.id} label={`Outpost at ${s.name}`} v={s.outpostProject!.progress} max={s.outpostProject!.total} />)}
            {settling.map((p) => <Row key={'c' + p.id} label={`Colony on ${p.name}`} v={p.colonizing!.progress} max={p.colonizing!.total} />)}
            {upgrades.map((s) => <Row key={'u' + s.id} label={`${STARBASE[s.starbase + 1]!.label} at ${s.name}`} v={s.starbaseUpgrade!.progress} max={s.starbaseUpgrade!.total} />)}
          </Section>
        </div>
        <div>
          <Section guide="construction-mega" title={<Term entry="mech.mega">Megastructures</Term>} aside="Generational projects">
            {megas.map(({ s, m }) => {
              const d = MEGA_BY_ID[m.id];
              return (
                <div key={s.id + m.id} style={{ marginBottom: 10 }}>
                  <div className="row between"><span className="serif" style={{ fontSize: 18, fontWeight: 600 }}>{d.label} at {s.name}</span><span className="num">Stage {m.stage}/{d.stages}</span></div>
                  {m.building ? <><Meter value={m.progress} max={d.stageDays} /><div className="hint">{m.progress === 0 ? 'Waiting for stage funds: ' : `Stage ${m.stage + 1} in progress, ${d.stageDays - m.progress} days left. Next stage costs `}<CostView cost={d.stageCost} empire={me} /></div></> : <div className="hint pos">Complete</div>}
                </div>
              );
            })}
            {MEGASTRUCTURES.map((d) => <MegaOption key={d.id} id={d.id} owned={owned.map((s) => s.id)} />)}
          </Section>
        </div>
      </div>
    </Sheet>
  );
  function Row({ label, v, max }: { label: string; v: number; max: number }) {
    return <div className="row" style={{ marginBottom: 6 }}><span style={{ width: 220 }}>{label}</span><div className="grow"><Meter value={v} max={max} tone="v" /></div><span className="num faint" style={{ width: 60, textAlign: 'right' }}>{max - v} d</span></div>;
  }
}

function MegaOption({ id, owned }: { id: string; owned: number[] }) {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const d = MEGA_BY_ID[id];
  const eligible = owned.filter((sid) => {
    const s = g.galaxy.systems[sid];
    return (!d.starReq || d.starReq.includes(s.star)) && !s.megastructures.some((m) => m.id === id) && s.megastructures.length < 2;
  });
  const [sys, setSys] = useState<number | ''>(eligible[0] ?? '');
  const researched = hasTech(me, d.tech);
  return (
    <div style={{ borderTop: '1px solid var(--rule)', padding: '9px 0' }}>
      <div className="row between"><span>{d.label}</span><span className="hint">{d.stages} stage{d.stages > 1 ? 's' : ''} × {d.stageDays} days</span></div>
      <div className="hint">{d.description}{d.starReq ? ` Requires a ${d.starReq.map((s) => STAR_TYPES[s].label.toLowerCase()).join(', ')}.` : ''}</div>
      <div className="row" style={{ marginTop: 4 }}><span className="hint">Per stage:</span><CostView cost={d.stageCost} empire={me} /></div>
      {researched ? (
        <div className="row" style={{ marginTop: 6 }}>
          <select value={sys} onChange={(e) => setSys(e.target.value === '' ? '' : +e.target.value)} style={{ background: 'var(--abyss-2)', border: '1px solid var(--rule-2)', padding: '3px 6px' }}>
            {!eligible.length && <option value="">No suitable system</option>}
            {eligible.map((sid) => <option key={sid} value={sid}>{g.galaxy.systems[sid].name} ({STAR_TYPES[g.galaxy.systems[sid].star].label})</option>)}
          </select>
          <button className="btn small primary" disabled={sys === ''} onClick={() => sys !== '' && ui.cmd({ type: 'startMegastructure', systemId: sys, mega: id })}>Begin construction</button>
        </div>
      ) : <div className="hint warn" style={{ marginTop: 4 }}>Requires research: {TECH_BY_ID[d.tech].name}</div>}
      {void fmt}
    </div>
  );
}
