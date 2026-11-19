import { useUI, useGame } from '../store';
import { hasContact, intelLevel, fuzz, opinion } from '../../sim/diplomacy';
import { visibleSystems, bordering, warBetween, armed } from '../../sim/territory';
import { fleetPower } from '../../sim/fleets';
import { GOVERNMENTS } from '../../sim/data/governments';
import { TECH_BY_ID } from '../../sim/data/techs';
import { Sheet, Section, Emblem, Meter, fmt, cls, Swatch } from '../components/common';
import { focusSystem } from '../components/MapView';
import { useState } from 'react';
import { COVERT, COVERT_KINDS, opsBy, successChance, validateOp, networkBonus, counterIntel } from '../../sim/espionage';
import { charactersOf } from '../../sim/characters';
import type { CovertKind, Empire } from '../../sim/types';

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
      <CovertPanel known={known} />
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

/** Covert operations: launch with an idle spymaster, follow the ones under way. */
function CovertPanel({ known }: { known: Empire[] }) {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const targets = known.filter((e) => e.kind === 'major' || e.kind === 'minor');
  const ops = opsBy(g, me.id);
  const busy = new Set(ops.map((o) => o.agentId));
  const agents = charactersOf(g, me.id).filter((c) => c.status === 'active' && c.role === 'spymaster' && !busy.has(c.id));
  const [targetId, setTarget] = useState<number | null>(null);
  const [kind, setKind] = useState<CovertKind>('gather_intel');
  const [agentId, setAgent] = useState<number | null>(null);
  const [planetId, setPlanet] = useState<number | null>(null);
  const t = targets.find((e) => e.id === targetId) ?? targets[0];
  const a = agents.find((c) => c.id === agentId) ?? agents[0];
  const worlds = t ? g.planets.filter((p) => p.colony?.ownerId === t.id && g.galaxy.systems[p.systemId] && me.explored.includes(p.systemId)) : [];
  const world = worlds.find((p) => p.id === planetId) ?? worlds[0];
  const err = !t ? 'No rival realm is known' : !a ? 'No idle spymaster: recruit one in the Hall of Heroes' : validateOp(g, me, t.id, kind, a.id, COVERT[kind].needsPlanet ? world?.id ?? null : null);
  const odds = t && a ? successChance(g, me, t, kind, a.id) : 0;
  return (
    <Section title="Covert operations" aside={`${ops.length} under way · our counter-intelligence ${Math.round(counterIntel(g, me) * 100)}%`}>
      <div className="list" data-testid="covert-ops">
        {ops.map((o) => (
          <div key={o.id} className="li">
            <span className="grow"><b>{COVERT[o.kind].label}</b> against the {g.empires[o.targetId].name}{o.planetId != null ? ` (${g.planets[o.planetId].name})` : ''}
              <div className="hint">{charactersOf(g, me.id).find((c) => c.id === o.agentId)?.name ?? 'Agent'} · {Math.max(0, o.total - o.progress)} days left</div></span>
            <button className="btn small" onClick={() => ui.cmd({ type: 'cancelCovert', opId: o.id })}>Recall</button>
          </div>
        ))}
        {!ops.length && <div className="empty">No operations under way.</div>}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        <select aria-label="Target realm" value={t?.id ?? ''} onChange={(ev) => setTarget(Number(ev.target.value))}>{targets.map((e) => <option key={e.id} value={e.id}>{e.name}{networkBonus(g, me.id, e.id) ? ' · network' : ''}</option>)}</select>
        <select aria-label="Operation" value={kind} onChange={(ev) => setKind(ev.target.value as CovertKind)}>{COVERT_KINDS.map((k) => <option key={k} value={k}>{COVERT[k].label}</option>)}</select>
        {COVERT[kind].needsPlanet && <select aria-label="Target world" value={world?.id ?? ''} onChange={(ev) => setPlanet(Number(ev.target.value))}>{worlds.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        <select aria-label="Agent" value={a?.id ?? ''} onChange={(ev) => setAgent(Number(ev.target.value))}>{agents.map((c) => <option key={c.id} value={c.id}>{c.name} · level {c.level}</option>)}</select>
        <button className="btn" disabled={!!err} title={err ?? ''} onClick={() => t && a && ui.cmd({ type: 'launchCovert', targetId: t.id, kind, agentId: a.id, planetId: COVERT[kind].needsPlanet ? world?.id ?? null : null })}>Launch</button>
      </div>
      <div className="hint" style={{ marginTop: 6 }}>{COVERT[kind].description} {COVERT[kind].days} days · {COVERT[kind].cost.credits} credits{COVERT[kind].cost.influence ? ` · ${COVERT[kind].cost.influence} influence` : ''}{t && a ? ` · ${Math.round(odds * 100)}% chance of success` : ''}{err ? ` · ${err}` : ''}</div>
    </Section>
  );
}
