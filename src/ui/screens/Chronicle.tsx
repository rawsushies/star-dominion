import { useState } from 'react';
import { useGame } from '../store';
import { formatDate } from '../../sim/util';
import { ERAS } from '../../sim/data/eras';
import { Sheet, Section, Swatch, cls, fmt } from '../components/common';
import type { ChronicleStat } from '../../sim/types';
import { PHASE_LABEL } from '../../sim/data/life';
import { useUI } from '../store';

type Metric = 'k' | 'pop' | 'systems' | 'military';
const METRICS: Record<Metric, string> = { k: 'Kardashev index', pop: 'Population', systems: 'Systems held', military: 'Fleet strength' };

/** Line chart of one metric for every sovereign realm across the recorded years. */
function HistoryChart({ metric }: { metric: Metric }) {
  const g = useGame();
  const years = g.chronicle ?? [];
  const W = 640, H = 220, P = 34;
  if (years.length < 2) return <div className="empty">The chronicle fills in as the years pass: one entry each new year.</div>;
  const ids = [...new Set(years.flatMap((y) => y.stats.map((s) => s.id)))].filter((id) => g.empires[id]?.kind === 'major');
  const val = (s: ChronicleStat | undefined) => (s ? (s[metric] as number) : null);
  let max = -Infinity, min = Infinity;
  for (const y of years) for (const s of y.stats) if (ids.includes(s.id)) { max = Math.max(max, s[metric] as number); min = Math.min(min, s[metric] as number); }
  const pad = (max - min) * 0.1 || Math.abs(max) * 0.05 || 1;
  min = Math.max(0, min - pad); max = max + pad;
  const x = (i: number) => P + (i / (years.length - 1)) * (W - P - 8);
  const yy = (v: number) => H - P + 8 - ((v - min) / (max - min)) * (H - P - 4);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} data-testid="history-chart" role="img" aria-label={`${METRICS[metric]} over time`}>
      {[0, 0.5, 1].map((f) => { const v = min + (max - min) * f; return <g key={f}><line x1={P} x2={W - 8} y1={yy(v)} y2={yy(v)} stroke="var(--rule)" /><text x={P - 4} y={yy(v) + 4} textAnchor="end" fontSize="10" fill="var(--text-3, #889)">{metric === 'k' ? v.toFixed(2) : fmt(v)}</text></g>; })}
      {years.map((y, i) => (i % Math.ceil(years.length / 8) === 0 ? <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--text-3, #889)">{formatDate(y.tick).slice(0, 4)}</text> : null))}
      {ids.map((id) => {
        const pts = years.map((y, i) => { const v = val(y.stats.find((s) => s.id === id)); return v == null ? null : `${x(i)},${yy(v)}`; }).filter(Boolean);
        const mine = id === g.playerId;
        return <polyline key={id} points={pts.join(' ')} fill="none" stroke={g.empires[id].color} strokeWidth={mine ? 2.6 : 1.3} opacity={mine ? 1 : 0.75} />;
      })}
    </svg>
  );
}

export function ChronicleScreen() {
  const g = useGame();
  const me = g.empires[g.playerId];
  const [metric, setMetric] = useState<Metric>('k');
  const years = (g.chronicle ?? []).slice().reverse();
  const mineIn = (stats: ChronicleStat[]) => stats.find((s) => s.id === me.id);
  return (
    <Sheet title="Chronicle of the reign" lede={`${years.length} ${years.length === 1 ? 'year' : 'years'} recorded. Each new year the chronicler sets down the realm's standing and the deeds that marked it.`}
      actions={<div className="seg">{(Object.keys(METRICS) as Metric[]).map((m) => <button key={m} className={cls(metric === m && 'on')} onClick={() => setMetric(m)}>{METRICS[m]}</button>)}</div>}>
      <Section title={`${METRICS[metric]}, every great realm`}>
        <HistoryChart metric={metric} />
        <div className="row wrap" style={{ gap: 10, marginTop: 4 }}>{g.empires.filter((e) => e.kind === 'major').map((e) => <span key={e.id} className="row hint" style={{ gap: 4 }}><Swatch color={e.color} />{e.name}{e.id === me.id ? ' (you)' : ''}{e.alive ? '' : ' (fallen)'}</span>)}</div>
      </Section>
      <GalacticHistory />
      <Section title="The years">
        <div className="list" data-testid="chronicle-years">
          {years.map((y, i) => {
            const s = mineIn(y.stats);
            const prev = years[i + 1] ? mineIn(years[i + 1].stats) : undefined;
            const delta = (k: keyof ChronicleStat) => (s && prev ? (s[k] as number) - (prev[k] as number) : 0);
            const mine = y.headlines.filter((h) => !h.empires.length || h.empires.includes(me.id));
            return (
              <div key={y.tick} style={{ padding: '8px 0', borderBottom: '1px solid var(--rule)' }}>
                <div className="row between"><span className="serif" style={{ fontSize: 18, fontWeight: 600 }}>Year {formatDate(y.tick).slice(0, 4)}</span>
                  {s && <span className="hint">K {s.k.toFixed(2)}{delta('k') ? ` (${delta('k') > 0 ? '+' : ''}${delta('k').toFixed(2)})` : ''} · {s.systems} systems · {fmt(s.pop)} pops · Citadel {s.citadel} · {ERAS[s.era]?.name}</span>}</div>
                {mine.length ? <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{mine.map((h, j) => <li key={j} className="muted" style={{ fontSize: 12.5 }}><span className="num faint">{formatDate(h.tick)}</span> {h.title}</li>)}</ul> : <div className="hint">A quiet year.</div>}
              </div>
            );
          })}
        </div>
      </Section>
    </Sheet>
  );
}

const KIND_LABEL: Record<string, string> = {
  trade: 'Trade', blockade: 'Blockade', famine: 'Famine', migration: 'Migration', refugees: 'Refugees', rise: 'Rise', decline: 'Decline', golden: 'Golden age',
  collapse: 'Crisis', recovery: 'Recovery', secession: 'Secession', recognition: 'Recognition', ascendant: 'New great power', depletion: 'Depletion',
  devastation: 'Devastation', rebuilt: 'Rebuilt', boom: 'Boom', bust: 'Bust',
};

/** Galactic history (sim/life.ts): what happened, why, to whom, and what came of it; and where every realm stands now. */
function GalacticHistory() {
  const g = useGame();
  const ui = useUI();
  const [who, setWho] = useState<'all' | 'mine' | 'great'>('great');
  const L = g.life;
  const list = (L?.history ?? []).filter((h) => who === 'all' || (who === 'mine' ? h.who.includes(g.playerId) : h.weight >= 2)).slice().reverse().slice(0, 80);
  const realms = g.empires.filter((e) => e.alive && (e.kind === 'major' || e.kind === 'minor' || e.kind === 'rebels'));
  return (
    <Section title="Galactic history" aside={<div className="seg">{(['great', 'mine', 'all'] as const).map((k) => <button key={k} className={cls(who === k && 'on')} onClick={() => setWho(k)}>{k === 'great' ? 'Great events' : k === 'mine' ? 'Our realm' : 'Everything'}</button>)}</div>}>
      <table className="t" data-testid="realm-arcs" style={{ marginBottom: 8 }}>
        <thead><tr><th>Realm</th><th>Fortune</th><th className="n">Prosperity</th><th className="n">Systems</th><th className="n">People</th></tr></thead>
        <tbody>{realms.map((e) => { const a = L?.arcs[e.id]; return <tr key={e.id}><td className="row" style={{ gap: 6 }}><Swatch color={e.color} />{e.name}{e.kind !== 'major' ? <span className="faint"> ({e.kind === 'rebels' ? 'breakaway' : 'minor'})</span> : null}</td><td>{a ? `${PHASE_LABEL[a.phase]} since ${formatDate(a.since).slice(0, 4)}` : '—'}</td><td className="n">{a?.prosperity ?? '—'}</td><td className="n">{e.stats.systems}</td><td className="n">{fmt(e.stats.population)}</td></tr>; })}</tbody>
      </table>
      <div className="list" data-testid="galactic-history">
        {!list.length && <div className="empty">History is still being written.</div>}
        {list.map((h) => (
          <div key={h.id} className={cls(h.systemId != null && 'click')} style={{ padding: '6px 0', borderBottom: '1px solid var(--rule)' }} onClick={() => { if (h.systemId != null) ui.set({ screen: 'map', view: 'galaxy', systemId: h.systemId }); }}>
            <div className="row between"><span style={{ fontWeight: 600 }}>{h.title}</span><span className="hint">{KIND_LABEL[h.kind] ?? h.kind} · {formatDate(h.tick)}</span></div>
            <div className="muted" style={{ fontSize: 12.5 }}><b>Cause:</b> {h.cause} <b>Consequence:</b> {h.effect}</div>
            {h.who.length > 0 && <div className="row" style={{ gap: 8, marginTop: 2 }}>{h.who.map((id) => g.empires[id] && <span key={id} className="row hint" style={{ gap: 4 }}><Swatch color={g.empires[id].color} />{g.empires[id].name}</span>)}</div>}
          </div>
        ))}
      </div>
    </Section>
  );
}
