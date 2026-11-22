// Cloud saves tied to a Google account (Firebase Auth + Cloud Firestore).
//
// The sovereign signs in with Google once; every manual save and autosave is
// then mirrored to users/{uid}/saves/{slot}, so a reign can be continued from
// any browser. Saves are gzip-compressed and split into chunks to stay well
// under Firestore's 1 MiB document limit. Firebase is loaded lazily and only
// when the project is configured (see DEVELOPMENT.md), so the game runs fully
// offline without it.

import type { SaveMeta } from './idb';
import { assertSlot, isValidSlot } from './slots';

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
let testFb: Fb | null = null;

function fb(): Promise<Fb> {
  if (testFb) return Promise.resolve(testFb);
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

/** Tests only: replace Firebase with an in-memory stand-in and set the signed-in user. */
export function __cloudTestHooks(stub: unknown, user: CloudUser | null) {
  testFb = stub as Fb;
  current = user;
}

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
const BATCH_LIMIT = 450; // Firestore allows 500 writes per batch; leave room for the metadata

/**
 * Cloud save layout (per user, per slot):
 *   users/{uid}/saves/{slot}                 metadata: name, realm, tick, size, parts, gen
 *   users/{uid}/saves/{slot}/chunks/{gen}-{i} part i of the gzip-compressed save
 * Every write uses a new generation id, so a reader only ever combines parts of one save, and
 * parts of older generations are deleted after the new one is in place. Saves written before
 * generations existed have no `gen` and parts named "0", "1", ...; they are still read, and
 * cleaned up by the next write or delete.
 */
function chunkId(gen: string | undefined, i: number): string {
  return gen ? `${gen}-${i}` : String(i);
}
function newGeneration(): string {
  const rnd = typeof crypto !== 'undefined' && 'getRandomValues' in crypto
    ? Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, '0')).join('')
    : Math.random().toString(36).slice(2, 12);
  return `g${Date.now().toString(36)}${rnd}`;
}

function signedIn(): CloudUser {
  const u = current;
  if (!u) throw new Error('Sign in to save to the cloud.');
  return u;
}

export async function cloudWrite(meta: Omit<SaveMeta, 'savedAt' | 'size'>, data: string): Promise<void> {
  const slot = assertSlot(meta.slot);
  const u = signedIn();
  const { db, fs } = await fb();
  const packed = await gzip(data);
  const parts = Math.max(1, Math.ceil(packed.length / CHUNK));
  if (parts + 1 > BATCH_LIMIT) throw new Error('This save is too large for cloud storage.');
  const gen = newGeneration();
  const base = fs.doc(db, 'users', u.uid, 'saves', slot);
  const batch = fs.writeBatch(db);
  for (let i = 0; i < parts; i++) {
    batch.set(fs.doc(base, 'chunks', chunkId(gen, i)), { b: fs.Bytes.fromUint8Array(packed.subarray(i * CHUNK, (i + 1) * CHUNK)) });
  }
  batch.set(base, { ...meta, slot, savedAt: Date.now(), size: data.length, parts, gen });
  await batch.commit();
  await pruneChunks(u.uid, slot);
}

/**
 * Delete the parts the slot's current metadata no longer points to (older generations, or the
 * extra parts of a larger save). Runs in a transaction on the metadata, so a write that lands
 * meanwhile is never damaged: only parts listed before the transaction are candidates, and the
 * transaction re-runs if the metadata changes under it.
 */
async function pruneChunks(uid: string, slot: string): Promise<void> {
  const { db, fs } = await fb();
  const base = fs.doc(db, 'users', uid, 'saves', slot);
  const listed = (await fs.getDocs(fs.collection(base, 'chunks'))).docs.map((d) => d.id);
  if (!listed.length) return;
  await fs.runTransaction(db, async (tx) => {
    const metaSnap = await tx.get(base);
    const m = metaSnap.exists() ? metaSnap.data() as { gen?: string; parts?: number } : null;
    const keep = new Set<string>();
    if (m) for (let i = 0; i < (m.parts ?? 1); i++) keep.add(chunkId(m.gen, i));
    for (const id of listed.slice(0, BATCH_LIMIT)) if (!keep.has(id)) tx.delete(fs.doc(base, 'chunks', id));
  });
}

export async function cloudList(): Promise<SaveMeta[]> {
  const u = current;
  if (!u) return [];
  const { db, fs } = await fb();
  const snap = await fs.getDocs(fs.collection(db, 'users', u.uid, 'saves'));
  return snap.docs
    .filter((d) => isValidSlot(d.id))
    .map((d) => ({ ...(d.data() as SaveMeta), slot: d.id }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function cloudRead(slot: string): Promise<string | null> {
  assertSlot(slot);
  const u = current;
  if (!u) return null;
  const { db, fs } = await fb();
  const base = fs.doc(db, 'users', u.uid, 'saves', slot);
  let lastGen: string | undefined | null = null;
  // a write that replaces this save while we read it removes the parts we are reading: start again
  for (let attempt = 0; attempt < 3; attempt++) {
    const meta = await fs.getDoc(base);
    if (!meta.exists()) return null;
    const m = meta.data() as { parts?: number; gen?: string };
    const parts = m.parts ?? 1;
    if (!Number.isInteger(parts) || parts < 1 || parts > BATCH_LIMIT) throw new Error('This cloud save is damaged (its part count is unreadable).');
    const chunks = await Promise.all(Array.from({ length: parts }, (_, i) => fs.getDoc(fs.doc(base, 'chunks', chunkId(m.gen, i)))));
    if (chunks.every((c) => c.exists())) {
      const arrays = chunks.map((c) => (c.data()!.b as import('firebase/firestore').Bytes).toUint8Array());
      const all = new Uint8Array(arrays.reduce((a, x) => a + x.length, 0));
      let o = 0;
      for (const a of arrays) { all.set(a, o); o += a.length; }
      return gunzip(all);
    }
    if (lastGen !== null && lastGen === (m.gen ?? '')) break;
    lastGen = m.gen ?? '';
  }
  throw new Error('This cloud save is incomplete (a part is missing). Load another save, or save again to replace it.');
}

export async function cloudDelete(slot: string): Promise<void> {
  assertSlot(slot);
  const u = current;
  if (!u) return;
  const { db, fs } = await fb();
  const base = fs.doc(db, 'users', u.uid, 'saves', slot);
  // every part, of every generation, not just the ones the metadata names; the metadata goes in
  // the first batch, so an interrupted delete leaves no visible, half-deleted save
  const ids = (await fs.getDocs(fs.collection(base, 'chunks'))).docs.map((d) => d.id);
  let first = true;
  for (let i = 0; i < ids.length || first; i += BATCH_LIMIT) {
    const batch = fs.writeBatch(db);
    if (first) { batch.delete(base); first = false; }
    for (const id of ids.slice(i, i + BATCH_LIMIT)) batch.delete(fs.doc(base, 'chunks', id));
    await batch.commit();
  }
}
