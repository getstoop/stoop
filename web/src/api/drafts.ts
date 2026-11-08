import { type DraftEntry, isEntryExpired, toDraftEntry } from "../core/drafts";

// Web's draft store: one localStorage item per key (core/drafts.ts
// → draftKey), under a prefix nothing else uses, so deleting every draft
// and the sweep never touch the theme or the voice switches kept beside
// them. The rules live in core/drafts.ts; this only reads and writes.
// The composer adopts it in a later step.
//
// Storage can be missing or refuse (a private window, a full quota): then
// the store reads as empty and writes do nothing, with no word to the
// person, so the composer works as it did before drafts.

export const DRAFTS_KEY_PREFIX = "stoop.draft.";

// Closed by deleteAllDrafts, so a save armed before signing out (the
// composer's debounce, its unmount save, a send failing late) can't
// recreate a draft just deleted. Not for the page's life: signing out
// and signing in again (the login form, the desktop hand-back, and
// whatever a provider adds) can all happen within one page load, so
// openDrafts belongs where the session is observed, in AppShell as the
// account becomes known, not in each page that creates one. One hole
// stays: a send that times out after a sign-out and the next sign-in's
// open writes under the old account's key, which needs the sign-out and
// sign-in within the stall age and shows nothing to the new account.
let closed = false;

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function parse(raw: string | null | undefined): DraftEntry | undefined {
  if (raw === null || raw === undefined) return undefined;
  try {
    return toDraftEntry(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

// Every stored draft's key, read before any is removed: removing while
// walking localStorage shifts the indices.
function draftItemKeys(): string[] {
  const found: string[] = [];
  try {
    const store = storage();
    if (!store) return found;
    for (let index = 0; index < store.length; index++) {
      const itemKey = store.key(index);
      if (itemKey?.startsWith(DRAFTS_KEY_PREFIX)) found.push(itemKey);
    }
  } catch {
    // Treated as empty.
  }
  return found;
}

function removeItem(itemKey: string): void {
  try {
    storage()?.removeItem(itemKey);
  } catch {
    // Nothing to do; the sweep has another go next start.
  }
}

export function readDraft(key: string): DraftEntry | undefined {
  if (closed) return undefined;
  try {
    return parse(storage()?.getItem(DRAFTS_KEY_PREFIX + key));
  } catch {
    return undefined;
  }
}

// An empty entry is a deletion, so a rule's result goes straight back.
export function writeDraft(key: string, entry: DraftEntry | undefined): void {
  if (closed) return;
  if (!entry) {
    deleteDraft(key);
    return;
  }
  try {
    storage()?.setItem(DRAFTS_KEY_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Full or refused: the words stay in the field for this session.
  }
}

export function deleteDraft(key: string): void {
  if (closed) return;
  removeItem(DRAFTS_KEY_PREFIX + key);
}

// Signing out: closes the store first, then deletes every account's
// drafts (the key says whose, and they all belong to this sign-in's
// device).
export function deleteAllDrafts(): void {
  closed = true;
  for (const itemKey of draftItemKeys()) removeItem(itemKey);
}

// Signing in: the store takes writes again.
export function openDrafts(): void {
  closed = false;
}

// Once at page start: an entry whose every slot has expired goes, and so
// does one that can't be read, since neither would ever show again.
export function sweepDrafts(now: number = Date.now()): void {
  for (const itemKey of draftItemKeys()) {
    let entry: DraftEntry | undefined;
    try {
      entry = parse(storage()?.getItem(itemKey));
    } catch {
      entry = undefined;
    }
    if (!entry || isEntryExpired(entry, now)) removeItem(itemKey);
  }
}

// Another tab wrote or deleted this key: the browser raises `storage`
// in every other tab on the origin, never in the one that wrote.
// Returns the unsubscribe.
export function onDraftChange(
  key: string,
  listener: (entry: DraftEntry | undefined) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const itemKey = DRAFTS_KEY_PREFIX + key;
  const handler = (event: StorageEvent) => {
    if (closed || event.key !== itemKey) return;
    listener(parse(event.newValue));
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
