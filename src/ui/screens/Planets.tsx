import { useState } from 'react';
import { Term } from '../components/Guidance';
import { useUI, useGame } from '../store';
import { getLedger } from '../../sim/engine';
import { BUILDINGS, BUILDABLE, type Yield } from '../../sim/data/buildings';
import { PLANET_TYPES } from '../../sim/data/planets';
import { SHIPS, SHIP_ORDER } from '../../sim/data/ships';
import { buildingCost, buildingDays, canBuild, canBuildShip, shipCost, shipDays, shipyardSlots } from '../../sim/construction';
import { Sheet, Section, CostView, Meter, ResGlyph, Tip, fmt, signed, cls, RES_META, plural } from '../components/common';
import { PlanetThumb } from '../components/ContextPanel';
import type { BuildingId, Planet, ShipClass } from '../../sim/types';
import type { LedgerKey } from '../../sim/economy';
import { DESIGNATIONS, DESIGNATION_IDS, DESIGNATION_COOLDOWN, DESIGNATION_COST } from '../../sim/data/designations';
import { governorBonus } from '../../sim/characters';

const ROUTE_LABEL: Record<string, string> = { capital: 'Capital', secure: 'Secure', raided: 'Raided', disrupted: 'Disrupted', cut: 'Cut off' };

export function yieldText(y: Yield, per = 'per worker'): string {
  return Object.entries(y).map(([k, v]) => `${v} ${k === 'trade' ? 'trade value' : RES_META[k as LedgerKey]?.label.toLowerCase() ?? k}`).join(', ') + (Object.keys(y).length ? ` ${per}` : '');
}

export function PlanetsScreen() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const L = getLedger(g, me);
  const colonies = g.planets.filter((p) => p.colony?.ownerId === g.playerId).sort((a, b) => b.colony!.pops - a.colony!.pops);
  const sel = colonies.find((p) => p.id === ui.planetId) ?? colonies[0];
  return (
    <Sheet title="Planet management" lede={`${plural(colonies.length, 'colonised world')}, ${fmt(me.stats.population, 0)} pops. Every world is run on its own jobs, housing and stability.`}>
      <div className="cols side">
        <div className="list" style={{ alignSelf: 'start' }}>
          {colonies.map((p) => {
            const rep = L.planets[p.id];
            const c = p.colony!;
            return (
              <div key={p.id} className={cls('li', sel?.id === p.id && 'sel')} onClick={() => ui.set({ planetId: p.id })}>
                <PlanetThumb planet={p} size={28} />
                <div className="grow">
                  <div className="row between"><span>{p.name}{me.capitalPlanetId === p.id && <span className="brass"> ♦</span>}</span><span className="num">{fmt(c.pops, 1)}</span></div>
                  <div className="row between hint">
                    <span>{PLANET_TYPES[p.type].label}{c.queue.length ? ` · building ${c.queue.length}` : ''}</span>
                    <span className={c.stability < 30 ? 'neg' : c.stability < 45 ? 'warn' : ''}>stab {Math.round(c.stability)}</span>
                  </div>
                  {rep && rep.routeStatus !== 'capital' && rep.routeStatus !== 'secure' && <div className="hint neg">Trade route {ROUTE_LABEL[rep.routeStatus].toLowerCase()}</div>}
                </div>
              </div>
            );
          })}
        </div>
        {sel ? <PlanetDetail p={sel} /> : <div className="empty">You hold no colonies.</div>}
      </div>
    </Sheet>
  );
}

