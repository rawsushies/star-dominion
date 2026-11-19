import { useState } from 'react';
import { useUI, useGame } from '../store';
import { COUNCIL_SEATS } from '../../sim/data/council';
import { DECREES, HOUSE_AMBITIONS } from '../../sim/data/governance';
import { ROLES, ATTR_LABEL } from '../../sim/data/characters';
import { charById, charactersOf, effectiveAttrs, effectiveness, governorBonus, provinceGovernor, canAssign } from '../../sim/characters';
import {
  canIssueDecree, decreeStrength, describePetition, houseAmbitionMet, inRevolt, canActOnHouse, provincesOf, maxDecrees, governanceMods,
} from '../../sim/governance';
import { getLedger } from '../../sim/engine';
import { formatDate } from '../../sim/util';
import { Sheet, Section, Meter, CostView, cls, signed } from '../components/common';
import { Crest } from './Heroes';
import type { Character } from '../../sim/types';

type Tab = 'council' | 'decrees' | 'houses' | 'provinces';

const MOD_LABEL: Record<string, string> = {
  output: 'output', tax: 'taxes', stability: 'stability', 'output.research': 'research', 'output.alloys': 'alloys', 'output.minerals': 'minerals', 'output.influence': 'influence',
  buildSpeed: 'construction speed', tradeValue: 'trade value', navalCap: 'naval capacity', garrison: 'garrisons', shipDamage: 'fleet damage', repair: 'repair speed',
  warExhaustion: 'war exhaustion', admin: 'administration', intel: 'intelligence', tracking: 'accuracy',
  storage: 'storage', shipCost: 'ship cost', growth: 'growth', defensePlatform: 'defence platforms', 'output.energy': 'energy',
};
const PCT = new Set(['output', 'storage', 'shipCost', 'growth', 'defensePlatform', 'output.energy', 'tax', 'output.research', 'output.alloys', 'output.minerals', 'output.influence', 'buildSpeed', 'tradeValue', 'garrison', 'shipDamage', 'repair', 'warExhaustion', 'tracking']);
export function modText(k: string, v: number): string {
  const label = MOD_LABEL[k] ?? k;
  return PCT.has(k) ? `${v > 0 ? '+' : ''}${Math.round(v * 100)}% ${label}` : `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10} ${label}`;
}

export function CouncilScreen() {
  const g = useGame();
  const me = g.empires[g.playerId];
  const [tab, setTab] = useState<Tab>('council');
  const pending = me.petitions?.length ?? 0;
  return (
    <Sheet title="Royal council" lede="Your ministers advise, the great houses scheme, and the provinces wait on your decrees."
      actions={<div className="seg">
        <button className={cls(tab === 'council' && 'on')} onClick={() => setTab('council')}>Council{pending ? ` (${pending})` : ''}</button>
        <button className={cls(tab === 'decrees' && 'on')} onClick={() => setTab('decrees')}>Decrees</button>
        <button className={cls(tab === 'houses' && 'on')} onClick={() => setTab('houses')}>Great houses</button>
        <button className={cls(tab === 'provinces' && 'on')} onClick={() => setTab('provinces')}>Provinces</button>
      </div>}>
      {tab === 'council' && <CouncilTab />}
      {tab === 'decrees' && <DecreesTab />}
      {tab === 'houses' && <HousesTab />}
      {tab === 'provinces' && <ProvincesTab />}
    </Sheet>
  );
}

