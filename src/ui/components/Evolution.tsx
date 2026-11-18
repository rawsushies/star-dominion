// Civilisational evolution UI: the Kardashev badge in the HUD, the era ladder
// in the Kingdom window, and the full-screen moment when a new age dawns.

import { useUI, useGame } from '../store';
import { ERAS, MAX_ERA } from '../../sim/data/eras';
import { eraRequirements, eraProgress, kardashev } from '../../sim/eras';
import { cls, fmt } from './common';

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'];

export function typeLabel(t: number) {
  return `Type ${t.toFixed(2)}`;
}

export function EraBadge() {
  const g = useGame();
  const ui = useUI();
  const e = g.empires[g.playerId];
  const era = ERAS[e.era ?? 0];
  const k = kardashev(g, e);
  const prog = eraProgress(g, e);
  return (
    <button className="era-badge" onClick={() => ui.openScreen('kingdom')} title="Civilisational era: open the Kingdom window to see what the next age needs">
      <span className="era-k num">{typeLabel(k)}</span>
      <span className="era-n">{era.name}</span>
      {(e.era ?? 0) < MAX_ERA && <span className="era-bar"><i style={{ width: `${prog * 100}%` }} /></span>}
    </button>
  );
}

export function EraLadder() {
  const g = useGame();
  const e = g.empires[g.playerId];
  const cur = e.era ?? 0;
  return (
    <div className="ladder">
      {ERAS.slice().reverse().map((era) => {
        const state = era.id < cur ? 'past' : era.id === cur ? 'now' : era.id === cur + 1 ? 'next' : 'future';
        const reqs = state === 'next' ? eraRequirements(g, e, era) : [];
        return (
          <div key={era.id} className={cls('rung', state)}>
            <div className="rung-type">{era.id === 0 ? '0.7' : ROMAN[Math.round(era.type)]}</div>
            <div className="rung-body">
              <div className="row between"><span className="rung-name">{era.name}</span><span className="hint">{era.epithet}</span></div>
              {(state === 'now' || state === 'next') && <div className="hint" style={{ color: 'var(--text-2)', marginTop: 2 }}>{era.lore}</div>}
              {state === 'next' && (
                <div className="reqs">
                  {reqs.map((q) => (
                    <div key={q.label} className={cls('req', q.done && 'done')}>
                      <span className="tick">{q.done ? '✓' : ''}</span>
                      <span className="grow">{q.label}</span>
                      <span className="num">{fmt(Math.min(q.have, q.need))}/{fmt(q.need)}</span>
                    </div>
                  ))}
                </div>
              )}
              {era.id > 0 && state !== 'future' && <div className="perks">{era.perks.join(' · ')}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function EraDawn() {
  const g = useUI((s) => s.game);
  const seen = useUI((s) => s.eraSeen);
  const set = useUI((s) => s.set);
  useUI((s) => s.rev);
  if (!g) return null;
  const e = g.empires[g.playerId];
  const cur = e.era ?? 0;
  if (cur <= seen) return null;
  const era = ERAS[cur];
  return (
    <div className="dawn" role="dialog" aria-label={`A new age: ${era.name}`}>
      <div className="dawn-inner">
        <div className="dawn-kicker">A new age dawns</div>
        <div className="dawn-type">Type {ROMAN[Math.round(era.type)]}</div>
        <h2 className="dawn-name">{era.name}</h2>
        <p className="dawn-text">{era.dawn}</p>
        <ul className="dawn-perks">{era.perks.map((p) => <li key={p}>{p}</li>)}</ul>
        <button className="btn primary" onClick={() => set({ eraSeen: cur })} autoFocus>Continue the reign</button>
      </div>
    </div>
  );
}
