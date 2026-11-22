// The Relic Vault: spend relics earned in play on draws for ships, heroes and caches.
import { useState } from 'react';
import { useGame, useUI } from '../store';
import { Sheet, Section, cls } from '../components/common';
import { audio } from '../../audio/manager';
import { EPIC_PITY, LEGEND_PITY, RARITY_LABEL, RARITY_ODDS, SHIP_BONUS, relicsOf, type RelicDraw, type Rarity } from '../../sim/relics';
import { formatDate } from '../../sim/util';

const ORDER: Rarity[] = ['legendary', 'epic', 'rare', 'common'];

function RelicGem({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className="relic-gem">
      <path d="M10 1.5l6.5 5-6.5 11.5L3.5 6.5z" fill="currentColor" fillOpacity="0.25" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M3.5 6.5h13M7 6.5l3 11.5 3-11.5M7 6.5l3-5 3 5" stroke="currentColor" strokeWidth="0.9" fill="none" strokeLinejoin="round" />
    </svg>
  );
}

function DrawCard({ d, i }: { d: RelicDraw; i: number }) {
  return (
    <div className={cls('relic-card', d.rarity)} style={{ animationDelay: `${i * 140}ms` }} data-testid="relic-card">
      <div className="relic-rarity">{RARITY_LABEL[d.rarity]}</div>
      <div className="relic-kind">{d.kind === 'ship' ? 'Warship' : d.kind === 'hero' ? 'Hero' : 'Cache'}</div>
      <div className="relic-title">{d.title}</div>
      <div className="relic-text">{d.text}</div>
    </div>
  );
}

export function VaultScreen() {
  const g = useGame();
  const ui = useUI();
  const e = g.empires[g.playerId];
  const have = relicsOf(e);
  const [shown, setShown] = useState<RelicDraw[]>([]);
  const pity = e.relicPity ?? { sinceEpic: 0, sinceLegend: 0 };
  const draw = (n: number) => {
    audio.unlock();
    const r = ui.cmd({ type: 'drawRelic', count: n });
    if (!r.ok) return;
    const got = (e.relicLog ?? []).slice(0, n).reverse();
    setShown(got);
    const best = got.some((d) => d.rarity === 'legendary') ? 'legendary' : got.some((d) => d.rarity === 'epic') ? 'epic' : null;
    audio.play(best ? 'mega.stage' : 'notify.good', { delay: got.length * 0.14 });
  };
  return (
    <Sheet title="Relic Vault" lede="Relics are earned by playing: finishing quests and ambitions, reaching new eras, winning wars and decisive battles. Spend them here on draws for warships, heroes and supplies. Nothing here costs real money.">
      <div className="vault-top">
        <div className="vault-count"><RelicGem size={30} /><span className="num" data-testid="relic-count">{have}</span><span className="hint">relic{have === 1 ? '' : 's'}</span></div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary" disabled={have < 1} onClick={() => draw(1)}>Draw 1</button>
          <button className="btn" disabled={have < 10} onClick={() => draw(10)}>Draw 10</button>
        </div>
        <div className="hint vault-pity">
          Epic or better guaranteed within {EPIC_PITY - pity.sinceEpic} draw{EPIC_PITY - pity.sinceEpic === 1 ? '' : 's'} · legendary within {LEGEND_PITY - pity.sinceLegend}
        </div>
      </div>
      {shown.length > 0 && <div className="relic-reveal" key={shown.map((d) => d.title).join('|') + g.tick}>{shown.map((d, i) => <DrawCard key={i} d={d} i={i} />)}</div>}
      <div className="cols" style={{ marginTop: 12 }}>
        <Section title="Odds">
          <table className="tbl">
            <tbody>
              {ORDER.map((r) => (
                <tr key={r}>
                  <td><span className={cls('relic-dot', r)} /> {RARITY_LABEL[r]}</td>
                  <td className="num">{Math.round(RARITY_ODDS[r] * 100)}%</td>
                  <td className="hint">{r === 'common' ? 'A cache of alloys, credits, minerals or influence' : `A warship (+${Math.round(SHIP_BONUS[r] * 100)}% firepower and hull) or a ${r === 'rare' ? 'level 3' : r === 'epic' ? 'level 5' : 'unique level 8'} hero`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">Every {EPIC_PITY}th draw without an epic is upgraded to epic. A legendary is guaranteed within {LEGEND_PITY} draws. Each legendary ship and hero can be drawn only once per reign.</p>
        </Section>
        <Section title="Recent draws" aside={(e.relicLog?.length ?? 0) || null}>
          {!(e.relicLog?.length) && <p className="hint">Nothing drawn yet. You start every reign with a few relics: try a draw.</p>}
          <div className="list">
            {(e.relicLog ?? []).map((d, i) => (
              <div key={i} className="li">
                <span className={cls('relic-dot', d.rarity)} />
                <div className="grow"><div>{d.title}</div><div className="hint">{RARITY_LABEL[d.rarity]} · {formatDate(d.tick)}</div></div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </Sheet>
  );
}