function CouncilTab() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const people = charactersOf(g, me.id);
  return (
    <div className="cols c2">
      <div>
        <Section title="Seats of the council">
          {COUNCIL_SEATS.map((seat) => {
            const c = charById(g, me.council?.[seat.id]);
            const holder = c && c.status === 'active' ? c : null;
            const eligible = people.filter((p) => !canAssign(g, p, { kind: 'council', seat: seat.id }));
            const a = holder ? effectiveAttrs(holder) : null;
            return (
              <div key={seat.id} className="row" style={{ gap: 10, padding: '8px 0', borderBottom: '1px solid var(--rule)', alignItems: 'flex-start' }} data-testid={`seat-${seat.id}`}>
                {holder ? <Crest c={holder} g={g} size={44} /> : <div style={{ width: 44, height: 44, border: '1px dashed var(--rule)', flex: 'none' }} />}
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="serif" style={{ fontSize: 16, fontWeight: 600 }}>{seat.label}</div>
                  <div className="hint">{seat.description}</div>
                  {holder && a && <div className="hint">{seat.perAttr.map((p) => modText(p.key, a[p.attr] * p.per * effectiveness(holder))).join(', ')} <span className="faint">({seat.perAttr.map((p) => `${ATTR_LABEL[p.attr]} ${a[p.attr]}`).join(', ')}, loyalty {Math.round(holder.loyalty)})</span></div>}
                  <select aria-label={`Appoint ${seat.label}`} style={{ marginTop: 4 }} value={holder?.id ?? ''} onChange={(ev) => ev.target.value && ui.cmd({ type: 'assignCharacter', charId: +ev.target.value, assignment: { kind: 'council', seat: seat.id } })}>
                    <option value="">{holder ? '' : 'Vacant. Appoint…'}</option>
                    {holder && <option value={holder.id}>{holder.name}</option>}
                    {eligible.filter((p) => p.id !== holder?.id).map((p) => <option key={p.id} value={p.id}>{ROLES[p.role].label} {p.name}, level {p.level}{p.assignment ? ' (reassign)' : ''}</option>)}
                  </select>
                  {!eligible.length && !holder && <div className="hint">Needs a {seat.roles.map((r) => ROLES[r].label.toLowerCase()).join(' or ')}. Recruit one in the Hall of Heroes.</div>}
                </div>
              </div>
            );
          })}
        </Section>
      </div>
      <div>
        <Section title="Matters before the council" aside={`${me.petitions?.length ?? 0} waiting`}>
          {!(me.petitions?.length) && <div className="empty">No matters await your decision. Ministers and houses bring new ones every few months.</div>}
          {(me.petitions ?? []).map((p) => {
            const d = describePetition(g, me, p);
            return (
              <div key={p.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--rule)' }} data-testid="petition">
                <div className="row between"><span className="serif" style={{ fontSize: 16, fontWeight: 600 }}>{d.title}</span><span className="hint">lapses {formatDate(p.expires)}</span></div>
                <p className="muted" style={{ margin: '4px 0 6px' }}>{d.text}</p>
                <div className="row wrap" style={{ gap: 6 }}>
                  {d.options.map((o) => (
                    <button key={o.index} className="btn small" disabled={!!o.why} title={o.why ?? optionHint(o.option, o.scale)} onClick={() => ui.cmd({ type: 'resolvePetition', petitionId: p.id, option: o.index })}>{o.label}</button>
                  ))}
                </div>
                <div className="hint" style={{ marginTop: 4 }}>{d.options.map((o) => `${o.label}: ${optionHint(o.option, o.scale) || 'no direct effect'}`).join(' · ')}</div>
              </div>
            );
          })}
        </Section>
        <Section title="Combined effect of council, decrees and houses">
          <div className="kv">
            {Object.entries(governanceMods(g, me)).filter(([, v]) => Math.abs(v) > 1e-3).map(([k, v]) => [<span key={k}>{MOD_LABEL[k] ?? k}</span>, <span key={k + 'v'} className={v > 0 === (k !== 'warExhaustion') ? 'pos' : 'neg'}>{modText(k, v)}</span>])}
          </div>
        </Section>
      </div>
    </div>
  );
}

