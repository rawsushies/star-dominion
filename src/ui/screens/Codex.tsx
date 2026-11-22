// The Imperial Codex window: guided lessons, the encyclopedia and guidance and audio settings.

import { useMemo, useState } from 'react';
import { useUI, useGame } from '../store';
import { Sheet, Section, cls } from '../components/common';
import { usePrefs } from '../components/Guidance';
import { CHAPTERS } from '../../guidance/chapters';
import { chapterStatus, resetGuidance, startLesson, type ChapterStatus } from '../../guidance/lessons';
import { guidanceOf, setGuidancePrefs } from '../../guidance/state';
import { CODEX_CATS, codexEntry, searchCodex, type CodexCat, type CodexEntry } from '../../guidance/codex';
import { NAV } from '../components/Chrome';
import { AudioSettings } from '../components/AudioSettings';
import { GraphicsSettings } from '../components/GraphicsSettings';

export function CodexScreen() {
  const ui = useUI();
  const tab = ui.codexTab;
  return (
    <Sheet title="Imperial Codex" lede="Lessons that teach the game by playing it, a reference for every mechanic, and your guidance and sound settings."
      actions={<div className="seg" role="tablist">
        {(['lessons', 'encyclopedia', 'settings'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={cls(tab === t && 'on')} onClick={() => ui.set({ codexTab: t })}>{t === 'lessons' ? 'Lessons' : t === 'encyclopedia' ? 'Encyclopedia' : 'Settings'}</button>
        ))}
      </div>}>
      {tab === 'lessons' && <Lessons />}
      {tab === 'encyclopedia' && <Encyclopedia />}
      {tab === 'settings' && <Settings />}
    </Sheet>
  );
}

const STATUS_LABEL: Record<ChapterStatus, string> = { done: 'Completed', active: 'In progress', available: 'Available', locked: 'Not yet recommended', skipped: 'Left unfinished' };

function Lessons() {
  const g = useGame();
  const ui = useUI();
  const s = guidanceOf(g);
  return (
    <Section title="Guided lessons" aside={`${s.done.length} of ${CHAPTERS.length} completed`}>
      <div className="lesson-list" data-testid="lesson-list">
        {CHAPTERS.map((c) => {
          const st = chapterStatus(g, c);
          return (
            <div key={c.id} className={cls('lesson-li', st)}>
              <span className="lesson-num num">{c.n}</span>
              <div className="grow">
                <div className="row" style={{ gap: 8 }}><b>{c.title}</b><span className={cls('tag', st === 'done' && 'good', st === 'active' && 'gold')}>{STATUS_LABEL[st]}</span></div>
                <div className="hint">{c.brief} {c.steps.length} steps.{st === 'locked' ? ` Recommended: ${c.unlockText.toLowerCase()}` : ''}</div>
              </div>
              {st === 'active'
                ? <button className="btn small" onClick={() => { s.paused = false; ui.bump(); }}>Resume</button>
                : <button className={cls('btn small', st === 'available' && 'primary')} onClick={() => { startLesson(g, c.id); ui.bump(); }}>{st === 'done' ? 'Replay' : st === 'skipped' ? 'Restart' : 'Start'}</button>}
            </div>
          );
        })}
      </div>
      <p className="hint" style={{ marginTop: 10 }}>Lessons never pause the game for you and never take control. Each step names one thing to do and ticks itself when you have done it. You can skip a step, pause the lesson (it shrinks to a bar you can reopen) or leave it and come back here later. Progress is saved with your game.</p>
    </Section>
  );
}

function Encyclopedia() {
  const ui = useUI();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<CodexCat | null>(null);
  const results = useMemo(() => searchCodex(q, cat), [q, cat]);
  const sel = ui.codexEntry ? codexEntry(ui.codexEntry) : null;
  const open = (id: string) => ui.set({ codexEntry: id });
  const groups = useMemo(() => {
    const m = new Map<string, CodexEntry[]>();
    for (const e of results) { const k = e.group ?? 'Mechanics'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(e); }
    return [...m.entries()].sort((a, b) => (a[0] === 'Mechanics' ? -1 : b[0] === 'Mechanics' ? 1 : 0));
  }, [results]);
  return (
    <div className="codex">
      <div className="codex-nav">
        <input className="codex-search" type="search" placeholder="Search the Codex" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the Codex" />
        <div className="codex-cats">
          <button className={cls(!cat && 'on')} onClick={() => setCat(null)}>All topics</button>
          {CODEX_CATS.map((c) => <button key={c.id} className={cls(cat === c.id && 'on')} onClick={() => setCat(cat === c.id ? null : c.id)}>{c.label}</button>)}
        </div>
        <div className="codex-results" data-testid="codex-results">
          {!results.length && <div className="empty">Nothing matches “{q}”. Try a shorter word, or clear the topic filter.</div>}
          {groups.map(([gname, list]) => (
            <div key={gname}>
              <div className="codex-group">{gname} <span className="hint">{list.length}</span></div>
              {list.slice(0, gname === 'Mechanics' ? 80 : 40).map((e) => (
                <button key={e.id} className={cls('codex-li', sel?.id === e.id && 'on')} onClick={() => open(e.id)}>{e.title}</button>
              ))}
              {list.length > 40 && gname !== 'Mechanics' && <div className="hint" style={{ padding: '2px 8px' }}>{list.length - 40} more: refine the search</div>}
            </div>
          ))}
        </div>
      </div>
      <div className="codex-entry" data-testid="codex-entry">
        {sel ? <Entry e={sel} open={open} /> : <CodexHome open={open} />}
      </div>
    </div>
  );
}

