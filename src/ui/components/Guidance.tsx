// Player guidance in the HUD: the lesson panel, the next-lesson offer, the advisor's hints,
// each window's information drawer and first-visit card, and Codex-backed tooltips. Guidance
// supports the player and never takes control: everything can be paused, dismissed or turned off.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useUI, useGame, onCommand, type ScreenId } from '../store';
import { cls, Tip } from './common';
import { focusSystem } from './MapView';
import { CHAPTERS, CHAPTER_BY_ID, type LessonStep } from '../../guidance/chapters';
import { activeChapter, activeStep, declineOffer, evaluateLesson, lessonCtx, nextStep, prevStep, recommendation, recordFlag, setPaused, skipLesson, startLesson, finishLesson } from '../../guidance/lessons';
import { guidanceOf, guidancePrefs, onPrefsChange } from '../../guidance/state';
import { currentHints, snoozeHint, reignGoal, type Hint } from '../../guidance/hints';
import { SCREEN_INFO } from '../../guidance/screens';
import { codexEntry } from '../../guidance/codex';
import { currentMoment, dismissMoment, type Moment } from '../../guidance/moments';
import { isSimple, setSimple, visibleScreens } from '../../guidance/path';
import { speakOnce } from '../../guidance/advisor';
import { AdvisorHead } from './Advisor';

export function usePrefs() {
  const [, setN] = useState(0);
  useEffect(() => onPrefsChange(() => setN((n) => n + 1)), []);
  return guidancePrefs();
}

// ---------------------------------------------------------------- controller

/** Records what the player does (for lesson objectives) and advances satisfied objectives. */
export function useGuidanceController() {
  useEffect(() => {
    const offCmd = onCommand((c, r) => {
      const g = useUI.getState().game;
      if (g && r.ok) recordFlag(g, `act:${c.type}`);
    });
    const offStore = useUI.subscribe((st, prev) => {
      const g = st.game;
      if (!g) return;
      if (st.speed > 0 && prev.speed === 0) recordFlag(g, 'ran');
      if (st.view === 'system' && prev.view !== 'system') recordFlag(g, 'view:system');
      if (st.systemId != null && st.systemId !== prev.systemId) recordFlag(g, 'sel:system');
      if (st.planetId != null && st.planetId !== prev.planetId) recordFlag(g, 'sel:planet');
      if (st.fleetId != null && st.fleetId !== prev.fleetId) recordFlag(g, 'sel:fleet');
      if (st.windows !== prev.windows) for (const w of st.windows) if (!prev.windows.some((p) => p.id === w.id)) recordFlag(g, `win:${w.id}`);
      if (st.view === 'capital' && prev.view !== 'capital') recordFlag(g, 'win:capital');
    });
    return () => { offCmd(); offStore(); };
  }, []);
  // objectives are checked a few times a second, whatever the game speed
  useEffect(() => {
    const id = setInterval(() => {
      const st = useUI.getState();
      if (st.game && evaluateLesson(st.game, st)) st.bump();
    }, 300);
    return () => clearInterval(id);
  }, []);
}

/** Highlight the step's control: the first selector that matches a visible element. */
function useHighlight(step: LessonStep | null, enabled: boolean) {
  const ui = useUI();
  useEffect(() => {
    if (!step?.target || !enabled) return;
    let el: Element | null = null;
    for (const sel of step.target) {
      const hit = findTarget(sel);
      if (hit && (hit as HTMLElement).offsetParent !== null) { el = hit; break; }
    }
    el?.classList.add('coach');
    return () => el?.classList.remove('coach');
  }, [step, enabled, ui.windows, ui.screen, ui.view, ui.rev]);
}

/** A CSS selector, or `text:<selector>|<text>`: the first visible match whose text contains <text>. */
function findTarget(sel: string): Element | null {
  if (!sel.startsWith('text:')) return document.querySelector(sel);
  const [css, text] = sel.slice(5).split('|');
  for (const el of document.querySelectorAll(css)) if ((el as HTMLElement).offsetParent !== null && el.textContent?.includes(text)) return el;
  return null;
}

