import { useEffect, useRef } from 'react';
import { Term } from '../components/Guidance';
import { useUI, useGame, type ScreenId } from '../store';
import { getLedger } from '../../sim/engine';
import { GOVERNMENTS } from '../../sim/data/governments';
import { ERAS } from '../../sim/data/eras';
import { kardashevType, formatWatts } from '../../sim/power';
import { charactersOf, captivesHeldBy } from '../../sim/characters';
import { inRevolt } from '../../sim/governance';
import { opsOf, opReport } from '../../sim/operations';
import { empireMods } from '../../sim/modifiers';
import { supplyNetwork } from '../../sim/territory';
import { CITADEL_MAX } from '../../sim/data/capital';
import { rulerAge, heirOf, HEIR_COST } from '../../sim/succession';
import { ROLES } from '../../sim/data/characters';
import { HeroView3D } from '../render/hero3d';
import { ScreenIcon } from '../components/icons';
import { Sheet, Section, fmt, cls } from '../components/common';
import type { Character, GameState } from '../../sim/types';
import { victoryProgress, VICTORY_LABEL, type VictoryKind } from '../../sim/victory';
import { ambitionList, phaseOf, PHASE_LABEL } from '../../sim/ambitions';
import { intelLevel } from '../../sim/diplomacy';

interface Matter { text: string; screen: ScreenId; tone: 'danger' | 'warn' | 'info' }

/** Everything in the realm that is waiting on the sovereign, most urgent first. */
export function pendingMatters(g: GameState): Matter[] {
  const e = g.empires[g.playerId];
  const L = getLedger(g, e);
  const out: Matter[] = [];
  const wars = g.wars.filter((w) => w.attackers.includes(e.id) || w.defenders.includes(e.id));
  for (const w of wars) out.push({ text: `${w.name}: war score ${Math.round(w.attackers.includes(e.id) ? w.score : -w.score)}`, screen: 'warroom', tone: 'danger' });
  // rivals visibly massing against us (the same intelligence that sends the warning dispatch)
  for (const r of g.empires) if (r.alive && r.aiPlan?.goal === 'arm' && r.aiPlan.target === e.id && intelLevel(g, e.id, r.id) >= 30) out.push({ text: `${r.name} is arming against us`, screen: 'diplomacy', tone: 'danger' });
  for (const r of g.empires) if (r.alive && r.kind === 'major' && r.id !== e.id && r.dominationSince != null) out.push({ text: `${r.name} holds a dominion: ${Math.max(0, 24 - Math.floor((g.tick - r.dominationSince) / 30))} months until they win`, screen: 'throne', tone: 'danger' });
  for (const r of L.shortages) out.push({ text: `Shortage of ${r}`, screen: 'economy', tone: 'danger' });
  for (const h of e.houses ?? []) if (inRevolt(g, h)) out.push({ text: `House ${h.name} is in revolt`, screen: 'council', tone: 'danger' });
  if (e.petitions?.length) out.push({ text: `${e.petitions.length} ${e.petitions.length === 1 ? 'matter awaits' : 'matters await'} the council`, screen: 'council', tone: 'warn' });
  for (const h of e.houses ?? []) if (!inRevolt(g, h) && h.loyalty < 30) out.push({ text: `House ${h.name} is close to revolt (loyalty ${Math.round(h.loyalty)})`, screen: 'council', tone: 'warn' });
  const pts = charactersOf(g, e.id).filter((c) => c.skillPoints > 0).length;
  if (pts) out.push({ text: `${pts} of your people have skill points to spend`, screen: 'heroes', tone: 'info' });
  const idle = charactersOf(g, e.id).filter((c) => !c.assignment).length;
  if (idle) out.push({ text: `${idle} of your people have no post`, screen: 'heroes', tone: 'info' });
  const caps = captivesHeldBy(g, e.id).length;
  if (caps) out.push({ text: `${caps} prisoners await your judgement`, screen: 'heroes', tone: 'info' });
  const mods = empireMods(g, e), net = supplyNetwork(g, e.id);
  const stuck = opsOf(g, e.id).filter((p) => ['blockaded', 'cut off'].includes(opReport(g, e, p, mods, { network: net, logisticsEff: 1 }).status)).length;
  if (stuck) out.push({ text: `${stuck} resource operations cannot deliver`, screen: 'operations', tone: 'warn' });
  if (L.logisticsUsed > L.logisticsCap) out.push({ text: `Freighters overstretched (${L.logisticsUsed}/${L.logisticsCap})`, screen: 'operations', tone: 'warn' });
  if (e.capital && !e.capital.queue.length) out.push({ text: 'The capital\'s builders are idle', screen: 'capital', tone: 'info' });
  if (!e.research.current) out.push({ text: 'No research under way', screen: 'research', tone: 'warn' });
  if (rulerAge(g, e) >= 50 && !heirOf(g, e)) out.push({ text: `No heir is named, and ${e.ruler} is ${rulerAge(g, e)}`, screen: 'throne', tone: rulerAge(g, e) >= 60 ? 'danger' : 'warn' });
  if (L.adminUsed > L.adminCap) out.push({ text: `Administrative overreach (${L.adminUsed}/${L.adminCap} systems)`, screen: 'council', tone: 'warn' });
  return out;
}

