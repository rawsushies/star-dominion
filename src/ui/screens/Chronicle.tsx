import { useState } from 'react';
import { useGame } from '../store';
import { formatDate } from '../../sim/util';
import { ERAS } from '../../sim/data/eras';
import { Sheet, Section, Swatch, cls, fmt } from '../components/common';
import type { ChronicleStat } from '../../sim/types';

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
