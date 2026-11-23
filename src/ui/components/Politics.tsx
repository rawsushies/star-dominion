// Emergent politics in the UI: overtures awaiting the player's answer (with the proposer's
// reasons), the pacts the player belongs to or knows of (with their actions), each realm's
// motives, the ancients' regard and the accord between them, and the galaxy's political history.
import { useState } from 'react';
import { useGame, useUI } from '../store';
import { Section, Meter, Swatch, Tip, cls } from './common';
import { formatDate } from '../../sim/util';
import { intelLevel } from '../../sim/diplomacy';
import { warBetween } from '../../sim/territory';
import { agendaOf, commonThreat, crisisActive, crisisThreat, desire, pol, regardOf, accordPact, POLITICS_COST, type Evaluation } from '../../sim/politics';
import { OFFER_COST, OFFER_LABEL, PACT_LABEL, PRIORITY_LABEL, PRIORITY_TEXT, ANCIENT_GIFTS } from '../../sim/data/politics';
import { PRECURSORS } from '../../sim/data/expansion';
import type { Command, CommandResult } from '../../sim/commands';
import type { GameState } from '../../sim/types';
import type { OfferKind, Pact, PoliticalOffer, PrecursorState } from '../../sim/expansionTypes';

const nm = (g: GameState, id: number | null | undefined) => (id != null && g.empires[id] ? g.empires[id].name : '?');
const reasonsText = (r: [string, number][]) => r.map(([k, v]) => `${k}: ${v > 0 ? '+' : ''}${v}`).join('\n');

/** Their reckoning, in brief: the strongest reasons either way. */
function Reasons({ r, testid }: { r: [string, number][]; testid?: string }) {
  const top = [...r].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
  return (
    <span className="hint" title={reasonsText(r)} data-testid={testid}>
      {top.map(([k, v], i) => <span key={i} className={v >= 0 ? 'pos' : 'neg'}>{i ? ' · ' : ''}{k} {v > 0 ? '+' : ''}{v}</span>)}
    </span>
  );
}

function Verdict({ ev }: { ev: Evaluation }) {
  const worst = ev.reasons.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1])[0];
  return <span className={cls('hint', ev.accept ? 'pos' : 'neg')} title={reasonsText(ev.reasons)}>{ev.accept ? 'They would likely agree' : worst ? `Unlikely: ${worst[0].toLowerCase()}` : 'Unlikely'}</span>;
}

function useRun(): [string | null, (c: Command) => CommandResult] {
  const ui = useUI();
  const [note, setNote] = useState<string | null>(null);
  return [note, (c: Command) => {
    const r = ui.cmd(c);
    const why = r.evaluation && !r.ok ? ` (${r.evaluation.reasons.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([k]) => k.toLowerCase()).join('; ')})` : '';
    setNote((r.message ?? (r.ok ? 'Done' : 'Refused')) + why);
    return r;
  }];
}

// ------------------------------------------------------------------ overtures

export function Overtures() {
  const g = useGame();
  if (!g.expansion) return null;
  const offers = pol(g).offers.filter((o) => o.to === g.playerId);
  if (!offers.length) return null;
  return (
    <Section title="Political overtures" aside={`${offers.length}`}>
      <div data-testid="overtures">{offers.map((o) => <OfferRow key={o.id} o={o} />)}</div>
    </Section>
  );
}

function OfferRow({ o }: { o: PoliticalOffer }) {
  const g = useGame();
  const ui = useUI();
  const from = g.empires[o.from];
  const mine = desire(g, g.playerId, { kind: o.kind, from: o.from, to: o.to, target: o.target, crisis: o.crisis });
  return (
    <div style={{ padding: '6px 0', borderBottom: '1px solid rgba(34,50,74,0.6)' }} data-testid={`offer-${o.kind}`}>
      <div className="row" style={{ gap: 6 }}>
        <Swatch color={from.color} />
        <span className="grow"><b style={{ fontWeight: 500 }}>{OFFER_LABEL[o.kind]}</b> — {o.text} <span className="faint">(until {formatDate(o.expires)})</span></span>
        <button className="btn small primary" onClick={() => ui.cmd({ type: 'politics', action: 'respond', offerId: o.id, accept: true })} data-testid={`accept-${o.kind}`}>Accept</button>
        <button className="btn small" onClick={() => ui.cmd({ type: 'politics', action: 'respond', offerId: o.id, accept: false })} data-testid={`decline-${o.kind}`}>Decline</button>
      </div>
      <div className="hint">Why they offer: <Reasons r={o.motives} /></div>
      <div className="hint">Your advisers weigh it: <Reasons r={mine.reasons} /></div>
    </div>
  );
}

