// The High Conclave: seats and weights, the motion in session (vote, veto, lobby, withdraw),
// tabling a motion, directives in force (defy or comply), crisis contributions and the record.
import { useState } from 'react';
import { useGame, useUI } from '../store';
import { Sheet, Section, Meter, Swatch, Tip, cls, fmt } from '../components/common';
import { formatDate } from '../../sim/util';
import { armed } from '../../sim/territory';
import { aiLean, canVote, computeWeights, directiveLabel, emergencyGrounds, greatPowerTest, motionCost, seatLabel, tallyEstimate, validateMotion } from '../../sim/conclave';
import { boundBy, reputation } from '../../sim/expansion';
import { omegaActive } from '../../sim/omega';
import { CONTRIBUTIONS, DIRECTIVES, FOUNDING, INJUNCTION_LABEL, LOBBY_COST, VETO_COOLDOWN, VETO_COST } from '../../sim/data/expansion';
import type { DirectiveKind, InjunctionProject, Resolution } from '../../sim/expansionTypes';
import type { Cost, GameState } from '../../sim/types';
import type { Command } from '../../sim/commands';

const costLine = (c: Cost) => Object.entries(c).map(([k, v]) => `${v} ${k}`).join(', ');
const KINDS: DirectiveKind[] = ['containment', 'embargo', 'naval_accords', 'ascension_injunction', 'repeal'];

function MotionForm({ g }: { g: GameState }) {
  const ui = useUI();
  const me = g.empires[g.playerId];
  const x = g.expansion!;
  const [kind, setKind] = useState<DirectiveKind>('embargo');
  const [target, setTarget] = useState<string>('');
  const [project, setProject] = useState<InjunctionProject>('continuum_engine');
  const [directive, setDirective] = useState<string>('');
  const [emergency, setEmergency] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const realms = g.empires.filter((e) => e.alive && e.id !== me.id && (e.kind === 'major' || e.kind === 'minor' || e.kind === 'rebels' || (kind === 'containment' && e.kind === 'precursor')));
  const r: Resolution = { kind };
  if (kind === 'containment' || kind === 'embargo') {
    if (target === 'omega') r.cosmic = 'omega';
    else if (target === 'devourer') r.cosmic = 'devourer';
    else if (target !== '') r.target = +target;
  }
  if (kind === 'ascension_injunction') r.project = project;
  if (kind === 'repeal' && directive !== '') r.directiveId = +directive;
  const why = validateMotion(g, me, r, emergency) ?? (me.stock.influence < motionCost(r, emergency) ? `Needs ${motionCost(r, emergency)} influence` : null);
  const table = () => { const res = ui.cmd({ type: 'conclave', action: 'propose', resolution: r, emergency }); setMsg(res.ok ? 'The motion is before the chamber.' : res.message ?? 'Refused'); };
  return (
    <div className="col" style={{ gap: 6 }} data-testid="motion-form">
      <label className="row" style={{ gap: 6 }}>
        <span className="hint" style={{ width: 70 }}>Motion</span>
        <select value={kind} onChange={(ev) => { setKind(ev.target.value as DirectiveKind); setTarget(''); setMsg(null); }} data-testid="motion-kind">
          {KINDS.map((k) => <option key={k} value={k}>{DIRECTIVES[k].label}</option>)}
        </select>
      </label>
      {(kind === 'containment' || kind === 'embargo') && (
        <label className="row" style={{ gap: 6 }}>
          <span className="hint" style={{ width: 70 }}>Target</span>
          <select value={target} onChange={(ev) => setTarget(ev.target.value)} data-testid="motion-target">
            <option value="">Choose…</option>
            {kind === 'containment' && <option value="omega">The Omega Incursion</option>}
            {kind === 'containment' && <option value="devourer">The Void Devourer</option>}
            {realms.map((e) => <option key={e.id} value={e.id}>{e.name}{e.kind === 'precursor' ? ' (ancient)' : ''} · reputation {Math.round(reputation(g, e.id))}</option>)}
          </select>
        </label>
      )}
      {kind === 'ascension_injunction' && (
        <label className="row" style={{ gap: 6 }}>
          <span className="hint" style={{ width: 70 }}>Project</span>
          <select value={project} onChange={(ev) => setProject(ev.target.value as InjunctionProject)}>
            {(Object.keys(INJUNCTION_LABEL) as InjunctionProject[]).map((p) => <option key={p} value={p}>{INJUNCTION_LABEL[p]}</option>)}
          </select>
        </label>
      )}
      {kind === 'repeal' && (
        <label className="row" style={{ gap: 6 }}>
          <span className="hint" style={{ width: 70 }}>Directive</span>
          <select value={directive} onChange={(ev) => setDirective(ev.target.value)}>
            <option value="">Choose…</option>
            {x.conclave.directives.map((d) => <option key={d.id} value={d.id}>{directiveLabel(g, d.resolution)}</option>)}
          </select>
        </label>
      )}
      {kind === 'containment' && (
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={emergency} onChange={(ev) => setEmergency(ev.target.checked)} />
          <span>Emergency session <span className="hint">(20 days, two thirds needed, no veto{emergencyGrounds(g, r) ? `; ${emergencyGrounds(g, r)!.toLowerCase()}` : ''})</span></span>
        </label>
      )}
      <div className="hint">{DIRECTIVES[kind].summary}</div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" disabled={!!why} onClick={table} data-testid="table-motion">Table the motion ({motionCost(r, emergency)} influence)</button>
        {why && <span className="hint neg">{why}</span>}
      </div>
      {msg && <div className="hint">{msg}</div>}
    </div>
  );
}

