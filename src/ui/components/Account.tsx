// Google account panel for cloud saves. When the build has no Firebase
// configuration it explains that saves stay in this browser.

import { useEffect, useState } from 'react';
import { cloudConfigured, onCloudUser, signInWithGoogle, signOutCloud, cloudList, cloudDelete, type CloudUser } from '../../persistence/cloud';
import type { SaveMeta } from '../../persistence/idb';
import { loadCloudGame } from '../store';
import { formatDate } from '../../sim/util';

export function useCloudUser() {
  const [u, setU] = useState<CloudUser | null>(null);
  useEffect(() => onCloudUser(setU), []);
  return u;
}

export function AccountPanel({ compact = false }: { compact?: boolean }) {
  const user = useCloudUser();
  const [saves, setSaves] = useState<SaveMeta[] | null>(null);
  const [msg, setMsg] = useState('');
  const refresh = () => cloudList().then(setSaves).catch((e) => setMsg(String(e.message ?? e)));
  useEffect(() => { if (user) refresh(); else setSaves(null); }, [user?.uid]);
  if (!cloudConfigured) {
    return <div className="hint">Saves are kept in this browser. Cloud saves with a Google account are available when the game is deployed with a Firebase project.</div>;
  }
  if (!user) {
    return (
      <div className="account">
        <button type="button" className="btn google" onClick={() => signInWithGoogle().catch((e) => setMsg(String(e.message ?? e)))}>
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Sign in with Google
        </button>
        <div className="hint">Keep your reign in the cloud and continue it from any browser.</div>
        {msg && <div className="hint warn">{msg}</div>}
      </div>
    );
  }
  return (
    <div className="account">
      <div className="row between">
        <span className="row" style={{ gap: 8 }}>{user.photo && <img src={user.photo} alt="" width={22} height={22} referrerPolicy="no-referrer" />}<span>{user.name}</span></span>
        <button type="button" className="btn small" onClick={() => signOutCloud()}>Sign out</button>
      </div>
      <div className="hint" style={{ margin: '4px 0 6px' }}>Saves and autosaves are mirrored to your account.</div>
      {saves && !saves.length && <div className="hint">No cloud saves yet.</div>}
      <div className="list">
        {(saves ?? []).slice(0, compact ? 3 : 10).map((sv) => (
          <div key={sv.slot} className="li" onClick={() => loadCloudGame(sv.slot).catch((e) => setMsg(String(e.message ?? e)))}>
            <div className="grow"><div>{sv.name}</div><div className="hint">{sv.realm} · {formatDate(sv.tick)} · {new Date(sv.savedAt).toLocaleDateString()}</div></div>
            {!compact && <button type="button" className="btn small danger" onClick={(e) => { e.stopPropagation(); cloudDelete(sv.slot).then(refresh); }}>Delete</button>}
          </div>
        ))}
      </div>
      {msg && <div className="hint warn">{msg}</div>}
    </div>
  );
}
