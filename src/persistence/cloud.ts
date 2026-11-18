// Cloud saves tied to a Google account (Firebase Auth + Cloud Firestore).
//
// The sovereign signs in with Google once; every manual save and autosave is
// then mirrored to users/{uid}/saves/{slot}, so a reign can be continued from
// any browser. Saves are gzip-compressed and split into chunks to stay well
// under Firestore's 1 MiB document limit. Firebase is loaded lazily and only
// when the project is configured (see DEVELOPMENT.md), so the game runs fully
// offline without it.

import type { SaveMeta } from './idb';

const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const cloudConfigured = !!(config.apiKey && config.authDomain && config.projectId);

export interface CloudUser { uid: string; name: string; email: string | null; photo: string | null }

type Fb = {
  auth: import('firebase/auth').Auth;
  db: import('firebase/firestore').Firestore;
  authMod: typeof import('firebase/auth');
  fs: typeof import('firebase/firestore');
};
let fbPromise: Promise<Fb> | null = null;

function fb(): Promise<Fb> {
  if (!cloudConfigured) return Promise.reject(new Error('Cloud saves are not configured for this build.'));
  fbPromise ??= (async () => {
    const [{ initializeApp }, authMod, fs] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
    const app = initializeApp(config as Record<string, string>);
    return { auth: authMod.getAuth(app), db: fs.getFirestore(app), authMod, fs };
  })();
  return fbPromise;
}

let current: CloudUser | null = null;
const listeners = new Set<(u: CloudUser | null) => void>();

/** Subscribe to sign-in state. Returns an unsubscribe function. */
export function onCloudUser(cb: (u: CloudUser | null) => void): () => void {
  listeners.add(cb);
  cb(current);
  if (cloudConfigured) {
    fb().then(({ auth, authMod }) => authMod.onAuthStateChanged(auth, (u) => {
      current = u ? { uid: u.uid, name: u.displayName ?? 'Sovereign', email: u.email, photo: u.photoURL } : null;
      listeners.forEach((l) => l(current));
    })).catch(() => {});
  }
  return () => listeners.delete(cb);
}

export function cloudUser() { return current; }

export async function signInWithGoogle() {
  const { auth, authMod } = await fb();
  await authMod.signInWithPopup(auth, new authMod.GoogleAuthProvider());
}

export async function signOutCloud() {
  const { auth, authMod } = await fb();
  await authMod.signOut(auth);
}

// ---------- compression helpers ----------

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

const CHUNK = 700_000;

export async function cloudWrite(meta: Omit<SaveMeta, 'savedAt' | 'size'>, data: string): Promise<void> {
  const u = current;
  if (!u) throw new Error('Sign in to save to the cloud.');
  const { db, fs } = await fb();
  const packed = await gzip(data);
  const parts = Math.ceil(packed.length / CHUNK);
  const base = fs.doc(db, 'users', u.uid, 'saves', meta.slot);
  const batch = fs.writeBatch(db);
  for (let i = 0; i < parts; i++) {
    batch.set(fs.doc(base, 'chunks', String(i)), { b: fs.Bytes.fromUint8Array(packed.subarray(i * CHUNK, (i + 1) * CHUNK)) });
  }
  batch.set(base, { ...meta, savedAt: Date.now(), size: data.length, parts });
  await batch.commit();
}

export async function cloudList(): Promise<SaveMeta[]> {
  const u = current;
  if (!u) return [];
  const { db, fs } = await fb();
  const snap = await fs.getDocs(fs.collection(db, 'users', u.uid, 'saves'));
  return snap.docs.map((d) => d.data() as SaveMeta).sort((a, b) => b.savedAt - a.savedAt);
}

export async function cloudRead(slot: string): Promise<string | null> {
  const u = current;
  if (!u) return null;
  const { db, fs } = await fb();
  const base = fs.doc(db, 'users', u.uid, 'saves', slot);
  const meta = await fs.getDoc(base);
  if (!meta.exists()) return null;
  const parts = (meta.data().parts as number) ?? 1;
  const chunks = await Promise.all(Array.from({ length: parts }, (_, i) => fs.getDoc(fs.doc(base, 'chunks', String(i)))));
  const arrays = chunks.map((c) => (c.data()!.b as import('firebase/firestore').Bytes).toUint8Array());
  const all = new Uint8Array(arrays.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const a of arrays) { all.set(a, o); o += a.length; }
  return gunzip(all);
}

export async function cloudDelete(slot: string): Promise<void> {
  const u = current;
  if (!u) return;
  const { db, fs } = await fb();
  const base = fs.doc(db, 'users', u.uid, 'saves', slot);
  const meta = await fs.getDoc(base);
  const parts = meta.exists() ? ((meta.data().parts as number) ?? 1) : 0;
  const batch = fs.writeBatch(db);
  for (let i = 0; i < parts; i++) batch.delete(fs.doc(base, 'chunks', String(i)));
  batch.delete(base);
  await batch.commit();
}
