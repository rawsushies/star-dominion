import { useEffect, useRef, useState } from 'react';
import { useUI, useGame } from '../store';
import { fleetPower } from '../../sim/fleets';
import { getLedger } from '../../sim/engine';
import { visibleSystems, isHostile, armed } from '../../sim/territory';
import { PEACE_LABEL } from '../../sim/diplomacy';
import { formatDate } from '../../sim/util';
import { Sheet, Section, Swatch, cls, fmt, Meter } from '../components/common';
import { focusSystem } from '../components/MapView';
import { BattleView3D } from '../render/battle3d';
import type { BattleReport, PeaceTerm } from '../../sim/types';

export function MilitaryScreen() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const L = getLedger(g, me);
  const wars = g.wars.filter((w) => w.attackers.includes(g.playerId) || w.defenders.includes(g.playerId));
  const vis = visibleSystems(g, g.playerId);
  const threats = Object.values(g.fleets).filter((f) => vis.has(f.systemId) && isHostile(g, g.playerId, f.ownerId) && armed(f) && g.empires[f.ownerId].kind !== 'guardian')
    .sort((a, b) => fleetPower(g, b) - fleetPower(g, a));
  const myBattles = g.battles.filter((b) => b.sides[0].includes(g.playerId) || b.sides[1].includes(g.playerId) || vis.has(b.systemId)).slice().reverse();
  const battle = g.battles.find((b) => b.id === ui.battleId) ?? myBattles[0];
  const myPower = Object.values(g.fleets).filter((f) => f.ownerId === g.playerId).reduce((a, f) => a + fleetPower(g, f), 0);
  return (
    <Sheet title="Military operations" lede={`Fleet strength ${fmt(myPower)} · naval capacity ${L.navalUsed}/${L.navalCap} · war exhaustion ${Math.round(me.warExhaustion)}`}>
      <div className="cols c2">
        <div>
          <Section title="Wars" aside={wars.length ? `${wars.length} active` : 'At peace'}>
            {!wars.length && <div className="empty">The realm is at peace. Wars are declared from the Diplomacy screen.</div>}
            {wars.map((w) => {
              const mine = w.attackers.includes(g.playerId) ? 1 : -1;
              const score = w.score * mine;
              const leader = (w.attackers.includes(g.playerId) ? w.attackers[0] : w.defenders[0]) === g.playerId;
              return (
                <div key={w.id} style={{ marginBottom: 14 }}>
                  <div className="serif" style={{ fontSize: 20, fontWeight: 600 }}>{w.name}</div>
                  <div className="hint">Since {formatDate(w.startTick)}. Allies: {(mine > 0 ? w.attackers : w.defenders).map((i) => g.empires[i].name).join(', ')}. Enemies: {(mine > 0 ? w.defenders : w.attackers).map((i) => g.empires[i].name).join(', ')}.</div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <span className="num" style={{ width: 90 }}>War score</span>
                    <div className="grow" style={{ position: 'relative', height: 6, background: 'var(--rule)' }}>
                      <i style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: 'var(--vellum-3)' }} />
                      <i style={{ position: 'absolute', top: 0, bottom: 0, background: score >= 0 ? 'var(--verdigris)' : 'var(--cinnabar)', left: score >= 0 ? '50%' : `${50 + score / 2}%`, width: `${Math.abs(score) / 2}%` }} />
                    </div>
                    <span className={cls('num', score >= 0 ? 'pos' : 'neg')} style={{ width: 40, textAlign: 'right' }}>{Math.round(score)}</span>
                  </div>
                  {leader && <PeaceButtons warId={w.id} />}
                </div>
              );
            })}
          </Section>
          <Section title="Hostile forces sighted" aside="Within sensor range">
            {!threats.length && <div className="empty">No hostile fleets in sight.</div>}
            <div className="list">
              {threats.slice(0, 12).map((f) => (
                <div key={f.id} className="li" onClick={() => { focusSystem(f.systemId); ui.set({ screen: 'map', view: 'galaxy', systemId: f.systemId, fleetId: f.id }); }}>
                  <Swatch color={g.empires[f.ownerId].color} />
                  <span className="grow">{g.empires[f.ownerId].adjective} fleet at {g.galaxy.systems[f.systemId].name}</span>
                  <span className="num">{f.ships.length} ships · {fleetPower(g, f)}</span>
                </div>
              ))}
            </div>
          </Section>
          <Section title="Your fleets">
            <table className="t">
              <thead><tr><th>Fleet</th><th>Location</th><th className="n">Ships</th><th className="n">Strength</th><th className="n">Supply</th></tr></thead>
              <tbody>
                {Object.values(g.fleets).filter((f) => f.ownerId === g.playerId && armed(f)).map((f) => (
                  <tr key={f.id} className="click" onClick={() => ui.set({ screen: 'fleets', fleetId: f.id })}>
                    <td>{f.name}</td><td>{g.galaxy.systems[f.systemId].name}</td><td className="n">{f.ships.length}</td><td className="n">{fleetPower(g, f)}</td><td className={cls('n', f.supply < 25 && 'neg')}>{Math.round(f.supply)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>
        <div>
          <Section title="Battle reports" aside={`${myBattles.length} recorded`}>
            {!myBattles.length && <div className="empty">No battles fought yet.</div>}
            <div className="list" style={{ maxHeight: 180, overflowY: 'auto' }}>
              {myBattles.map((b) => (
                <div key={b.id} className={cls('li', battle?.id === b.id && 'sel')} onClick={() => ui.set({ battleId: b.id })}>
                  <span className="grow">Battle of {g.galaxy.systems[b.systemId].name} <span className="faint">· {formatDate(b.tick)}</span></span>
                  <span className="num">{b.ongoing ? <span className="neg">Ongoing</span> : `${b.shipsLost[0]} : ${b.shipsLost[1]} lost`}</span>
                </div>
              ))}
            </div>
            {battle && <BattleViewer b={battle} />}
          </Section>
        </div>
      </div>
    </Sheet>
  );
}

function PeaceButtons({ warId }: { warId: number }) {
  const ui = useUI();
  const [res, setRes] = useState<string>('');
  const propose = (term: PeaceTerm) => {
    const r = ui.cmd({ type: 'proposePeace', warId, term });
    if (r.evaluation) setRes(`${r.ok ? 'Accepted' : 'Rejected'}: ${r.evaluation.reasons.map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ')}`);
  };
  return (
    <div style={{ marginTop: 8 }}>
      <div className="row wrap">{(['status_quo', 'tribute', 'cede', 'vassalize'] as PeaceTerm[]).map((t) => <button key={t} className="btn small" onClick={() => propose(t)}>Offer: {PEACE_LABEL[t]}</button>)}</div>
      {res && <div className="hint" style={{ marginTop: 4 }}>{res}</div>}
    </div>
  );
}

/** Replays a recorded battle in 3D: the real hulls, beams, torpedoes, strike craft, shields and explosions. */
function BattleViewer({ b }: { b: BattleReport }) {
  const g = useGame();
  const ref = useRef<HTMLCanvasElement>(null);
  const view = useRef<BattleView3D | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [ready, setReady] = useState(false);
  const maxRound = Math.max(1, Math.min(b.rounds, b.ships[0]?.hp.length ?? 1));
  useEffect(() => {
    const v = new BattleView3D(ref.current!);
    view.current = v;
    (window as unknown as { __sdBattle?: BattleView3D }).__sdBattle = v;
    return () => { v.dispose(); view.current = null; };
  }, []);
  useEffect(() => {
    setReady(false); setTime(0); setPlaying(true);
    view.current?.load(g, b).then(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.id]);
  useEffect(() => {
    if (!playing || !ready) return;
    let raf = 0, last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      setTime((t) => { const n = t + dt * 0.8; if (n >= maxRound) { setPlaying(false); return maxRound - 0.001; } return n; });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, ready, maxRound]);
  useEffect(() => { view.current?.setTime(time); }, [time, ready]);
  const round = Math.min(maxRound - 1, Math.floor(time));
  const sideName = (s: 0 | 1) => b.sides[s].map((i) => g.empires[i].name).join(', ');
  return (
    <div style={{ marginTop: 10 }}>
      <div className="row between"><span className="serif" style={{ fontSize: 20, fontWeight: 600 }}>Battle of {g.galaxy.systems[b.systemId].name}</span><span className="hint">{b.ongoing ? 'Still raging' : b.winner === -1 ? 'Broken off' : `${sideName(b.winner as 0 | 1)} victorious`}</span></div>
      <div style={{ position: 'relative', marginTop: 6 }}>
        <canvas ref={ref} data-testid="battle3d" style={{ width: '100%', height: 340, display: 'block', border: '1px solid var(--rule)', cursor: 'grab', touchAction: 'none' }} />
        {!ready && <div className="hint" style={{ position: 'absolute', left: 10, top: 8 }}>Loading the fleets…</div>}
        <div className="hint" style={{ position: 'absolute', right: 10, bottom: 8 }}>Drag to turn the camera, scroll to zoom.</div>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn small" onClick={() => { if (time >= maxRound - 0.01) setTime(0); setPlaying(!playing); }}>{playing ? 'Pause' : 'Play'}</button>
        <input type="range" min={0} max={maxRound - 1} step={0.01} value={time} onChange={(e) => { setPlaying(false); setTime(+e.target.value); }} className="grow" aria-label="Battle round" />
        <span className="num faint">Round {round + 1}/{maxRound}</span>
      </div>
      <div className="kv" style={{ marginTop: 8 }}>
        <span>{sideName(0)}</span><span>{b.shipsLost[0]} ships lost ({fmt(b.losses[0])} value)</span>
        <span>{sideName(1)}</span><span>{b.shipsLost[1]} ships lost ({fmt(b.losses[1])} value)</span>
      </div>
      <Meter value={b.losses[1]} max={Math.max(1, b.losses[0] + b.losses[1])} tone="v" />
    </div>
  );
}

