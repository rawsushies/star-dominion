import { useEffect, useRef, useState } from 'react';
import { Term } from '../components/Guidance';
import { HeroView3D } from '../render/hero3d';
import { useUI, useGame } from '../store';
import {
  charactersOf, captivesHeldBy, rosterLimit, effectiveAttrs, effectiveness, loyaltyTarget, ambitionMet, salary, xpForLevel,
  canLearn, canAssign, describeAssignment, recruitCost, recruitChance, ransomPrice, MAX_LEVEL,
} from '../../sim/characters';
import { ROLES, ROLE_ORDER, ATTRS, ATTR_LABEL, TRAIT_BY_ID, SKILLS, AMBITIONS, ITEMS, ITEM_BY_ID, type EquipSlot } from '../../sim/data/characters';
import { COUNCIL_SEATS } from '../../sim/data/council';
import { hasContact } from '../../sim/diplomacy';
import { formatDate } from '../../sim/util';
import { Sheet, Section, Meter, CostView, cls } from '../components/common';
import type { CharAssignment, Character, GameState } from '../../sim/types';

type Tab = 'service' | 'candidates' | 'prisoners';

function HeroFigure({ c, color }: { c: Character; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const view = useRef<HeroView3D | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const v = new HeroView3D(ref.current);
    view.current = v;
    return () => { v.dispose(); view.current = null; };
  }, []);
  useEffect(() => { view.current?.show(c, color); });
  return <canvas ref={ref} className="hero-figure" data-testid="hero-figure" aria-label={`Portrait of ${c.name}`} />;
}
const SLOTS: EquipSlot[] = ['weapon', 'armour', 'instrument', 'relic'];

/** Monogram crest: realm colour ring, role glyph, initials. */
export function Crest({ c, g, size = 56 }: { c: Character; g: GameState; size?: number }) {
  const col = g.empires[c.ownerId]?.color ?? '#888';
  const ini = c.name.split(' ').map((w) => w[0]).join('').slice(0, 2);
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden style={{ flex: 'none' }}>
      <path d="M28 3 L51 12 V30 C51 42 40 50 28 54 C16 50 5 42 5 30 V12 Z" fill="rgba(0,0,0,.35)" stroke={col} strokeWidth="1.6" />
      <path d="M28 8 L46 15 V30 C46 39 38 46 28 49 C18 46 10 39 10 30 V15 Z" fill="none" stroke={col} strokeOpacity=".35" />
      <text x="28" y="34" textAnchor="middle" fontSize="17" fontFamily="var(--serif, serif)" fill="var(--vellum, #eee)" fontWeight="600">{ini}</text>
      <text x="28" y="45" textAnchor="middle" fontSize="6.5" fill={col} letterSpacing=".5">{ROLES[c.role].label.toUpperCase()}</text>
    </svg>
  );
}

function assignmentOptions(g: GameState, c: Character): { label: string; a: CharAssignment }[] {
  const out: { label: string; a: CharAssignment }[] = [];
  const me = c.ownerId;
  for (const f of Object.values(g.fleets)) if (f.ownerId === me) out.push({ label: `Fleet: ${f.name}`, a: { kind: 'fleet', fleetId: f.id } });
  const secs = new Set<number>();
  for (const s of g.galaxy.systems) if (s.owner === me && s.sector != null) secs.add(s.sector);
  for (const id of secs) out.push({ label: `Province: ${g.galaxy.sectors?.[id]?.name ?? 'Sector ' + id}`, a: { kind: 'province', sectorId: id } });
  for (const p of g.planets) if (p.colony?.ownerId === me) out.push({ label: `World: ${p.name}`, a: { kind: 'planet', planetId: p.id } });
  for (const t of g.empires) if (t.alive && t.id !== me && (t.kind === 'major' || t.kind === 'minor') && hasContact(g, me, t.id)) out.push({ label: `Envoy to the ${t.name}`, a: { kind: 'envoy', empireId: t.id } });
  for (const s of COUNCIL_SEATS) out.push({ label: `Council: ${s.label}`, a: { kind: 'council', seat: s.id } });
  return out.filter((o) => !canAssign(g, c, o.a));
}

