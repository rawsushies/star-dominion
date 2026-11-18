import { useUI, useGame } from '../store';
import { hasContact, intelLevel, fuzz, opinion } from '../../sim/diplomacy';
import { visibleSystems, bordering, warBetween, armed } from '../../sim/territory';
import { fleetPower } from '../../sim/fleets';
import { GOVERNMENTS } from '../../sim/data/governments';
import { TECH_BY_ID } from '../../sim/data/techs';
import { Sheet, Section, Emblem, Meter, fmt, cls, Swatch } from '../components/common';
import { focusSystem } from '../components/MapView';

export function IntelScreen() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const vis = visibleSystems(g, g.playerId);
  const known = g.empires.filter((e) => e.alive && e.id !== g.playerId && (e.kind === 'major' || e.kind === 'minor' || e.kind === 'rebels') && hasContact(g, g.playerId, e.id));
  const myPower = me.stats.militaryPower || 1;
  const unexplored = g.galaxy.systems.length - me.explored.length;
  return (
    <Sheet title="Intelligence" lede={`Reports on ${known.length} known realms. Accuracy depends on borders, treaties and your intelligence service (currently ${me.policies.intelligence}). ${unexplored} systems remain uncharted.`}
      actions={<button className="btn" onClick={() => ui.set({ screen: 'kingdom' })}>Intelligence service policy</button>}>
      {!known.length && <div className="empty">No foreign realms have been encountered. Scouts reveal the galaxy.</div>}
      <div className="cols c2">
        {known.map((e) => {
          const intel = intelLevel(g, g.playerId, e.id);
          const f = (v: number, salt: number) => { const r = fuzz(v, intel, e.id * 31 + salt); return r.range ? `${fmt(r.value)} ±${fmt(r.range)}` : fmt(v); };
          const fleets = Object.values(g.fleets).filter((x) => x.ownerId === e.id && vis.has(x.systemId) && armed(x));
          const seenPower = fleets.reduce((a, x) => a + fleetPower(g, x), 0);
          const ratio = e.stats.militaryPower / myPower;
          const threat = warBetween(g, e.id, g.playerId) ? 'At war' : ratio > 2 && bordering(g, e.id, g.playerId) && opinion(g, e.id, g.playerId) < 0 ? 'Severe' : ratio > 1.2 && bordering(g, e.id, g.playerId) ? 'Elevated' : 'Low';
          const recent = intel >= 60 ? e.research.done.slice(-3).map((t) => TECH_BY_ID[t]?.name).filter(Boolean) : [];
          return (
            <div key={e.id} className="frame" style={{ padding: 14 }}>
              <div className="row" style={{ gap: 10 }}>
                <Emblem empire={e} size={34} />
                <div className="grow"><div className="serif" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1 }}>{e.name}</div><div className="hint">{GOVERNMENTS[e.government].label}{e.kind !== 'major' ? ' · independent' : ''}</div></div>
                <span className={cls('tag', threat === 'Low' ? '' : 'bad')}>Threat: {threat}</span>
              </div>
              <div className="row" style={{ marginTop: 8 }}><span className="hint" style={{ width: 90 }}>Intel {intel}%</span><div className="grow"><Meter value={intel} /></div></div>
              <div className="kv" style={{ marginTop: 8 }}>
                <span>Worlds / systems</span><span>{intel >= 40 ? e.stats.colonies : '?'} / {e.stats.systems}</span>
                <span>Population</span><span>{f(e.stats.population, 1)}</span>
                <span>Military strength</span><span>{f(e.stats.militaryPower, 2)}</span>
                <span>Fleets in sensor range</span><span>{fleets.length} ({fmt(seenPower)})</span>
                <span>Economic output</span><span>{f(e.stats.economyScore, 3)}</span>
                <span>Research output</span><span>{f(e.stats.research, 4)}</span>
                <span>Technologies</span><span>{intel >= 50 ? e.research.done.length : '?'}</span>
                <span>Stability</span><span>{intel >= 50 ? e.stats.avgStability : '?'}</span>
                <span>War exhaustion</span><span>{intel >= 40 ? Math.round(e.warExhaustion) : '?'}</span>
                <span>Wars</span><span>{g.wars.filter((w) => w.attackers.includes(e.id) || w.defenders.includes(e.id)).map((w) => w.name).join(', ') || 'None'}</span>
              </div>
              {recent.length > 0 && <div className="hint" style={{ marginTop: 6 }}>Recent breakthroughs: {recent.join(', ')}</div>}
              {fleets.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {fleets.slice(0, 4).map((x) => (
                    <div key={x.id} className="row between hint" style={{ cursor: 'pointer' }} onClick={() => { focusSystem(x.systemId); ui.set({ screen: 'map', view: 'galaxy', fleetId: x.id, systemId: x.systemId }); }}>
                      <span className="row" style={{ gap: 6 }}><Swatch color={e.color} />Fleet at {g.galaxy.systems[x.systemId].name}</span><span className="num">{fleetPower(g, x)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Section title="Galactic dangers">
        <div className="kv">
          <span>Sentinel lairs known</span><span>{g.galaxy.systems.filter((s) => s.features.includes('guardian') && me.explored.includes(s.id)).length}</span>
          <span>Corsair bands sighted</span><span>{Object.values(g.fleets).filter((x) => g.empires[x.ownerId].kind === 'raiders' && vis.has(x.systemId)).length}</span>
          <span>Wars across the galaxy</span><span>{g.wars.length}</span>
        </div>
      </Section>
    </Sheet>
  );
}
