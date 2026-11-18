import { useState } from 'react';
import { useUI, useGame } from '../store';
import { getLedger } from '../../sim/engine';
import type { LedgerKey } from '../../sim/economy';
import { Sheet, Section, ResGlyph, RES_META, fmt, signed, cls } from '../components/common';
import { ShipyardPanel } from './Planets';

/** Production chain node figures pulled from the ledger lines. */
function flow(lines: { key: string; label: string; amount: number }[], key: LedgerKey) {
  let made = 0, used = 0;
  for (const l of lines) if (l.key === key) { if (l.amount > 0) made += l.amount; else used -= l.amount; }
  return { made, used };
}

export function IndustryScreen() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const L = getLedger(g, me);
  const colonies = g.planets.filter((p) => p.colony?.ownerId === g.playerId);
  const yards = colonies.filter((p) => (p.colony!.buildings.shipyard ?? 0) > 0);
  const [yard, setYard] = useState<number | null>(yards[0]?.id ?? null);
  const sy = yards.find((p) => p.id === yard) ?? yards[0];
  const cols: LedgerKey[] = ['minerals', 'energy', 'food', 'alloys', 'electronics', 'components', 'rare', 'research'];
  const node = (k: LedgerKey, x: number, y: number) => {
    const f = flow(L.lines, k);
    return (
      <g transform={`translate(${x},${y})`}>
        <rect x={-62} y={-26} width={124} height={52} fill="#0e1626" stroke={L.net[k] < 0 ? '#d2604a' : '#2e4262'} />
        <text x={0} y={-8} textAnchor="middle" fill={RES_META[k].color} style={{ font: "500 14px 'Barlow Condensed'" }}>{RES_META[k].label}</text>
        <text x={0} y={9} textAnchor="middle" fill="#b8ae98" style={{ font: "400 12px 'Barlow Condensed'" }}>made {fmt(f.made, 1)} · used {fmt(f.used, 1)}</text>
        <text x={0} y={21} textAnchor="middle" fill={L.net[k] >= 0 ? '#5fa79a' : '#d2604a'} style={{ font: "500 12px 'Barlow Condensed'" }}>net {signed(L.net[k])}</text>
      </g>
    );
  };
  const step = (label: string, x: number, y: number) => (
    <g transform={`translate(${x},${y})`}>
      <path d="M-56 -14 L56 -14 L64 0 L56 14 L-56 14 L-64 0 Z" fill="#14100a" stroke="#6d5a33" />
      <text x={0} y={4} textAnchor="middle" fill="#e0c07e" style={{ font: "500 13px 'Barlow Condensed'" }}>{label}</text>
    </g>
  );
  const line = (x1: number, y1: number, x2: number, y2: number) => <path d={`M${x1} ${y1} C${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`} fill="none" stroke="#2e4262" strokeWidth="1.4" />;
  return (
    <Sheet title="Industry" lede="Raw extraction feeds refining, refining feeds manufacturing, and manufacturing feeds your shipyards, laboratories and megastructures.">
      <Section title="Production chains" aside="Live monthly figures">
        <svg viewBox="0 0 1000 300" style={{ width: '100%', maxHeight: 320 }} role="img" aria-label="Production chain diagram">
          {line(130, 60, 290, 60)}{line(130, 60, 290, 160)}{line(130, 250, 290, 160)}
          {line(418, 60, 560, 60)}{line(418, 160, 560, 160)}
          {line(688, 60, 790, 110)}{line(688, 160, 790, 110)}{line(688, 160, 790, 230)}
          {line(688, 60, 860, 20)}
          {node('minerals', 70, 60)}
          {node('rare', 70, 250)}
          {step('Alloy foundries', 354, 60)}
          {step('Electronics fabs', 354, 160)}
          {node('alloys', 624, 60)}
          {node('electronics', 624, 160)}
          {step('Component works', 854, 110)}
          {step('Labs & consumer goods', 854, 230)}
          <text x={870} y={24} fill="#7f7868" style={{ font: "400 12px 'Barlow Condensed'" }}>→ ships, starbases, megastructures</text>
        </svg>
      </Section>
      <div className="cols c2">
        <Section title="Output by world">
          <table className="t">
            <thead><tr><th>World</th>{cols.map((k) => <th key={k} className="n" title={RES_META[k].label}><ResGlyph r={k} /></th>)}</tr></thead>
            <tbody>
              {colonies.map((p) => {
                const rep = L.planets[p.id];
                return (
                  <tr key={p.id} className="click" onClick={() => ui.set({ screen: 'planets', planetId: p.id })}>
                    <td>{p.name}</td>
                    {cols.map((k) => { const v = rep?.production[k] ?? 0; return <td key={k} className={cls('n', v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : 'faint')}>{Math.abs(v) < 0.05 ? '·' : signed(v)}</td>; })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint">Output includes worker inputs, building upkeep and population consumption on each world.</p>
        </Section>
        <Section title="Shipyards" aside={`${yards.length} yards · naval cap ${L.navalUsed}/${L.navalCap}`}>
          {!yards.length && <div className="empty">No shipyards. Build a Spaceport, then an Orbital Shipyard, on a colony.</div>}
          {yards.length > 1 && <div className="row wrap" style={{ marginBottom: 6 }}>{yards.map((p) => <button key={p.id} className={cls('btn small', sy?.id === p.id && 'on')} onClick={() => setYard(p.id)}>{p.name} ({p.colony!.shipQueue.length})</button>)}</div>}
          {sy && <ShipyardPanel p={sy} />}
        </Section>
      </div>
    </Sheet>
  );
}
