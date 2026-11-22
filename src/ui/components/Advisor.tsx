// Lord Admiral Fiona MacLeod on screen: her portrait, her name and the line she is speaking.
import { useEffect, useState } from 'react';
import { audio } from '../../audio/manager';
import { ADVISOR, line, replay, type VoiceId } from '../../guidance/advisor';
import { cls } from './common';

/** An original portrait: a veteran admiral, silver-streaked red hair, dress coat with gold boards. */
export function AdvisorPortrait({ size = 44, speaking = false }: { size?: number; speaking?: boolean }) {
  return (
    <svg className={cls('advisor-portrait', speaking && 'speaking')} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`${ADVISOR.title} ${ADVISOR.name}`}>
      <defs>
        <radialGradient id="adv-bg" cx="50%" cy="38%" r="70%"><stop offset="0" stopColor="#1d3346" /><stop offset="1" stopColor="#0a121a" /></radialGradient>
        <linearGradient id="adv-hair" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#b6563a" /><stop offset="0.55" stopColor="#8f3f2b" /><stop offset="1" stopColor="#c9c2ba" /></linearGradient>
        <linearGradient id="adv-coat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1f2c44" /><stop offset="1" stopColor="#111a2a" /></linearGradient>
        <clipPath id="adv-clip"><circle cx="32" cy="32" r="31" /></clipPath>
      </defs>
      <g clipPath="url(#adv-clip)">
        <rect width="64" height="64" fill="url(#adv-bg)" />
        {/* hair behind */}
        <path d="M17 30c0-12 7-19 15-19s15 7 15 19c0 6-2 11-3 14H20c-1-3-3-8-3-14z" fill="url(#adv-hair)" />
        {/* coat and shoulders */}
        <path d="M6 64c1-11 8-17 18-19l8 6 8-6c10 2 17 8 18 19z" fill="url(#adv-coat)" />
        <path d="M24 45l8 6 8-6 1 4-9 8-9-8z" fill="#e8e1d4" />
        <path d="M30.5 51h3v13h-3z" fill="#a4282f" />
        <rect x="9" y="47" width="11" height="3.2" rx="1" fill="#d8b45a" transform="rotate(-14 14 48)" />
        <rect x="44" y="47" width="11" height="3.2" rx="1" fill="#d8b45a" transform="rotate(14 50 48)" />
        <circle cx="20" cy="56" r="1.6" fill="#d8b45a" /><circle cx="44" cy="56" r="1.6" fill="#d8b45a" />
        {/* neck and face */}
        <path d="M27.5 38h9v8l-4.5 3-4.5-3z" fill="#d9a78d" />
        <ellipse cx="32" cy="30" rx="10" ry="12" fill="#e8bba1" />
        {/* hair in front: a swept fringe and a silver streak */}
        <path d="M21.5 27c1-9 6-13 11.5-13 6 0 10 4 11 10-4-3-9-4.5-14-3.5-3 .6-6 2.6-8.5 6.5z" fill="url(#adv-hair)" />
        <path d="M37 15.5c3 1.5 5.5 4.5 6.5 8.5-1-.8-2-1.4-3-1.9-.6-2.6-1.8-4.8-3.5-6.6z" fill="#d6d0c8" />
        {/* brows, eyes, a scar across the left brow */}
        <path d="M25.5 27.2l4.6-.9M34 26.3l4.6.9" stroke="#6b2f22" strokeWidth="1.3" strokeLinecap="round" />
        <ellipse cx="28" cy="30" rx="1.5" ry="1.1" fill="#24313a" /><ellipse cx="36" cy="30" rx="1.5" ry="1.1" fill="#24313a" />
        <path d="M37.5 24.5l2.4 5.2" stroke="#b9826c" strokeWidth="0.9" strokeLinecap="round" />
        <path d="M31.6 31.5l-.8 4h2" stroke="#c48f76" strokeWidth="0.9" fill="none" strokeLinecap="round" />
        <path d="M28.6 38.2c2.2 1.1 4.6 1.1 6.8 0" stroke="#a5604f" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </g>
      <circle cx="32" cy="32" r="31" fill="none" stroke="#d8b45a" strokeOpacity="0.55" strokeWidth="1.5" />
    </svg>
  );
}

function useSpeaking(): string | null {
  const [, setN] = useState(0);
  useEffect(() => audio.onChange(() => setN((n) => n + 1)), []);
  return audio.speaking;
}

/** Her name, and (when she has a recorded line here) the words as a quote with a replay button. */
export function AdvisorHead({ voice, label }: { voice?: VoiceId; label?: string }) {
  const speaking = useSpeaking();
  const now = !!voice && speaking === voice;
  return (
    <div className="advisor-head">
      <AdvisorPortrait speaking={now} />
      <div className="grow">
        <div className="advisor-name">{ADVISOR.name}<span className="hint"> · {label ?? ADVISOR.title}</span>{now && <span className="advisor-wave" aria-hidden><i /><i /><i /></span>}</div>
        {voice && <q className="advisor-quote" data-testid="advisor-quote">{line(voice)}</q>}
      </div>
      {voice && <button className="wbtn" onClick={() => (now ? audio.hush() : replay(voice))} aria-label={now ? 'Stop the advisor' : 'Hear it again'} title={now ? 'Stop' : 'Hear it again'}>{now ? '■' : '▶'}</button>}
    </div>
  );
}
