import { useState } from 'react';
import { Term } from '../components/Guidance';
import { StationButtons } from '../components/OpControls';
import { useUI, useGame } from '../store';
import { STAR_TYPES, PLANET_TYPES } from '../../sim/data/planets';
import { STARBASE } from '../../sim/data/ships';
import { MEGA_BY_ID } from '../../sim/data/megastructures';
import { starbaseUpgradeCost } from '../../sim/construction';
import { STATION_COST } from '../../sim/commands';
import { planetHab } from '../../sim/economy';
import { empireMods, hasTech } from '../../sim/modifiers';
import { claimCost, supplyNetwork } from '../../sim/territory';
import { systemValue } from '../../sim/diplomacy';
import { Sheet, Section, CostView, Meter, Tip, cls, fmt, Swatch } from '../components/common';
import { PlanetThumb, FEATURE_INFO } from '../components/ContextPanel';
import { focusSystem } from '../components/MapView';

export function SystemsScreen() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const [filter, setFilter] = useState<'owned' | 'frontier'>('owned');
  const net = supplyNetwork(g, g.playerId);
  const explored = new Set(me.explored);
  const owned = g.galaxy.systems.filter((s) => s.owner === g.playerId);
  const frontier = g.galaxy.systems.filter((s) => s.owner == null && explored.has(s.id) && !s.features.includes('guardian'))
    .sort((a, b) => systemValue(g, b.id) - systemValue(g, a.id));
  const list = filter === 'owned' ? owned : frontier;
  const sel = g.galaxy.systems.find((s) => s.id === ui.systemId && list.includes(s)) ?? list[0];
  const mods = empireMods(g, me);
  return (
    <Sheet title="Star systems" lede="Claimed systems project starbases, host orbital extractors and anchor your supply network. Unclaimed systems can be raised as outposts by construction ships."
      actions={<div className="seg" style={{ width: 280 }}><button className={cls(filter === 'owned' && 'on')} onClick={() => setFilter('owned')}>Your systems ({owned.length})</button><button className={cls(filter === 'frontier' && 'on')} onClick={() => setFilter('frontier')}>Unclaimed ({frontier.length})</button></div>}>
      <div className="cols side">
        <div className="list" style={{ alignSelf: 'start' }}>
          {list.map((s) => (
            <div key={s.id} className={cls('li', sel?.id === s.id && 'sel')} onClick={() => ui.set({ systemId: s.id })}>
              <span className="swatch" style={{ background: STAR_TYPES[s.star].glow, borderRadius: 0 }} />
              <div className="grow">
                <div className="row between"><span>{s.name}</span><span className="num faint">{s.planetIds.length} bodies</span></div>
                <div className="hint">
                  {filter === 'owned' ? `${s.starbase ? STARBASE[s.starbase]!.label : 'No starbase'}${!net.has(s.id) ? ' · cut off' : ''}` : `Claim: ${claimCost(g, me, s.id)} influence · value ${Math.round(systemValue(g, s.id))}`}
                </div>
              </div>
            </div>
          ))}
          {!list.length && <div className="empty">{filter === 'owned' ? 'No systems.' : 'No charted unclaimed systems. Send scouts to explore.'}</div>}
        </div>
        {sel && (
          <div style={{ minWidth: 0 }}>
            <div className="row between">
              <div>
                <h1 className="serif" style={{ margin: 0, fontSize: 34, fontWeight: 600 }}>{sel.name}</h1>
                <div className="subtitle">{STAR_TYPES[sel.star].label} · {sel.owner != null ? g.empires[sel.owner].name : 'Unclaimed'}{sel.asteroidBelts ? ` · ${sel.asteroidBelts} asteroid belt${sel.asteroidBelts > 1 ? 's' : ''} (${(sel.asteroidBelts * 2.5).toFixed(1)} minerals/month to owner)` : ''}</div>
              </div>
              <div className="row">
                <button className="btn" onClick={() => { focusSystem(sel.id); ui.set({ screen: 'map', view: 'galaxy', systemId: sel.id }); }}>Show on map</button>
                <button className="btn" onClick={() => ui.set({ screen: 'map', view: 'system', systemId: sel.id })}>Enter system</button>
              </div>
            </div>
            {sel.features.length > 0 && <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>{sel.features.map((f) => <Tip key={f} content={FEATURE_INFO[f][1]}><span className={cls('tag', f === 'guardian' ? 'bad' : 'gold')}>{FEATURE_INFO[f][0]}</span></Tip>)}</div>}
            {sel.owner === g.playerId && (
              <Section title={<Term entry="mech.outpost">Starbase</Term>} aside={sel.starbase ? STARBASE[sel.starbase]!.label : 'None'}>
                <div className="row wrap" style={{ gap: 18 }}>
                  <div className="kv" style={{ minWidth: 260 }}>
                    <span>Hull</span><span>{sel.starbase ? fmt(STARBASE[sel.starbase]!.hull + STARBASE[sel.starbase]!.armor) : '—'}</span>
                    <span>Weapons</span><span>{sel.starbase ? STARBASE[sel.starbase]!.damage : '—'}</span>
                    <span>Damage</span><span className={sel.starbaseDamage > 0 ? 'neg' : ''}>{Math.round(sel.starbaseDamage * 100)}%</span>
                    <span>Protects trade lanes</span><span>{sel.starbase >= 2 ? 'Yes' : 'No (Starport or better)'}</span>
                  </div>
                  <div>
                    {sel.starbaseUpgrade ? (
                      <><div className="hint">Upgrading to {STARBASE[sel.starbase + 1]!.label}</div><Meter value={sel.starbaseUpgrade.progress} max={sel.starbaseUpgrade.total} /></>
                    ) : starbaseUpgradeCost(sel.starbase) ? (
                      <div>
                        <div className="hint" style={{ marginBottom: 4 }}>Upgrade to {STARBASE[sel.starbase + 1]!.label} ({STARBASE[sel.starbase + 1]!.days} days){sel.starbase === 2 && !hasTech(me, 'eng_starbases') ? ' — requires Citadel Engineering' : ''}</div>
                        <CostView cost={starbaseUpgradeCost(sel.starbase)!} empire={me} />
                        <div style={{ marginTop: 6 }}><button className="btn" onClick={() => ui.cmd({ type: 'upgradeStarbase', systemId: sel.id })}>Upgrade starbase</button></div>
                      </div>
                    ) : <div className="hint">Maximum level.</div>}
                  </div>
                </div>
              </Section>
            )}
            <Section title="Celestial bodies" aside={sel.owner === g.playerId ? <span>Orbital station: <CostView cost={STATION_COST} empire={me} /></span> : undefined}>
              <table className="t">
                <thead><tr><th></th><th>World</th><th>Type</th><th className="n">Size</th><th className="n">Habitability</th><th className="n">Min/En/Rare</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {sel.planetIds.map((pid) => {
                    const p = g.planets[pid];
                    const hab = planetHab(g, p, me, mods);
                    return (
                      <tr key={pid}>
                        <td style={{ width: 40 }}><PlanetThumb planet={p} size={22} /></td>
                        <td>{p.name}{p.moonOf != null && <span className="faint"> (moon)</span>}</td>
                        <td>{PLANET_TYPES[p.type].label}</td>
                        <td className="n">{p.size}</td>
                        <td className={cls('n', hab >= 0.6 ? 'pos' : hab > 0 ? 'warn' : 'faint')}>{hab > 0 ? `${Math.round(hab * 100)}%` : '—'}</td>
                        <td className="n">{Math.round(p.deposits.minerals * 10) / 10}/{p.deposits.energy}/{p.deposits.rare}</td>
                        <td>{p.colony ? <span className="row" style={{ gap: 6 }}><Swatch color={g.empires[p.colony.ownerId].color} />Colony{p.colony.ownerId === g.playerId ? `, ${fmt(p.colony.pops, 1)} pops` : ''}</span> : p.colonizing ? 'Being settled' : p.station ? `${p.station[0].toUpperCase()}${p.station.slice(1)} operation, level ${p.op?.level ?? 1}` : <span className="faint">Untouched</span>}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {p.colony?.ownerId === g.playerId && <button className="btn small" onClick={() => ui.set({ screen: 'planets', planetId: p.id })}>Manage</button>}
                          {sel.owner === g.playerId && !p.colony && !p.station && <StationButtons p={p} small />}
                          {!p.colony && hab > 0 && !p.colonizing && (sel.owner == null || sel.owner === g.playerId) && <> <button className="btn small" onClick={() => { ui.selectPlanet(p.id); ui.set({ screen: 'map' }); }}>Colonise…</button></>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Section>
            {sel.megastructures.length > 0 && (
              <Section title="Megastructures">
                {sel.megastructures.map((m) => {
                  const d = MEGA_BY_ID[m.id];
                  return (
                    <div key={m.id} style={{ marginBottom: 8 }}>
                      <div className="row between"><span>{d.label} <span className="faint">({g.empires[m.ownerId].name})</span></span><span className="num">Stage {m.stage}/{d.stages}</span></div>
                      {m.building && <Meter value={m.progress} max={d.stageDays} />}
                      <div className="hint">{d.description}</div>
                    </div>
                  );
                })}
              </Section>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