function optionHint(o: import('../../sim/data/governance').PetitionOption, scale: number): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(o.cost ?? {})) out.push(`-${v} ${k}`);
  for (const [k, v] of Object.entries(o.gain ?? {})) out.push(`+${Math.round(v * scale)} ${k}`);
  if (o.timed) out.push(...Object.entries(o.timed.mods).map(([k, v]) => modText(k, v > 0 ? v * scale : v) + ` for ${Math.round(o.timed!.days / 30)} months`));
  if (o.house) out.push(`house opinion ${signed(o.house, 0)}`);
  if (o.allHouses) out.push(`all houses ${signed(o.allHouses, 0)}`);
  if (o.member) out.push(`minister loyalty ${signed(o.member, 0)}`);
  return out.join(', ');
}

function DecreesTab() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const active = me.decrees ?? [];
  return (
    <>
      <p className="muted">{active.length} of {maxDecrees(g, me)} decrees in force. A decree is stronger when the minister who presides over it is able and loyal.</p>
      <table className="t">
        <thead><tr><th>Decree</th><th>Effect</th><th>Presiding minister</th><th>Cost</th><th></th></tr></thead>
        <tbody>
          {DECREES.map((d) => {
            const act = active.find((x) => x.id === d.id);
            const why = act ? null : canIssueDecree(g, me, d.id);
            const str = act?.strength ?? decreeStrength(g, me, d);
            const seat = COUNCIL_SEATS.find((s) => s.id === d.seat)!;
            const holder = charById(g, me.council?.[d.seat]);
            return (
              <tr key={d.id} className={cls(act && 'sel')} data-testid={`decree-${d.id}`}>
                <td><div className="serif" style={{ fontWeight: 600 }}>{d.label}</div><div className="hint">{d.description}{d.war ? ' Wartime only.' : ''}</div></td>
                <td className="hint">{Object.entries(d.mods).map(([k, v]) => modText(k, v < 0 && k === 'stability' ? v : v * str)).join(', ')}<br />{Math.round(d.days / 30)} months</td>
                <td className="hint">{seat.label}: {holder?.status === 'active' ? `${holder.name} (${Math.round(str * 100)}%)` : 'vacant (80%)'}</td>
                <td><CostView cost={d.cost} empire={me} /></td>
                <td>{act
                  ? <><div className="hint">until {formatDate(act.until)}</div><button className="btn small" onClick={() => ui.cmd({ type: 'revokeDecree', decree: d.id })}>Revoke</button></>
                  : <button className="btn small" disabled={!!why} title={why ?? 'Issue this decree'} onClick={() => ui.cmd({ type: 'issueDecree', decree: d.id })}>Issue</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function HousesTab() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  return (
    <div className="cols c3">
      {(me.houses ?? []).map((h) => {
        const met = houseAmbitionMet(g, me, h);
        const members = g.characters.filter((c) => c.houseId === h.id && c.status === 'active' && c.ownerId === me.id);
        const revolt = inRevolt(g, h);
        return (
          <div key={h.id} style={{ borderTop: `3px solid ${h.color}`, padding: '10px 2px' }} data-testid="house">
            <div className="serif" style={{ fontSize: 20, fontWeight: 600 }}>House {h.name}</div>
            <div className="hint" style={{ fontStyle: 'italic' }}>“{h.motto}”</div>
            {revolt && <div className="neg" style={{ marginTop: 6 }}>In open revolt until {formatDate(h.revoltUntil)}</div>}
            <div className="kv" style={{ marginTop: 8 }}>
              <span>Loyalty</span><span className="row" style={{ gap: 6 }}><span style={{ width: 90 }}><Meter value={h.loyalty} tone={h.loyalty < 30 ? 'r' : undefined} /></span>{Math.round(h.loyalty)}</span>
              <span>Power</span><span className="row" style={{ gap: 6 }}><span style={{ width: 90 }}><Meter value={h.power} /></span>{Math.round(h.power)}</span>
              <span>Wants</span><span>{HOUSE_AMBITIONS[h.ambition].label}</span>
              <span>Status</span><span className={met ? 'pos' : 'neg'}>{met ? 'Satisfied' : h.grievance ? `Aggrieved for ${h.grievance} months` : 'Not satisfied'}</span>
              <span>Lands</span><span>{h.provinces.map((p) => g.galaxy.sectors?.[p]?.name).filter(Boolean).join(', ') || 'None'}</span>
            </div>
            <p className="hint">{HOUSE_AMBITIONS[h.ambition].want} Effect on stability: {signed(((h.loyalty - 50) / 50) * (h.power / 100) * 6, 1)}.</p>
            <div className="hint">Members in your service: {members.length ? members.map((c: Character) => c.name).join(', ') : 'none'}</div>
            <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
              {(['grant', 'honour', 'suppress'] as const).map((a) => {
                const why = canActOnHouse(g, me, h, a);
                const label = a === 'grant' ? 'Grant privileges (30 influence)' : a === 'honour' ? 'Honour with gifts (250 credits)' : 'Suppress (20 influence)';
                return <button key={a} className={cls('btn small', a === 'suppress' && 'danger')} disabled={!!why} title={why ?? label} onClick={() => ui.cmd({ type: 'houseAction', houseId: h.id, action: a })}>{label}</button>;
              })}
            </div>
          </div>
        );
      })}
      {!(me.houses?.length) && <div className="empty">Your realm has no great houses.</div>}
    </div>
  );
}

function ProvincesTab() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const L = getLedger(g, me);
  const govs = charactersOf(g, me.id).filter((c) => c.role === 'governor');
  const rows = provincesOf(g, me.id).map((sec) => {
    const systems = g.galaxy.systems.filter((s) => s.sector === sec && s.owner === me.id);
    const worlds = g.planets.filter((p) => p.colony?.ownerId === me.id && g.galaxy.systems[p.systemId].sector === sec);
    const pops = worlds.reduce((a, p) => a + p.colony!.pops, 0);
    const stab = worlds.length ? worlds.reduce((a, p) => a + p.colony!.stability, 0) / worlds.length : null;
    return { sec, systems: systems.length, worlds: worlds.length, pops, stab, gov: provinceGovernor(g, me.id, sec), bonus: governorBonus(g, me.id, sec), houses: (me.houses ?? []).filter((h) => h.provinces.includes(sec)) };
  });
  return (
    <>
      <p className="muted">Administrative capacity {L.adminUsed} of {L.adminCap}. Each governed province adds capacity, and a governor raises output and stability on every colony in it.</p>
      <table className="t">
        <thead><tr><th>Province</th><th className="n">Systems</th><th className="n">Colonies</th><th className="n">Population</th><th className="n">Stability</th><th>Houses</th><th>Governor</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sec} data-testid="province">
              <td>{g.galaxy.sectors?.[r.sec]?.name ?? `Sector ${r.sec}`}</td>
              <td className="n">{r.systems}</td>
              <td className="n">{r.worlds}</td>
              <td className="n">{r.pops.toFixed(1)}</td>
              <td className={cls('n', r.stab != null && r.stab < 35 && 'neg')}>{r.stab == null ? '—' : Math.round(r.stab)}</td>
              <td className="hint">{r.houses.map((h) => h.name).join(', ')}</td>
              <td>
                <select aria-label="Governor" value={r.gov?.id ?? ''} onChange={(ev) => ev.target.value ? ui.cmd({ type: 'assignCharacter', charId: +ev.target.value, assignment: { kind: 'province', sectorId: r.sec } }) : r.gov && ui.cmd({ type: 'assignCharacter', charId: r.gov.id, assignment: null })}>
                  <option value="">{govs.length ? 'No governor' : 'No governors in service'}</option>
                  {govs.map((c) => <option key={c.id} value={c.id}>{c.name}, level {c.level}{c.assignment && !(c.assignment.kind === 'province' && c.assignment.sectorId === r.sec) ? ' (reassign)' : ''}</option>)}
                </select>
                {r.gov && <div className="hint">{modText('output', r.bonus.output)}, {signed(r.bonus.stability, 1)} stability</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
