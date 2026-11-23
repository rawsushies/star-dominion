// Ancients and threats: the Stagnant Ascendancies (pressure, blame, warnings, tribute, knowledge,
// sponsorship), the War in Heaven, the Void Devourer, the Sentinels' sites and the Omega Incursion.
import { useState } from 'react';
import { useGame, useUI } from '../store';
import { Sheet, Section, Meter, Tip, cls, fmt } from '../components/common';
import { focusSystem } from '../components/MapView';
import { formatDate } from '../../sim/util';
import { opinion } from '../../sim/diplomacy';
import { fleetPower } from '../../sim/fleets';
import { armed, warBetween } from '../../sim/territory';
import { blameShare, precursorEmpire, tributeCost } from '../../sim/ancients';
import { devourerFleet } from '../../sim/threats';
import { omegaActive, omegaFleets, riftHeldBy } from '../../sim/omega';
import { expansionModLines, reputation, sponsorOf } from '../../sim/expansion';
import { DEVOURER, KNOWLEDGE_COST, KNOWLEDGE_OPINION, OMEGA, PRECURSORS, PRESSURE, SENTINEL_SITES, SPONSOR_COST, SPONSOR_OPINION } from '../../sim/data/expansion';
import { modText } from '../modLabels';
import type { Command } from '../../sim/commands';
import type { Cost, GameState } from '../../sim/types';
import type { PrecursorState } from '../../sim/expansionTypes';
import { AncientStance, AncientsAccord } from '../components/Politics';

const costLine = (c: Cost) => Object.entries(c).map(([k, v]) => `${v} ${k}`).join(', ');
const STATUS: Record<string, string> = { dormant: 'Dormant', stirring: 'Stirring', awakened: 'Awakened', watchful: 'Watchful', fallen: 'Fallen', absent: 'Absent' };
const STAGE: Record<string, string> = { dormant: 'Quiet', anomalies: 'Anomalies', warnings: 'Warnings: a rift is forming', rift: 'The rift is open', incursion: 'Incursion', resolved: 'Resolved' };

function go(sid: number) {
  focusSystem(sid);
  useUI.getState().set({ screen: 'map', view: 'galaxy', systemId: sid });
}

