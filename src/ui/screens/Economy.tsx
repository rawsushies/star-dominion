import { useState } from 'react';
import { useUI, useGame } from '../store';
import { getLedger } from '../../sim/engine';
import { marketQuote, marketFee, MARKET_BASE } from '../../sim/commands';
import { RESOURCES, type ResId } from '../../sim/types';
import type { LedgerKey } from '../../sim/economy';
import { Sheet, Section, ResGlyph, RES_META, fmt, signed, cls, Meter } from '../components/common';

export function EconomyScreen() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const L = getLedger(g, me);
  const [focus, setFocus] = useState<LedgerKey>('credits');
  const keys: LedgerKey[] = [...RESOURCES, 'research'];
  const lines = L.lines.filter((l) => l.key === focus).sort((a, b) => b.amount - a.amount);
  const tradable = RESOURCES.filter((r) => r !== 'credits' && r !== 'influence');
  return (
    <Sheet title="Economy" lede="Every figure is a monthly flow from the simulation: production, consumption, taxes, trade, upkeep and treaties.">
      <div className="cols c2">
        <div>
          <Section title="Kingdom ledger" aside="Click a resource for its breakdown">
            <table className="t">
              <thead><tr><th>Resource</th><th className="n">Stored</th><th className="n">Capacity</th><th className="n">Income</th><th className="n">Expenses</th><th className="n">Net</th></tr></thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k} className={cls('click', focus === k && 'sel')} onClick={() => setFocus(k)}>
                    <td><span className="row" style={{ gap: 6 }}><ResGlyph r={k} />{RES_META[k].label}{L.shortages.includes(k as ResId) && <span className="tag bad">Shortage</span>}</span></td>
                    <td className="n">{k === 'research' ? '—' : fmt(me.stock[k as ResId])}</td>
                    <td className="n faint">{k === 'research' ? '—' : fmt(L.cap[k as ResId])}</td>
                    <td className="n pos">{fmt(L.income[k], 1)}</td>
                    <td className="n neg">{fmt(L.expense[k], 1)}</td>
                    <td className={cls('n', L.net[k] >= 0 ? 'pos' : 'neg')}>{signed(L.net[k])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title={`${RES_META[focus].label}: sources and uses`}>
            <div className="kv">
              {lines.map((l) => [<span key={l.label}>{l.label}</span>, <span key={l.label + 'v'} className={l.amount >= 0 ? 'pos' : 'neg'}>{signed(l.amount)}</span>])}
            </div>
            {!lines.length && <div className="empty">No flows.</div>}
          </Section>
        </div>
        <div>
          <Section title="Galactic market" aside={`Broker fee ${Math.round(marketFee(g, g.playerId) * 100)}%`}>
            <p className="hint" style={{ marginTop: 0 }}>Prices move with every trade and drift back toward their base value each month. Large orders cost more.</p>
            <table className="t">
              <thead><tr><th>Good</th><th className="n">Price</th><th className="n">Stored</th><th>Buy</th><th>Sell</th></tr></thead>
              <tbody>
                {tradable.map((r) => {
                  const p = g.market.price[r];
                  const trend = p / MARKET_BASE[r];
                  return (
                    <tr key={r}>
                      <td><span className="row" style={{ gap: 6 }}><ResGlyph r={r} />{RES_META[r].label}</span></td>
                      <td className={cls('n', trend > 1.15 ? 'neg' : trend < 0.85 ? 'pos' : '')}>{p.toFixed(2)}</td>
                      <td className="n">{fmt(me.stock[r])}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {[50, 200].map((a) => <button key={a} className="btn small" style={{ marginRight: 4 }} title={`Costs ${marketQuote(g, g.playerId, r, a)} credits`} disabled={me.stock.credits < marketQuote(g, g.playerId, r, a)} onClick={() => ui.cmd({ type: 'market', res: r, amount: a })}>+{a}</button>)}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {[50, 200].map((a) => <button key={a} className="btn small" style={{ marginRight: 4 }} title={`Earns ${marketQuote(g, g.playerId, r, -a)} credits`} disabled={me.stock[r] < a} onClick={() => ui.cmd({ type: 'market', res: r, amount: -a })}>−{a}</button>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
          <Section title="Storage">
            {RESOURCES.filter((r) => r !== 'credits' && r !== 'influence').map((r) => (
              <div key={r} className="row" style={{ marginBottom: 5 }}>
                <span style={{ width: 120 }} className="row"><ResGlyph r={r} />&nbsp;{RES_META[r].label}</span>
                <div className="grow"><Meter value={me.stock[r]} max={L.cap[r]} tone={me.stock[r] > L.cap[r] * 0.95 ? 'r' : undefined} /></div>
                <span className="num faint" style={{ width: 90, textAlign: 'right' }}>{fmt(me.stock[r])}/{fmt(L.cap[r])}</span>
              </div>
            ))}
            <p className="hint">Production above capacity is wasted. Strategic Depots and technology raise the limit.</p>
          </Section>
          <Section title="Fiscal levers">
            <p className="hint" style={{ marginTop: 0 }}>Taxation is set at <b>{me.policies.taxation}</b>; trade law is <b>{me.policies.trade_law}</b>. Adjust them in the Ministry of the Treasury.</p>
            <button className="btn" onClick={() => ui.set({ screen: 'kingdom' })}>Open ministries</button>
          </Section>
        </div>
      </div>
    </Sheet>
  );
}