export function ConclaveScreen() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const x = g.expansion;
  const [note, setNote] = useState<string | null>(null);
  if (!x) return <Sheet title="High Conclave"><div className="empty">This reign has no Conclave.</div></Sheet>;
  const c = x.conclave;
  const run = (cmd: Command) => { const r = ui.cmd(cmd); setNote(r.ok ? (r.message ?? 'Done') : (r.message ?? 'Refused')); };
  if (c.founded == null) {
    return (
      <Sheet title="High Conclave" lede="A galactic assembly of the great realms, with influence but no armies of its own.">
        <div className="empty" data-testid="conclave-unfounded">
          The Conclave has not yet formed. It is founded in the {Math.round(FOUNDING.earliest / 360)}rd year once any great realm reaches the Interstellar Imperium, and in the {Math.round(FOUNDING.latest / 360)}th year regardless. The three leading great realms at its founding hold permanent seats.
        </div>
      </Sheet>
    );
  }
  const live = computeWeights(g);
  const s = c.session;
  const weights = s ? s.weights : live;
  const members = Object.keys(c.seats).map(Number).filter((id) => g.empires[id]?.alive).sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0) || a - b);
  const mySeat = c.seats[me.id] ?? null;
  const gp = greatPowerTest(g, me);
  const tally = s ? tallyEstimate(g, s) : null;
  const vetoReady = c.founders.includes(me.id) && (c.vetoUsed[me.id] == null || g.tick - c.vetoUsed[me.id] >= VETO_COOLDOWN);
  return (
    <Sheet title="High Conclave" lede={`Founded ${formatDate(c.founded)}. Founding Sovereigns: ${c.founders.filter((id) => g.empires[id]?.alive).map((id) => g.empires[id].name).join(', ')}.`}>
      {note && <div className="hint" style={{ marginBottom: 6 }} data-testid="conclave-note">{note}</div>}
      <div className="cols c2">
        <div>
          <Section title="Your standing">
            <div className="kv">
              <span>Seat</span><span data-testid="my-seat">{seatLabel(mySeat)}{(c.suspended[me.id] ?? 0) > g.tick ? ` (suspended until ${formatDate(c.suspended[me.id])})` : ''}</span>
              <span>Voting weight</span><span>{canVote(g, me.id) ? `${(live[me.id] ?? 0).toFixed(1)} of 100` : 'No vote'}</span>
              <span>Galactic reputation</span><span className={cls('num', reputation(g, me.id) < 0 ? 'neg' : 'pos')}>{Math.round(reputation(g, me.id))}</span>
              {c.founders.includes(me.id) && <><span>Founding veto</span><span>{vetoReady ? `Ready (${VETO_COST} influence, then ${VETO_COOLDOWN / 360} years)` : 'Spent'}</span></>}
            </div>
            {mySeat !== 'founder' && mySeat !== 'great' && <div className="hint" style={{ marginTop: 4 }}>{gp.ok ? 'You qualify as a Great Power; the seat is granted at the next yearly review.' : `To sit as a Great Power: ${gp.reasons.join('; ')}.`}</div>}
            <div className="hint" style={{ marginTop: 4 }}>Weights combine political standing, territory, military strength and reputation, each with diminishing returns, scaled by seat; no member holds more than a third. Stockpiles never count.</div>
          </Section>
          <Section title="Members" aside={`${members.filter((id) => canVote(g, id)).length} with a vote`}>
            <table className="t" data-testid="conclave-members">
              <thead><tr><th>Realm</th><th>Seat</th><th className="n">Weight{s ? ' (frozen)' : ''}</th><th className="n">Rep.</th>{s && <th>Position</th>}</tr></thead>
              <tbody>
                {members.map((id) => {
                  const e = g.empires[id];
                  const v = s?.votes[id];
                  const lean = s && !v && !e.isPlayer && s.weights[id] != null ? aiLean(g, e, s) : null;
                  return (
                    <tr key={id}>
                      <td><span className="row" style={{ gap: 4 }}><Swatch color={e.color} />{e.name}</span></td>
                      <td className="hint">{seatLabel(c.seats[id])}</td>
                      <td className="n">{weights[id] != null ? weights[id].toFixed(1) : '—'}</td>
                      <td className={cls('n', reputation(g, id) < 0 && 'neg')}>{Math.round(reputation(g, id))}</td>
                      {s && (
                        <td>
                          {v ? <b>{v}</b> : lean != null ? <span className="hint">leans {lean > 0.15 ? 'yea' : lean < -0.15 ? 'nay' : 'abstain'}</span> : <span className="hint">—</span>}
                          {lean != null && id !== me.id && (
                            <span className="row" style={{ gap: 2, display: 'inline-flex', marginLeft: 6 }}>
                              <Tip content={`Lobby for yea: ${costLine(LOBBY_COST)}`}><button className="btn small" disabled={s.lobbied.includes(`${me.id}:${id}`)} onClick={() => run({ type: 'conclave', action: 'lobby', target: id, toward: 'yea' })}>+</button></Tip>
                              <Tip content={`Lobby for nay: ${costLine(LOBBY_COST)}`}><button className="btn small" disabled={s.lobbied.includes(`${me.id}:${id}`)} onClick={() => run({ type: 'conclave', action: 'lobby', target: id, toward: 'nay' })}>−</button></Tip>
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
        </div>
        <div>
          <Section title={s ? (s.emergency ? 'Emergency session' : 'In session') : 'The chamber'} aside={s ? `closes in ${Math.max(0, s.deadline - g.tick)} days` : undefined}>
            {s ? (
              <div data-testid="session">
                <div className="serif" style={{ fontSize: 17, fontWeight: 600 }}>{directiveLabel(g, s.resolution)}</div>
                <div className="hint">Tabled by the {g.empires[s.proposer].name} on {formatDate(s.opened)}. {DIRECTIVES[s.resolution.kind].summary}</div>
                {tally && (
                  <div style={{ marginTop: 6 }}>
                    <div className="row between hint"><span>Expected yea {tally.yea.toFixed(1)}</span><span>nay {tally.nay.toFixed(1)}</span><span>abstain {tally.abstain.toFixed(1)}</span></div>
                    <Meter value={tally.yea} max={Math.max(1, tally.yea + tally.nay)} tone={tally.yea > tally.nay ? 'v' : 'r'} />
                    <div className="hint">{s.emergency ? 'Needs two thirds of the votes cast' : 'Needs more yea than nay'}, and 40% of the chamber taking a side.</div>
                  </div>
                )}
                {s.weights[me.id] != null && canVote(g, me.id) ? (
                  <div className="row" style={{ gap: 6, marginTop: 8 }}>
                    {(['yea', 'nay', 'abstain'] as const).map((v) => <button key={v} className={cls('btn', s.votes[me.id] === v && 'primary')} onClick={() => run({ type: 'conclave', action: 'vote', vote: v })} data-testid={`vote-${v}`}>{v[0].toUpperCase() + v.slice(1)}</button>)}
                    {!s.emergency && c.founders.includes(me.id) && s.proposer !== me.id && <button className="btn danger" disabled={!vetoReady || me.stock.influence < VETO_COST} onClick={() => run({ type: 'conclave', action: 'vote', vote: 'veto' })}>Veto</button>}
                    {s.proposer === me.id && <button className="btn" onClick={() => run({ type: 'conclave', action: 'withdraw' })}>Withdraw</button>}
                  </div>
                ) : <div className="hint" style={{ marginTop: 6 }}>You have no vote in this session.</div>}
              </div>
            ) : canVote(g, me.id) ? <MotionForm g={g} /> : <div className="empty">Observers may watch and lobby, but not table motions or vote.</div>}
          </Section>
          <Section title="Directives in force" aside={`${c.directives.length}`}>
            {!c.directives.length && <div className="empty">None.</div>}
            {c.directives.map((d) => {
              const bound = boundBy(g, d, me.id);
              const defiant = d.defiant.includes(me.id);
              return (
                <div key={d.id} style={{ padding: '5px 0', borderBottom: '1px solid var(--rule)' }} data-testid="directive">
                  <div className="row between"><b>{directiveLabel(g, d.resolution)}</b><span className="hint">until {formatDate(d.expires)}</span></div>
                  <div className="hint">{d.resolution.kind === 'containment' ? `Coalition: ${d.supporters.map((id) => g.empires[id].name).join(', ') || 'none'}.` : DIRECTIVES[d.resolution.kind].summary}</div>
                  <div className="row between" style={{ marginTop: 2 }}>
                    <span className={cls('hint', bound && 'neg')}>{d.resolution.target === me.id ? 'Aimed at you' : defiant ? 'You defy it' : bound ? 'Binds you' : 'Does not bind you'}{d.defiant.length ? ` · defied by ${d.defiant.map((id) => g.empires[id].name).join(', ')}` : ''}</span>
                    {bound && <Tip content="Your realm is freed from the directive, but loses 15 reputation, angers its supporters, suffers -4 stability for 3 years, and a second defiance within 10 years suspends a non-founding seat."><button className="btn small danger" onClick={() => run({ type: 'conclave', action: 'defy', directiveId: d.id })}>Defy</button></Tip>}
                    {defiant && <button className="btn small" onClick={() => run({ type: 'conclave', action: 'comply', directiveId: d.id })}>Comply again</button>}
                  </div>
                </div>
              );
            })}
          </Section>
          {omegaActive(g) && c.seats[me.id] != null && (
            <Section title="Crisis effort" aside={`your credit ${fmt(x.omega.credit[me.id] ?? 0)}`}>
              <div className="hint">Contributions to the counteroffensive against the Omega rift. The realm with the most credit when the rift is sealed or destroyed is hailed Warden of the Galaxy.</div>
              {(['resources', 'intel', 'infrastructure'] as const).map((k) => (
                <div key={k} className="row between" style={{ marginTop: 4 }}>
                  <span>{CONTRIBUTIONS[k].label} <span className="hint">({costLine(CONTRIBUTIONS[k].cost)})</span></span>
                  <button className="btn small" onClick={() => run({ type: 'conclave', action: 'contribute', kind: k })} data-testid={`contribute-${k}`}>Contribute</button>
                </div>
              ))}
              <FleetContribution g={g} run={run} />
            </Section>
          )}
          <Section title="The record" aside={`${c.history.length}`}>
            {!c.history.length && <div className="empty">No motions yet.</div>}
            {c.history.slice(-10).reverse().map((h) => (
              <div key={h.id} className="row between hint" style={{ padding: '2px 0' }}>
                <span>{formatDate(h.tick)} · {directiveLabel(g, h.resolution)}{h.emergency ? ' (emergency)' : ''}</span>
                <span className={cls(h.result === 'passed' ? 'pos' : 'neg')}>{h.result.replace('_', ' ')} {h.yea}/{h.nay}{h.vetoedBy != null ? ` · veto ${g.empires[h.vetoedBy].name}` : ''}</span>
              </div>
            ))}
          </Section>
        </div>
      </div>
    </Sheet>
  );
}

function FleetContribution({ g, run }: { g: GameState; run: (c: Command) => void }) {
  const fleets = Object.values(g.fleets).filter((f) => f.ownerId === g.playerId && armed(f));
  const [id, setId] = useState<string>('');
  if (!fleets.length) return null;
  return (
    <div className="row between" style={{ marginTop: 4 }}>
      <select value={id} onChange={(ev) => setId(ev.target.value)}>
        <option value="">Send a fleet to the rift…</option>
        {fleets.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.ships.length} ships)</option>)}
      </select>
      <button className="btn small" disabled={!id} onClick={() => run({ type: 'conclave', action: 'contribute', kind: 'fleet', fleetId: +id })}>Send</button>
    </div>
  );
}
