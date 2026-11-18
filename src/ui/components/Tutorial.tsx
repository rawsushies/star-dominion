// Guided first reign: an advisor walks a new sovereign through the core loop.
// Each objective completes itself when the player actually does the thing,
// and the control it refers to is highlighted on screen.

import { useEffect } from 'react';
import { useUI, useGame } from '../store';
import type { GameState } from '../../sim/types';
import type { UIState } from '../store';
import { ownedSystems } from '../../sim/territory';

interface Step {
  title: string;
  text: string;
  /** CSS selector of the control to highlight */
  target?: string;
  done?: (g: GameState, ui: UIState) => boolean;
}

const builtCount = (g: GameState) => g.planets.reduce((a, p) => a + (p.colony?.ownerId === g.playerId ? Object.values(p.colony.buildings).reduce((x, n) => x + (n ?? 0), 0) + p.colony.queue.length : 0), 0);
const shipCount = (g: GameState) => Object.values(g.fleets).filter((f) => f.ownerId === g.playerId).reduce((a, f) => a + f.ships.length, 0) + g.planets.reduce((a, p) => a + (p.colony?.ownerId === g.playerId ? p.colony.shipQueue.length : 0), 0);

export const STEPS: Step[] = [
  {
    title: 'Welcome, Sovereign',
    text: 'You rule one world and a handful of ships. Time is paused. The dial at the bottom controls time: click its centre or press Space to pause and resume, and use the arrows below it for speed. The icons on the far left open your ministries as windows.',
    target: '.dial',
  },
  {
    title: 'Set the scholars to work',
    text: 'Open Research (the flask on the left) and choose a technology. Research never stops while a project is set, so always keep one chosen.',
    target: '.neo-btn[aria-label="Research"]',
    done: (g) => !!g.empires[g.playerId].research.current,
  },
  {
    title: 'Let time run',
    text: 'Press Space or click the centre of the dial. Days pass, resources flow in, and your fleets move. You can pause any time to give orders calmly.',
    target: '.dial-center',
    done: (_g, ui) => ui.speed > 0,
  },
  {
    title: 'Chart the stars',
    text: 'Select your Survey Corps in the Overview (Fleets tab, right side), then right-click a nearby system on the map to send it there. Explored systems reveal planets you can claim.',
    target: '.overview',
    done: (g) => g.empires[g.playerId].explored.length > (g.tutorial?.base.explored ?? 0) + 1,
  },
  {
    title: 'Build on your capital',
    text: 'Open Planets, select your capital, and add a district or building. Districts give jobs; workers in jobs produce food, minerals, energy and more. Watch the resource strip at the top.',
    target: '.neo-btn[aria-label="Planets"]',
    done: (g) => builtCount(g) > (g.tutorial?.base.buildings ?? 0),
  },
  {
    title: 'Claim a neighbouring system',
    text: 'Click an explored, unclaimed system next to your borders. In the Selected item panel on the right, press "Send construction ship". The outpost extends your territory, supply and income.',
    target: '.right-col',
    done: (g) => ownedSystems(g, g.playerId).length >= 2,
  },
  {
    title: 'Raise a ship',
    text: 'Open Industry or your capital\'s shipyard and queue a warship. Your navy protects trade from corsairs and your worlds from rivals. Mind your naval capacity on the dial\'s right gauge.',
    target: '.neo-btn[aria-label="Industry"]',
    done: (g) => shipCount(g) > (g.tutorial?.base.ships ?? 0),
  },
  {
    title: 'Meet your neighbours',
    text: 'Open Diplomacy. Every realm remembers how you treat it. Trade agreements and non-aggression pacts make early growth far safer.',
    target: '.neo-btn[aria-label="Diplomacy"]',
    done: (_g, ui) => ui.windows.some((w) => w.id === 'diplomacy'),
  },
  {
    title: 'Look to the next age',
    text: 'Open the Kingdom window (your crest, top left) and find Evolution. Your civilisation climbs from feudal houses to a Type I imperium and beyond, gaining power at each step. The badge under your realm\'s name shows your progress.',
    target: '.era-badge',
    done: (_g, ui) => ui.windows.some((w) => w.id === 'kingdom'),
  },
  {
    title: 'The reign is yours',
    text: 'You know the essentials. Hover anything for details, check the Dispatches log for news, and pause whenever you need to think. Expand, prosper, and lead your people to the stars.',
  },
];

export function beginTutorial(g: GameState) {
  g.tutorial = { step: 0, base: { explored: g.empires[g.playerId].explored.length, buildings: builtCount(g), ships: shipCount(g) } };
}

export function TutorialPanel() {
  const g = useGame();
  const ui = useUI();
  const t = g.tutorial;
  const step = t ? STEPS[t.step] : null;
  // auto-advance when the objective is met
  useEffect(() => {
    if (!t || !step?.done) return;
    if (step.done(g, ui)) { t.step = Math.min(STEPS.length - 1, t.step + 1); ui.bump(); }
  });
  // highlight the referenced control
  useEffect(() => {
    if (!step?.target) return;
    const el = document.querySelector(step.target);
    el?.classList.add('coach');
    return () => el?.classList.remove('coach');
  }, [step?.target, ui.windows.length, ui.screen]);
  if (!t || !step) return null;
  const last = t.step === STEPS.length - 1;
  const close = () => { g.tutorial = null; ui.bump(); };
  return (
    <aside className="tutor glass" aria-live="polite">
      <div className="whead">
        <span className="wtitle">Royal advisor</span>
        <span className="hint" style={{ marginLeft: 6 }}>{t.step + 1} of {STEPS.length}</span>
        <span className="grow" />
        <button className="wbtn" onClick={close} aria-label="End the tutorial">×</button>
      </div>
      <div className="tutor-body">
        <div className="tutor-title">{step.title}</div>
        <p>{step.text}</p>
        <div className="tutor-steps">{STEPS.map((_, i) => <i key={i} className={i < t.step ? 'done' : i === t.step ? 'now' : ''} />)}</div>
        <div className="row between" style={{ marginTop: 8 }}>
          <button className="btn small" disabled={t.step === 0} onClick={() => { t.step--; ui.bump(); }}>Back</button>
          {last ? <button className="btn small primary" onClick={close}>Finish</button>
            : <button className="btn small" onClick={() => { t.step++; ui.bump(); }}>{step.done ? 'Skip' : 'Next'}</button>}
        </div>
      </div>
    </aside>
  );
}
