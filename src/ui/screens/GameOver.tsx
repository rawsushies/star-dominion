import { useState } from 'react';
import { useUI } from '../store';
import { formatDate } from '../../sim/util';

export function GameOver() {
  const g = useUI((s) => s.game);
  useUI((s) => s.rev);
  const quit = useUI((s) => s.quit);
  const [dismissed, setDismissed] = useState<number | null>(null);
  if (!g?.gameOver || dismissed === g.tick || (g.gameOver.won && dismissed != null)) return null;
  const e = g.empires[g.playerId];
  return (
    <div className="modal-back">
      <div className="modal sheet frame" style={{ width: 'min(560px, calc(100vw - 32px))' }}>
        <div className="sheet-body" style={{ padding: '28px 30px' }}>
          <div className="serif" style={{ fontSize: 44, fontWeight: 600, lineHeight: 1 }}>{g.gameOver.won ? 'Dominion' : 'The fall of a crown'}</div>
          <p className="serif" style={{ fontSize: 19, fontStyle: 'italic', color: 'var(--vellum-2)' }}>{g.gameOver.reason}</p>
          <div className="kv" style={{ marginTop: 12 }}>
            <span>Reign ended / recorded</span><span>{formatDate(g.tick)}</span>
            <span>Systems held</span><span>{e.stats.systems}</span>
            <span>Population</span><span>{Math.round(e.stats.population)}</span>
            <span>Technologies</span><span>{e.research.done.length}</span>
          </div>
          <div className="row between" style={{ marginTop: 22 }}>
            <button className="btn" onClick={quit}>Return to title</button>
            {g.gameOver.won && <button className="btn primary" onClick={() => setDismissed(g.tick)}>Continue ruling</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
