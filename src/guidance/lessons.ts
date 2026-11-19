// The lesson engine: starting, advancing, pausing, skipping, replaying and resetting chapters,
// recording the player actions that objectives look for, and choosing what to recommend next.

import type { GameState } from '../sim/types';
import type { UIState } from '../ui/store';
import { CHAPTERS, CHAPTER_BY_ID, type Chapter, type LessonCtx, type LessonStep } from './chapters';
import { counters, guidanceOf } from './state';

const MAX_FLAGS = 400;

/** Record something the player did (`act:<command>`, `win:<screen>`, `view:system`, ...). */
export function recordFlag(g: GameState, flag: string): boolean {
  const s = guidanceOf(g);
  if (s.seen.includes(flag)) return false;
  s.seen.push(flag);
  if (s.seen.length > MAX_FLAGS) s.seen.splice(0, s.seen.length - MAX_FLAGS);
  return true;
}

export function hasFlag(g: GameState, flag: string): boolean {
  return !!g.guidance?.seen.includes(flag);
}

export function startLesson(g: GameState, id: string, step = 0) {
  const s = guidanceOf(g);
  if (!CHAPTER_BY_ID[id]) return;
  s.active = id;
  s.step = step;
  s.paused = false;
  s.skipped = s.skipped.filter((x) => x !== id);
  beginStep(g);
}

/** Capture the counters an objective compares against, and forget step-local flags. */
function beginStep(g: GameState) {
  const s = guidanceOf(g);
  s.base = counters(g);
  // action flags count only from the moment the step began
  s.seen = s.seen.filter((f) => !f.startsWith('act:') && !f.startsWith('win:') && f !== 'ran' && !f.startsWith('sel:') && f !== 'view:system');
}

export function activeChapter(g: GameState): Chapter | null {
  const id = g.guidance?.active;
  return id ? CHAPTER_BY_ID[id] ?? null : null;
}

export function activeStep(g: GameState): LessonStep | null {
  const c = activeChapter(g);
  return c ? c.steps[Math.min(g.guidance!.step, c.steps.length - 1)] : null;
}

export function nextStep(g: GameState) {
  const s = guidanceOf(g);
  const c = activeChapter(g);
  if (!c) return;
  if (s.step >= c.steps.length - 1) { finishLesson(g); return; }
  s.step++;
  beginStep(g);
}

export function prevStep(g: GameState) {
  const s = guidanceOf(g);
  if (!s.active || s.step === 0) return;
  s.step--;
  beginStep(g);
}

export function finishLesson(g: GameState) {
  const s = guidanceOf(g);
  if (s.active && !s.done.includes(s.active)) s.done.push(s.active);
  s.active = null;
  s.step = 0;
  s.paused = false;
}

/** Leave the lesson without finishing it; it stays available to resume or replay. */
export function skipLesson(g: GameState) {
  const s = guidanceOf(g);
  if (s.active && !s.done.includes(s.active) && !s.skipped.includes(s.active)) s.skipped.push(s.active);
  s.active = null;
  s.step = 0;
  s.paused = false;
}

export function setPaused(g: GameState, paused: boolean) {
  guidanceOf(g).paused = paused;
}

/** Forget all lesson progress (first-visit cards and hint snoozes too). */
export function resetGuidance(g: GameState) {
  const s = guidanceOf(g);
  s.active = null; s.step = 0; s.paused = false;
  s.done = []; s.skipped = []; s.offered = []; s.seen = []; s.snoozed = {}; s.base = {};
}

export function lessonCtx(g: GameState, ui: UIState): LessonCtx {
  const s = guidanceOf(g);
  return { g, ui, base: s.base, now: counters(g), has: (f) => s.seen.includes(f) };
}

/** Advance past every satisfied objective. Returns true when something changed. */
export function evaluateLesson(g: GameState, ui: UIState): boolean {
  const s = guidanceOf(g);
  const c = activeChapter(g);
  if (!c || s.paused) return false;
  const step = c.steps[s.step];
  if (!step?.done) return false;
  if (!step.done(lessonCtx(g, ui))) return false;
  nextStep(g);
  return true;
}

export type ChapterStatus = 'done' | 'active' | 'available' | 'locked' | 'skipped';

export function chapterStatus(g: GameState, c: Chapter): ChapterStatus {
  const s = guidanceOf(g);
  if (s.active === c.id) return 'active';
  if (s.done.includes(c.id)) return 'done';
  if (s.skipped.includes(c.id)) return 'skipped';
  return c.unlock(g, s.done) ? 'available' : 'locked';
}

/** The next lesson to offer: the first unlocked chapter neither done, skipped nor already offered. */
export function recommendation(g: GameState): Chapter | null {
  const s = guidanceOf(g);
  if (s.active) return null;
  return CHAPTERS.find((c) => !s.done.includes(c.id) && !s.skipped.includes(c.id) && !s.offered.includes(c.id) && c.unlock(g, s.done)) ?? null;
}

export function declineOffer(g: GameState, id: string) {
  const s = guidanceOf(g);
  if (!s.offered.includes(id)) s.offered.push(id);
}

export function progressSummary(g: GameState): { done: number; total: number } {
  return { done: guidanceOf(g).done.length, total: CHAPTERS.length };
}