export function HeroesScreen() {
  const g = useGame();
  const me = g.empires[g.playerId];
  const [tab, setTab] = useState<Tab>('service');
  const [role, setRole] = useState<string>('all');
  const [selId, setSel] = useState<number | null>(null);
  const service = charactersOf(g, g.playerId);
  const candidates = g.characters.filter((c) => c.ownerId === g.playerId && c.status === 'candidate');
  const held = captivesHeldBy(g, g.playerId);
  const ours = g.characters.filter((c) => c.status === 'captive' && c.ownerId === g.playerId);
  const list = (tab === 'service' ? service : tab === 'candidates' ? candidates : [...held, ...ours]).filter((c) => role === 'all' || c.role === role);
  const sel = list.find((c) => c.id === selId) ?? list[0];
  const limit = rosterLimit(g, me);
  return (
    <Sheet title="Hall of Heroes" lede={`${service.length} of ${limit} places filled. The people of the realm lead its fleets, govern its provinces and sit on its council.`}
      actions={<div className="seg" data-guide="heroes-roster">
        <button className={cls(tab === 'service' && 'on')} onClick={() => setTab('service')}>In service ({service.length})</button>
        <button className={cls(tab === 'candidates' && 'on')} onClick={() => setTab('candidates')}>Candidates ({candidates.length})</button>
        <button className={cls(tab === 'prisoners' && 'on')} onClick={() => setTab('prisoners')}>Prisoners ({held.length + ours.length})</button>
      </div>}>
      <div className="cols side">
        <div style={{ alignSelf: 'start' }}>
          <div className="field">
            <select aria-label="Filter by role" value={role} onChange={(ev) => setRole(ev.target.value)}>
              <option value="all">All roles</option>
              {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLES[r].plural}</option>)}
            </select>
          </div>
          <div className="list" data-testid="hero-list">
            {list.map((c) => (
              <div key={c.id} className={cls('li', sel?.id === c.id && 'sel')} onClick={() => setSel(c.id)}>
                <Crest c={c} g={g} size={34} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row between"><span>{c.rarity && <span className={`relic-dot ${c.rarity}`} title={`${c.rarity[0].toUpperCase()}${c.rarity.slice(1)} hero from the Relic Vault`} />}{c.name}</span><span className="num">{c.level}</span></div>
                  <div className="hint">{ROLES[c.role].label} · {c.status === 'captive' ? (c.captorId === g.playerId ? `prisoner of yours, from the ${g.empires[c.ownerId]?.name}` : `held by the ${g.empires[c.captorId ?? 0]?.name}`) : c.status === 'candidate' ? 'seeks a post' : describeAssignment(g, c.assignment)}</div>
                </div>
                {c.skillPoints > 0 && c.status === 'active' && <span className="badge" title="Unspent skill points">{c.skillPoints}</span>}
              </div>
            ))}
            {!list.length && <div className="empty">{tab === 'candidates' ? 'No candidates this year. New ones arrive each new year.' : tab === 'prisoners' ? 'No prisoners on either side.' : 'Nobody in service. Recruit candidates to lead your fleets and provinces.'}</div>}
          </div>
          {tab === 'service' && <ArmoryPanel />}
        </div>
        {sel ? <HeroDetail c={sel} key={sel.id} /> : <div className="empty">Select a person.</div>}
      </div>
    </Sheet>
  );
}

