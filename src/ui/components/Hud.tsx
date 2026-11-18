// The Sovereign HUD: a slim neocom column, a floating location/agenda readout,
// a resource strip, the throne dial (time, speed and lenses), the dispatches
// log, the overview and a floating window manager for management screens.

import { useRef, useState, type ReactNode } from 'react';
import { useUI, useGame, SPEEDS, type ScreenId, type MapMode, type Win } from '../store';
import { getLedger } from '../../sim/engine';
import { formatDate } from '../../sim/util';
import { GOVERNMENTS } from '../../sim/data/governments';
import { TECH_BY_ID, techCost } from '../../sim/data/techs';
import { BUILDINGS } from '../../sim/data/buildings';
import { SHIPS } from '../../sim/data/ships';
import { RESOURCES, type BuildingId, type ShipClass } from '../../sim/types';
import type { LedgerKey } from '../../sim/economy';
import { jumpDistances } from '../../sim/galaxy';
import { visibleSystems } from '../../sim/territory';
import { fleetPower } from '../../sim/fleets';
import { hasContact, opinion } from '../../sim/diplomacy';
import { ResGlyph, RES_META, Tip, fmt, signed, cls, Emblem, Swatch } from './common';
import { ScreenIcon, PlayIcon } from './icons';
import { NAV, jumpTo } from './Chrome';
import { focusSystem } from './MapView';
import { SCREENS } from '../screens';

// ---------------------------------------------------------------- neocom

const GROUPS: ScreenId[][] = [
  ['map'],
  ['kingdom', 'planets', 'system'],
  ['fleets', 'military'],
  ['economy', 'industry', 'construction', 'trade'],
  ['research', 'techtree'],
  ['diplomacy', 'intel', 'journal'],
];

export function Neocom() {
  const g = useGame();
  const screen = useUI((s) => s.screen);
  const windows = useUI((s) => s.windows);
  const open = useUI((s) => s.openScreen);
  const set = useUI((s) => s.set);
  const e = g.empires[g.playerId];
  const inbox = g.proposals.filter((p) => p.to === g.playerId).length;
  const idleResearch = !e.research.current && !e.research.queue.length;
  const label = (id: ScreenId) => NAV.find((n) => n.id === id)?.label ?? id;
  return (
    <nav className="neocom" aria-label="Screens">
      <button className="neo-crest" onClick={() => open('kingdom')} aria-label="Kingdom overview" title={e.name}>
        <Emblem empire={e} size={28} />
      </button>
      {GROUPS.map((grp, gi) => (
        <div key={gi} className="neo-group">
          {grp.map((id) => {
            const isOpen = windows.some((w) => w.id === id);
            const badge = id === 'diplomacy' && inbox ? String(inbox) : id === 'research' && idleResearch ? '!' : null;
            return (
              <button key={id} className={cls('neo-btn', isOpen && 'open', screen === id && 'on')} onClick={() => (id === 'map' ? set({ view: 'galaxy' }) : open(id))} aria-label={label(id)}>
                <ScreenIcon id={id} size={20} />
                <span className="neo-flyout">{label(id)}</span>
                {badge && <span className="neo-badge">{badge}</span>}
              </button>
            );
          })}
        </div>
      ))}
      <div className="grow" />
      <button className="neo-btn" onClick={() => set({ menuOpen: true, speed: 0 })} aria-label="Chancery: save, load and options">
        <svg width="20" height="20" viewBox="0 0 20 20"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" /></svg>
        <span className="neo-flyout">Chancery</span>
      </button>
      <div className="neo-clock num">{formatDate(g.tick).slice(0, 4)}</div>
    </nav>
  );
}

// ---------------------------------------------------------------- location & agenda

function Fold({ title, aside, children, initial = true }: { title: ReactNode; aside?: ReactNode; children: ReactNode; initial?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="fold">
      <button className="fold-h" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={cls('caret', open && 'open')} />
        <span className="fold-t">{title}</span>
        {aside && <span className="fold-a">{aside}</span>}
      </button>
      {open && <div className="fold-b">{children}</div>}
    </div>
  );
}