// ---------------------------------------------------------------- lessons

export function GuidanceStack() {
  useGuidanceController();
  const ref = useRef<HTMLDivElement>(null);
  // the right column (selection and overview) ends above the stack, so the two never overlap
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--guide-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    const ro = new ResizeObserver(set);
    ro.observe(el);
    set();
    return () => { ro.disconnect(); root.style.setProperty('--guide-h', '0px'); };
  }, []);
  return (
    <div className="guide-stack" ref={ref}>
      <MomentCard />
      <HintCard />
      <LessonPanel />
    </div>
  );
}

function LessonPanel() {
  const g = useGame();
  const ui = useUI();
  const prefs = usePrefs();
  const s = guidanceOf(g);
  const chapter = activeChapter(g);
  const step = activeStep(g);
  useHighlight(step, !!chapter && !s.paused);
  const [note, setNote] = useState<{ step: LessonStep; text: string } | null>(null);
  const live = !!chapter && !!step && !s.paused;
  useEffect(() => { if (live && step?.voice) speakOnce(g, step.voice); }, [live, step]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!chapter || !step) return prefs.lessons ? <LessonOffer /> : null;
  const bump = () => ui.bump();
  if (s.paused) {
    return (
      <button className="lesson-pill glass" onClick={() => { setPaused(g, false); bump(); }} aria-label={`Resume lesson: ${chapter.title}`}>
        <span className="lesson-n">Lesson {chapter.n}</span> {chapter.title} <span className="hint">· step {s.step + 1} of {chapter.steps.length} · resume</span>
      </button>
    );
  }
  const ctx = lessonCtx(g, ui);
  const text = typeof step.text === 'function' ? step.text(ctx) : step.text;
  const last = s.step === chapter.steps.length - 1;
  const met = !!step.done?.(ctx);
  const goal = typeof step.goal === 'function' ? step.goal(ctx) : step.goal;
  const doIt = () => {
    const cmds = step.auto?.(g) ?? [];
    if (!cmds.length) { setNote({ step, text: 'There is nothing that can be done for this step right now.' }); return; }
    let ok = 0; let why = '';
    for (const c of cmds) { const r = ui.cmd(c); if (r.ok) ok++; else why ||= r.message ?? ''; if (step.autoFirst && r.ok) break; }
    setNote({ step, text: ok ? (step.autoFirst ? 'Done.' : `Done: ${ok} order${ok > 1 ? 's' : ''} given.`) + (why && !step.autoFirst ? ` Some could not be given: ${why}.` : '') : `It could not be done yet: ${why || 'not possible right now'}.` });
    bump();
  };
  return (
    <aside className="lesson glass" aria-live="polite" aria-label="Lesson">
      <div className="whead">
        <span className="wtitle">Lesson {chapter.n}: {chapter.title}</span>
        <span className="grow" />
        <button className="wbtn" onClick={() => { setPaused(g, true); bump(); }} aria-label="Pause the lesson" title="Pause the lesson">‖</button>
        <button className="wbtn" onClick={() => { skipLesson(g); bump(); }} aria-label="Leave the lesson" title="Leave the lesson (resume or replay it from the Codex)">×</button>
      </div>
      <div className="lesson-body">
        <div className="lesson-steps" aria-hidden>{chapter.steps.map((_, i) => <i key={i} className={i < s.step ? 'done' : i === s.step ? 'now' : ''} />)}</div>
        <AdvisorHead voice={step.voice} />
        <div className="lesson-title">{step.title}</div>
        <p>{text}</p>
        {step.goal && (
          <div className={cls('lesson-goal', met && 'met')} data-testid="lesson-goal">
            <span className="box" aria-hidden>{met ? '✓' : ''}</span>
            <span>{goal}</span>
          </div>
        )}
        {note && note.step === step && <div className="hint lesson-note" role="status">{note.text}</div>}
        <div className="row between" style={{ marginTop: 10, gap: 6 }}>
          <button className="btn small" disabled={s.step === 0} onClick={() => { prevStep(g); bump(); }}>Back</button>
          <span className="grow" />
          {(step.open || step.show) && <button className="btn small" onClick={() => {
            const sh = step.show?.(g);
            if (sh?.fleetId != null) ui.selectFleet(sh.fleetId);
            if (sh?.systemId != null) { if (sh.fleetId == null) ui.selectSystem(sh.systemId); ui.set({ view: 'galaxy', screen: 'map' }); focusSystem(sh.systemId); }
            if (sh?.planetId != null) ui.selectPlanet(sh.planetId);
            const scr = sh?.screen ?? step.open;
            if (scr) ui.openScreen(scr);
          }}>Show me</button>}
          {step.auto && !met && <button className="btn small" onClick={doIt} title="Give the orders for this step">Do it for me</button>}
          {last ? <button className="btn small primary" onClick={() => { finishLesson(g); bump(); }}>Finish lesson</button>
            : <button className={cls('btn small', !step.goal && 'primary')} onClick={() => { nextStep(g); bump(); }}>{step.goal ? 'Skip step' : 'Continue'}</button>}
        </div>
      </div>
    </aside>
  );
}

