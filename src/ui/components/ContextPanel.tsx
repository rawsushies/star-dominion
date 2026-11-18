import { useEffect, useRef } from 'react';
import { useUI, useGame } from '../store';
import { STAR_TYPES, PLANET_TYPES } from '../../sim/data/planets';
import { SHIPS, STARBASE, SHIP_ORDER } from '../../sim/data/ships';
import { MEGA_BY_ID } from '../../sim/data/megastructures';
import { TRAIT_BY_ID } from '../../sim/data/characters';
import { planetHab } from '../../sim/economy';
import { empireMods } from '../../sim/modifiers';
import { claimCost, visibleSystems, isHostile } from '../../sim/territory';
import { fleetPower, admiralOf, shipStats, fleetSpeed, orbitSecured } from '../../sim/fleets';
import { starbaseUpgradeCost } from '../../sim/construction';
import { STATION_COST } from '../../sim/commands';
import { intelLevel, fuzz } from '../../sim/diplomacy';
import { getLedger } from '../../sim/engine';
import { planetSprite } from '../render/planet3d';
import { PlanetHero } from './PlanetHero';
import { CostView, Meter, Section, Swatch, cls, fmt, Tip } from './common';
import type { Fleet, GameState, Planet, StarSystem, SystemFeature } from '../../sim/types';

export const FEATURE_INFO: Record<SystemFeature, [string, string]> = {
  ancient_ruins: ['Precursor ruins', 'The first fleet to survey them gains research.'],
  jump_nexus: ['Jump nexus', 'Hyperlane crossroads. Owners collect transit tolls.'],
  rare_cluster: ['Rare element cluster', 'Owners extract rare elements from the system.'],
  nebula: ['Nebula', 'Sensor haze: weapon tracking -10% in battle.'],
  derelict: ['Derelict hulk', 'Salvageable alloys for the first explorer.'],
  pulsar: ['Pulsar', 'Radiation storms: shields are useless in battle here.'],
  guardian: ['Sentinel lair', 'Ancient automated warships guard this system.'],
};

export function PlanetThumb({ planet, size = 40 }: { planet: Planet; size?: number }) {
  return size >= 64 ? <PlanetHero planet={planet} size={size} /> : <SpriteThumb planet={planet} size={size} />;
}

function SpriteThumb({ planet, size }: { planet: Planet; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const lights = planet.colony ? Math.min(1, planet.colony.pops / 30) : 0;
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const spr = planetSprite(planet.type, planet.id * 7919 + 13, size * dpr, { lights });
    cv.width = spr.width; cv.height = spr.height;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(spr, 0, 0);
  }, [planet.type, planet.id, size, lights]);
  return <canvas ref={ref} style={{ width: size * 1.24, height: size * 1.24, flex: 'none' }} aria-hidden />;
}

export function ContextPanel() {
  const g = useGame();
  const { systemId, planetId, fleetId, set } = useUI();
  let body: JSX.Element | null = null;
  if (fleetId != null && g.fleets[fleetId]) body = <FleetCtx f={g.fleets[fleetId]} />;
  else if (planetId != null) body = <PlanetCtx p={g.planets[planetId]} />;
  else if (systemId != null) body = <SystemCtx s={g.galaxy.systems[systemId]} />;
  if (!body) return null;
  return (
    <aside className="ctx glass">
      <div className="whead"><span className="wtitle">Selected item</span><span className="grow" /><button className="wbtn" onClick={() => set({ systemId: null, planetId: null, fleetId: null })} aria-label="Clear selection">×</button></div>
      <div className="ctx-body">{body}</div>
    </aside>
  );
}

function ownerLine(g: GameState, owner: number | null) {
  if (owner == null) return <span className="faint">Unclaimed</span>;
  const e = g.empires[owner];
  return <span className="row" style={{ gap: 6 }}><Swatch color={e.color} />{e.name}</span>;
}