export function LocationHud() {
  const g = useGame();
  const ui = useUI();
  const e = g.empires[g.playerId];
  const sys = ui.systemId != null ? g.galaxy.systems[ui.systemId] : null;
  const explored = sys ? e.explored.includes(sys.id) : false;
  const owner = sys?.owner != null ? g.empires[sys.owner] : null;
  const cap = e.capitalSystemId != null ? e.capitalSystemId : null;
  const jumps = sys && cap != null ? jumpDistances(g.galaxy, [cap])[sys.id] : null;
  const cur = e.research.current ? TECH_BY_ID[e.research.current] : null;
  const builds = g.planets.filter((p) => p.colony?.ownerId === g.playerId).flatMap((p) => [...p.colony!.queue, ...p.colony!.shipQueue].slice(0, 1).map((q) => ({ p, q })));
  const wars = g.wars.filter((w) => w.attackers.includes(g.playerId) || w.defenders.includes(g.playerId));
  return (
    <div className="loc-hud">
      <div className="loc-realm" onClick={() => ui.openScreen('kingdom')}>
        <span className="loc-name">{e.name}</span>
        <span className="loc-gov">{GOVERNMENTS[e.government].label} · {e.ruler}</span>
      </div>
      {sys && (
        <div className="loc-sys">
          <span className="loc-star" style={{ background: owner?.color ?? '#5d6873' }} />
          <span className="loc-sysname" onClick={() => { focusSystem(sys.id); }}>{explored ? sys.name : 'Uncharted system'}</span>
          {owner && <span className="loc-sec" style={{ color: owner.color }}>{owner.id === g.playerId ? 'Crown space' : owner.name}</span>}
          {!owner && explored && <span className="loc-sec dim">Unclaimed</span>}
          {jumps != null && jumps > 0 && Number.isFinite(jumps) && <span className="loc-route">{jumps} {jumps === 1 ? 'jump' : 'jumps'} from the throne</span>}
        </div>
      )}
      <Fold title="Research" aside={cur ? `${Math.round((e.research.progress / techCost(cur.id)) * 100)}%` : <span className="bad">Idle</span>}>
        {cur ? (
          <button className="agenda" onClick={() => ui.openScreen('research')}>
            <span>{cur.name}</span>
            <span className="agenda-bar"><i style={{ width: `${Math.min(100, (e.research.progress / techCost(cur.id)) * 100)}%` }} /></span>
          </button>
        ) : <button className="agenda warnline" onClick={() => ui.openScreen('research')}>Choose a technology to study</button>}
      </Fold>
      <Fold title="Construction" aside={builds.length || null}>
        {builds.length === 0 && <button className="agenda dim" onClick={() => ui.openScreen('planets')}>No works underway</button>}
        {builds.slice(0, 4).map(({ p, q }, i) => (
          <button key={i} className="agenda" onClick={() => { ui.selectPlanet(p.id); ui.openScreen('planets'); }}>
            <span>{q.kind === 'building' ? BUILDINGS[q.id as BuildingId].label : SHIPS[q.id as ShipClass].label} <em>· {p.name}</em></span>
            <span className="agenda-bar"><i style={{ width: `${Math.min(100, (q.progress / q.total) * 100)}%` }} /></span>
          </button>
        ))}
      </Fold>
      {wars.length > 0 && (
        <Fold title="War" aside={<span className="bad">{wars.length}</span>}>
          {wars.map((w) => {
            const mine = w.attackers.includes(g.playerId) ? w.score : -w.score;
            return (
              <button key={w.id} className="agenda" onClick={() => ui.openScreen('military')}>
                <span>{w.name}</span>
                <span className={cls('num', mine >= 0 ? 'good' : 'bad')}>{signed(mine, 0)}</span>
              </button>
            );
          })}
        </Fold>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- resources

export function ResourceStrip() {
  const g = useGame();
  const e = g.empires[g.playerId];
  const L = getLedger(g, e);
  const keys: LedgerKey[] = [...RESOURCES, 'research'];
  return (
    <div className="res-strip">
      {keys.map((k) => {
        const stock = k === 'research' ? null : e.stock[k];
        const net = L.net[k];
        const capV = k === 'research' ? 0 : L.cap[k];
        const short = k !== 'research' && L.shortages.includes(k as any);
        const lines = L.lines.filter((l) => l.key === k).sort((a, b) => b.amount - a.amount);
        return (
          <Tip key={k} content={
            <div>
              <h4>{RES_META[k].label}</h4>
              {k === 'research' ? <div className="muted">Research points per month toward the current project.</div> : <div className="muted">Stored {fmt(stock!)} of {fmt(capV)} capacity.</div>}
              <div className="kv">
                {lines.slice(0, 14).map((l) => [<span key={l.label + 'a'}>{l.label}</span>, <span key={l.label + 'b'} className={l.amount >= 0 ? 'pos' : 'neg'}>{signed(l.amount)}</span>])}
                <span style={{ color: 'var(--text)' }}>Net per month</span><span className={net >= 0 ? 'pos' : 'neg'}>{signed(net)}</span>
              </div>
              {short && <div className="neg" style={{ marginTop: 6 }}>Shortage: dependent production is crippled.</div>}
            </div>
          }>
            <div className={cls('chip', short && 'short')}>
              <ResGlyph r={k} size={13} />
              <span className="chip-v num">{k === 'research' ? fmt(net) : fmt(stock!)}</span>
              {k !== 'research' && <span className={cls('chip-d num', net >= 0 ? 'pos' : 'neg')}>{signed(net, Math.abs(net) < 10 ? 1 : 0)}</span>}
              {k !== 'research' && k !== 'credits' && k !== 'influence' && <span className="chip-bar"><i className={stock! >= capV * 0.95 ? 'full' : ''} style={{ width: `${Math.min(100, (stock! / capV) * 100)}%` }} /></span>}
            </div>
          </Tip>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- throne dial

const LENSES: { id: MapMode; label: string; icon: ReactNode }[] = [
  { id: 'political', label: 'Political lens: borders and sovereignty', icon: <path d="M4 6 L10 3 L16 6 L16 14 L10 17 L4 14 Z M10 3 V17 M4 6 L16 14" /> },
  { id: 'resources', label: 'Resource lens: deposits and open worlds', icon: <path d="M10 3 L15 7 L13 16 H7 L5 7 Z M5 7 H15 M10 3 L8 16 M10 3 L12 16" /> },
  { id: 'military', label: 'Military lens: fleet strength', icon: <path d="M10 2 L16 5 V10 C16 14 13 16.5 10 18 C7 16.5 4 14 4 10 V5 Z" /> },
  { id: 'trade', label: 'Trade lens: routes to the capital', icon: <path d="M3 14 C7 14 7 6 11 6 C14 6 14 10 17 10 M14 7 L17 10 L14 13" /> },
  { id: 'supply', label: 'Supply lens: where fleets resupply', icon: <><circle cx="10" cy="10" r="6.5" /><circle cx="10" cy="10" r="2.2" /></> },
];

function polar(cx: number, cy: number, r: number, a: number) { return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; }
function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
}

export function ThroneDial() {
  const g = useGame();
  const ui = useUI();
  const e = g.empires[g.playerId];
  const L = getLedger(g, e);
  const day = g.tick % 30;
  const C = 84, R = 76;
  const segs = Array.from({ length: 30 }, (_, i) => {
    const a0 = -Math.PI / 2 + (i / 30) * Math.PI * 2 + 0.025, a1 = a0 + (Math.PI * 2) / 30 - 0.05;
    return <path key={i} d={arc(C, C, R, a0, a1)} className={cls('seg', i <= day && 'lit', i === day && 'now')} />;
  });
  const stab = e.stats.avgStability / 100;
  const naval = L.navalCap ? Math.min(1, L.navalUsed / L.navalCap) : 0;
  // left gauge: stability (bottom-up), right gauge: naval capacity
  const lg0 = Math.PI * 0.62, lg1 = Math.PI * 1.38;
  const rg0 = -Math.PI * 0.38, rg1 = Math.PI * 0.38;
  const paused = ui.speed === 0;
  return (
    <div className="dial-wrap">
      <div className="dial-slots left">
        {LENSES.map((l) => (
          <button key={l.id} className={cls('slot', ui.mapMode === l.id && ui.view === 'galaxy' && 'on')} onClick={() => ui.set({ mapMode: l.id, view: 'galaxy', screen: 'map' })} aria-label={l.label} title={l.label}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round">{l.icon}</svg>
          </button>
        ))}
      </div>
      <div className="dial">
        <svg width={C * 2} height={C * 2} viewBox={`0 0 ${C * 2} ${C * 2}`}>
          <circle cx={C} cy={C} r={R + 6} className="dial-rim" />
          {segs}
          <path d={arc(C, C, 62, lg0, lg1)} className="gauge-bg" />
          <path d={arc(C, C, 62, lg1 - (lg1 - lg0) * stab, lg1)} className={cls('gauge', stab < 0.35 ? 'bad' : stab < 0.5 ? 'warn' : 'good')} />
          <path d={arc(C, C, 62, rg0, rg1)} className="gauge-bg" />
          <path d={arc(C, C, 62, rg1 - (rg1 - rg0) * naval, rg1)} className={cls('gauge', naval > 1 ? 'bad' : 'ice')} />
          <circle cx={C} cy={C} r={50} className="dial-face" />
        </svg>
        <button className={cls('dial-center', paused && 'paused')} onClick={() => ui.togglePause()} aria-label={paused ? 'Resume (Space)' : 'Pause (Space)'}>
          <span className="dial-date num">{formatDate(g.tick)}</span>
          <span className="dial-state">{paused ? 'Paused' : `${SPEEDS[ui.speed]} days/s`}</span>
        </button>
        <Tip content={<div><h4>Stability</h4><div className="muted">Average across your worlds: {e.stats.avgStability}. Below 35, unrest turns to revolt.</div></div>} className="gauge-hit l"><span /></Tip>
        <Tip content={<div><h4>Naval capacity</h4><div className="muted">{L.navalUsed} of {L.navalCap} used. Exceeding it raises fleet upkeep.</div></div>} className="gauge-hit r"><span /></Tip>
        <div className="speeds">
          {[0, 1, 2, 3].map((n) => (
            <button key={n} className={cls('spd', ui.speed === n && 'on')} onClick={() => ui.setSpeed(n)} aria-label={n === 0 ? 'Pause' : `Speed ${n}`} title={n === 0 ? 'Pause (Space)' : `Speed ${n} (${n})`}>
              <PlayIcon n={n} />
            </button>
          ))}
        </div>
      </div>
      <div className="dial-slots right">
        <button className={cls('slot', ui.view === 'galaxy' && ui.screen === 'map' && 'on')} onClick={() => ui.set({ view: 'galaxy', screen: 'map' })} aria-label="Galaxy map" title="Galaxy map (F1)"><ScreenIcon id="map" size={20} /></button>
        <button className={cls('slot', ui.view === 'system' && 'on')} disabled={ui.systemId == null || !e.explored.includes(ui.systemId)} onClick={() => ui.set({ view: 'system', screen: 'map' })} aria-label="Enter selected system" title="Enter the selected system"><ScreenIcon id="system" size={20} /></button>
        <button className="slot" onClick={() => { if (e.capitalSystemId != null) { focusSystem(e.capitalSystemId); ui.selectSystem(e.capitalSystemId); ui.set({ view: 'galaxy', screen: 'map' }); } }} aria-label="Go to the capital" title="Go to the capital">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M3 15 V8 L6.5 10.5 L10 5 L13.5 10.5 L17 8 V15 Z" /></svg>
        </button>
        <button className="slot" onClick={() => ui.openScreen('fleets')} aria-label="Fleets" title="Fleets"><ScreenIcon id="fleets" size={20} /></button>
        <button className="slot" onClick={() => ui.openScreen('construction')} aria-label="Construction" title="Construction"><ScreenIcon id="construction" size={20} /></button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- dispatches

const DISPATCH_TABS: { id: string; label: string; kinds?: string[] }[] = [
  { id: 'all', label: 'All' },
  { id: 'realm', label: 'Realm', kinds: ['colony', 'outpost', 'construction', 'shipyard', 'starbase', 'megastructure', 'capital', 'government', 'unrest', 'rebellion', 'shortage', 'trade', 'research', 'discovery'] },
  { id: 'war', label: 'War', kinds: ['war', 'peace', 'battle', 'battle_end', 'invasion', 'capture', 'retreat', 'admiral', 'raiders', 'fall', 'guardian'] },
  { id: 'court', label: 'Court', kinds: ['treaty', 'diplomacy', 'peace', 'war', 'event'] },
];

export function Dispatches() {
  const g = useGame();
  const [tab, setTab] = useState('all');
  const [min, setMin] = useState(false);
  const flash = useUI((s) => s.flash);
  const t = DISPATCH_TABS.find((x) => x.id === tab)!;
  const evs = g.events.filter((e) => (e.empires.length === 0 || e.empires.includes(g.playerId)) && (!t.kinds || t.kinds.includes(e.kind))).slice(-40).reverse();
  return (
    <div className={cls('dispatch glass', min && 'min')}>
      <div className="tabs">
        {DISPATCH_TABS.map((x) => <button key={x.id} className={cls('tab', tab === x.id && 'on')} onClick={() => { setTab(x.id); setMin(false); }}>{x.label}</button>)}
        <span className="grow" />
        <button className="wbtn" onClick={() => setMin(!min)} aria-label={min ? 'Expand dispatches' : 'Collapse dispatches'}>{min ? '▴' : '–'}</button>
      </div>
      {flash && <div className="dispatch-flash">{flash}</div>}
      {!min && (
        <div className="dispatch-list">
          {evs.map((ev) => (
            <button key={ev.id} className="dl" onClick={() => jumpTo(ev)} title={ev.text}>
              <span className={cls('sev', ev.severity)} />
              <span className="dl-d num">{formatDate(ev.tick).slice(5)}</span>
              <span className="dl-t">{ev.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- overview

export function Overview() {
  const g = useGame();
  const ui = useUI();
  const [tab, setTab] = useState<'systems' | 'fleets' | 'realms'>('systems');
  const [min, setMin] = useState(false);
  const e = g.empires[g.playerId];
  const from = ui.systemId ?? e.capitalSystemId ?? 0;
  const dist = jumpDistances(g.galaxy, [from]);
  const vis = visibleSystems(g, g.playerId);
  let rows: ReactNode[] = [];
  if (tab === 'systems') {
    rows = e.explored.slice().sort((a, b) => dist[a] - dist[b]).slice(0, 80).map((id) => {
      const s = g.galaxy.systems[id];
      const o = s.owner != null ? g.empires[s.owner] : null;
      return (
        <tr key={id} className={cls(ui.systemId === id && 'sel')} onClick={() => { ui.selectSystem(id); focusSystem(id); }} onDoubleClick={() => ui.set({ view: 'system', systemId: id, screen: 'map' })}>
          <td className="n">{dist[id]}</td>
          <td>{s.name}</td>
          <td className="own">{o ? <><Swatch color={o.color} />{o.id === g.playerId ? 'Crown' : o.name}</> : <span className="dim">Unclaimed</span>}</td>
        </tr>
      );
    });
  } else if (tab === 'fleets') {
    const fl = Object.values(g.fleets).filter((f) => f.ships.length && (f.ownerId === g.playerId || vis.has(f.systemId))).sort((a, b) => dist[a.systemId] - dist[b.systemId]).slice(0, 80);
    rows = fl.map((f) => {
      const o = g.empires[f.ownerId];
      return (
        <tr key={f.id} className={cls(ui.fleetId === f.id && 'sel')} onClick={() => { ui.selectFleet(f.id); ui.set({ systemId: f.systemId }); focusSystem(f.systemId); }}>
          <td className="n">{dist[f.systemId]}</td>
          <td><Swatch color={o.color} /> {f.name}</td>
          <td className="own num">{fleetPower(g, f) || '—'}</td>
        </tr>
      );
    });
  } else {
    rows = g.empires.filter((x) => x.alive && x.id !== g.playerId && (x.kind === 'major' || x.kind === 'minor' || x.kind === 'rebels') && hasContact(g, g.playerId, x.id)).map((x) => {
      const op = opinion(g, x.id, g.playerId);
      const war = g.wars.some((w) => (w.attackers.includes(x.id) && w.defenders.includes(g.playerId)) || (w.defenders.includes(x.id) && w.attackers.includes(g.playerId)));
      return (
        <tr key={x.id} onClick={() => ui.openScreen('diplomacy')}>
          <td className="n"><Swatch color={x.color} /></td>
          <td>{x.name}</td>
          <td className={cls('own num', war ? 'bad' : op >= 25 ? 'good' : op <= -25 ? 'bad' : '')}>{war ? 'War' : signed(op, 0)}</td>
        </tr>
      );
    });
  }
  return (
    <div className={cls('overview glass', min && 'min')}>
      <div className="whead"><span className="wtitle">Overview</span><span className="grow" /><button className="wbtn" onClick={() => setMin(!min)} aria-label={min ? 'Expand overview' : 'Collapse overview'}>{min ? '▾' : '–'}</button></div>
      {!min && (
        <>
          <div className="tabs">
            {(['systems', 'fleets', 'realms'] as const).map((x) => <button key={x} className={cls('tab', tab === x && 'on')} onClick={() => setTab(x)}>{x[0].toUpperCase() + x.slice(1)}</button>)}
          </div>
          <div className="ov-body">
            <table className="ov">
              <thead><tr><th className="n">{tab === 'realms' ? '' : 'Jumps'}</th><th>Name</th><th>{tab === 'systems' ? 'Sovereign' : tab === 'fleets' ? 'Strength' : 'Opinion'}</th></tr></thead>
              <tbody>{rows}</tbody>
            </table>
            {!rows.length && <div className="empty">Nothing to show yet.</div>}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- window manager

export function WindowLayer() {
  const windows = useUI((s) => s.windows);
  return <>{windows.map((w) => <WindowFrame key={w.id} win={w} />)}</>;
}

function WindowFrame({ win }: { win: Win }) {
  const ui = useUI();
  const Screen = SCREENS[win.id];
  const ref = useRef<HTMLDivElement>(null);
  const focused = ui.screen === win.id;
  const label = NAV.find((n) => n.id === win.id)?.label ?? win.id;
  const startDrag = (e: React.PointerEvent, mode: 'move' | 'size') => {
    if (e.button !== 0) return;
    e.preventDefault();
    ui.focusWin(win.id);
    const sx = e.clientX, sy = e.clientY, { x, y, w, h } = win;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (mode === 'move') ui.patchWin(win.id, { x: Math.max(46, Math.min(window.innerWidth - 120, x + dx)), y: Math.max(0, Math.min(window.innerHeight - 40, y + dy)) });
      else ui.patchWin(win.id, { w: Math.max(420, w + dx), h: Math.max(240, h + dy) });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <section ref={ref} className={cls('win glass', focused && 'focus', win.min && 'min')} style={{ left: win.x, top: win.y, width: win.w, height: win.min ? undefined : win.h, zIndex: 100 + win.z }}
      onPointerDown={() => { if (!focused) ui.focusWin(win.id); }} aria-label={label}>
      <header className="whead" onPointerDown={(e) => startDrag(e, 'move')} onDoubleClick={() => ui.patchWin(win.id, { min: !win.min })}>
        <ScreenIcon id={win.id} size={16} />
        <span className="wtitle">{label}</span>
        <span className="grow" />
        <button className="wbtn" onPointerDown={(e) => e.stopPropagation()} onClick={() => ui.patchWin(win.id, { min: !win.min })} aria-label="Minimise">–</button>
        <button className="wbtn" onPointerDown={(e) => e.stopPropagation()} onClick={() => ui.closeWin(win.id)} aria-label="Close">×</button>
      </header>
      {!win.min && <div className="wbody"><Screen /></div>}
      {!win.min && <div className="wsize" onPointerDown={(e) => startDrag(e, 'size')} aria-hidden />}
    </section>
  );
}
