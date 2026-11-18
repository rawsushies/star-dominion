import { useState } from 'react';
import { useGame } from '../store';
import { formatDate } from '../../sim/util';
import { Sheet, cls } from '../components/common';
import { jumpTo } from '../components/Chrome';

const FILTERS: { id: string; label: string; kinds?: string[] }[] = [
  { id: 'all', label: 'All' },
  { id: 'war', label: 'War', kinds: ['war', 'peace', 'battle', 'battle_end', 'invasion', 'capture', 'retreat', 'admiral', 'raiders', 'fall'] },
  { id: 'realm', label: 'Realm', kinds: ['colony', 'outpost', 'construction', 'shipyard', 'starbase', 'megastructure', 'capital', 'government', 'unrest', 'rebellion', 'shortage', 'trade'] },
  { id: 'diplomacy', label: 'Diplomacy', kinds: ['treaty', 'diplomacy', 'peace', 'war'] },
  { id: 'science', label: 'Science', kinds: ['research', 'discovery', 'guardian'] },
  { id: 'events', label: 'Events', kinds: ['event', 'start', 'victory', 'gameover'] },
];

export function JournalScreen() {
  const g = useGame();
  const [f, setF] = useState('all');
  const [sev, setSev] = useState<'all' | 'important'>('all');
  const filt = FILTERS.find((x) => x.id === f)!;
  const evs = g.events
    .filter((e) => e.empires.length === 0 || e.empires.includes(g.playerId))
    .filter((e) => !filt.kinds || filt.kinds.includes(e.kind))
    .filter((e) => sev === 'all' || e.severity === 'danger' || e.severity === 'warn')
    .slice().reverse();
  return (
    <Sheet title="Event journal" lede="The chronicle of your reign and the galaxy around it. Select an entry to go to the place it concerns."
      actions={<div className="seg">{FILTERS.map((x) => <button key={x.id} className={cls(f === x.id && 'on')} onClick={() => setF(x.id)}>{x.label}</button>)}<button className={cls(sev === 'important' && 'on')} onClick={() => setSev(sev === 'all' ? 'important' : 'all')}>Warnings only</button></div>}>
      {!evs.length && <div className="empty">Nothing recorded under this heading.</div>}
      <div className="list">
        {evs.map((e) => (
          <div key={e.id} className="li" onClick={() => jumpTo(e)} style={{ alignItems: 'flex-start' }}>
            <span className={cls('sev', e.severity)} style={{ marginTop: 7 }} />
            <span className="num faint" style={{ width: 82, flex: 'none' }}>{formatDate(e.tick)}</span>
            <div className="grow">
              <div className="serif" style={{ fontSize: 17, fontWeight: 600 }}>{e.title}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{e.text}</div>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