function SystemCtx({ s }: { s: StarSystem }) {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const explored = me.explored.includes(s.id);
  const visible = visibleSystems(g, g.playerId).has(s.id);
  if (!explored) {
    return (
      <>
        <h2>Uncharted system</h2>
        <div className="subtitle">No survey data</div>
        <p className="hint" style={{ marginTop: 12 }}>Send a scout or any fleet here to chart its worlds, resources and hazards.</p>
        <OwnFleetQuickMove target={s.id} />
      </>
    );
  }
  const bodies = s.planetIds.map((id) => g.planets[id]);
  const mods = empireMods(g, me);
  const fleets = visible ? Object.values(g.fleets).filter((f) => f.systemId === s.id && f.progress === 0 && f.ships.length) : [];
  const ctors = Object.values(g.fleets).filter((f) => f.ownerId === g.playerId && f.ships.some((x) => x.cls === 'constructor') && f.order.type === 'idle');
  const upCost = starbaseUpgradeCost(s.starbase);
  return (
    <>
      <h2>{s.name}</h2>
      <div className="subtitle">{STAR_TYPES[s.star].label} · {bodies.length} bodies{s.asteroidBelts ? ` · ${s.asteroidBelts} asteroid belt${s.asteroidBelts > 1 ? 's' : ''}` : ''}</div>
      <div className="kv" style={{ marginTop: 12 }}>
        <span>Sovereignty</span><span>{ownerLine(g, s.owner)}</span>
        <span>Starbase</span><span>{s.starbase ? STARBASE[s.starbase]!.label : 'None'}{s.starbaseDamage > 0.01 ? ` (${Math.round(s.starbaseDamage * 100)}% damaged)` : ''}</span>
        {s.owner == null && <><span>Outpost claim cost</span><span>{claimCost(g, me, s.id)} influence</span></>}
      </div>
      {s.outpostProject && <div style={{ marginTop: 8 }}><div className="hint">Outpost under construction by {g.empires[s.outpostProject.empireId].name}</div><Meter value={s.outpostProject.progress} max={s.outpostProject.total} /></div>}
      {s.features.length > 0 && (
        <Section title="Features">
          {s.features.map((f) => <div key={f} style={{ marginBottom: 4 }}><span className={cls('tag', f === 'guardian' ? 'bad' : 'gold')}>{FEATURE_INFO[f][0]}</span> <span className="hint">{FEATURE_INFO[f][1]}</span></div>)}
        </Section>
      )}
      <Section title="Celestial bodies">
        <div className="list">
          {bodies.map((p) => {
            const hab = planetHab(g, p, me, mods);
            return (
              <div key={p.id} className="li" onClick={() => ui.selectPlanet(p.id)}>
                <PlanetThumb planet={p} size={26} />
                <div className="grow">
                  <div>{p.name}{p.moonOf != null && <span className="faint"> (moon)</span>}</div>
                  <div className="hint">{PLANET_TYPES[p.type].label} · size {p.size}{hab > 0 && !p.colony ? ` · ${Math.round(hab * 100)}% habitable` : ''}{p.station ? ` · ${p.station} station` : ''}</div>
                </div>
                {p.colony && <span className="tag" style={{ borderColor: g.empires[p.colony.ownerId].color, color: g.empires[p.colony.ownerId].color }}>{p.colony.ownerId === g.playerId ? `${fmt(p.colony.pops, 1)} pops` : 'Colony'}</span>}
                {p.colonizing && <span className="tag good">Settling</span>}
              </div>
            );
          })}
        </div>
      </Section>
      {fleets.length > 0 && (
        <Section title="Fleets present">
          <div className="list">
            {fleets.map((f) => (
              <div key={f.id} className="li" onClick={() => ui.selectFleet(f.id)}>
                <Swatch color={g.empires[f.ownerId].color} />
                <span className="grow">{f.ownerId === g.playerId || intelLevel(g, g.playerId, f.ownerId) > 30 ? f.name : `${g.empires[f.ownerId].adjective} fleet`}</span>
                <span className="num">{f.ships.length} ships · {fleetPower(g, f)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      <Section title="Actions">
        <div className="row wrap">
          <button className="btn" onClick={() => ui.set({ view: 'system' })}>Enter system</button>
          {s.owner == null && !s.outpostProject && ctors.length > 0 && (
            <button className="btn primary" onClick={() => ui.cmd({ type: 'fleetOrder', fleetId: ctors[0].id, order: { type: 'outpost', systemId: s.id } })}>Send construction ship</button>
          )}
          {s.owner === g.playerId && upCost && !s.starbaseUpgrade && (
            <Tip content={<div><h4>Upgrade to {STARBASE[s.starbase + 1]!.label}</h4><CostView cost={upCost} empire={me} /><div className="hint">Stronger defences; Starports and above protect trade routes from raiding.</div></div>}>
              <button className="btn" onClick={() => ui.cmd({ type: 'upgradeStarbase', systemId: s.id })}>Upgrade starbase</button>
            </Tip>
          )}
          {s.owner === g.playerId && <button className="btn" onClick={() => ui.set({ screen: 'construction' })}>Megastructures</button>}
        </div>
        {s.starbaseUpgrade && <div style={{ marginTop: 8 }}><div className="hint">Starbase upgrade in progress</div><Meter value={s.starbaseUpgrade.progress} max={s.starbaseUpgrade.total} /></div>}
        {s.megastructures.map((m) => (
          <div key={m.id} style={{ marginTop: 8 }}>
            <div className="row between"><span>{MEGA_BY_ID[m.id].label}</span><span className="num">Stage {m.stage}/{MEGA_BY_ID[m.id].stages}</span></div>
            {m.building && <Meter value={m.progress} max={MEGA_BY_ID[m.id].stageDays} />}
          </div>
        ))}
        <OwnFleetQuickMove target={s.id} />
      </Section>
    </>
  );
}

function OwnFleetQuickMove({ target }: { target: number }) {
  const g = useGame();
  const ui = useUI();
  const sel = ui.fleetId != null ? g.fleets[ui.fleetId] : null;
  if (!sel || sel.ownerId !== g.playerId) return null;
  return <div style={{ marginTop: 10 }}><button className="btn" onClick={() => ui.cmd({ type: 'moveFleet', fleetId: sel.id, target })}>Send {sel.name} here</button></div>;
}

function PlanetCtx({ p }: { p: Planet }) {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const mods = empireMods(g, me);
  const hab = planetHab(g, p, me, mods);
  const sys = g.galaxy.systems[p.systemId];
  const def = PLANET_TYPES[p.type];
  const c = p.colony;
  const mine = c?.ownerId === g.playerId;
  const colonyShips = Object.values(g.fleets).filter((f) => f.ownerId === g.playerId && f.ships.some((s) => s.cls === 'colony') && f.order.type === 'idle');
  const transports = Object.values(g.fleets).filter((f) => f.ownerId === g.playerId && f.troops > 0);
  const hostile = c && isHostile(g, g.playerId, c.ownerId);
  const rep = mine ? getLedger(g, me).planets[p.id] : null;
  const intel = c && !mine ? intelLevel(g, g.playerId, c.ownerId) : 100;
  return (
    <>
      <div className="row" style={{ gap: 14, alignItems: 'center' }}>
        <PlanetThumb planet={p} size={64} />
        <div>
          <h2>{p.name}</h2>
          <div className="subtitle">{def.label} world · size {p.size}</div>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>{def.description}</p>
      <div className="kv" style={{ marginTop: 8 }}>
        <span>System</span><span><button className="linkish" onClick={() => ui.selectSystem(p.systemId)}>{sys.name}</button></span>
        <span>Habitability for your people</span><span className={hab >= 0.6 ? 'pos' : hab > 0 ? 'warn' : 'neg'}>{Math.round(hab * 100)}%</span>
        <span>Mineral / energy deposits</span><span>{p.deposits.minerals} / {p.deposits.energy}</span>
        {p.deposits.rare > 0 && <><span>Rare element vein</span><span>{p.deposits.rare}</span></>}
        {p.deposits.research > 0 && <><span>Research anomaly</span><span>{p.deposits.research}</span></>}
        {c && <><span>Colony of</span><span>{ownerLine(g, c.ownerId)}</span></>}
        {c && <><span>Population</span><span>{mine || intel > 40 ? fmt(c.pops, 1) : `~${fuzz(Math.round(c.pops), intel, p.id).value}`}</span></>}
        {c && (mine || intel > 50) && <><span>Stability</span><span>{Math.round(c.stability)}</span></>}
        {c && <><span>Defence batteries</span><span>{c.buildings.orbital_defense ?? 0}{c.defenseDamage > 0.01 ? ` (${Math.round(c.defenseDamage * 100)}% down)` : ''}</span></>}
        {c && (c.buildings.planetary_shield ?? 0) > 0 && <><span>Planetary shield</span><span>Active</span></>}
        {rep && <><span>Garrison</span><span>{fmt(rep.garrison, 1)} divisions</span></>}
      </div>
      {p.colonizing && <div style={{ marginTop: 10 }}><div className="hint">Colony being established by {g.empires[p.colonizing.empireId].name}</div><Meter value={p.colonizing.progress} max={p.colonizing.total} tone="v" /></div>}
      <Section title="Actions">
        <div className="row wrap">
          {mine && <button className="btn primary" onClick={() => ui.set({ screen: 'planets', planetId: p.id })}>Manage colony</button>}
          {!c && !p.colonizing && hab > 0 && (sys.owner == null || sys.owner === g.playerId) && (
            colonyShips.length
              ? <button className="btn primary" onClick={() => ui.cmd({ type: 'fleetOrder', fleetId: colonyShips[0].id, order: { type: 'colonize', planetId: p.id } })}>Send colony ship</button>
              : <span className="hint">Build a colony ship at a shipyard to settle this world.</span>
          )}
          {!c && sys.owner === g.playerId && !p.station && (
            <>
              <Tip content={<div><h4>Mining station</h4><CostView cost={STATION_COST} empire={me} /><div className="hint">Extracts {p.deposits.minerals + 1} minerals{p.deposits.rare ? ` and ${(p.deposits.rare * 0.6).toFixed(1)} rare elements` : ''} per month.</div></div>}>
                <button className="btn" onClick={() => ui.cmd({ type: 'buildStation', planetId: p.id, kind: 'mining' })}>Mining station</button>
              </Tip>
              <Tip content={<div><h4>Energy collector</h4><CostView cost={STATION_COST} empire={me} /><div className="hint">Harvests about {p.deposits.energy + 1} energy per month.</div></div>}>
                <button className="btn" onClick={() => ui.cmd({ type: 'buildStation', planetId: p.id, kind: 'energy' })}>Energy collector</button>
              </Tip>
              {p.deposits.research > 0 && <button className="btn" onClick={() => ui.cmd({ type: 'buildStation', planetId: p.id, kind: 'research' })}>Research outpost</button>}
            </>
          )}
          {hostile && transports.length > 0 && (
            <Tip content={orbitSecured(g, g.playerId, p.id) ? 'Orbit secured: troops can land.' : 'Troops will wait in orbit until enemy fleets, the starbase and defence batteries are neutralised.'}>
              <button className="btn danger" onClick={() => ui.cmd({ type: 'fleetOrder', fleetId: transports[0].id, order: { type: 'invade', planetId: p.id } })}>Invade with {transports[0].name}</button>
            </Tip>
          )}
          {c && !mine && !hostile && <span className="hint">Declare war to invade this world.</span>}
        </div>
      </Section>
    </>
  );
}

export function orderText(g: GameState, f: Fleet): string {
  const o = f.order;
  const n = (id: number) => g.galaxy.systems[id].name;
  switch (o.type) {
    case 'idle': return f.path.length ? `Moving to ${n(f.path[f.path.length - 1])}` : `Holding at ${n(f.systemId)}`;
    case 'move': return `Moving to ${n(o.target)}`;
    case 'patrol': return `Patrolling ${n(o.a)} ⇄ ${n(o.b)}`;
    case 'outpost': return `Raising outpost at ${n(o.systemId)}`;
    case 'colonize': return `Colonising ${g.planets[o.planetId].name}`;
    case 'invade': return `Invading ${g.planets[o.planetId].name}`;
    case 'blockade': return `Blockading ${n(o.systemId)}`;
  }
}

function FleetCtx({ f }: { f: Fleet }) {
  const g = useGame();
  const ui = useUI();
  const own = f.ownerId === g.playerId;
  const e = g.empires[f.ownerId];
  const intel = own ? 100 : intelLevel(g, g.playerId, f.ownerId);
  const counts: Record<string, number> = Object.create(null);
  for (const s of f.ships) counts[s.cls] = (counts[s.cls] ?? 0) + 1;
  const adm = admiralOf(g, f);
  let hull = 0, max = 0;
  for (const s of f.ships) { const st = shipStats(g, e, s.cls); hull += s.hull + s.armor; max += st.hull + st.armor; }
  const others = own ? Object.values(g.fleets).filter((x) => x.ownerId === g.playerId && x.id !== f.id && x.systemId === f.systemId && x.progress === 0 && f.progress === 0) : [];
  const hasCtor = f.ships.some((s) => s.cls === 'constructor');
  const hasColony = f.ships.some((s) => s.cls === 'colony');
  return (
    <>
      <h2>{own || intel > 30 ? f.name : `${e.adjective} fleet`}</h2>
      <div className="subtitle row" style={{ gap: 6 }}><Swatch color={e.color} />{e.name}</div>
      <div className="kv" style={{ marginTop: 12 }}>
        <span>Status</span><span>{own || intel > 50 ? orderText(g, f) : 'Unknown intentions'}</span>
        <span>Strength</span><span>{own ? fleetPower(g, f) : fuzz(fleetPower(g, f), intel, f.id).value}</span>
        <span>Ships</span><span>{f.ships.length}</span>
        {(own || intel > 50) && <><span>Hull integrity</span><span>{Math.round((hull / Math.max(1, max)) * 100)}%</span></>}
        {own && <><span>Supply</span><span className={f.supply < 25 ? 'neg' : ''}>{Math.round(f.supply)}%</span></>}
        {own && <><span>Speed</span><span>{fleetSpeed(g, f).toFixed(1)} ly/day</span></>}
        {f.troops > 0 && <><span>Embarked troops</span><span>{f.troops} divisions</span></>}
        {own && <><span>Admiral</span><span>{adm ? `${adm.name} (level ${adm.level}${adm.traits.length ? ', ' + adm.traits.map((t) => TRAIT_BY_ID[t]?.label ?? t).join(', ') : ''})` : 'None'}</span></>}
      </div>
      {(own || intel > 40) && (
        <Section title="Composition">
          <div className="kv">
            {SHIP_ORDER.filter((c) => counts[c]).map((c) => [<span key={c}>{SHIPS[c].label}</span>, <span key={c + 'n'}>{own || intel > 70 ? counts[c] : `~${fuzz(counts[c], intel, f.id + c.length).value}`}</span>])}
          </div>
        </Section>
      )}
      {own && (
        <>
          <Section title="Orders">
            <div className="row wrap">
              <button className="btn" onClick={() => ui.set({ pendingOrder: { kind: 'move', fleetId: f.id }, view: 'galaxy' })}>Move</button>
              {!hasCtor && !hasColony && <button className="btn" onClick={() => ui.set({ pendingOrder: { kind: 'patrol', fleetId: f.id }, view: 'galaxy' })}>Patrol</button>}
              {!hasCtor && !hasColony && <button className="btn" onClick={() => ui.set({ pendingOrder: { kind: 'blockade', fleetId: f.id }, view: 'galaxy' })}>Blockade</button>}
              {hasCtor && <button className="btn primary" onClick={() => ui.set({ pendingOrder: { kind: 'outpost', fleetId: f.id }, view: 'galaxy' })}>Build outpost</button>}
              <button className="btn" onClick={() => ui.cmd({ type: 'fleetOrder', fleetId: f.id, order: { type: 'idle' } })}>Stop</button>
            </div>
            {hasColony && <p className="hint" style={{ marginTop: 6 }}>Select a habitable planet and choose “Send colony ship”.</p>}
            {f.troops > 0 && <p className="hint" style={{ marginTop: 6 }}>Select a hostile colony and choose “Invade”.</p>}
          </Section>
          <Section title="Stance">
            <div className="seg">
              {(['aggressive', 'defensive', 'passive'] as const).map((s) => (
                <button key={s} className={cls(f.stance === s && 'on')} onClick={() => ui.cmd({ type: 'setStance', fleetId: f.id, stance: s })}>{s[0].toUpperCase() + s.slice(1)}</button>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 6 }}>{f.stance === 'aggressive' ? 'Fights to the end and stops to engage hostiles it meets.' : f.stance === 'defensive' ? 'Engages, but withdraws when badly outmatched.' : 'Avoids battle and retreats immediately when attacked.'}</p>
          </Section>
          {others.length > 0 && (
            <Section title="Merge with">
              <div className="row wrap">{others.map((o) => <button key={o.id} className="btn small" onClick={() => ui.cmd({ type: 'mergeFleets', fleetId: f.id, otherId: o.id })}>{o.name}</button>)}</div>
            </Section>
          )}
          <div style={{ marginTop: 14 }}><button className="btn" onClick={() => ui.set({ screen: 'fleets' })}>Open in fleet management</button></div>
        </>
      )}
    </>
  );
}
