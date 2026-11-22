import { useEffect, useRef, useState } from 'react';
import { Term } from '../components/Guidance';
import { HeroView3D } from '../render/hero3d';
import type { Character } from '../../sim/types';
import { useUI, useGame } from '../store';
import { opinionBreakdown, opinion, hasContact, intelLevel, canDeclareWar, TREATY_LABEL, PEACE_LABEL, evaluateProposal, systemValue, type Evaluation } from '../../sim/diplomacy';
import { hasTreaty, warBetween, bordering } from '../../sim/territory';
import { GOVERNMENTS } from '../../sim/data/governments';
import { CIV_TEMPLATES } from '../../sim/data/names';
import { RESOURCES, type DealItem, type ResId, type TreatyType, type Proposal } from '../../sim/types';
import { formatDate } from '../../sim/util';
import { Sheet, Section, Emblem, Swatch, ResGlyph, RES_META, signed, cls, fmt } from '../components/common';

const TREATIES: TreatyType[] = ['nap', 'trade', 'research', 'defense', 'alliance'];

export function DiplomacyScreen() {
  const g = useGame();
  const me = g.empires[g.playerId];
  const known = g.empires.filter((e) => e.alive && e.id !== g.playerId && (e.kind === 'major' || e.kind === 'minor' || e.kind === 'rebels') && hasContact(g, g.playerId, e.id));
  const [selId, setSelId] = useState<number | null>(null);
  const sel = known.find((e) => e.id === selId) ?? known[0];
  const inbox = g.proposals.filter((p) => p.to === g.playerId);
  return (
    <Sheet title="Diplomacy" lede="Every kingdom remembers. Opinions are built from government, borders, treaties and history — broken pacts and declared wars are not quickly forgotten.">
      {inbox.length > 0 && (
        <Section title="Envoys awaiting an answer" aside={`${inbox.length}`}>
          {inbox.map((p) => <ProposalRow key={p.id} p={p} />)}
        </Section>
      )}
      <div className="cols side" style={{ marginTop: inbox.length ? 10 : 0 }}>
        <div className="list" style={{ alignSelf: 'start' }}>
          {known.map((e) => {
            const op = opinion(g, e.id, g.playerId);
            const war = warBetween(g, e.id, g.playerId);
            return (
              <div key={e.id} className={cls('li', sel?.id === e.id && 'sel')} onClick={() => setSelId(e.id)}>
                <Emblem empire={e} size={22} />
                <div className="grow">
                  <div>{e.name}</div>
                  <div className="hint">{e.kind === 'major' ? GOVERNMENTS[e.government].label : e.kind === 'rebels' ? 'Rebel state' : 'Independent state'}</div>
                </div>
                {war ? <span className="tag bad">War</span> : <span className={cls('num', op >= 20 ? 'pos' : op <= -20 ? 'neg' : 'faint')}>{signed(op, 0)}</span>}
              </div>
            );
          })}
          {!known.length && <div className="empty">No contact with other realms yet. Explore to meet them.</div>}
        </div>
        {sel ? <EmpirePanel id={sel.id} /> : null}
      </div>
      {void me}
    </Sheet>
  );
}

function ProposalRow({ p }: { p: Proposal }) {
  const g = useGame();
  const ui = useUI();
  const from = g.empires[p.from];
  const describe = (items: DealItem[]) => items.map((it) => it.kind === 'credits' ? `${it.amount} credits` : it.kind === 'resource' ? `${it.amount} ${it.res}` : it.kind === 'system' ? `the ${g.galaxy.systems[it.systemId].name} system` : TREATY_LABEL[it.treaty]).join(', ');
  let text = '';
  if (p.kind === 'peace') text = `proposes peace: ${PEACE_LABEL[p.peaceTerm ?? 'status_quo']}${p.peaceTerm && p.peaceTerm !== 'status_quo' ? ' (in their favour)' : ''}.`;
  else if (p.joinWar != null) { const w = g.wars.find((x) => x.id === p.joinWar); const foe = w ? g.empires[w.attackers.includes(p.from) ? w.defenders[0] : w.attackers[0]] : null; text = `offers ${describe(p.give)} if you join their war against the ${foe?.name ?? 'enemy'}. Accepting puts you at war with them.`; }
  else if (p.demand) text = `demands ${describe(p.receive)}. Refusing will anger them, and they will start arming against you.`;
  else if (p.give.length && !p.receive.length) text = `offers ${describe(p.give)}.`;
  else if (!p.give.length && p.receive.length) text = `demands ${describe(p.receive)}.`;
  else text = `offers ${describe(p.give)} in exchange for ${describe(p.receive)}.`;
  return (
    <div className="row" style={{ padding: '6px 0', borderBottom: '1px solid rgba(34,50,74,0.6)' }}>
      <Swatch color={from.color} />
      <span className="grow"><b style={{ fontWeight: 500 }}>{from.name}</b> {text} <span className="faint">({formatDate(p.tick)})</span></span>
      <button className="btn small primary" onClick={() => ui.cmd({ type: 'respondProposal', id: p.id, accept: true })}>{p.demand ? 'Pay' : p.joinWar != null ? 'Join the war' : 'Accept'}</button>
      <button className="btn small" onClick={() => {
        ui.cmd({ type: 'respondProposal', id: p.id, accept: false });
      }}>{p.demand ? 'Refuse' : 'Decline'}</button>
    </div>
  );
}