function ArmoryPanel() {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const academy = me.capital?.buildings.military_academy?.level ?? 0;
  return (
    <Section title="Armoury" aside={`${me.armory?.length ?? 0} stored`}>
      {(me.armory ?? []).map((id, i) => <div key={i} className="hint">{ITEM_BY_ID[id]?.label}: {ITEM_BY_ID[id]?.description}</div>)}
      {academy < 1 ? <p className="hint">Build a Military Academy in the capital to commission equipment.</p> : (
        <div className="list" style={{ marginTop: 6 }}>
          {ITEMS.filter((it) => !it.findable).map((it) => (
            <div key={it.id} className="row between" style={{ padding: '2px 0' }}>
              <span title={it.description}>{it.label}</span>
              <span className="row"><CostView cost={it.cost} empire={me} /><button className="btn small" onClick={() => ui.cmd({ type: 'commissionItem', item: it.id })}>Commission</button></span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function HeroDetail({ c }: { c: Character }) {
  const g = useGame();
  const ui = useUI();
  const me = g.empires[g.playerId];
  const attrs = effectiveAttrs(c);
  const mine = c.ownerId === g.playerId && c.status === 'active';
  const opts = mine ? assignmentOptions(g, c) : [];
  const curKey = c.assignment ? JSON.stringify(c.assignment) : '';
  const skills = SKILLS.filter((s) => s.role === c.role);
  const target = loyaltyTarget(g, c);
  return (
    <div style={{ minWidth: 0 }} data-testid="hero-detail">
      <div className="hero-top">
        <HeroFigure c={c} color={g.empires[c.ownerId]?.color ?? '#888'} />
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <Crest c={c} g={g} size={48} />
            <div className="grow">
              <h2 className="serif" style={{ margin: 0 }}>{c.rarity && <span className={`relic-dot ${c.rarity}`} />}{c.name}</h2>
              <div className="muted"><Term entry={`role.${c.role}`}>{ROLES[c.role].label}</Term>, level {c.level} of {MAX_LEVEL}. {ROLES[c.role].serves}.</div>
            </div>
          </div>
          <div className="hint" style={{ marginTop: 4 }}>{ROLES[c.role].description}{c.houseId != null && g.empires[c.ownerId]?.houses?.find((h) => h.id === c.houseId) ? ` Of House ${g.empires[c.ownerId].houses!.find((h) => h.id === c.houseId)!.name}.` : ''}</div>
          <div style={{ marginTop: 10 }}>
            <div className="row between hint"><span>Level {c.level}</span><span>{c.level < MAX_LEVEL ? `${Math.round(c.xp)} / ${xpForLevel(c.level)} experience` : 'Mastered'}</span></div>
            <Meter value={c.level < MAX_LEVEL ? c.xp : 1} max={c.level < MAX_LEVEL ? xpForLevel(c.level) : 1} />
          </div>
          <div className="stat-strip" style={{ marginTop: 10 }}>
            <div className="stat"><div className="k">Loyalty</div><div className={cls('v', c.loyalty < 30 && 'neg')}>{Math.round(c.loyalty)}</div><div className="s">trending to {Math.round(target)}</div></div>
            <div className="stat"><div className="k">Effectiveness</div><div className="v">{Math.round(effectiveness(c) * 100)}%</div><div className="s">falls with low loyalty</div></div>
            <div className="stat"><div className="k">Pay</div><div className="v">{salary(c).toFixed(1)}</div><div className="s">credits a month</div></div>
            <div className="stat"><div className="k">Ambition</div><div className="v" style={{ fontSize: 18 }}>{AMBITIONS[c.ambition.kind].label}</div><div className="s">{ambitionMet(g, c) ? 'Satisfied' : AMBITIONS[c.ambition.kind].want}</div></div>
          </div>
          <div className="slots">
            {SLOTS.map((sl) => <div key={sl} className={cls('slot-box', c.equipment[sl] && 'on')} title={c.equipment[sl] ? `${ITEM_BY_ID[c.equipment[sl]!]?.label}: ${ITEM_BY_ID[c.equipment[sl]!]?.description}` : `${sl}: empty`}><span>{sl}</span><b>{c.equipment[sl] ? ITEM_BY_ID[c.equipment[sl]!]?.label : 'Empty'}</b></div>)}
          </div>
        </div>
      </div>

      <div className="row wrap" style={{ marginTop: 8, gap: 8 }}>
        {c.status === 'candidate' && c.ownerId === g.playerId && <><button className="btn primary" onClick={() => ui.cmd({ type: 'recruitCharacter', charId: c.id })}>Recruit</button><CostView cost={recruitCost(c)} empire={me} /></>}
        {c.status === 'captive' && c.captorId === g.playerId && <>
          <button className="btn" onClick={() => ui.cmd({ type: 'captive', charId: c.id, action: 'recruit' })} title="Costs 25 influence">Offer service ({Math.round(recruitChance(g, c) * 100)}% chance)</button>
          <button className="btn" onClick={() => ui.cmd({ type: 'captive', charId: c.id, action: 'ransom' })}>Demand ransom ({ransomPrice(c)} credits)</button>
          <button className="btn" onClick={() => ui.cmd({ type: 'captive', charId: c.id, action: 'pardon' })}>Pardon and release</button>
        </>}
        {c.status === 'captive' && c.ownerId === g.playerId && <button className="btn" onClick={() => ui.cmd({ type: 'payRansom', charId: c.id })}>Pay ransom ({ransomPrice(c)} credits)</button>}
        {mine && <button className="btn danger" onClick={() => { if (confirm(`Dismiss ${c.name}? They leave your service for good.`)) ui.cmd({ type: 'dismissCharacter', charId: c.id }); }}>Dismiss</button>}
      </div>

      <div className="cols c2" style={{ marginTop: 4 }}>
        <div>
          <Section title="Attributes">
            <div className="kv">
              {ATTRS.map((a) => [<span key={a} className={cls(ROLES[c.role].primary.includes(a) && 'strong')}>{ATTR_LABEL[a]}</span>, <span key={a + 'v'} className="row" style={{ gap: 6 }}><span style={{ width: 90 }}><Meter value={attrs[a]} max={20} /></span><span className="num">{attrs[a]}</span></span>])}
            </div>
          </Section>
          <Section title="Traits">
            {c.traits.length ? c.traits.map((t) => <div key={t}><span className={TRAIT_BY_ID[t]?.good ? 'pos' : 'neg'}>{TRAIT_BY_ID[t]?.label ?? t}</span> <span className="hint">{TRAIT_BY_ID[t]?.description}</span></div>) : <span className="hint">No notable traits.</span>}
          </Section>
          {mine && (
            <Section title="Post">
              <div className="field">
                <select aria-label="Assignment" value={curKey} onChange={(ev) => ui.cmd({ type: 'assignCharacter', charId: c.id, assignment: ev.target.value ? JSON.parse(ev.target.value) : null })}>
                  <option value="">Unassigned</option>
                  {c.assignment && !opts.some((o) => JSON.stringify(o.a) === curKey) && <option value={curKey}>{describeAssignment(g, c.assignment)}</option>}
                  {opts.map((o) => <option key={JSON.stringify(o.a)} value={JSON.stringify(o.a)}>{o.label}</option>)}
                </select>
              </div>
              <p className="hint">{ROLES[c.role].serves}. Assigning someone to an occupied post replaces the holder.</p>
            </Section>
          )}
          {mine && (
            <Section title="Equipment">
              <div className="kv">
                {SLOTS.map((s) => {
                  const cur = c.equipment[s];
                  const avail = [...new Set((me.armory ?? []).filter((id) => ITEM_BY_ID[id]?.slot === s))];
                  return [<span key={s}>{s[0].toUpperCase() + s.slice(1)}</span>, <span key={s + 'v'}>
                    {cur ? <>{ITEM_BY_ID[cur]?.label} <button className="btn small" onClick={() => ui.cmd({ type: 'unequipItem', charId: c.id, slot: s })}>Remove</button></>
                      : avail.length ? <select aria-label={`Equip ${s}`} value="" onChange={(ev) => ev.target.value && ui.cmd({ type: 'equipItem', charId: c.id, item: ev.target.value })}><option value="">Empty. Equip…</option>{avail.map((id) => <option key={id} value={id}>{ITEM_BY_ID[id].label}</option>)}</select>
                      : <span className="faint">Empty</span>}
                  </span>];
                })}
              </div>
            </Section>
          )}
        </div>
        <div>
          <Section title="Skills" aside={c.skillPoints ? `${c.skillPoints} point${c.skillPoints > 1 ? 's' : ''} to spend` : undefined}>
            {skills.map((s) => {
              const rank = c.skills[s.id] ?? 0;
              const why = mine ? canLearn(c, s.id) : 'n/a';
              return (
                <div key={s.id} className="row between" style={{ padding: '3px 0', gap: 8 }}>
                  <div className="grow">
                    <div>{s.label} <span className="faint">tier {s.tier} · {rank}/{s.maxRank}</span></div>
                    <div className="hint">{s.description}</div>
                  </div>
                  {mine && <button className="btn small" disabled={!!why} title={why ?? 'Spend a skill point'} onClick={() => ui.cmd({ type: 'learnSkill', charId: c.id, skill: s.id })}>Learn</button>}
                </div>
              );
            })}
          </Section>
          <Section title="Service record">
            <div className="kv">
              <span>Battles won</span><span>{c.record.battlesWon}</span>
              <span>Battles lost</span><span>{c.record.battlesLost}</span>
              <span>Worlds taken</span><span>{c.record.worldsTaken}</span>
              <span>Months served</span><span>{c.record.monthsServed}</span>
            </div>
          </Section>
          <Section title="History">
            <div style={{ maxHeight: 200, overflow: 'auto' }}>
              {c.bio.slice().reverse().map((b, i) => <div key={i} className="row" style={{ gap: 8, alignItems: 'flex-start' }}><span className="num faint" style={{ width: 82, flex: 'none' }}>{formatDate(b.tick)}</span><span className="muted" style={{ fontSize: 12.5 }}>{b.text}</span></div>)}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
