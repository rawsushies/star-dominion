// Save-slot identifiers, shared by local (IndexedDB) and cloud (Firestore) saves.
//
// A slot id is used verbatim as a Firestore document id under users/{uid}/saves/, so it must be a
// single, ordinary path segment: no "/", not "." or "..", not Firestore's reserved __name__ form.
// Ids are limited to lowercase letters, digits, "-" and "_". Up to 200 characters are accepted,
// so saves made by earlier versions (which slugged the whole save name) stay readable and
// deletable; new ids are at most 64 characters.

const SLOT_RE = /^[a-z0-9_-]{1,200}$/;

export function isValidSlot(slot: unknown): slot is string {
  return typeof slot === 'string' && SLOT_RE.test(slot) && !/^__.*__$/.test(slot);
}

export function assertSlot(slot: unknown): string {
  if (!isValidSlot(slot)) throw new Error(`Invalid save slot: ${JSON.stringify(String(slot)).slice(0, 40)}`);
  return slot;
}

/** FNV-1a, as six base-36 characters: a short, stable tag for a save name. */
function tag(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36).padStart(6, '0').slice(-6);
}

/**
 * The slot a save name is stored under. The same name always gives the same slot (saving again
 * overwrites it). Names that only differ in characters the slug drops ("My Save!" and "My Save?")
 * get different slots, because a short tag of the exact name is appended whenever the slug is
 * not the name itself.
 */
export function slotForName(name: string): string {
  const exact = name.trim();
  const slug = exact.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  if (slug && slug === exact) return slug;
  return `${slug || 'save'}-${tag(exact)}`;
}
