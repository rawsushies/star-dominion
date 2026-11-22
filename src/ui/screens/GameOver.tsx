import { useState } from 'react';
import { useUI } from '../store';
import { formatDate } from '../../sim/util';
import { VICTORY_LABEL, victoryProgress } from '../../sim/victory';
import { MAX_ERA, ERAS } from '../../sim/data/eras';

export function GameOver() {
  const g = useUI((s) => s.game);
  useUI((s) => s.rev);
  const quit = useUI((s) => s.quit);
  const [dismissed, setDismissed] = useState<number | null>(null);
  if (!g?.gameOver || dismissed === g.tick || (g.gameOver.won && dismissed != null)) return null;
  const e = g.empires[g.playerId];
  const winner = g.gameOver.kind ? g.empires[g.gameOver.winner ?? g.playerId] : null;
  return (
    <div className="modal-back">
      <div className="modal sheet frame" style={{ width: 'min(560px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
        <div className="sheet-body" style={{ padding: '28px 30px' }}>
          <div className="serif" style={{ fontSize: 44, fontWeight: 600, lineHeight: 1 }}>{g.gameOver.won ? `${g.gameOver.kind ? VICTORY_LABEL[g.gameOver.kind] : 'Dominion'} victory` : g.gameOver.winner != null ? `${VICTORY_LABEL[g.gameOver.kind!]}: ${g.empires[g.gameOver.winner].name}` : 'The fall of a crown'}</div>
          <p className="serif" style={{ fontSize: 19, fontStyle: 'italic', color: 'var(--vellum-2)' }}>{g.gameOver.reason}</p>
          {winner && (
            <div style={{ marginTop: 12 }} data-testid="gameover-why">
              <b>{g.gameOver.won ? 'How you won' : `How ${winner.name} won`}</b>
              <p className="hint" style={{ margin: '4px 0 0' }}>{victoryProgress(g, winner).find((v) => v.kind === g.gameOver!.kind)?.detail}.</p>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <b>Your roads to victory</b>
            {victoryProgress(g, e).map((v) => (
              <div key={v.kind} className="row between hint" style={{ marginTop: 3 }}><span>{VICTORY_LABEL[v.kind]}</span><span>{Math.round(v.progress * 100)}%</span></div>
            ))}
          </div>
          <div className="kv" style={{ marginTop: 12 }}>
            <span>Reign ended / recorded</span><span>{formatDate(g.tick)} · {Math.floor(g.tick / 360)} years</span>
            <span>Systems held</span><span>{e.stats.systems}</span>
            <span>Population</span><span>{Math.round(e.stats.population)}</span>
            <span>Era</span><span>{ERAS[Math.min(MAX_ERA, e.era ?? 0)].name}</span>
            <span>Kardashev rating</span><span>{(e.stats.kardashev ?? 0).toFixed(2)}</span>
            <span>Wars won</span><span>{e.warsWon ?? 0}</span>
            <span>Vassals</span><span>{g.treaties.filter((t) => t.type === 'vassal' && t.a === e.id).length}</span>
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