function CodexHome({ open }: { open: (id: string) => void }) {
  return (
    <div>
      <h2 className="codex-title">The reference of the realm</h2>
      <p>Every entry here describes the game as it is actually simulated. Figures for buildings, ships, technologies, eras, megastructures, capital works, roles, decrees and policies come straight from the game's data, so they match what you will pay and get.</p>
      <div className="codex-start">
        {['mech.sovereign', 'mech.resources', 'mech.planetBuild', 'mech.capital', 'mech.combat', 'mech.invasion', 'mech.eras', 'mech.kardashev', 'mech.diplomacy', 'mech.characters', 'mech.houses', 'mech.mega'].map((id) => {
          const e = codexEntry(id)!;
          return <button key={id} className="codex-card" onClick={() => open(id)}><b>{e.title}</b><span className="hint">{e.summary}</span></button>;
        })}
      </div>
    </div>
  );
}

function Entry({ e, open }: { e: CodexEntry; open: (id: string) => void }) {
  const ui = useUI();
  const catLabel = CODEX_CATS.find((c) => c.id === e.cat)?.label;
  const screenLabel = e.screen ? NAV.find((n) => n.id === e.screen)?.label : null;
  return (
    <article>
      <div className="hint">{catLabel}{e.group ? ` · ${e.group}` : ''}</div>
      <h2 className="codex-title">{e.title}</h2>
      {e.status === 'speculative' && <div className="tag gold" style={{ display: 'inline-block', marginBottom: 6 }}>Speculative fiction: beyond today's science, but fully playable</div>}
      {e.status === 'unavailable' && <div className="tag bad" style={{ display: 'inline-block', marginBottom: 6 }}>Not available in this version</div>}
      <p className="codex-summary">{e.summary}</p>
      {e.what && <><h4>What it is</h4><p>{e.what}</p></>}
      {e.does && <><h4>What it does</h4><p>{e.does}</p></>}
      {e.how && <><h4>How to use it</h4><p>{e.how}</p></>}
      {e.facts && e.facts.length > 0 && (
        <>
          <h4>{e.id.startsWith('mech.') || e.id.startsWith('cat.') ? 'Details' : 'Costs, requirements and effects'}</h4>
          <dl className="codex-facts">{e.facts.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        </>
      )}
      {e.strategy && <><h4>Strategy</h4><p>{e.strategy}</p></>}
      {e.related.length > 0 && (
        <>
          <h4>Related</h4>
          <div className="row wrap" style={{ gap: 6 }}>{e.related.map((r) => { const x = codexEntry(r); return x && x.id !== e.id ? <button key={r} className="btn small" onClick={() => open(r)}>{x.title}</button> : null; })}</div>
        </>
      )}
      <div className="row" style={{ gap: 6, marginTop: 14 }}>
        <button className="btn small" onClick={() => ui.set({ codexEntry: null })}>Codex home</button>
        {e.screen && screenLabel && <button className="btn small primary" onClick={() => ui.openScreen(e.screen!)}>Open {screenLabel}</button>}
      </div>
    </article>
  );
}

function Settings() {
  const g = useGame();
  const ui = useUI();
  const prefs = usePrefs();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="cols c2">
      <Section title="Guidance">
        <label className="row setting"><input type="checkbox" checked={prefs.lessons} onChange={(e) => setGuidancePrefs({ lessons: e.target.checked })} /> <span><b>Lessons and first-visit cards</b><span className="hint" style={{ display: 'block' }}>Offer the next lesson and explain each window the first time you open it.</span></span></label>
        <label className="row setting"><input type="checkbox" checked={prefs.hints} onChange={(e) => setGuidancePrefs({ hints: e.target.checked })} /> <span><b>Advisor hints</b><span className="hint" style={{ display: 'block' }}>Point out real problems: shortages, idle research, idle ships and builders, unassigned characters, threatened worlds.</span></span></label>
        <label className="row setting"><input type="checkbox" checked={prefs.tooltips} onChange={(e) => setGuidancePrefs({ tooltips: e.target.checked })} /> <span><b>Explanatory tooltips</b><span className="hint" style={{ display: 'block' }}>Explain terms, resources and controls when you hover them.</span></span></label>
        <div className="row" style={{ gap: 6, marginTop: 10 }}>
          <button className="btn small" onClick={() => setGuidancePrefs({ lessons: false, hints: false, tooltips: false })}>I know the game: turn all off</button>
          <button className="btn small" onClick={() => setGuidancePrefs({ lessons: true, hints: true, tooltips: true })}>Turn all on</button>
        </div>
        <div className="row" style={{ gap: 6, marginTop: 10 }}>
          {!confirm ? <button className="btn small danger" onClick={() => setConfirm(true)}>Reset lesson progress</button>
            : <><span className="hint">Forget completed lessons, seen cards and dismissed hints for this reign?</span><button className="btn small danger" onClick={() => { resetGuidance(g); setConfirm(false); ui.bump(); }}>Reset</button><button className="btn small" onClick={() => setConfirm(false)}>Keep</button></>}
        </div>
        <p className="hint">These preferences are kept in this browser. Lesson progress is saved with each game.</p>
      </Section>
      <Section title="Sound">
        <AudioSettings />
      </Section>
      <Section title="Graphics">
        <GraphicsSettings />
      </Section>
    </div>
  );
}