/** Offers the next unlocked lesson once; the player decides. */
function LessonOffer() {
  const g = useGame();
  const ui = useUI();
  const next = recommendation(g);
  if (!next) return null;
  const done = guidanceOf(g).done.length;
  return (
    <aside className="lesson-offer glass" aria-label="Lesson available">
      <div className="lesson-offer-k">{done ? 'Next lesson' : 'Lesson available'} · {next.n} of {CHAPTERS.length}</div>
      <div className="lesson-title">{next.title}</div>
      <div className="hint">{next.brief}</div>
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <button className="btn small primary" onClick={() => { startLesson(g, next.id); ui.bump(); }}>Start lesson</button>
        <button className="btn small" onClick={() => { declineOffer(g, next.id); ui.bump(); }}>Not now</button>
        <span className="grow" />
        <button className="btn small" onClick={() => ui.openCodex(null, 'lessons')}>All lessons</button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- "what just happened?" cards

let momentCache: { tick: number; rev: number; m: Moment | null } = { tick: -1, rev: -1, m: null };

function MomentCard() {
  const g = useGame();
  const ui = useUI();
  const prefs = usePrefs();
  if (momentCache.tick !== g.tick || momentCache.rev !== ui.rev) momentCache = { tick: g.tick, rev: ui.rev, m: prefs.lessons ? currentMoment(g) : null };
  const m = momentCache.m;
  const id = m?.id;
  // danger stops the clock so there is time to read and act
  useEffect(() => {
    if (m?.pause && useUI.getState().speed > 0) useUI.getState().setSpeed(0);
    if (m?.voice) speakOnce(g, m.voice);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!m) return null;
  const close = () => { dismissMoment(g, m); momentCache.rev = -1; ui.bump(); };
  const act = () => {
    const a = m.action!;
    if (a.battleId != null) { ui.set({ battleId: a.battleId, screen: 'military' }); close(); return; }
    if (a.fleetId != null) ui.selectFleet(a.fleetId);
    if (a.systemId != null) { ui.set({ systemId: a.systemId, view: 'galaxy', screen: 'map' }); focusSystem(a.systemId); }
    if (a.planetId != null) ui.selectPlanet(a.planetId);
    if (a.screen) ui.openScreen(a.screen);
    close();
  };
  return (
    <aside className={cls('moment glass', m.danger && 'danger')} aria-label="What just happened" data-testid="moment">
      <div className="moment-k">{m.danger ? 'Important' : id?.startsWith('quest-') ? 'Quest' : 'Something new'}</div>
      <AdvisorHead voice={m.voice} />
      <div className="lesson-title">{m.title}</div>
      <p>{m.text}</p>
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        {m.action && <button className="btn small primary" onClick={act}>{m.action.label}</button>}
        <button className="btn small" onClick={close}>Got it</button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- hints

let hintCache: { tick: number; rev: number; at: number; hints: Hint[] } = { tick: -1, rev: -1, at: 0, hints: [] };

function HintCard() {
  const g = useGame();
  const ui = useUI();
  const prefs = usePrefs();
  const [open, setOpen] = useState(false);
  const [fold, setFold] = useState(false);
  const [, setWake] = useState(0);
  // recompute at most every 1.5 s of real time, or when the day changes after a pause
  const now = performance.now();
  const stale = prefs.hints && (hintCache.tick !== g.tick || (ui.speed === 0 && hintCache.rev !== ui.rev));
  if (prefs.hints && (hintCache.tick !== g.tick && now - hintCache.at > 1500 || hintCache.rev === -1 || (ui.speed === 0 && hintCache.rev !== ui.rev && now - hintCache.at > 400))) {
    hintCache = { tick: g.tick, rev: ui.rev, at: now, hints: currentHints(g) };
  }
  // a change that arrived inside the throttle window must still be seen: while paused nothing
  // else re-renders the card, so wake it once the window has passed
  const pending = stale && (hintCache.tick !== g.tick || hintCache.rev !== ui.rev);
  useEffect(() => {
    if (!pending) return;
    const wait = Math.max(50, (ui.speed === 0 ? 400 : 1500) - (performance.now() - hintCache.at) + 20);
    const t = setTimeout(() => setWake((n) => n + 1), wait);
    return () => clearTimeout(t);
  });
  if (!prefs.hints) return null;
  // during a lesson only urgent matters interrupt
  const lesson = guidanceOf(g).active && !guidanceOf(g).paused;
  // a beginner sees one thing at a time, and only about screens they already have
  const simple = isSimple(g);
  const vis = visibleScreens(g);
  const hints = hintCache.hints.filter((h) => (!lesson || h.severity === 'danger') && (!vis || !h.action?.screen || vis.has(h.action.screen)));
  if (lesson && !hints.length) return null;
  const goal = reignGoal(g);
  const few = simple ? 1 : 3;
  const shown = open ? hints.slice(0, 7) : hints.slice(0, few);
  const act = (h: Hint) => {
    const a = h.action;
    if (!a) return;
    if (a.fleetId != null) ui.selectFleet(a.fleetId);
    if (a.systemId != null) { ui.set({ systemId: a.systemId, view: 'galaxy', screen: 'map' }); focusSystem(a.systemId); }
    if (a.planetId != null) ui.selectPlanet(a.planetId);
    if (a.screen) ui.openScreen(a.screen);
  };
  const dismiss = (h: Hint) => { snoozeHint(g, h.id); hintCache.rev = -1; hintCache.hints = hintCache.hints.filter((x) => x.id !== h.id); ui.bump(); };
  return (
    <aside className="hints glass" aria-label="Next steps">
      <div className="hints-head">
        <span className="hint-t">{simple ? 'Next step' : 'Next steps'}</span>
        <button className="hint-fold" onClick={() => setFold(!fold)} aria-expanded={!fold} title={fold ? 'Show next steps' : 'Fold away'}>{fold ? '▸' : '▾'}</button>
      </div>
      {!fold && <div className="hint-goal" data-testid="reign-goal">{goal.text}</div>}
      {!fold && shown.map((h) => (
        <div key={h.id} className={cls('hint-row', h.severity)} data-testid="hint">
          <div className="hint-t">{h.title}</div>
          <div className="hint-x">{h.text}</div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            {h.action && <button className="btn small" onClick={() => act(h)}>{h.action.label}</button>}
            <button className="btn small" onClick={() => dismiss(h)} title="Hide this advice for six months">Dismiss</button>
          </div>
        </div>
      ))}
      {!fold && hints.length > few && <button className="hint-more" onClick={() => setOpen(!open)}>{open ? 'Show fewer' : simple ? 'Show other ideas' : `${Math.min(7, hints.length) - few} more`}</button>}
    </aside>
  );
}

// ---------------------------------------------------------------- windows: info drawer and first visit

/** The ? button in a window header. */
export function InfoButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return <button className={cls('wbtn', open && 'on')} onPointerDown={(e) => e.stopPropagation()} onClick={onToggle} aria-label="About this window" aria-pressed={open} title="About this window">?</button>;
}

export function ScreenInfoPanel({ id, onClose }: { id: ScreenId; onClose: () => void }) {
  const ui = useUI();
  const g = useGame();
  const info = SCREEN_INFO[id];
  if (!info) return null;
  const lesson = info.lesson ? CHAPTER_BY_ID[info.lesson] : null;
  return (
    <div className="info-drawer" role="region" aria-label={`About ${info.title}`}>
      <div className="row between"><b>{info.title}</b><button className="wbtn" onClick={onClose} aria-label="Close the explanation">×</button></div>
      <p>{info.purpose}</p>
      <dl className="info-controls">
        {info.controls.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {info.advanced?.map((a, i) => <p key={i} className="hint">{a}</p>)}
      <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
        {info.codex.map((c) => { const e = codexEntry(c); return e ? <button key={c} className="btn small" onClick={() => ui.openCodex(c)}>{e.title}</button> : null; })}
        {lesson && <button className="btn small primary" onClick={() => { startLesson(g, lesson.id); ui.bump(); onClose(); }}>Lesson {lesson.n}: {lesson.title}</button>}
      </div>
    </div>
  );
}

/** Shown inside a window the first time it is opened in this reign (when lessons are on). */
export function FirstVisit({ id, onMore }: { id: ScreenId; onMore: () => void }) {
  const g = useGame();
  const ui = useUI();
  const prefs = usePrefs();
  const info = SCREEN_INFO[id];
  const s = guidanceOf(g);
  const key = `intro:${id}`;
  // the lesson in progress already explains its own windows
  const lessonCovers = !!s.active && !s.paused && activeChapter(g)?.steps.some((st) => st.open === id);
  if (!prefs.lessons || !info || id === 'codex' || s.seen.includes(key) || lessonCovers) return null;
  const close = () => { recordFlag(g, key); ui.bump(); };
  return (
    <div className="first-visit" role="note">
      <div className="grow">
        <b>{info.title}.</b> {info.purpose}
      </div>
      <button className="btn small" onClick={() => { close(); onMore(); }}>How it works</button>
      <button className="btn small" onClick={close}>Got it</button>
    </div>
  );
}

// ---------------------------------------------------------------- Codex-backed tooltips

/** Wraps a term with an explanation from the Codex; click opens the entry. */
export function Term({ entry, children, extra }: { entry: string; children: ReactNode; extra?: ReactNode }) {
  const ui = useUI();
  const prefs = usePrefs();
  const e = codexEntry(entry);
  if (!e || !prefs.tooltips) return <>{children}</>;
  return (
    <Tip content={<div><h4>{e.title}</h4><div className="muted">{e.summary}</div>{extra}<div className="hint" style={{ marginTop: 4 }}>Click for the Codex entry.</div></div>}>
      <span className="term" role="button" tabIndex={0} onClick={() => ui.openCodex(entry)} onKeyDown={(k) => { if (k.key === 'Enter') ui.openCodex(entry); }}>{children}</span>
    </Tip>
  );
}

/** Starts the first lesson for a new reign (when the player asked for guidance). */
export function beginGuidedReign() {
  const g = useUI.getState().game;
  if (!g) return;
  setSimple(g, true);
  startLesson(g, 'welcome');
  useUI.getState().bump();
}