const MINISTRIES: { id: ScreenId; label: string }[] = [
  { id: 'council', label: 'Royal council' }, { id: 'capital', label: 'Imperial capital' }, { id: 'heroes', label: 'Hall of Heroes' },
  { id: 'warroom', label: 'War room' }, { id: 'diplomacy', label: 'Diplomacy' }, { id: 'kingdom', label: 'Empire overview' },
  { id: 'operations', label: 'Resource operations' }, { id: 'economy', label: 'Treasury and economy' }, { id: 'chronicle', label: 'Chronicle' },
];

function RulerFigure({ g }: { g: GameState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const e = g.empires[g.playerId];
  useEffect(() => {
    const v = new HeroView3D(ref.current!);
    // the sovereign is not a roster character; present them in noble dress
    const ruler = { id: e.id * 7 + e.emblem, role: 'governor', level: 20, equipment: {}, traits: [], name: e.ruler } as unknown as Character;
    v.showArchetype('sovereign', e.id * 7 + e.emblem + (e.rulerBorn ?? 0), e.color, ruler);
    return () => v.dispose();
  }, [e.id, e.color, e.emblem, e.ruler, e.rulerBorn]);
  return <canvas ref={ref} className="hero-figure" style={{ height: 420 }} aria-label={`Portrait of ${e.ruler}`} />;
}

/** The sovereign's age and reign, the named heir, and naming a new one. */
function Succession() {
  const g = useGame();
  const ui = useUI();
  const e = g.empires[g.playerId];
  const heir = heirOf(g, e);
  const people = charactersOf(g, e.id).filter((c) => c.status === 'active');
  const reign = Math.floor((g.tick - (e.reignStart ?? 0)) / 360);
  return (
    <Section guide="throne-succession" title={<Term entry="mech.succession">Succession</Term>} aside={`${e.ruler}, aged ${rulerAge(g, e)} · reigning ${reign} ${reign === 1 ? 'year' : 'years'}`}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }} data-testid="succession">
        <span>{heir ? <>Heir: <b>{heir.name}</b> <span className="hint">({ROLES[heir.role].label}, level {heir.level})</span></> : <span className="warn">No heir is named. If the throne falls empty, the great houses will fight over it.</span>}</span>
        <select className="grow" aria-label="Name an heir" value={heir?.id ?? ''} onChange={(ev) => ui.cmd({ type: 'designateHeir', charId: ev.target.value === '' ? null : Number(ev.target.value) })} style={{ maxWidth: 260 }}>
          <option value="">{heir ? 'Revoke the heir' : 'Name an heir…'}</option>
          {people.map((c) => <option key={c.id} value={c.id}>{c.name} · {ROLES[c.role].label} {c.level}</option>)}
        </select>
        <span className="hint">Naming an heir costs {HEIR_COST} influence.</span>
      </div>
    </Section>
  );
}

const VICTORY_HOW: Record<VictoryKind, string> = {
  domination: 'Hold half of all claimed systems and two fifths of all people, then keep it for two years.',
  supremacy: 'Leave no rival great realm independent for a year: destroy them, make them vassals in peace terms, or press weak neighbours to swear fealty (Diplomacy, Demand vassalage). A vassal\'s land does not count toward Domination, so this is the road of subjugation, not annexation. Keep your vassals content, or they rise when you look weak.',
  ascension: 'Advance through the eras to Omega Sovereignty: research, power, great works and the Continuum Engine.',
};