function PlanetDetail({ p }: { p: Planet }) {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const L = getLedger(g, me);
  const rep = L.planets[p.id];
  const c = p.colony!;
  const [tab, setTab] = useState<'build' | 'ships'>('build');
  if (!rep) return null;
  const caps = rep.districtCaps;
  const prodKeys = (Object.keys(rep.production) as LedgerKey[]).filter((k) => Math.abs(rep.production[k] ?? 0) > 0.05);
  const buildings = Object.entries(c.buildings).filter(([, n]) => (n ?? 0) > 0) as [BuildingId, number][];
  const order = (b: BuildingId) => ['capital', 'residential', 'agri', 'mining', 'power'].indexOf(b) + 1 || 99;
  buildings.sort((a, b) => order(a[0]) - order(b[0]));
  return (
    <div style={{ minWidth: 0 }}>
      <div className="row planet-head" style={{ gap: 18, alignItems: 'center' }}>
        <PlanetThumb planet={p} size={150} />
        <div className="grow">
          <h1 className="serif" style={{ fontSize: 36, margin: 0, fontWeight: 600, lineHeight: 1 }}>{p.name}</h1>
          <div className="subtitle">{PLANET_TYPES[p.type].label} world · size {p.size} · {Math.round(rep.hab * 100)}% habitable · founded {c.foundedTick < 0 ? 'before the reign' : `in ${2400 + Math.floor(c.foundedTick / 360)}`}</div>
          <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
            {me.capitalPlanetId === p.id && <span className="tag gold">Capital</span>}
            {!rep.connected && <span className="tag bad">Cut off from the realm</span>}
            {c.resistance > 0 && <span className="tag bad">Occupation resistance {Math.round(c.resistance)}</span>}
            {c.lowStabilityMonths > 0 && <span className="tag bad">Unrest: revolt in {Math.max(0, 4 - c.lowStabilityMonths)} months if unchecked</span>}
            <span className="tag">Trade route: {ROUTE_LABEL[rep.routeStatus]}</span>
          </div>
        </div>
        <div className="row"><button className="btn" onClick={() => { ui.set({ screen: 'map', view: 'system', systemId: p.systemId, planetId: p.id }); }}>View in system</button></div>
      </div>

      <div className="stat-strip" style={{ marginTop: 14 }}>
        <Tip content={<div><h4>Population</h4>Each pop is roughly 100 million people. Growth {signed(rep.growth, 2)} pops per month.</div>}>
          <div className="stat" style={{ width: '100%' }}><div className="k">Population</div><div className="v">{fmt(c.pops, 1)}<span className="faint" style={{ fontSize: 15 }}> / {rep.housing} housing</span></div><div className={cls('s', rep.growth < 0 && 'neg')}>{signed(rep.growth, 2)} per month</div></div>
        </Tip>
        <div className="stat"><div className="k">Jobs filled</div><div className="v">{rep.employed}<span className="faint" style={{ fontSize: 15 }}> / {rep.jobs}</span></div><div className={cls('s', rep.unemployed >= 1 && 'warn')}>{rep.unemployed >= 1 ? `${fmt(rep.unemployed, 1)} unemployed` : 'Full employment'}</div></div>
        <Tip content={<div><h4>Stability</h4><div className="kv">{rep.stabilityFactors.map(([k, v]) => [<span key={k}>{k}</span>, <span key={k + 'v'} className={v >= 0 ? 'pos' : 'neg'}>{signed(v, 0)}</span>])}</div><div className="hint" style={{ marginTop: 6 }}>Below 40 output falls; below 12 for four months the world revolts.</div></div>}>
          <div className="stat" style={{ width: '100%' }}><div className="k">Stability</div><div className={cls('v', c.stability < 30 ? 'neg' : c.stability < 45 ? 'warn' : '')}>{Math.round(c.stability)}</div><div className="s">trending to {Math.round(rep.stabilityTarget)} · output ×{rep.outputMult.toFixed(2)}</div></div>
        </Tip>
        <div className="stat"><div className="k">Garrison</div><div className="v">{fmt(rep.garrison, 1)}</div><div className="s">{c.buildings.orbital_defense ?? 0} defence batteries</div></div>
        <div className="stat"><div className="k">Trade value</div><div className="v">{fmt(rep.trade, 1)}</div><div className="s">{fmt(rep.tradeCollected, 1)} reaches the treasury</div></div>
      </div>

      <div className="cols side-r" style={{ marginTop: 16 }}>
        <div style={{ minWidth: 0 }}>
          <Section guide="planet-build" title="Districts and buildings" aside={`${rep.buildingsUsed}/${rep.buildingSlots} building slots · more slots every 5 pops`}>
            <label className="row setting" style={{ marginBottom: 8 }} data-testid="auto-build">
              <input type="checkbox" checked={!!c.auto} onChange={(ev) => ui.cmd({ type: 'setAutoBuild', planetId: p.id, on: ev.target.checked })} />
              <span><b>Let the steward build here</b><span className="hint" style={{ display: 'block' }}>Each month the steward queues what this world needs most (following its province role), keeping a small reserve. You can still build yourself.{p.id !== me.capitalPlanetId && <> <button className="linkish" onClick={(ev) => { ev.preventDefault(); ui.cmd({ type: 'setAutoBuild', planetId: 'all', on: true }); }}>Hand every colony to stewards</button></>}</span></span>
            </label>
            <div className="row wrap" style={{ marginBottom: 8, gap: 6 }}>
              {(['residential', 'agri', 'mining', 'power'] as const).map((d) => {
                const have = (c.buildings[d] ?? 0) + c.queue.filter((q) => q.id === d && !q.demolish).length;
                const v = canBuild(g, me, p, d);
                return (
                  <Tip key={d} content={<div><h4>{BUILDINGS[d].label}</h4><CostView cost={buildingCost(g, me, d)} empire={me} /><div className="hint">{buildingDays(g, me, d)} days. {BUILDINGS[d].description}</div>{!v.ok && <div className="neg">{v.reason}</div>}</div>}>
                    <button className="btn small" disabled={!v.ok} onClick={() => ui.cmd({ type: 'queueBuilding', planetId: p.id, building: d })}>
                      + {BUILDINGS[d].label.replace(' District', '')} <span className="faint">{have}/{caps[d]}</span>
                    </button>
                  </Tip>
                );
              })}
            </div>
            <div className="tiles">
              {buildings.flatMap(([b, n]) => Array.from({ length: n }).map((_, i) => {
                const d = BUILDINGS[b];
                const filled = rep.filled[b] ?? 0;
                const per = d.jobs;
                const workers = Math.max(0, Math.min(per, filled - i * per));
                return (
                  <Tip key={b + i} content={<div><h4>{d.label}</h4><div className="hint">{d.description}</div>{Object.keys(d.output).length > 0 && <div style={{ marginTop: 4 }}>Produces {yieldText(d.output)}</div>}{Object.keys(d.input).length > 0 && <div>Consumes {yieldText(d.input as Yield)}</div>}{Object.keys(d.upkeep).length > 0 && <div>Upkeep <CostView cost={d.upkeep} showShort={false} /></div>}</div>}>
                    <div className="tile" style={{ width: '100%' }}>
                      <span className="nm">{d.label}</span>
                      {per > 0 && <span className="jb">{workers}/{per} workers</span>}
                      {d.housing > 0 && per === 0 && <span className="jb">{d.housing} housing</span>}
                      {b !== 'capital' && <button className="x" title="Demolish" onClick={() => ui.cmd({ type: 'demolish', planetId: p.id, building: b })}>×</button>}
                    </div>
                  </Tip>
                );
              }))}
              {c.queue.map((q, i) => (
                <div key={'q' + i} className="tile building">
                  <span className="nm">{q.demolish ? `Demolish ${BUILDINGS[q.id as BuildingId].label}` : BUILDINGS[q.id as BuildingId].label}</span>
                  <span className="jb">{i === 0 ? (q.paid ? `${Math.max(0, Math.ceil(q.total - q.progress))} days left` : 'Awaiting resources') : 'Queued'}</span>
                  <Meter value={q.progress} max={q.total} />
                  <button className="x" style={{ opacity: 1 }} title="Cancel (75% refund if started)" onClick={() => ui.cmd({ type: 'cancelQueue', planetId: p.id, index: i })}>×</button>
                </div>
              ))}
            </div>
          </Section>
          <div className="row" style={{ marginTop: 14, gap: 0 }}>
            <button className={cls('btn small', tab === 'build' && 'on')} onClick={() => setTab('build')}>Construct building</button>
            <button className={cls('btn small', tab === 'ships' && 'on')} onClick={() => setTab('ships')} disabled={!(c.buildings.shipyard ?? 0)}>Shipyard{!(c.buildings.shipyard ?? 0) ? ' (none)' : ''}</button>
          </div>
          {tab === 'build' ? <BuildMenu p={p} /> : <ShipyardPanel p={p} />}
        </div>
        <div>
          <DesignationPanel p={p} />
          <Section title="Monthly output of this world">
            <div className="kv">
              {prodKeys.map((k) => [
                <span key={k} className="row" style={{ gap: 6 }}><ResGlyph r={k} />{RES_META[k].label}</span>,
                <span key={k + 'v'} className={(rep.production[k] ?? 0) >= 0 ? 'pos' : 'neg'}>{signed(rep.production[k] ?? 0)}</span>,
              ])}
            </div>
          </Section>
          <Section title={<Term entry="mech.stability">Stability factors</Term>}>
            <div className="kv">
              {rep.stabilityFactors.map(([k, v]) => [<span key={k}>{k}</span>, <span key={k + 'v'} className={v >= 0 ? 'pos' : 'neg'}>{signed(v, 0)}</span>])}
            </div>
          </Section>
          <Section title="Deposits">
            <div className="kv">
              <span>Minerals</span><span>{p.deposits.minerals}</span>
              <span>Energy</span><span>{p.deposits.energy}</span>
              <span>Rare elements</span><span>{p.deposits.rare || '—'}</span>
              <span>Research anomaly</span><span>{p.deposits.research || '—'}</span>
            </div>
            <p className="hint">Mining districts gain 4% per mineral deposit; rare extractors require a vein.</p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function BuildMenu({ p }: { p: Planet }) {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const opts = BUILDABLE.filter((b) => BUILDINGS[b].category !== 'district');
  return (
    <div style={{ border: '1px solid var(--rule)', borderTop: 0 }}>
      {opts.map((b) => {
        const d = BUILDINGS[b];
        const v = canBuild(g, me, p, b);
        const cost = buildingCost(g, me, b);
        return (
          <div key={b} className={cls('build-opt', !v.ok && 'dis')} onClick={() => v.ok && ui.cmd({ type: 'queueBuilding', planetId: p.id, building: b })}>
            <span>{d.label} <span className="faint">· {buildingDays(g, me, b)} days{d.jobs ? ` · ${d.jobs} jobs` : ''}</span></span>
            <CostView cost={cost} empire={me} />
            <span className="hint" style={{ gridColumn: '1 / -1' }}>
              {v.ok ? (Object.keys(d.output).length ? `Produces ${yieldText(d.output)}${Object.keys(d.input).length ? `; consumes ${yieldText(d.input as Yield)}` : ''}. ` : '') + d.description : v.reason}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A province's role: what the world specialises in, and who governs it. */
function DesignationPanel({ p }: { p: Planet }) {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const c = p.colony!;
  if (p.id === me.capitalPlanetId) return null;
  const cur = c.designation ?? 'balanced';
  const wait = Math.max(0, (c.designationTick ?? -99999) + DESIGNATION_COOLDOWN - g.tick);
  const gov = governorBonus(g, me.id, g.galaxy.systems[p.systemId].sector);
  return (
    <Section guide="planet-province" title={<Term entry="mech.designation">Province role</Term>} aside={gov.name ? `Governor ${gov.name} strengthens it` : 'No governor in this province'}>
      <div className="list" data-testid="designations">
        {DESIGNATION_IDS.map((id) => {
          const d = DESIGNATIONS[id];
          const active = id === cur;
          const blocked = !active && (wait > 0 || me.stock.influence < DESIGNATION_COST);
          return (
            <button key={id} className={cls('li', active && 'sel')} disabled={blocked} aria-pressed={active}
              onClick={() => !active && ui.cmd({ type: 'setDesignation', planetId: p.id, designation: id })}>
              <span className="grow" style={{ textAlign: 'left' }}><b>{d.label}</b><div className="hint">{d.description}</div></span>
            </button>
          );
        })}
      </div>
      <div className="hint" style={{ marginTop: 6 }}>{wait > 0 ? `Role can change again in ${wait} days.` : `Changing role costs ${DESIGNATION_COST} influence; then it is fixed for a year.`}</div>
    </Section>
  );
}

export function ShipyardPanel({ p }: { p: Planet }) {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const c = p.colony!;
  const L = getLedger(g, me);
  return (
    <div style={{ border: '1px solid var(--rule)', borderTop: 0, padding: '8px 0' }}>
      <div className="row between" style={{ padding: '0 8px 6px' }}>
        <span className="hint">{shipyardSlots(g, p)} slip{shipyardSlots(g, p) > 1 ? 's' : ''} building in parallel. Naval capacity {L.navalUsed}/{L.navalCap}{L.navalUsed > L.navalCap ? ' — over capacity raises fleet upkeep' : ''}.</span>
      </div>
      {c.shipQueue.length > 0 && (
        <div style={{ padding: '0 8px 8px' }}>
          {c.shipQueue.map((q, i) => (
            <div key={i} className="row" style={{ marginBottom: 4 }}>
              <span style={{ width: 130 }}>{SHIPS[q.id as ShipClass].label}</span>
              <div className="grow"><Meter value={q.progress} max={q.total} /></div>
              <span className="num faint" style={{ width: 90, textAlign: 'right' }}>{q.paid ? `${Math.ceil(q.total - q.progress)} days` : i < shipyardSlots(g, p) ? 'Awaiting resources' : 'Queued'}</span>
              <button className="btn small" onClick={() => ui.cmd({ type: 'cancelQueue', planetId: p.id, index: i, ships: true })}>Cancel</button>
            </div>
          ))}
        </div>
      )}
      {SHIP_ORDER.map((cls2) => {
        const d = SHIPS[cls2];
        const v = canBuildShip(g, me, p, cls2);
        return (
          <div key={cls2} className={cls('build-opt', !v.ok && 'dis')} onClick={() => v.ok && ui.cmd({ type: 'queueShip', planetId: p.id, cls: cls2 })}>
            <span>{d.label} <span className="faint">· {d.role} · {shipDays(g, me, cls2)} days · {d.command} naval cap</span></span>
            <CostView cost={shipCost(g, me, cls2)} empire={me} />
            <span className="hint" style={{ gridColumn: '1 / -1' }}>{v.ok ? d.description : v.reason}</span>
          </div>
        );
      })}
    </div>
  );
}
