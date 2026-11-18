import { useUI, useGame } from '../store';
import { getLedger } from '../../sim/engine';
import { TECHS, TECH_BY_ID, TECH_CATEGORIES, techCost } from '../../sim/data/techs';
import { availableTechs } from '../../sim/research';
import { Sheet, Section, Meter, fmt, cls } from '../components/common';

export function ResearchScreen() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const L = getLedger(g, me);
  const r = me.research;
  const rp = Math.max(0.01, L.net.research);
  const avail = availableTechs(me);
  const cur = r.current ? TECH_BY_ID[r.current] : null;
  const months = (id: string, extra = 0) => Math.ceil((techCost(id) - extra) / rp);
  return (
    <Sheet title="Research" lede={`${fmt(L.net.research, 1)} research per month from laboratories, academies and anomalies. ${r.done.length} of ${TECHS.length} technologies mastered.`}
      actions={<button className="btn" onClick={() => ui.set({ screen: 'techtree' })}>Open technology tree</button>}>
      <div className="cols side-r">
        <div>
          <Section title="Available projects" aside="Click to research now; queue to follow on">
            {TECH_CATEGORIES.map((c) => {
              const list = avail.filter((t) => TECH_BY_ID[t].category === c.id);
              if (!list.length) return null;
              return (
                <div key={c.id} style={{ marginBottom: 12 }}>
                  <div className="row" style={{ gap: 6, marginBottom: 4 }}><span className="swatch" style={{ background: c.color }} /><span style={{ fontFamily: 'var(--cond)', fontSize: 14 }}>{c.label}</span></div>
                  <div className="list">
                    {list.map((id) => {
                      const t = TECH_BY_ID[id];
                      const queued = r.queue.includes(id);
                      return (
                        <div key={id} className={cls('li', r.current === id && 'sel')} style={{ cursor: 'default', alignItems: 'flex-start' }}>
                          <div className="grow">
                            <div className="row between"><span>{t.name} <span className="faint">· tier {t.tier}</span></span><span className="num faint">{techCost(id)} · ~{months(id)} mo</span></div>
                            <div className="hint">{t.description}</div>
                          </div>
                          <div className="row" style={{ gap: 4 }}>
                            <button className="btn small primary" disabled={r.current === id} onClick={() => ui.cmd({ type: 'setResearch', tech: id })}>Research</button>
                            <button className="btn small" disabled={queued || r.current === id} onClick={() => ui.cmd({ type: 'queueResearch', tech: id })}>Queue</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {!avail.length && <div className="empty">Every technology has been mastered.</div>}
          </Section>
        </div>
        <div>
          <Section title="Current project">
            {cur ? (
              <>
                <div className="serif" style={{ fontSize: 22, fontWeight: 600 }}>{cur.name}</div>
                <div className="hint">{cur.description}</div>
                <div style={{ margin: '8px 0 4px' }}><Meter value={r.progress} max={techCost(cur.id)} /></div>
                <div className="row between num"><span>{fmt(r.progress)} / {techCost(cur.id)}</span><span>~{months(cur.id, r.progress)} months</span></div>
                <button className="btn small" style={{ marginTop: 8 }} onClick={() => ui.cmd({ type: 'dequeueResearch', tech: cur.id })}>Stop project</button>
              </>
            ) : <div className="empty">No project selected. Research points are being wasted beyond a small reserve of {fmt(Math.min(200, r.progress))}.</div>}
          </Section>
          <Section title="Queue" aside={`${r.queue.length} projects`}>
            {!r.queue.length && <div className="hint">Queued projects start automatically when the current one completes. Queuing a locked technology queues its prerequisites too.</div>}
            {r.queue.map((id, i) => (
              <div key={id} className="row between" style={{ padding: '4px 0', borderBottom: '1px solid rgba(34,50,74,0.6)' }}>
                <span><span className="faint num">{i + 1}.</span> {TECH_BY_ID[id].name}</span>
                <button className="btn small" onClick={() => ui.cmd({ type: 'dequeueResearch', tech: id })}>Remove</button>
              </div>
            ))}
          </Section>
          <Section title="Recently completed">
            {r.done.slice(-8).reverse().map((id) => <div key={id} className="hint" style={{ padding: '2px 0' }}>{TECH_BY_ID[id].name}</div>)}
            {!r.done.length && <div className="hint">Nothing yet.</div>}
          </Section>
        </div>
      </div>
    </Sheet>
  );
}

export function TechTreeScreen() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const r = me.research;
  const COLW = 196, ROWH = 64, X0 = 120, Y0 = 34;
  // lay out by category rows and tier columns, stacking within a cell
  const pos = new Map<string, [number, number]>();
  let rowCursor = 0;
  const rowStart: Record<string, number> = {};
  for (const c of TECH_CATEGORIES) {
    rowStart[c.id] = rowCursor;
    const perTier: Record<number, number> = {};
    for (const t of TECHS.filter((x) => x.category === c.id)) {
      const k = perTier[t.tier] ?? 0;
      perTier[t.tier] = k + 1;
      pos.set(t.id, [X0 + (t.tier - 1) * COLW, Y0 + (rowCursor + k) * ROWH]);
    }
    rowCursor += Math.max(1, ...Object.values(perTier));
  }
  const H = Y0 + rowCursor * ROWH + 20;
  const W = X0 + 5 * COLW + 20;
  const avail = new Set(availableTechs(me));
  return (
    <Sheet title="Technology tree" lede="Nine fields, five tiers. Lines show prerequisites. Click an available technology to research it, or a locked one to queue it with its prerequisites.">
      <div className="tree" style={{ width: W, height: H }}>
        <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }} aria-hidden>
          {[1, 2, 3, 4, 5].map((t) => <text key={t} x={X0 + (t - 1) * COLW} y={18} fill="#7f7868" style={{ font: "500 13px 'Barlow Condensed'" }}>Tier {t}</text>)}
          {TECH_CATEGORIES.map((c) => <line key={c.id} x1={0} x2={W} y1={Y0 + rowStart[c.id] * ROWH - 6} y2={Y0 + rowStart[c.id] * ROWH - 6} stroke="#22324a" />)}
          {TECHS.flatMap((t) => t.requires.map((req) => {
            const a = pos.get(req)!, b = pos.get(t.id)!;
            const done = r.done.includes(req);
            return <path key={req + t.id} d={`M${a[0] + 168} ${a[1] + 22} C${a[0] + 182} ${a[1] + 22}, ${b[0] - 14} ${b[1] + 22}, ${b[0]} ${b[1] + 22}`} fill="none" stroke={done ? '#5fa79a' : '#2e4262'} strokeWidth="1.2" opacity={0.8} />;
          }))}
        </svg>
        {TECH_CATEGORIES.map((c) => <div key={c.id} style={{ position: 'absolute', left: 0, top: Y0 + rowStart[c.id] * ROWH, width: X0 - 12, fontFamily: 'var(--cond)', fontSize: 13.5, color: c.color, lineHeight: 1.1 }}>{c.label}</div>)}
        {TECHS.map((t) => {
          const [x, y] = pos.get(t.id)!;
          const done = r.done.includes(t.id);
          const state = done ? 'done' : r.current === t.id ? 'cur' : r.queue.includes(t.id) ? 'queued' : avail.has(t.id) ? 'avail' : 'locked';
          return (
            <div key={t.id} className={cls('tnode', state)} style={{ left: x, top: y }} title={t.description}
              onClick={() => { if (done) return; if (avail.has(t.id)) ui.cmd({ type: 'setResearch', tech: t.id }); else ui.cmd({ type: 'queueResearch', tech: t.id }); }}>
              <div className="tn">{t.name}</div>
              <div className="hint">{done ? 'Mastered' : state === 'cur' ? `In progress ${Math.round((r.progress / techCost(t.id)) * 100)}%` : state === 'queued' ? 'Queued' : `${techCost(t.id)} research`}</div>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