function PowerCard({ g, ps, run }: { g: GameState; ps: PrecursorState; run: (c: Command) => void }) {
  const def = PRECURSORS[ps.id];
  const me = g.empires[g.playerId];
  const pe = precursorEmpire(g, ps);
  const alive = !!pe?.alive && ps.status !== 'fallen' && ps.status !== 'absent';
  const op = alive ? opinion(g, ps.empireId, me.id) : 0;
  const atWar = alive && !!warBetween(g, me.id, ps.empireId);
  const sponsored = !!ps.sponsored[me.id];
  const share = blameShare(ps, me.id);
  const top = Object.entries(ps.blame).sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([id]) => g.empires[+id]);
  const due = ps.demands[me.id];
  const cd = ps.knowledgeCooldown[me.id] ?? 0;
  const known = alive && ps.sacred.some((sid) => me.explored.includes(sid));
  return (
    <Section title={<span style={{ color: def.color }}>{def.name}</span>} aside={STATUS[ps.status]}>
      <div data-testid={`power-${ps.id}`}>
        <div className="hint"><b>{STATUS[ps.status]}.</b> {def.epithet}. {def.lore}</div>
        {ps.status === 'absent' ? <div className="empty">This power found no place in this galaxy.</div> : (
          <>
            <div className="row" style={{ gap: 8, marginTop: 6 }}>
              <span className="hint" style={{ width: 70 }}>Pressure</span>
              <span className="grow"><Meter value={Math.min(PRESSURE.awaken, ps.pressure)} max={PRESSURE.awaken} tone={ps.pressure >= PRESSURE.final ? 'r' : 'v'} /></span>
              <span className="num">{Math.round(ps.pressure)} / {PRESSURE.awaken}</span>
            </div>
            <div className="hint">Warnings at {PRESSURE.stir} and {PRESSURE.final}; at {PRESSURE.awaken} they wake and make war on those they blame. You caused {Math.round(share * 100)}% of it.{top.length ? ` Most blamed: ${top.map(([id, v]) => `${g.empires[+id].name} (${Math.round(v)})`).join(', ')}.` : ''}</div>
            <div className="hint" style={{ marginTop: 4 }}><b>What wakes them:</b> {def.wakes.join('; ')}.</div>
            {ps.sources.length > 0 && (
              <details style={{ marginTop: 4 }}><summary className="hint">Recent causes</summary>
                {ps.sources.slice(-8).reverse().map((src, i) => <div key={i} className="row between hint"><span>{formatDate(src.tick)} · {src.label}</span><span className="num">{src.amount > 0 ? '+' : ''}{src.amount}</span></div>)}
              </details>
            )}
            {alive && (
              <div className="kv" style={{ marginTop: 6 }}>
                <span>Their opinion of you</span><span className={cls('num', op < 0 ? 'neg' : 'pos')}>{Math.round(op)}</span>
                <span>Relation</span><span>{atWar ? 'At war' : sponsored ? 'You are their sponsored sovereign' : 'Neutral'}</span>
                {due != null && <><span>Tribute demanded</span><span className="neg">due {formatDate(due)} ({Math.max(0, due - g.tick)} days)</span></>}
              </div>
            )}
            {sponsored && <div className="hint">Terms: {def.sponsorDuty} Strikes: {ps.sponsored[me.id].strikes} of 2. Favours: {def.sponsorBoons.map((b) => `${b.label} (${modText(b.key, b.value)})`).join(', ')}.</div>}
            {alive && !atWar && (
              <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                <Tip content={`Offer ${costLine(tributeCost(g, ps, me))}${def.tributeResearch ? ` and ${def.tributeResearch} research in progress` : ''}. Eases their pressure (once every six months) and their opinion of you.`}>
                  <button className="btn small" onClick={() => run({ type: 'ancients', precursor: ps.id, action: 'tribute' })} data-testid={`tribute-${ps.id}`}>Pay tribute</button>
                </Tip>
                <Tip content={`${KNOWLEDGE_COST} influence. Needs their opinion of ${KNOWLEDGE_OPINION} or sponsorship; once every three years. ${ps.id === 'automata' ? 'They hand over a technology.' : 'Research, a relic and psionic calm.'} The other power resents it.`}>
                  <button className="btn small" disabled={cd > g.tick} onClick={() => run({ type: 'ancients', precursor: ps.id, action: 'knowledge' })}>{cd > g.tick ? `Knowledge in ${Math.ceil((cd - g.tick) / 30)} mo` : 'Seek knowledge'}</button>
                </Tip>
                {sponsored ? <button className="btn small danger" onClick={() => run({ type: 'ancients', precursor: ps.id, action: 'renounce' })}>Renounce sponsorship</button>
                  : <Tip content={`${SPONSOR_COST} influence; needs their opinion of ${SPONSOR_OPINION}. A seat in the High Conclave and their favours, bound by their terms: ${def.sponsorDuty}`}><button className="btn small" disabled={!!sponsorOf(g, me.id)} onClick={() => run({ type: 'ancients', precursor: ps.id, action: 'sponsor' })}>Seek sponsorship</button></Tip>}
                {known && <button className="btn small" onClick={() => go(ps.sacred[0])}>Show enclave</button>}
              </div>
            )}
            {alive && !known && <div className="hint" style={{ marginTop: 4 }}>Their enclave has not been found.</div>}
            {alive && known && <AncientStance ps={ps} />}
          </>
        )}
      </div>
    </Section>
  );
}