/** The rival realm's ruler: villain's dress when at war with us. */
function RivalFigure({ id }: { id: number }) {
  const g = useGame();
  const ref = useRef<HTMLCanvasElement>(null);
  const e = g.empires[id];
  const war = !!warBetween(g, id, g.playerId);
  useEffect(() => {
    const v = new HeroView3D(ref.current!);
    const stand = { id: e.id * 11 + e.emblem, role: 'governor', level: 10, equipment: {}, traits: [], name: e.ruler } as unknown as Character;
    v.showArchetype(war ? 'villain' : 'rival', e.id * 11 + e.emblem + (e.rulerBorn ?? 0), e.color, stand);
    return () => v.dispose();
  }, [e.id, e.color, e.emblem, e.rulerBorn, war]);
  return <canvas ref={ref} className="hero-figure rival-figure" style={{ width: 120, height: 170, flex: 'none' }} aria-label={`Portrait of ${e.ruler || e.name}`} />;
}

function EmpirePanel({ id }: { id: number }) {
  const g = useGame();
  const ui = useUI();
  const e = g.empires[id];
  const me = g.empires[g.playerId];
  const [result, setResult] = useState<{ ok: boolean; ev?: Evaluation; msg?: string } | null>(null);
  const [give, setGive] = useState<DealItem[]>([]);
  const [receive, setReceive] = useState<DealItem[]>([]);
  const [cGive, setCGive] = useState<Partial<Record<ResId, number>>>({});
  const [cGet, setCGet] = useState<Partial<Record<ResId, number>>>({});
  const [years, setYears] = useState(5);
  const breakdown = opinionBreakdown(g, id, g.playerId);
  const op = opinion(g, id, g.playerId);
  const intel = intelLevel(g, g.playerId, id);
  const war = warBetween(g, id, g.playerId);
  const treaties = g.treaties.filter((t) => (t.a === id && t.b === g.playerId) || (t.b === id && t.a === g.playerId));
  const lore = CIV_TEMPLATES.find((c) => c.name === e.name)?.lore;
  const send = (gv: DealItem[], rc: DealItem[]) => {
    const r = ui.cmd({ type: 'propose', to: id, give: gv, receive: rc });
    setResult({ ok: r.ok, ev: r.evaluation, msg: r.message });
    if (r.ok) { setGive([]); setReceive([]); }
  };
  const preview = (gv: DealItem[], rc: DealItem[]) => evaluateProposal(g, { id: 0, from: g.playerId, to: id, give: gv, receive: rc, tick: g.tick, kind: 'deal' });
  const mySystems = g.galaxy.systems.filter((s) => s.owner === g.playerId && s.id !== me.capitalSystemId);
  const theirSystems = g.galaxy.systems.filter((s) => s.owner === id && s.id !== e.capitalSystemId && me.explored.includes(s.id));
  const truce = g.truces.find((t) => ((t.a === id && t.b === g.playerId) || (t.b === id && t.a === g.playerId)) && t.until > g.tick);
  const vassalOf = treaties.find((t) => t.type === 'vassal');
  return (
    <div style={{ minWidth: 0 }}>
      <div className="row" style={{ gap: 14, alignItems: 'center' }}>
        <RivalFigure id={id} />
        <Emblem empire={e} size={52} />
        <div className="grow">
          <h1 className="serif" style={{ margin: 0, fontSize: 32, fontWeight: 600, lineHeight: 1 }}>{e.name}</h1>
          <div className="subtitle">{e.ruler ? `${e.ruler} · ` : ''}{GOVERNMENTS[e.government].label}{bordering(g, id, g.playerId) ? ' · shares a border with you' : ''}</div>
          {lore && <div className="hint" style={{ marginTop: 4 }}>{lore}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={cls('num', op >= 20 ? 'pos' : op <= -20 ? 'neg' : '')} style={{ fontSize: 30, lineHeight: 1 }}>{signed(op, 0)}</div>
          <div className="hint">their opinion of you</div>
        </div>
      </div>
      <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
        {war && <span className="tag bad">At war</span>}
        {truce && <span className="tag">Truce until {formatDate(truce.until)}</span>}
        {treaties.map((t) => <span key={t.type} className="tag good">{t.type === 'vassal' ? (t.a === g.playerId ? 'Your vassal' : 'Your overlord') : TREATY_LABEL[t.type]}</span>)}
        <span className="tag">Intel {intel}%</span>
      </div>
      <div className="cols c2" style={{ marginTop: 6 }}>
        <div>
          <Section title={<Term entry="mech.diplomacy">Why they feel this way</Term>}>
            <div className="kv">{breakdown.map(([k, v], i) => [<span key={k + i}>{k}</span>, <span key={k + i + 'v'} className={v >= 0 ? 'pos' : 'neg'}>{signed(v, 0)}</span>])}</div>
          </Section>
          <Section title="Treaties" guide="diplomacy-treaties">
            {TREATIES.map((t) => {
              const has = hasTreaty(g, id, g.playerId, t);
              const ev = !has && !war ? preview([{ kind: 'treaty', treaty: t }], []) : null;
              return (
                <div key={t} className="row between" style={{ padding: '4px 0', borderBottom: '1px solid rgba(34,50,74,0.5)' }}>
                  <span><Term entry="mech.treaties">{TREATY_LABEL[t]}</Term></span>
                  {has ? <button className="btn small danger" onClick={() => { if (confirm(`End the ${TREATY_LABEL[t]}? Breaking pacts damages your reputation.`)) ui.cmd({ type: 'breakTreaty', target: id, treaty: t }); }}>Dissolve</button>
                    : <span className="row" style={{ gap: 8 }}>{ev && <span className={cls('hint', ev.accept ? 'pos' : 'neg')}>{ev.accept ? 'Likely' : 'Unlikely'}</span>}<button className="btn small" disabled={!!war} onClick={() => send([{ kind: 'treaty', treaty: t }], [])}>Propose</button></span>}
                </div>
              );
            })}
            {e.kind !== 'major' || true ? (
              <div className="row between" style={{ padding: '4px 0' }}>
                <span>Demand vassalage</span>
                <button className="btn small" disabled={!!war || !!vassalOf} onClick={() => send([], [{ kind: 'treaty', treaty: 'vassal' }])}>Demand</button>
              </div>
            ) : null}
            {vassalOf && vassalOf.b === g.playerId && <button className="btn small danger" style={{ marginTop: 6 }} onClick={() => ui.cmd({ type: 'breakTreaty', target: id, treaty: 'vassal' })}>Declare independence (war)</button>}
          </Section>
          <Section title={<Term entry="mech.war">War and peace</Term>}>
            {war ? (
              <div className="hint">You are at war. Offer terms from the Military screen.<div style={{ marginTop: 6 }}><button className="btn small" onClick={() => ui.set({ screen: 'military' })}>Open military operations</button></div></div>
            ) : (
              <>
                {(() => { const v = canDeclareWar(g, g.playerId, id); return (
                  <div className="row between">
                    <span className="hint">{v.ok ? 'Costs 40 influence. Breaks treaties with them and alarms their neighbours. Their defensive allies will join.' : v.reason}</span>
                    <button className="btn danger" disabled={!v.ok} onClick={() => { if (confirm(`Declare war on ${e.name}?`)) ui.cmd({ type: 'declareWar', target: id }); }}>Declare war</button>
                  </div>
                ); })()}
              </>
            )}
          </Section>
        </div>
        <div>
          <Section title="Exchange" aside="One-time transfer">
            <DealColumn label="You give" items={give} setItems={setGive} systems={mySystems} maxRes={me.stock} />
            <DealColumn label="You ask for" items={receive} setItems={setReceive} systems={theirSystems} />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn primary" disabled={!give.length && !receive.length || !!war} onClick={() => send(give, receive)}>Propose exchange</button>
              {(give.length > 0 || receive.length > 0) && (() => { const ev = preview(give, receive); return <span className={cls('hint', ev.accept ? 'pos' : 'neg')}>{ev.accept ? 'They seem inclined to accept' : 'They seem unlikely to accept'}</span>; })()}
            </div>
          </Section>
          <Section title="Resource contract" aside="Monthly, recurring">
            <ContractRow label="You send each month" v={cGive} set={setCGive} />
            <ContractRow label="They send each month" v={cGet} set={setCGet} />
            <div className="row" style={{ marginTop: 6 }}>
              <span className="hint">Duration</span>
              <select value={years} onChange={(ev) => setYears(+ev.target.value)} style={{ background: 'var(--abyss-2)', border: '1px solid var(--rule-2)', padding: '3px 6px' }}>{[2, 5, 10].map((y) => <option key={y} value={y}>{y} years</option>)}</select>
              <button className="btn" disabled={!!war} onClick={() => {
                const r = ui.cmd({ type: 'proposeContract', to: id, give: cGive, receive: cGet, years });
                setResult({ ok: r.ok, ev: r.evaluation, msg: r.message });
              }}>Propose contract</button>
            </div>
          </Section>
          {result && (
            <Section title={result.ok ? 'Accepted' : 'Declined'}>
              {result.msg && <div className={result.ok ? 'pos' : 'neg'}>{result.msg}</div>}
              {result.ev && <div className="kv" style={{ marginTop: 4 }}>{result.ev.reasons.map(([k, v], i) => [<span key={k + i}>{k}</span>, <span key={k + i + 'v'} className={v >= 0 ? 'pos' : 'neg'}>{signed(v, 0)}</span>])}</div>}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function DealColumn({ label, items, setItems, systems, maxRes }: { label: string; items: DealItem[]; setItems: (x: DealItem[]) => void; systems: { id: number; name: string }[]; maxRes?: Record<ResId, number> }) {
  const g = useGame();
  const [res, setRes] = useState<ResId | 'credits'>('credits');
  const [amt, setAmt] = useState(100);
  const [sys, setSys] = useState<number | ''>('');
  const add = (it: DealItem) => setItems([...items, it]);
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="hint" style={{ marginBottom: 4 }}>{label}</div>
      <div className="row wrap" style={{ gap: 4 }}>
        {items.map((it, i) => (
          <span key={i} className="tag gold" style={{ cursor: 'pointer' }} onClick={() => setItems(items.filter((_, j) => j !== i))} title="Remove">
            {it.kind === 'credits' ? `${it.amount} credits` : it.kind === 'resource' ? `${it.amount} ${RES_META[it.res].label.toLowerCase()}` : it.kind === 'system' ? `${g.galaxy.systems[it.systemId].name} (value ${Math.round(systemValue(g, it.systemId))})` : TREATY_LABEL[it.treaty]} ×
          </span>
        ))}
      </div>
      <div className="row" style={{ marginTop: 4, gap: 4 }}>
        <select value={res} onChange={(e) => setRes(e.target.value as ResId)} style={sel}>{RESOURCES.filter((r) => r !== 'influence').map((r) => <option key={r} value={r}>{RES_META[r].label}</option>)}</select>
        <input type="number" min={1} value={amt} onChange={(e) => setAmt(Math.max(1, +e.target.value))} style={{ ...sel, width: 80 }} />
        <button className="btn small" disabled={!!maxRes && maxRes[res as ResId] < amt} onClick={() => add(res === 'credits' ? { kind: 'credits', amount: amt } : { kind: 'resource', res: res as ResId, amount: amt })}>Add</button>
        <select value={sys} onChange={(e) => setSys(e.target.value === '' ? '' : +e.target.value)} style={{ ...sel, maxWidth: 140 }}>
          <option value="">System…</option>
          {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="btn small" disabled={sys === '' || items.some((i) => i.kind === 'system' && i.systemId === sys)} onClick={() => sys !== '' && add({ kind: 'system', systemId: sys })}>Add</button>
      </div>
    </div>
  );
}

const sel = { background: 'var(--abyss-2)', border: '1px solid var(--rule-2)', padding: '3px 6px' } as const;

function ContractRow({ label, v, set }: { label: string; v: Partial<Record<ResId, number>>; set: (x: Partial<Record<ResId, number>>) => void }) {
  const goods: ResId[] = ['credits', 'minerals', 'energy', 'food', 'alloys', 'electronics', 'rare'];
  return (
    <div style={{ marginBottom: 6 }}>
      <div className="hint" style={{ marginBottom: 3 }}>{label}</div>
      <div className="row wrap" style={{ gap: 6 }}>
        {goods.map((r) => (
          <label key={r} className="row" style={{ gap: 3 }} title={RES_META[r].label}>
            <ResGlyph r={r} />
            <input type="number" min={0} value={v[r] ?? 0} onChange={(e) => set({ ...v, [r]: Math.max(0, +e.target.value) })} style={{ ...sel, width: 52 }} />
          </label>
        ))}
      </div>
      {void fmt}
    </div>
  );
}
