// Audio settings: master, music, effects and ambience volumes and a global mute, kept in this
// browser. Missing or unreadable storage falls back to the defaults.

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  ambient: number;
  muted: boolean;
}

export const AUDIO_DEFAULTS: AudioSettings = { master: 0.8, music: 0.55, sfx: 0.7, ambient: 0.45, muted: false };
const KEY = 'sd.audio.v1';

const clamp = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);

export function loadAudioSettings(storage: Pick<Storage, 'getItem'> | null = safeStorage()): AudioSettings {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return { ...AUDIO_DEFAULTS };
    const p = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      master: clamp(p.master, AUDIO_DEFAULTS.master), music: clamp(p.music, AUDIO_DEFAULTS.music),
      sfx: clamp(p.sfx, AUDIO_DEFAULTS.sfx), ambient: clamp(p.ambient, AUDIO_DEFAULTS.ambient), muted: p.muted === true,
    };
  } catch { return { ...AUDIO_DEFAULTS }; }
}

export function saveAudioSettings(s: AudioSettings, storage: Pick<Storage, 'setItem'> | null = safeStorage()) {
  try { storage?.setItem(KEY, JSON.stringify(s)); } catch { /* not persisted */ }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