export function CosmosScreen() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const x = g.expansion;
  const [note, setNote] = useState<string | null>(null);
  if (!x) return <Sheet title="Ancients and threats"><div className="empty">Nothing stirs in this galaxy.</div></Sheet>;
  const run = (cmd: Command) => { const r = ui.cmd(cmd); setNote(r.ok ? (r.message ?? 'Done') : (r.message ?? 'Refused')); };
  const h = x.heaven;
  const dv = x.devourer;
  const df = devourerFleet(g);
  const o = x.omega;
  const sites = Object.entries(x.sentinels).map(([k, v]) => ({ sid: +k, site: v })).filter(({ sid }) => me.explored.includes(sid));
  const salvageable = h.active ? Object.values(g.fleets).filter((f) => f.ownerId === me.id && f.progress === 0 && armed(f)).map((f) => f.systemId).filter((sid, i, a) => a.indexOf(sid) === i && x.precursors.some((p) => g.galaxy.systems[sid].owner === p.empireId)) : [];
  const held = riftHeldBy(g, me.id);
  const engine = g.galaxy.systems.some((s) => s.megastructures.some((m) => m.id === 'continuum_engine' && m.ownerId === me.id && m.stage >= 1));
  const boons = expansionModLines(g, me);
  return (
    <Sheet title="Ancients and threats" lede="The Stagnant Ascendancies, the War in Heaven, the Void Devourer, the Sentinels and the Omega Incursion.">
      {note && <div className="hint" style={{ marginBottom: 6 }} data-testid="cosmos-note">{note}</div>}
      <div className="cols c2">
        <div>
          {x.precursors.map((ps) => <PowerCard key={ps.id} g={g} ps={ps} run={run} />)}
          <Section title="The War in Heaven" aside={h.active ? `since ${formatDate(h.startTick ?? 0)}` : h.ended ? 'over' : 'not begun'}>
            {!h.active && !h.ended && <div className="empty">If both ancient powers wake, they turn on each other. Younger realms may then pledge to a side, stand together in an independent coalition, stay out of it, or salvage the ancients' outworks.</div>}
            {h.ended && !h.active && <div className="hint">Ended {formatDate(h.ended.tick)}: {h.ended.text}</div>}
            {h.active && (
              <div data-testid="heaven">
                <div className="hint">Pledged: {Object.entries(h.pledges).map(([id, side]) => `${g.empires[+id].name} → ${PRECURSORS[side].adjective}`).join(', ') || 'nobody'}. Coalition: {h.coalition.map((id) => g.empires[id].name).join(', ') || 'nobody'}.</div>
                {h.pledges[me.id] ? <div className="hint">You fight for {PRECURSORS[h.pledges[me.id]].name}.</div> : (
                  <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                    {x.precursors.filter((p) => p.status === 'awakened').map((p) => <button key={p.id} className="btn small" onClick={() => run({ type: 'ancients', precursor: p.id, action: 'pledge' })}>Pledge to {PRECURSORS[p.id].adjective}s</button>)}
                    {h.coalition.includes(me.id) ? <button className="btn small" onClick={() => run({ type: 'ancients', precursor: 'veil', action: 'leave_coalition' })}>Leave the coalition</button>
                      : <Tip content="Stay out of the war, but coalition members come to each other's defence if either power attacks one of them."><button className="btn small" onClick={() => run({ type: 'ancients', precursor: 'veil', action: 'coalition' })}>Join the independent coalition</button></Tip>}
                  </div>
                )}
                {salvageable.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    {salvageable.map((sid) => {
                      const ps = x.precursors.find((p) => g.galaxy.systems[sid].owner === p.empireId)!;
                      return <div key={sid} className="row between"><span>{g.galaxy.systems[sid].name} ({PRECURSORS[ps.id].adjective})</span><Tip content="Research, rare elements, alloys and a relic, at the cost of reputation and their hatred. Their warships must be gone."><button className="btn small danger" onClick={() => run({ type: 'ancients', precursor: ps.id, action: 'salvage', systemId: sid })}>Salvage</button></Tip></div>;
                    })}
                  </div>
                )}
              </div>
            )}
          </Section>
          <AncientsAccord />
        </div>
        <div>
          <Section title="The Omega Incursion" aside={STAGE[o.stage]}>
            <div data-testid="omega">
              {o.stage === 'dormant' && <div className="empty">Proving the Omega Theorem, or bringing a Continuum Engine to its second stage, will draw the attention of something outside this universe.</div>}
              {o.trigger && <div className="hint">Drawn by the {g.empires[o.trigger.empireId].name} ({o.trigger.cause === 'theorem' ? 'the Omega Theorem' : 'the Continuum Engine'}), {formatDate(o.trigger.tick)}.</div>}
              {o.stage === 'anomalies' && <div className="hint">Anomalies spread. A rift's location will be known in about {Math.max(0, Math.ceil(OMEGA.anomalyMonths - (g.tick - o.stageTick) / 30))} months.</div>}
              {o.rift != null && o.stage !== 'resolved' && <div className="row between"><span>Rift: <b>{g.galaxy.systems[o.rift].name}</b></span><button className="btn small" onClick={() => go(o.rift!)}>Show</button></div>}
              {o.stage === 'warnings' && <div className="hint">It opens in about {Math.max(0, Math.ceil(OMEGA.warningMonths - (g.tick - o.stageTick) / 30))} months. Prepare fleets and starbases; defended systems resist corruption.</div>}
              {omegaActive(g) && (
                <>
                  <div className="row" style={{ gap: 8, marginTop: 6 }}><span className="hint" style={{ width: 70 }}>Integrity</span><span className="grow"><Meter value={o.integrity} max={100} tone="r" /></span><span className="num">{Math.round(o.integrity)}</span></div>
                  <div className="kv">
                    <span>Strength</span><span>{o.strength.toFixed(2)}</span>
                    <span>Corrupted systems</span><span>{Object.keys(o.corrupted).length}</span>
                    <span>Omega fleets</span><span>{omegaFleets(g).length}</span>
                    <span>Worlds lost</span><span>{o.losses.colonies}</span>
                    <span>Counteroffensive</span><span>{x.conclave.directives.some((d) => d.resolution.cosmic === 'omega') ? 'The Conclave coordinates it (+25% siege)' : 'Uncoordinated'}</span>
                    <span>Your credit</span><span>{fmt(o.credit[me.id] ?? 0)}</span>
                  </div>
                  <div className="hint" style={{ marginTop: 4 }}>Warships holding the rift with no Omega ship there wear its integrity down each month. Corrupted worlds with no fleet of yours are lost after {OMEGA.neglectMonths} months. If corruption takes {Math.round(OMEGA.consumeShare * 100)}% of claimed space, the galaxy is consumed.</div>
                  {o.project && <div style={{ marginTop: 4 }}><span className="hint">Sealing by the {g.empires[o.project.empireId].name}: </span><Meter value={o.project.progress} max={o.project.total} /></div>}
                  <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                    <Tip content={`Integrity ${OMEGA.sealIntegrity} or less; ${costLine(OMEGA.sealCost)}; hold the rift ${OMEGA.sealDays} days. Ends the incursion; its remnants wither.`}><button className="btn small" disabled={!held || o.integrity > OMEGA.sealIntegrity || !!o.project} onClick={() => run({ type: 'omega', action: 'seal' })} data-testid="omega-seal">Seal the rift</button></Tip>
                    <Tip content={`Integrity ${OMEGA.breachIntegrity} or less. Two of every five of your warships at the rift are lost; every Omega fleet is destroyed and the galaxy recovers fastest.`}><button className="btn small danger" disabled={!held || o.integrity > OMEGA.breachIntegrity} onClick={() => run({ type: 'omega', action: 'breach' })}>Destroy the source</button></Tip>
                    <Tip content={`Integrity ${OMEGA.exploitIntegrity} or less; the Transcendent Continuum or a working Continuum Engine; ${costLine(OMEGA.exploitCost)}. +30% energy and +25% research for good, but -40 reputation, the hatred of every realm and the ancients, the slowest recovery, and a yearly chance the rift tears free.`}><button className="btn small danger" disabled={!held || o.integrity > OMEGA.exploitIntegrity || ((me.era ?? 0) < 4 && !engine)} onClick={() => run({ type: 'omega', action: 'exploit' })}>Bind it for ourselves</button></Tip>
                  </div>
                  {!held && <div className="hint">To act at the rift your warships must hold it, with no Omega warship there.</div>}
                </>
              )}
              {o.resolution && <div className="hint" style={{ marginTop: 4 }}>{formatDate(o.resolution.tick)}: the rift was {o.resolution.kind}{o.resolution.empireId != null ? ` by the ${g.empires[o.resolution.empireId].name}` : ''}. {Object.keys(o.recovery).length} systems are still recovering. {o.losses.colonies} worlds were lost.</div>}
            </div>
          </Section>
          <Section title="The Void Devourer" aside={dv.status === 'roaming' ? 'roaming' : dv.status === 'unborn' ? 'not yet seen' : dv.status}>
            <div data-testid="devourer">
              {dv.status === 'unborn' && <div className="empty">Deep-space observatories report nothing yet. A stellar leviathan may enter the galaxy in a later age.</div>}
              {df && (
                <>
                  <div className="kv">
                    <span>Location</span><span><button className="btn small" onClick={() => go(df.systemId)}>{g.galaxy.systems[df.systemId].name}</button></span>
                    <span>Next destination</span><span>{dv.target != null ? <>{g.galaxy.systems[dv.target].name} in {Math.max(0, dv.nextMoveTick - g.tick)} days{g.galaxy.systems[dv.target].owner === me.id ? <b className="neg"> (yours)</b> : ''}</> : 'unknown'}</span>
                    <span>Strength</span><span>{fmt(fleetPower(g, df))} ({df.ships.length} spawn)</span>
                    <span>Fed</span><span>{dv.fed} times · {Object.keys(dv.scars).length} systems scarred</span>
                    <span>Leaves the galaxy</span><span>{formatDate((dv.bornTick ?? g.tick) + DEVOURER.lifespanYears * 360)}</span>
                  </div>
                  <div className="hint">Where it sits, energy falls to {Math.round(DEVOURER.drain * 100)}% and trade through the system is cut; it scars systems it feeds on ({Math.round(DEVOURER.scar * 100)}% energy for {DEVOURER.scarYears} years) and eats a stage of any Dyson Swarm there. Fleets and starbases can kill it; leaving your systems to it with no fleet nearby costs reputation.</div>
                </>
              )}
              {dv.status === 'slain' && <div className="hint">Slain {dv.endTick != null ? formatDate(dv.endTick) : ''}{dv.slainBy != null ? ` by the ${g.empires[dv.slainBy].name}` : ''}.</div>}
              {dv.status === 'departed' && <div className="hint">It left the galaxy {dv.endTick != null ? formatDate(dv.endTick) : ''}.</div>}
            </div>
          </Section>
          <Section title="Sentinel sites" aside={`${sites.length} known`}>
            {!sites.length && <div className="empty">No Sentinel lair has been charted.</div>}
            <table className="t">
              <tbody>
                {sites.map(({ sid, site }) => (
                  <tr key={sid} className="click" onClick={() => go(sid)}>
                    <td>{g.galaxy.systems[sid].name}</td>
                    <td><Tip content={SENTINEL_SITES[site.kind].reward}><span>{SENTINEL_SITES[site.kind].label}</span></Tip></td>
                    <td className="hint">{site.claimedBy != null ? `won by ${g.empires[site.claimedBy].name}` : g.galaxy.systems[sid].features.includes('guardian') ? 'guarded' : 'open'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="hint">Destroying a host gives its reward to the victor and +8 reputation, but Automata Prime built the Sentinels.</div>
          </Section>
          <Section title="Standing and boons">
            <div className="kv"><span>Galactic reputation</span><span className={cls('num', reputation(g, me.id) < 0 ? 'neg' : 'pos')}>{Math.round(reputation(g, me.id))}</span></div>
            {boons.length ? boons.map((b, i) => <div key={i} className="row between hint"><span>{b.label}</span><span>{modText(b.key, b.value)}</span></div>) : <div className="hint">No lasting boons yet.</div>}
          </Section>
        </div>
      </div>
    </Sheet>
  );
}
