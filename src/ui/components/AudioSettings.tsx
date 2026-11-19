// Sound settings: master, music, effects and ambience volumes with immediate preview, and mute.
// Used in the Codex settings tab and the Chancery.

import { useEffect, useRef, useState } from 'react';
import { audio, type Bus } from '../../audio/manager';
import type { AudioSettings as Settings } from '../../audio/settings';

export function useAudioSettings(): Settings {
  const [, setN] = useState(0);
  useEffect(() => audio.onChange(() => setN((n) => n + 1)), []);
  return audio.settings;
}

const ROWS: { key: keyof Omit<Settings, 'muted'>; label: string; note: string; bus?: Bus }[] = [
  { key: 'master', label: 'Master volume', note: 'Everything you hear.' },
  { key: 'music', label: 'Music', note: 'The soundtrack, which follows what you are doing.', bus: 'music' },
  { key: 'sfx', label: 'Sound effects', note: 'Interface, construction, fleets, combat and events.', bus: 'sfx' },
  { key: 'ambient', label: 'Ambience', note: 'Space, orbit, the capital\'s industry and ship engines.', bus: 'ambient' },
];

export function AudioSettings({ compact = false }: { compact?: boolean }) {
  const s = useAudioSettings();
  const previewAt = useRef(0);
  const change = (key: keyof Settings, v: number) => {
    audio.unlock();
    audio.set({ [key]: v } as Partial<Settings>);
    // effects preview immediately; music and ambience are already playing
    const now = performance.now();
    if ((key === 'sfx' || key === 'master') && now - previewAt.current > 180) { previewAt.current = now; audio.play('ui.confirm'); }
  };
  const status = audio.state === 'unsupported' ? 'This browser does not support Web Audio; the game plays silently.'
    : audio.state === 'locked' ? 'Sound starts after your first click or key press (a browser rule).'
      : s.muted ? 'All sound is muted.' : null;
  return (
    <div className="audio-settings" data-testid="audio-settings">
      <label className="row setting">
        <input type="checkbox" checked={s.muted} onChange={(e) => { audio.unlock(); audio.set({ muted: e.target.checked }); }} aria-label="Mute all sound" />
        <span><b>Mute all sound</b>{!compact && <span className="hint" style={{ display: 'block' }}>Shortcut: M</span>}</span>
      </label>
      {ROWS.map((r) => (
        <div key={r.key} className="vol-row">
          <label htmlFor={`vol-${r.key}`}>{r.label}</label>
          <input id={`vol-${r.key}`} type="range" min={0} max={100} step={1} value={Math.round(s[r.key] * 100)} disabled={s.muted}
            onChange={(e) => change(r.key, +e.target.value / 100)} aria-valuetext={`${Math.round(s[r.key] * 100)}%`} />
          <span className="num vol-v">{Math.round(s[r.key] * 100)}</span>
          {!compact && <span className="hint vol-note">{r.note}</span>}
        </div>
      ))}
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <button className="btn small" onClick={() => { audio.unlock(); audio.reset(); }}>Restore defaults</button>
        <button className="btn small" disabled={s.muted} onClick={() => { audio.unlock(); audio.play('notify.good'); }}>Test sound</button>
      </div>
      {status && <p className="hint" data-testid="audio-status">{status}</p>}
      {!compact && <p className="hint">Music and ambience are original, generated live in your browser. Sound effects are by Kenney (CC0). Settings are kept in this browser.</p>}
    </div>
  );
}

/** A speaker button that toggles mute. */
export function MuteButton({ className = 'neo-btn' }: { className?: string }) {
  const s = useAudioSettings();
  return (
    <button className={className} onClick={() => { audio.unlock(); audio.set({ muted: !s.muted }); }} aria-label={s.muted ? 'Unmute sound (M)' : 'Mute sound (M)'} aria-pressed={s.muted} title={s.muted ? 'Unmute sound (M)' : 'Mute sound (M)'}>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
        <path d="M3 8 H6 L10 4.5 V15.5 L6 12 H3 Z" />
        {s.muted ? <path d="M13 7.5 L18 12.5 M18 7.5 L13 12.5" /> : <><path d="M13 7.5 C14.5 9 14.5 11 13 12.5" /><path d="M15.2 5.5 C18 8 18 12 15.2 14.5" /></>}
      </svg>
      {className === 'neo-btn' && <span className="neo-flyout">{s.muted ? 'Unmute sound' : 'Mute sound'}</span>}
    </button>
  );
}
