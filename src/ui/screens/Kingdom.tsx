import { EraLadder, typeLabel } from '../components/Evolution';
import { kardashev } from '../../sim/eras';
import { useUI, useGame } from '../store';
import { getLedger } from '../../sim/engine';
import { GOVERNMENTS, MINISTRIES, POLICIES, type PolicyOption } from '../../sim/data/governments';
import { GOV_CHANGE_COST } from '../../sim/commands';
import { empireMods } from '../../sim/modifiers';
import { hasContact, intelLevel, fuzz } from '../../sim/diplomacy';
import { Sheet, Section, Stat, Tip, Emblem, fmt, signed, cls, CostView, Swatch, plural } from '../components/common';
import type { GovernmentId } from '../../sim/types';

export function KingdomScreen() {
  const g = useGame();
  const ui = useUI();
  const e = g.empires[g.playerId];
  const L = getLedger(g, e);
  const st = e.stats;
  const mods = empireMods(g, e);
  const yearsUntilReform = Math.max(0, Math.ceil((e.governmentChangedTick + 3600 - g.tick) / 360));
  const known = g.empires.filter((x) => x.alive && (x.kind === 'major' || x.kind === 'minor' || x.kind === 'rebels') && hasContact(g, g.playerId, x.id));
  const metric = (x: typeof e, k: 'population' | 'militaryPower' | 'economyScore' | 'research' | 'systems') => {
    if (x.id === e.id) return x.stats[k];
    return fuzz(x.stats[k], intelLevel(g, g.playerId, x.id), x.id + k.length).value;
  };
  const ranked = known.slice().sort((a, b) => metric(b, 'economyScore') + metric(b, 'militaryPower') - metric(a, 'economyScore') - metric(a, 'militaryPower'));
  return (
    <Sheet title="Kingdom overview" lede={<span>{e.ruler} rules the {e.name}, {/^[aeiou]/i.test(GOVERNMENTS[e.government].label) ? 'an' : 'a'} {GOVERNMENTS[e.government].label.toLowerCase()} of {st.colonies} {st.colonies === 1 ? 'world' : 'worlds'} across {st.systems} {st.systems === 1 ? 'system' : 'systems'}.</span>}>
      <div className="row" style={{ gap: 16, alignItems: 'center', marginBottom: 14 }}>
        <Emblem empire={e} size={54} />
        <div>
          <div className="serif" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1 }}>{e.name}</div>
          <div className="subtitle">{e.ruler}</div>
        </div>
      </div>
      <div className="stat-strip">
        <Stat k="Treasury" v={fmt(e.stock.credits)} s={`${signed(L.net.credits)} per month`} />
        <Stat k="Population" v={fmt(st.population, 1)} s="pops (≈100M each)" />
        <Stat k="Economic output" v={fmt(st.economyScore)} s="weighted monthly income" />
        <Stat k="Industrial capacity" v={fmt(st.industry)} s="alloys, electronics, components" />
        <Stat k="Military strength" v={fmt(st.militaryPower)} s={`naval cap ${L.navalUsed}/${L.navalCap}`} />
        <Stat k="Scientific output" v={fmt(L.net.research)} s="research per month" />
        <Stat k="Political stability" v={st.avgStability} s="average across worlds" tone={st.avgStability < 35 ? 'neg' : ''} />
        <Stat k="Diplomatic influence" v={fmt(e.stock.influence)} s={`${signed(L.net.influence)} per month`} />
        <Stat k="Territory" v={st.systems} s={plural(st.colonies, 'colony', 'colonies')} />
        <Stat k="Administration" v={`${L.adminUsed}/${L.adminCap}`} s={L.adminUsed > L.adminCap ? 'Over capacity: stability and influence suffer' : 'systems governed / capacity'} tone={L.adminUsed > L.adminCap ? 'neg' : ''} />
        <Stat k="War exhaustion" v={Math.round(e.warExhaustion)} s="rises with losses and long wars" tone={e.warExhaustion > 50 ? 'neg' : ''} />
      </div>

      <Section title="Political eras" aside={typeLabel(kardashev(g, e))}>
        <EraLadder />
      </Section>

      <div className="cols c2" style={{ marginTop: 6 }}>
        <div>
          <Section title="Government" aside={yearsUntilReform ? `Reform possible in ${yearsUntilReform} years` : `Reform costs ${GOV_CHANGE_COST} influence`}>
            <div className="list">
              {(Object.keys(GOVERNMENTS) as GovernmentId[]).map((id) => {
                const gov = GOVERNMENTS[id];
                const cur = e.government === id;
                return (
                  <div key={id} className={cls('li', cur && 'sel')} style={{ cursor: 'default', alignItems: 'flex-start' }}>
                    <div className="grow">
                      <div className="row between"><span className="serif" style={{ fontSize: 18, fontWeight: 600 }}>{gov.label}</span>{cur ? <span className="tag gold">Current</span> : <button className="btn small" disabled={yearsUntilReform > 0 || e.stock.influence < GOV_CHANGE_COST} onClick={() => ui.cmd({ type: 'changeGovernment', government: id })}>Reform</button>}</div>
                      <div className="hint">{gov.description}</div>
                      <div className="hint" style={{ color: 'var(--vellum-2)' }}>{gov.summary.join(' · ')}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="hint">Reforming causes two years of upheaval (−15 stability) and locks reforms for ten years.</p>
          </Section>
          <Section title="Ranking of known powers">
            <table className="t">
              <thead><tr><th>Realm</th><th className="n">Worlds</th><th className="n">Pops</th><th className="n">Economy</th><th className="n">Military</th><th className="n">Research</th></tr></thead>
              <tbody>
                {ranked.map((x) => (
                  <tr key={x.id} className={cls(x.id === e.id && 'sel')}>
                    <td><span className="row" style={{ gap: 6 }}><Swatch color={x.color} />{x.name}</span></td>
                    <td className="n">{x.stats.colonies}</td>
                    <td className="n">{fmt(metric(x, 'population'))}</td>
                    <td className="n">{fmt(metric(x, 'economyScore'))}</td>
                    <td className="n">{fmt(metric(x, 'militaryPower'))}</td>
                    <td className="n">{fmt(metric(x, 'research'))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">Rival figures are estimates; their accuracy depends on your intelligence on each realm.</p>
          </Section>
        </div>
        <div>
          {MINISTRIES.map((m) => (
            <Section key={m.id} title={m.label} aside={m.brief}>
              {POLICIES.filter((p) => p.ministry === m.id).map((p) => (
                <div key={p.id} style={{ marginBottom: 10 }}>
                  <div className="row between" style={{ marginBottom: 4 }}><span>{p.label}</span><span className="hint">Changing costs 5 influence</span></div>
                  <div className="seg">
                    {p.options.map((o) => (
                      <Tip key={o.id} style={{ flex: 1 }} content={<PolicyTip o={o} colonies={st.colonies} />}>
                        <button style={{ width: '100%' }} className={cls(e.policies[p.id] === o.id && 'on')} onClick={() => ui.cmd({ type: 'setPolicy', policy: p.id, option: o.id })}>{o.label}</button>
                      </Tip>
                    ))}
                  </div>
                </div>
              ))}
            </Section>
          ))}
          <Section title="Active effects">
            <div className="kv">
              {Object.entries(mods).filter(([, v]) => Math.abs(v) > 0.001).sort().map(([k, v]) => [
                <span key={k}>{modLabel(k)}</span>,
                <span key={k + 'v'} className={v >= 0 === !NEGATIVE_GOOD.has(k) ? 'pos' : 'neg'}>{Math.abs(v) < 1.5 && !INTEGER_MODS.has(k) ? `${v > 0 ? '+' : ''}${Math.round(v * 100)}%` : signed(v, 0)}</span>,
              ])}
            </div>
            {e.timedMods.length > 0 && <div style={{ marginTop: 8 }}>{e.timedMods.map((t, i) => <div key={i} className="hint">{t.label}: {Math.ceil((t.until - g.tick) / 30)} months remaining</div>)}</div>}
          </Section>
        </div>
      </div>
    </Sheet>
  );
}

const INTEGER_MODS = new Set(['stability', 'admin', 'navalCap', 'diploOpinion', 'acceptance', 'intel', 'sensor']);
const NEGATIVE_GOOD = new Set(['buildCost', 'shipCost', 'upkeepShips', 'upkeepBuildings', 'claimCost', 'colonyCost', 'marketFee', 'supplyDrain', 'foodUpkeep', 'warExhaustion']);

export function modLabel(k: string): string {
  const map: Record<string, string> = {
    stability: 'Stability', admin: 'Admin capacity', navalCap: 'Naval capacity', tax: 'Taxes', tradeValue: 'Trade value', growth: 'Population growth',
    buildSpeed: 'Construction speed', buildCost: 'Construction cost', shipBuildSpeed: 'Shipbuilding speed', shipCost: 'Ship cost', shipDamage: 'Weapon damage',
    shipHull: 'Ship hull', shipArmor: 'Ship armour', shipShields: 'Ship shields', shipSpeed: 'Fleet speed', tracking: 'Weapon tracking', evasion: 'Evasion',
    strikeDamage: 'Strike craft damage', upkeepShips: 'Fleet upkeep', upkeepBuildings: 'Building upkeep', garrison: 'Garrisons', defensePlatform: 'Defence batteries',
    starbase: 'Starbases', habitability: 'Habitability', claimCost: 'Outpost cost', colonyCost: 'Colony ship cost', colonizeSpeed: 'Colonisation speed',
    marketFee: 'Market fees', supplyDrain: 'Supply drain', repair: 'Repair rate', sensor: 'Sensor range', intel: 'Intelligence', diploOpinion: 'Opinion abroad',
    acceptance: 'Diplomatic acceptance', foodUpkeep: 'Food consumption', warExhaustion: 'War exhaustion gain', resistanceDecay: 'Pacification speed', storage: 'Storage',
  };
  if (k.startsWith('output.')) return `${k.slice(7)[0].toUpperCase()}${k.slice(8)} output`;
  return map[k] ?? k;
}

function PolicyTip({ o, colonies }: { o: PolicyOption; colonies: number }) {
  const cost: Record<string, number> = {};
  for (const [k, v] of Object.entries(o.costPerColony ?? {})) cost[k] = (cost[k] ?? 0) + (v as number) * colonies;
  for (const [k, v] of Object.entries(o.costFlat ?? {})) cost[k] = (cost[k] ?? 0) + (v as number);
  return (
    <div>
      <h4>{o.label}</h4>
      <div>{o.description}</div>
      {Object.keys(cost).length > 0 && <div style={{ marginTop: 4 }}>Monthly cost at your size: <CostView cost={cost} showShort={false} /></div>}
    </div>
  );
}