/** How close the realm, and the most advanced rival we know of, are to each victory. */
function RoadsToVictory({ g }: { g: GameState }) {
  const e = g.empires[g.playerId];
  const mine = victoryProgress(g, e);
  const rivals = g.empires.filter((x) => x.alive && x.kind === 'major' && x.id !== e.id && intelLevel(g, e.id, x.id) > 0);
  return (
    <Section guide="throne-victory" title="Roads to victory" aside="Any great realm can win; a rival's victory ends your reign">
      <div className="list" data-testid="victory">
        {mine.map((v) => {
          let lead: { name: string; p: number } | null = null;
          for (const r of rivals) { const p = victoryProgress(g, r).find((x) => x.kind === v.kind)!.progress; if (!lead || p > lead.p) lead = { name: r.name, p }; }
          return (
            <div key={v.kind} className="li" style={{ display: 'block' }} title={VICTORY_HOW[v.kind]}>
              <div className="row between"><b>{VICTORY_LABEL[v.kind]}</b><span className="hint">{Math.round(v.progress * 100)}%{lead ? ` · leading rival: ${lead.name} ${Math.round(lead.p * 100)}%` : ''}</span></div>
              <div className="meter v" style={{ margin: '4px 0' }}><i style={{ width: `${v.progress * 100}%` }} /></div>
              {lead && <div className="meter" style={{ marginBottom: 4 }}><i style={{ width: `${lead.p * 100}%`, background: 'var(--bad)' }} /></div>}
              <div className="hint">{v.detail}. {VICTORY_HOW[v.kind]}</div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** Optional milestones for the current phase of the reign. */
function Ambitions({ g }: { g: GameState }) {
  const e = g.empires[g.playerId];
  const phase = phaseOf(e);
  const list = ambitionList(g, e);
  const now = list.filter((a) => a.def.phase === phase);
  const done = list.filter((a) => a.done).length;
  return (
    <Section title="Ambitions" aside={`${PHASE_LABEL[phase]} · ${done} of ${list.length} fulfilled`}>
      <p className="hint" style={{ margin: '0 0 6px' }}>Optional goals for this stage of your reign. Pursue any of them, or none; each pays a modest reward when met.</p>
      <div className="list" data-testid="ambitions">
        {now.map((a) => (
          <div key={a.def.id} className="li" style={{ display: 'block', opacity: a.done ? 0.6 : 1 }}>
            <div className="row between"><span><span className={cls('sev', a.done ? 'good' : 'info')} /> <b>{a.def.title}</b></span><span className="hint">{a.done ? 'Fulfilled' : `${fmt(a.have)} / ${fmt(a.need)}`}</span></div>
            {!a.done && <div className="meter" style={{ margin: '4px 0' }}><i style={{ width: `${a.frac * 100}%` }} /></div>}
            <div className="hint">{a.def.how} Reward: {a.def.rewardText}.</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function ThroneScreen() {
  const g = useGame();
  const ui = useUI();
  const e = g.empires[g.playerId];
  const st = e.stats;
  const kt = kardashevType(st.kardashev ?? 0);
  const matters = pendingMatters(g);
  const rank = g.empires.filter((x) => x.alive && x.kind === 'major').sort((a, b) => (b.stats.kardashev ?? 0) - (a.stats.kardashev ?? 0)).findIndex((x) => x.id === e.id) + 1;
  return (
    <Sheet title="Throne room" lede={`${e.ruler} of the ${e.name}. ${GOVERNMENTS[e.government].label}, ${ERAS[e.era ?? 0]?.name ?? ''}.`}>
      <div className="hero-top">
        <RulerFigure g={g} />
        <div style={{ minWidth: 0 }}>
          <div className="stat-strip">
            <div className="stat"><div className="k">Kardashev</div><div className="v">{(st.kardashev ?? 0).toFixed(2)}</div><div className="s">{kt.label}{kt.speculative ? ' (speculative)' : ''} · {formatWatts(st.powerW ?? 0)}</div></div>
            <div className="stat"><div className="k">Standing</div><div className="v">{rank ? `#${rank}` : '—'}</div><div className="s">among the great realms</div></div>
            <div className="stat"><div className="k">Population</div><div className="v">{fmt(st.population, 1)}</div><div className="s">{st.colonies} worlds, {st.systems} systems</div></div>
            <div className="stat"><div className="k">Military</div><div className="v">{fmt(st.militaryPower)}</div><div className="s">fleet strength</div></div>
            <div className="stat"><div className="k">Citadel</div><div className="v">{e.capital?.buildings.citadel?.level ?? 0}</div><div className="s">of {CITADEL_MAX}</div></div>
          </div>
          <Section title="Awaiting your word" aside={matters.length ? `${matters.length}` : 'Nothing pressing'}>
            <div className="list" data-testid="matters">
              {matters.map((m, i) => (
                <div key={i} className="li" onClick={() => ui.openScreen(m.screen)}>
                  <span className={cls('sev', m.tone)} />
                  <span className="grow">{m.text}</span>
                  <span className="hint">Open</span>
                </div>
              ))}
              {!matters.length && <div className="empty">The realm is quiet. Your ministers have nothing to put before you.</div>}
            </div>
          </Section>
          <RoadsToVictory g={g} />
          <Ambitions g={g} />
          <Succession />
          <Section title="Ministries">
            <div className="ministries">
              {MINISTRIES.map((m) => (
                <button key={m.id} className="btn ministry" onClick={() => ui.openScreen(m.id)}><ScreenIcon id={m.id} size={22} /><span>{m.label}</span></button>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </Sheet>
  );
}
