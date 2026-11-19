import { useUI, useGame } from '../store';
import { fleetPower, admiralOf } from '../../sim/fleets';
import { visibleSystems, isHostile, armed } from '../../sim/territory';
import { adjacency } from '../../sim/galaxy';
import { formatDate } from '../../sim/util';
import { ROLES } from '../../sim/data/characters';
import { Sheet, Section, Meter, Swatch, cls, fmt } from '../components/common';
import { focusSystem } from '../components/MapView';

export function WarRoomScreen() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const vis = visibleSystems(g, g.playerId);
  const wars = g.wars.filter((w) => w.attackers.includes(me.id) || w.defenders.includes(me.id));
  const enemies = new Set(wars.flatMap((w) => (w.attackers.includes(me.id) ? w.defenders : w.attackers)));
  const hostileFleets = Object.values(g.fleets).filter((f) => f.ships.length && vis.has(f.systemId) && armed(f) && (enemies.has(f.ownerId) || isHostile(g, g.playerId, f.ownerId)));
  const myFleets = Object.values(g.fleets).filter((f) => f.ownerId === me.id && armed(f)).sort((a, b) => fleetPower(g, b) - fleetPower(g, a));
  // fronts: our systems that border an enemy's
  const adj = adjacency(g.galaxy);
  const fronts = g.galaxy.systems.filter((s) => s.owner === me.id && adj[s.id].some((n) => { const o = g.galaxy.systems[n].owner; return o != null && enemies.has(o); }));
  const threat = (sid: number) => hostileFleets.filter((f) => f.systemId === sid || adj[sid].includes(f.systemId)).reduce((a, f) => a + fleetPower(g, f), 0);
  const defence = (sid: number) => myFleets.filter((f) => f.systemId === sid).reduce((a, f) => a + fleetPower(g, f), 0);
  const battles = g.battles.filter((b) => b.sides[0].includes(me.id) || b.sides[1].includes(me.id)).slice(-8).reverse();
  const go = (sid: number) => { focusSystem(sid); ui.set({ screen: 'map', view: 'galaxy', systemId: sid }); };
  return (
    <Sheet title="War room" lede={wars.length ? `The realm is at war on ${wars.length} ${wars.length === 1 ? 'front' : 'fronts'}.` : 'The realm is at peace. Keep watch on the borders.'}>
      <div className="cols c2">
        <div>
          <Section title="Wars" aside={`${wars.length}`}>
            {!wars.length && <div className="empty">No wars. Declare war from the Diplomacy screen.</div>}
            {wars.map((w) => {
              const ours = w.attackers.includes(me.id) ? w.score : -w.score;
              const foes = (w.attackers.includes(me.id) ? w.defenders : w.attackers).map((id) => g.empires[id]);
              const theirPower = foes.reduce((a, f) => a + (f.stats.militaryPower ?? 0), 0);
              return (
                <div key={w.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--rule)' }} data-testid="war">
                  <div className="row between"><span className="serif" style={{ fontSize: 16, fontWeight: 600 }}>{w.name}</span><span className="hint">since {formatDate(w.startTick)}</span></div>
                  <div className="row" style={{ gap: 6 }}>{foes.map((f) => <span key={f.id} className="row" style={{ gap: 4 }}><Swatch color={f.color} />{f.name}</span>)}</div>
                  <div className="row" style={{ gap: 8, marginTop: 4 }}><span className="hint" style={{ width: 90 }}>War score</span><span className="grow"><Meter value={50 + ours / 2} max={100} tone={ours < 0 ? 'r' : 'v'} /></span><span className={cls('num', ours < 0 ? 'neg' : 'pos')}>{ours > 0 ? '+' : ''}{Math.round(ours)}</span></div>
                  <div className="hint">Fleet strength: ours {fmt(me.stats.militaryPower)} against theirs {fmt(theirPower)}. War exhaustion {Math.round(me.warExhaustion)}.</div>
                </div>
              );
            })}
            <div className="row" style={{ marginTop: 6 }}><button className="btn small" onClick={() => ui.openScreen('diplomacy')}>Open diplomacy</button><button className="btn small" onClick={() => ui.openScreen('military')}>Battle reports</button></div>
          </Section>
          <Section title="Fronts" aside={`${fronts.length} border systems`}>
            <table className="t">
              <thead><tr><th>System</th><th className="n">Threat nearby</th><th className="n">Our fleets</th><th>Starbase</th></tr></thead>
              <tbody>
                {fronts.slice(0, 14).map((s) => {
                  const t = threat(s.id), d = defence(s.id);
                  return (
                    <tr key={s.id} className="click" onClick={() => go(s.id)}>
                      <td>{s.name}</td>
                      <td className={cls('n', t > d && 'neg')}>{t ? fmt(t) : '—'}</td>
                      <td className="n">{d ? fmt(d) : '—'}</td>
                      <td className="hint">{['None', 'Outpost', 'Starport', 'Citadel'][s.starbase] ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!fronts.length && <div className="hint">No system of yours borders an enemy.</div>}
          </Section>
        </div>
        <div>
          <Section title="Hostile forces sighted" aside={`${hostileFleets.length}`}>
            {!hostileFleets.length && <div className="hint">No hostile warfleets within sensor range.</div>}
            {hostileFleets.slice(0, 12).map((f) => (
              <div key={f.id} className="row between click" style={{ padding: '3px 0' }} onClick={() => go(f.systemId)}>
                <span className="row" style={{ gap: 6 }}><Swatch color={g.empires[f.ownerId].color} />{g.empires[f.ownerId].adjective} fleet, {f.ships.length} ships</span>
                <span className="hint">{g.galaxy.systems[f.systemId].name} · strength {fmt(fleetPower(g, f))}</span>
              </div>
            ))}
          </Section>
          <Section title="Our fleets">
            <table className="t">
              <thead><tr><th>Fleet</th><th>Commander</th><th className="n">Strength</th><th className="n">Supply</th></tr></thead>
              <tbody>
                {myFleets.map((f) => { const c = admiralOf(g, f); return (
                  <tr key={f.id} className="click" onClick={() => ui.set({ screen: 'fleets', fleetId: f.id })}>
                    <td>{f.name}<div className="hint">{g.galaxy.systems[f.systemId].name}</div></td>
                    <td className="hint">{c ? `${ROLES[c.role].label} ${c.name}` : 'None'}</td>
                    <td className="n">{fmt(fleetPower(g, f))}</td>
                    <td className={cls('n', f.supply < 25 && 'neg')}>{Math.round(f.supply)}%</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </Section>
          <Section title="Recent battles">
            {!battles.length && <div className="hint">No battles yet.</div>}
            {battles.map((b) => {
              const side = b.sides[0].includes(me.id) ? 0 : 1;
              return (
                <div key={b.id} className="row between click" style={{ padding: '3px 0' }} onClick={() => ui.set({ screen: 'military', battleId: b.id })}>
                  <span>Battle of {g.galaxy.systems[b.systemId].name} <span className="hint">{formatDate(b.tick)}</span></span>
                  <span className={cls('hint', b.winner === side ? 'pos' : b.winner === -1 ? '' : 'neg')}>{b.shipsLost[side]} lost, {b.shipsLost[1 - side]} destroyed · Watch replay</span>
                </div>
              );
            })}
          </Section>
        </div>
      </div>
    </Sheet>
  );
}
