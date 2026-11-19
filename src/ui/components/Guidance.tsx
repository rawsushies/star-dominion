// Player guidance in the HUD: the lesson panel, the next-lesson offer, the advisor's hints,
// each window's information drawer and first-visit card, and Codex-backed tooltips. Guidance
// supports the player and never takes control: everything can be paused, dismissed or turned off.

import { useEffect, useState, type ReactNode } from 'react';
import { useUI, useGame, onCommand, type ScreenId } from '../store';
import { cls, Tip } from './common';
import { focusSystem } from './MapView';
import { CHAPTERS, CHAPTER_BY_ID, type LessonStep } from '../../guidance/chapters';
import { activeChapter, activeStep, declineOffer, evaluateLesson, lessonCtx, nextStep, prevStep, recommendation, recordFlag, setPaused, skipLesson, startLesson, finishLesson } from '../../guidance/lessons';
import { guidanceOf, guidancePrefs, onPrefsChange } from '../../guidance/state';
import { currentHints, snoozeHint, type Hint } from '../../guidance/hints';
import { SCREEN_INFO } from '../../guidance/screens';
import { codexEntry } from '../../guidance/codex';

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
      const hit = document.querySelector(sel);
      if (hit && (hit as HTMLElement).offsetParent !== null) { el = hit; break; }
    }
    el?.classList.add('coach');
    return () => el?.classList.remove('coach');
  }, [step, enabled, ui.windows, ui.screen, ui.view, ui.rev]);
}

// ---------------------------------------------------------------- lessons

export function GuidanceStack() {
  useGuidanceController();
  return (
    <div className="guide-stack">
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
        <div className="lesson-title">{step.title}</div>
        <p>{text}</p>
        {step.goal && (
          <div className={cls('lesson-goal', met && 'met')} data-testid="lesson-goal">
            <span className="box" aria-hidden>{met ? '✓' : ''}</span>
            <span>{step.goal}</span>
          </div>
        )}
        <div className="row between" style={{ marginTop: 10, gap: 6 }}>
          <button className="btn small" disabled={s.step === 0} onClick={() => { prevStep(g); bump(); }}>Back</button>
          <span className="grow" />
          {step.open && <button className="btn small" onClick={() => ui.openScreen(step.open!)}>Show me</button>}
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

// ---------------------------------------------------------------- hints

let hintCache: { tick: number; rev: number; at: number; hints: Hint[] } = { tick: -1, rev: -1, at: 0, hints: [] };

function HintCard() {
  const g = useGame();
  const ui = useUI();
  const prefs = usePrefs();
  const [open, setOpen] = useState(false);
  if (!prefs.hints) return null;
  // recompute at most every 1.5 s of real time, or when the day changes after a pause
  const now = performance.now();
  if (hintCache.tick !== g.tick && now - hintCache.at > 1500 || hintCache.rev === -1 || (ui.speed === 0 && hintCache.rev !== ui.rev && now - hintCache.at > 400)) {
    hintCache = { tick: g.tick, rev: ui.rev, at: now, hints: g.tick < 5 ? [] : currentHints(g) };
  }
  // during a lesson only urgent matters interrupt
  const lesson = guidanceOf(g).active && !guidanceOf(g).paused;
  const hints = hintCache.hints.filter((h) => !lesson || h.severity === 'danger');
  if (!hints.length) return null;
  const shown = open ? hints.slice(0, 6) : hints.slice(0, 1);
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
    <aside className="hints glass" aria-label="Advisor">
      {shown.map((h) => (
        <div key={h.id} className={cls('hint-row', h.severity)} data-testid="hint">
          <div className="hint-t">{h.title}</div>
          <div className="hint-x">{h.text}</div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            {h.action && <button className="btn small" onClick={() => act(h)}>{h.action.label}</button>}
            <button className="btn small" onClick={() => dismiss(h)} title="Hide this advice for six months">Dismiss</button>
          </div>
        </div>
      ))}
      {hints.length > 1 && <button className="hint-more" onClick={() => setOpen(!open)}>{open ? 'Show fewer' : `${hints.length - 1} more ${hints.length - 1 === 1 ? 'matter' : 'matters'}`}</button>}
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
  startLesson(g, 'welcome');
  useUI.getState().bump();
}
