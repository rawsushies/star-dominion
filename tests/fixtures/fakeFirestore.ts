// A small in-memory stand-in for the parts of the Firestore web SDK that src/persistence/cloud.ts
// uses: doc/collection references, getDoc/getDocs, write batches (atomic on commit) and Bytes.
// It models paths and atomic batches only, not security rules: passing tests here says nothing
// about the live project's rules.

type Data = Record<string, unknown>;
interface Ref { path: string; id: string }

export class FakeFirestore {
  docs = new Map<string, Data>();
  /** write counter per document path, for optimistic transactions */
  private versions = new Map<string, number>();
  private bump(path: string) { this.versions.set(path, (this.versions.get(path) ?? 0) + 1); }
  commits = 0;
  /** called before each batch commit; lets a test interleave another writer */
  beforeCommit: (() => Promise<void> | void) | null = null;
  /** called before a transaction commits (once) */
  beforeTxCommit: (() => Promise<void> | void) | null = null;

  private join(base: unknown, segs: string[]): string {
    const head = base && typeof base === 'object' && 'path' in (base as Ref) ? (base as Ref).path : '';
    for (const s of segs) if (typeof s !== 'string' || s === '' || s.includes('//')) throw new Error(`Invalid path segment: ${String(s)}`);
    return [head, ...segs].filter(Boolean).join('/');
  }

  readonly sdk = {
    doc: (base: unknown, ...segs: string[]): Ref => {
      const path = this.join(base, segs);
      const parts = path.split('/');
      if (parts.length % 2 !== 0) throw new Error(`Invalid document reference ${path}: an even number of segments is required`);
      return { path, id: parts[parts.length - 1] };
    },
    collection: (base: unknown, ...segs: string[]): Ref => {
      const path = this.join(base, segs);
      if (path.split('/').length % 2 !== 1) throw new Error(`Invalid collection reference ${path}`);
      return { path, id: path.split('/').pop()! };
    },
    getDoc: async (ref: Ref) => {
      const d = this.docs.get(ref.path);
      return { id: ref.id, exists: () => d != null, data: () => (d ? { ...d } : undefined) };
    },
    getDocs: async (col: Ref) => {
      const depth = col.path.split('/').length + 1;
      const docs = [...this.docs.entries()]
        .filter(([p]) => p.startsWith(col.path + '/') && p.split('/').length === depth)
        .map(([p, d]) => ({ id: p.split('/').pop()!, ref: { path: p, id: p.split('/').pop()! }, data: () => ({ ...d }) }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
    writeBatch: () => {
      const ops: (() => void)[] = [];
      return {
        set: (ref: Ref, data: Data) => { ops.push(() => { this.docs.set(ref.path, { ...data }); this.bump(ref.path); }); },
        delete: (ref: Ref) => { ops.push(() => { this.docs.delete(ref.path); this.bump(ref.path); }); },
        commit: async () => {
          if (ops.length > 500) throw new Error('A batch can hold at most 500 writes');
          if (this.beforeCommit) { const f = this.beforeCommit; this.beforeCommit = null; await f(); }
          for (const op of ops) op();
          this.commits++;
        },
      };
    },
    /** optimistic transaction: re-runs if a document it read was written before it commits */
    runTransaction: async <T,>(_db: unknown, fn: (tx: { get(r: Ref): Promise<unknown>; set(r: Ref, d: Data): void; delete(r: Ref): void }) => Promise<T>): Promise<T> => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const seen = new Map<string, number>();
        const ops: (() => void)[] = [];
        const tx = {
          get: async (r: Ref) => { seen.set(r.path, this.versions.get(r.path) ?? 0); return this.sdk.getDoc(r); },
          set: (r: Ref, d: Data) => { ops.push(() => { this.docs.set(r.path, { ...d }); this.bump(r.path); }); },
          delete: (r: Ref) => { ops.push(() => { this.docs.delete(r.path); this.bump(r.path); }); },
        };
        const out = await fn(tx);
        if (this.beforeTxCommit) { const f = this.beforeTxCommit; this.beforeTxCommit = null; await f(); }
        if ([...seen].every(([p, v]) => (this.versions.get(p) ?? 0) === v)) { for (const op of ops) op(); return out; }
      }
      throw new Error('transaction failed after retries');
    },
    Bytes: { fromUint8Array: (u: Uint8Array) => ({ toUint8Array: () => u.slice() }) },
  };

  stub() { return { auth: {}, db: {}, authMod: {}, fs: this.sdk }; }

  /** paths under a prefix, for assertions */
  under(prefix: string): string[] { return [...this.docs.keys()].filter((p) => p.startsWith(prefix)).sort(); }
}