// ------------------------------------------------------------------ pacts and history

function pactLine(g: GameState, p: Pact): string {
  const members = p.members.map((m) => nm(g, m)).join(', ');
  switch (p.kind) {
    case 'compact': return `${members} against ${nm(g, p.target)}`;
    case 'collusion': return `${members} against ${nm(g, p.target)}${p.secret ? ' (secret)' : ''}`;
    case 'concord': return `${members} against ${p.crisis === 'omega' ? 'the Omega Incursion' : 'the Void Devourer'}`;
    case 'accord': return `${members}: ${p.depth === 'alliance' ? 'allied' : 'truce'}`;
  }
}

export function PactsAndHistory() {
  const g = useGame();
  const [note, run] = useRun();
  const [all, setAll] = useState(false);
  if (!g.expansion) return null;
  const me = g.playerId;
  const p = pol(g);
  const visible = p.pacts.filter((x) => !x.secret || x.knownBy.includes(me));
  const history = [...p.history].reverse();
  return (
    <Section title="Pacts and political history" aside={`${visible.length} pacts`}>
      <div data-testid="pacts">
        {note && <div className="hint">{note}</div>}
        {!visible.length && <div className="empty">No compacts, conspiracies, concords or accords are known.</div>}
        {visible.map((x) => {
          const member = x.members.includes(me);
          const calledOn = member && x.target != null && !warBetween(g, me, x.target) && x.members.some((m) => m !== me && warBetween(g, m, x.target!));
          return (
            <div key={x.id} className="row between" style={{ padding: '3px 0' }} data-testid={`pact-${x.kind}`}>
              <span className="grow"><b style={{ fontWeight: 500 }}>{PACT_LABEL[x.kind]}</b> · {pactLine(g, x)} <span className="faint">since {formatDate(x.founded)}{x.kind !== 'collusion' && x.strain > 0 ? ` · strain ${Math.round(x.strain)}` : ''}</span></span>
              <span className="row" style={{ gap: 4 }}>
                {calledOn && <Tip content="Go to war against their foe beside your partners."><button className="btn small primary" onClick={() => run({ type: 'politics', action: 'honour', pactId: x.id })} data-testid="honour">Honour</button></Tip>}
                {member && x.kind !== 'accord' && <Tip content="Your partners will remember it."><button className="btn small" onClick={() => run({ type: 'politics', action: 'leave', pactId: x.id })}>Leave</button></Tip>}
                {!member && x.kind === 'collusion' && x.secret && <Tip content={`${POLITICS_COST.expose} influence. Lay the proof before the galaxy: the conspirator's reputation suffers and every realm remembers.`}><button className="btn small" onClick={() => run({ type: 'politics', action: 'expose', pactId: x.id })} data-testid="expose">Expose</button></Tip>}
                {x.kind === 'collusion' && x.target === me && <Tip content="Demand they end it. Whether they back down depends on your strength and their pride."><button className="btn small" onClick={() => run({ type: 'politics', action: 'confront', pactId: x.id })} data-testid="confront">Confront</button></Tip>}
              </span>
            </div>
          );
        })}
        <div className="hint" style={{ marginTop: 8 }}><b>History</b></div>
        {!history.length && <div className="empty">The galaxy's politics have yet to make history.</div>}
        {(all ? history : history.slice(0, 10)).map((h) => (
          <div key={h.id} className="hint" style={{ padding: '2px 0' }} title={h.text}>
            <span className="faint">{formatDate(h.tick)}</span> · {h.title}
          </div>
        ))}
        {history.length > 10 && <button className="btn small" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${history.length}`}</button>}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ motives and proposals to a realm

export function Motives({ id }: { id: number }) {
  const g = useGame();
  const [note, run] = useRun();
  const [target, setTarget] = useState<number | null>(null);
  if (!g.expansion) return null;
  const me = g.playerId;
  const a = agendaOf(g, id);
  const intel = intelLevel(g, me, id);
  const foes = g.empires.filter((e) => e.alive && e.id !== me && e.id !== id && (e.kind === 'major' || (e.kind === 'precursor' && g.expansion!.precursors.some((p) => p.empireId === e.id && p.status !== 'fallen' && p.status !== 'absent'))));
  const tgt = target ?? a?.fears.find((f) => foes.some((e) => e.id === f.id))?.id ?? foes[0]?.id ?? null;
  const compact = tgt != null ? desire(g, id, { kind: 'compact', from: me, to: id, target: tgt }) : null;
  const crises = (['omega', 'devourer'] as const).filter((c) => crisisActive(g, c) && crisisThreat(g, me, c) >= 15);
  return (
    <Section title="Motives" aside={a ? PRIORITY_LABEL[a.priority] : '—'}>
      <div data-testid="motives">
        {!a ? <div className="empty">Their purposes are unknown.</div> : intel < 30 ? <div className="hint">Too little intelligence to read their purposes (intel {intel} of 30). Plant a network or sign a treaty.</div> : (
          <>
            <div className="hint">{g.empires[id].name} {PRIORITY_TEXT[a.priority]} (since {formatDate(a.since)}).</div>
            <div className="kv" style={{ marginTop: 4 }}>
              <span>Fears</span><span>{a.fears.length ? a.fears.map((f) => `${nm(g, f.id)} (${f.why})`).join('; ') : 'nothing in particular'}</span>
              <span>Wants</span><span>{a.interests.map((i) => i.label).join('; ')}</span>
              <span>Loyal to</span><span>{a.loyalties.length ? a.loyalties.map((l) => nm(g, l)).join(', ') : 'no one'}</span>
              <span>Rival</span><span>{a.rival != null ? nm(g, a.rival) : 'none'}</span>
              <span>Omega vision</span><span>{a.vision === 'exploit' ? 'Bind the rift for its power' : a.vision === 'destroy' ? 'Break the rift by force' : 'Seal the rift'}</span>
            </div>
          </>
        )}
        {g.empires[id].kind === 'major' && foes.length > 0 && (
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            <span className="hint">Compact against</span>
            <select value={tgt ?? ''} onChange={(e) => setTarget(+e.target.value)} data-testid="compact-target">
              {foes.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <Tip content={`${OFFER_COST.compact} influence. Members join one another's wars against the foe and do not plan war on one another. Any war between you ends in a white peace.`}>
              <button className="btn small" disabled={tgt == null} onClick={() => tgt != null && run({ type: 'politics', action: 'propose', kind: 'compact', to: id, target: tgt })} data-testid="propose-compact">Propose compact</button>
            </Tip>
            {compact && <Verdict ev={compact} />}
          </div>
        )}
        {crises.map((c) => (
          <div key={c} className="row wrap" style={{ gap: 6, marginTop: 4 }}>
            <Tip content={`${OFFER_COST.concord} influence. Set your quarrels aside until the crisis ends; a war between you ends in a white peace.`}>
              <button className="btn small" onClick={() => run({ type: 'politics', action: 'propose', kind: 'concord', to: id, crisis: c })}>Propose a concord against {c === 'omega' ? 'Omega' : 'the Devourer'}</button>
            </Tip>
            <Verdict ev={desire(g, id, { kind: 'concord', from: me, to: id, target: null, crisis: c })} />
          </div>
        ))}
        {note && <div className="hint">{note}</div>}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ the ancients

const ANCIENT_ASKS: { kind: OfferKind; label: string; tip: string }[] = [
  { kind: 'alliance', label: 'Ask for an alliance', tip: 'Each joins the other\'s wars. They must admire and respect you, and must be awake.' },
  { kind: 'protection', label: 'Ask for protection', tip: 'A mutual defence pact. Easier to win than an alliance.' },
  { kind: 'clientage', label: 'Offer to serve them', tip: 'Become their vassal and military partner, under their protection. You could no longer win alone.' },
  { kind: 'submission', label: 'Demand submission', tip: 'Only an ancient power that fears you, has lost its war or its enclave will kneel.' },
];

export function AncientStance({ ps }: { ps: PrecursorState }) {
  const g = useGame();
  const [note, run] = useRun();
  const [target, setTarget] = useState<number | null>(null);
  if (!g.expansion) return null;
  const me = g.playerId;
  const r = regardOf(g, ps, me);
  const youngs = g.empires.filter((e) => e.alive && e.kind === 'major' && e.id !== me);
  const tgt = target ?? youngs[0]?.id ?? null;
  const gifted = (g.expansion.boons[me] ?? []).some((b) => ANCIENT_GIFTS[ps.id].some((x) => x.label === b.label));
  return (
    <div style={{ marginTop: 8 }} data-testid={`regard-${ps.id}`}>
      <div className="hint"><b>How they regard you</b></div>
      {(['respect', 'admiration', 'fear'] as const).map((k) => (
        <div key={k} className="row" style={{ gap: 8 }}>
          <span className="hint" style={{ width: 80 }}>{k[0].toUpperCase() + k.slice(1)}</span>
          <span className="grow"><Meter value={r[k]} tone={k === 'fear' ? 'r' : 'v'} /></span>
          <span className="num">{Math.round(r[k])}</span>
        </div>
      ))}
      <div className="hint">Respect grows with your strength and deeds, admiration with conduct they approve of{gifted ? '' : ' (enough of it and they may share an exclusive technology)'}, fear with your power and the trouble you cause them.</div>
      <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
        {ANCIENT_ASKS.map((a) => {
          const ev = desire(g, ps.empireId, { kind: a.kind, from: me, to: ps.empireId, target: null });
          return (
            <Tip key={a.kind} content={`${a.tip} ${OFFER_COST[a.kind] ? `${OFFER_COST[a.kind]} influence. ` : ''}${ev.accept ? 'They would likely agree.' : `Unlikely: ${ev.reasons.filter(([, v]) => v < 0).sort((x, y) => x[1] - y[1])[0]?.[0].toLowerCase() ?? 'they are unmoved'}.`}`}>
              <button className={cls('btn small', ev.accept && 'primary')} onClick={() => run({ type: 'politics', action: 'propose', kind: a.kind, to: ps.empireId })} data-testid={`ask-${a.kind}-${ps.id}`}>{a.label}</button>
            </Tip>
          );
        })}
      </div>
      {youngs.length > 0 && (
        <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
          <span className="hint">Conspire against</span>
          <select value={tgt ?? ''} onChange={(e) => setTarget(+e.target.value)}>{youngs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
          <Tip content={`${OFFER_COST.collusion} influence. A secret pact: they turn their eye on your rival and may join your war, or call you into theirs. If it comes to light, the galaxy will not forgive it.`}>
            <button className="btn small danger" disabled={tgt == null} onClick={() => tgt != null && run({ type: 'politics', action: 'propose', kind: 'collusion', to: ps.empireId, target: tgt })}>Propose collusion</button>
          </Tip>
        </div>
      )}
      {note && <div className="hint" data-testid={`ancient-note-${ps.id}`}>{note}</div>}
    </div>
  );
}

export function AncientsAccord() {
  const g = useGame();
  const [note, run] = useRun();
  if (!g.expansion) return null;
  const acc = accordPact(g);
  const ct = commonThreat(g);
  const awake = g.expansion.precursors.filter((p) => p.status !== 'fallen' && p.status !== 'absent' && g.empires[p.empireId]?.alive);
  return (
    <Section title="Between the ancients" aside={acc ? (acc.depth === 'alliance' ? 'Allied' : 'Truce') : 'Rivals'}>
      <div data-testid="accord">
        {awake.length < 2 ? <div className="empty">Only one ancient power remains.</div> : acc ? (
          <>
            <div className="hint">{PRECURSORS.veil.name} and {PRECURSORS.automata.name} hold an accord ({acc.depth}) since {formatDate(acc.founded)}{acc.reason ? `, drawn together by ${acc.reason}` : ''}. Strain {Math.round(acc.strain)} of 100: their old enmity returns when nothing holds them together; at 100 it breaks{awake.every((p) => p.status === 'awakened') ? ' and the War in Heaven begins' : ''}.</div>
            <Tip content={`${POLITICS_COST.sow_discord} influence. Feed each power proof of the other's treachery. If your agents are caught, both turn on you.`}>
              <button className="btn small danger" onClick={() => run({ type: 'politics', action: 'sow_discord' })} data-testid="sow-discord">Sow discord</button>
            </Tip>
          </>
        ) : (
          <>
            <div className="hint">An enmity older than the hyperlanes divides them. A common threat could bring them to terms{ct.w ? ` (now: ${ct.why}, ${ct.w})` : ''}; both awake and at odds, they fight the War in Heaven.</div>
            <Tip content={`${POLITICS_COST.mediate} influence. Broker an accord: it works only if both are willing and trust you. Success earns their admiration and the galaxy's esteem.`}>
              <button className="btn small" onClick={() => run({ type: 'politics', action: 'mediate' })} data-testid="mediate">Mediate between them</button>
            </Tip>
          </>
        )}
        {note && <div className="hint">{note}</div>}
      </div>
    </Section>
  );
}
