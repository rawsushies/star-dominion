import { useUI, useGame } from '../store';
import { getLedger } from '../../sim/engine';
import { formatDate } from '../../sim/util';
import { Sheet, Section, Stat, Swatch, fmt, signed, cls, ResGlyph } from '../components/common';
import type { ResId } from '../../sim/types';

const STATUS: Record<string, [string, string]> = {
  capital: ['Capital', ''], secure: ['Secure', 'good'], raided: ['Raided', 'gold'], disrupted: ['Disrupted', 'bad'], cut: ['Cut off', 'bad'],
};

export function TradeScreen() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const L = getLedger(g, me);
  const routes = Object.values(L.planets).sort((a, b) => b.trade - a.trade);
  const agreements = g.treaties.filter((t) => t.type === 'trade' && (t.a === g.playerId || t.b === g.playerId));
  const deals = g.tradeDeals.filter((d) => d.a === g.playerId || d.b === g.playerId);
  const tributes = g.tributes.filter((t) => t.from === g.playerId || t.to === g.playerId);
  const agreementIncome = L.lines.filter((l) => l.label === 'Trade agreements').reduce((a, l) => a + l.amount, 0);
  return (
    <Sheet title="Trade routes" lede="Trade value generated on each world must travel to the capital through your territory. Hostile ships cut routes; unpatrolled lanes without starports bleed value to raiders."
      actions={<button className="btn" onClick={() => ui.set({ screen: 'map', view: 'galaxy', mapMode: 'trade' })}>Show routes on map</button>}>
      <div className="stat-strip">
        <Stat k="Trade generated" v={fmt(L.tradeTotal, 1)} s="per month" />
        <Stat k="Reaching the treasury" v={fmt(L.tradeTotal - L.tradeLost, 1)} s="credits per month" />
        <Stat k="Lost to raids and blockades" v={fmt(L.tradeLost, 1)} tone={L.tradeLost > 1 ? 'neg' : ''} s={`${L.tradeTotal > 0 ? Math.round((L.tradeLost / L.tradeTotal) * 100) : 0}% of value`} />
        <Stat k="Trade agreements" v={agreements.length} s={`${signed(agreementIncome)} credits per month`} />
      </div>
      <div className="cols c2" style={{ marginTop: 6 }}>
        <Section title="Routes to the capital">
          <table className="t">
            <thead><tr><th>Origin</th><th className="n">Value</th><th className="n">Collected</th><th className="n">Jumps</th><th>Status</th></tr></thead>
            <tbody>
              {routes.map((r) => {
                const p = g.planets[r.planetId];
                const [lab, tone] = STATUS[r.routeStatus];
                return (
                  <tr key={r.planetId} className="click" onClick={() => ui.set({ screen: 'planets', planetId: p.id })}>
                    <td>{p.name}</td>
                    <td className="n">{fmt(r.trade, 1)}</td>
                    <td className={cls('n', r.tradeCollected < r.trade - 0.05 ? 'warn' : '')}>{fmt(r.tradeCollected, 1)}</td>
                    <td className="n">{Math.max(0, r.routePath.length - 1)}</td>
                    <td><span className={cls('tag', tone)}>{lab}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint">Each lane without a Starport and not patrolled in the last 45 days loses 2.5% of the value passing through it (up to 50%). Spaceports and Commerce Exchanges generate trade value; corporate governments and free-market law multiply it.</p>
        </Section>
        <div>
          <Section title="Trade agreements" aside="+8% of collected trade and +2 credits each">
            {!agreements.length && <div className="empty">No trade agreements. Propose them from Diplomacy.</div>}
            {agreements.map((t) => { const o = g.empires[t.a === g.playerId ? t.b : t.a]; return <div key={o.id} className="row between" style={{ padding: '4px 0' }}><span className="row" style={{ gap: 6 }}><Swatch color={o.color} />{o.name}</span><span className="hint">since {formatDate(t.since)}</span></div>; })}
          </Section>
          <Section title="Resource contracts and tribute">
            {!deals.length && !tributes.length && <div className="empty">No standing contracts.</div>}
            {deals.map((d) => (
              <div key={d.id} className="hint" style={{ padding: '3px 0' }}>
                With {g.empires[d.a === g.playerId ? d.b : d.a].name} until {formatDate(d.until)}: give {Object.entries(d.a === g.playerId ? d.aGives : d.bGives).map(([k, v]) => <span key={k}><ResGlyph r={k as ResId} /> {v} </span>)} receive {Object.entries(d.a === g.playerId ? d.bGives : d.aGives).map(([k, v]) => <span key={k}><ResGlyph r={k as ResId} /> {v} </span>)}
              </div>
            ))}
            {tributes.map((t, i) => (
              <div key={i} className="row between" style={{ padding: '3px 0' }}>
                <span>{t.from === g.playerId ? `Tribute to ${g.empires[t.to].name}` : `Tribute from ${g.empires[t.from].name}`}</span>
                <span className={cls('num', t.from === g.playerId ? 'neg' : 'pos')}>{t.from === g.playerId ? '−' : '+'}{t.perMonth}/month until {formatDate(t.until)}</span>
              </div>
            ))}
          </Section>
          <Section title="Protecting commerce">
            <ul className="hint" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.6 }}>
              <li>Upgrade starbases on busy lanes to Starports.</li>
              <li>Set a warfleet to patrol between your capital and outlying worlds.</li>
              <li>Hunt corsair raiders before they settle on your trade lanes.</li>
              <li>Keep colonies connected: a world cut off from the capital sends no trade at all.</li>
            </ul>
          </Section>
        </div>
      </div>
    </Sheet>
  );
}
