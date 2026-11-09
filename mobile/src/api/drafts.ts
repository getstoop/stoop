import { type DraftEntry, draftKey, isEntryExpired, toDraftEntry } from "@stoop/core/drafts";
import { Directory, File, Paths } from "expo-file-system";

// The phone's draft store: an unsent message kept on the device
// (docs/architecture/messaging.md → The composer), under the documents
// folder, which the system doesn't purge as it may the cache. The rules
// live in core/drafts.ts; this only reads and writes. The composer
// adopts it (screens/Channel/useSavedDraft), and signing out or removing
// a server calls deleteServerDrafts (servers/useLeaveServer).
//
// One file per server and account, drafts/<server>/<account>.json, so a
// removed server's drafts go as one folder and the sweep tells a
// forgotten server by a folder's name, with nothing to parse. Inside,
// the entries are keyed by the whole core key (server, account, channel,
// root): the server and account repeat the path, but there is one name
// for a draft everywhere and a file read back says whose each entry is.
//
// A file is read from disk once and then held here, so a save per typing
// pause only serialises what is in memory and writes it through; memory
// changes only after the disk has, so the two never disagree. Nothing is
// written to a file until a read of it has succeeded, since writing
// would overwrite drafts never seen; a read the disk refused is tried
// again at the next read or write, so one refusal at launch (the sweep
// reads every file) doesn't lose the session. A file whose content is
// not what was written reads as empty and the next write replaces it. A
// write that fails is dropped, with no word to the person, so the
// composer works as it did before drafts.

export type DraftAddress = {
  serverId: string;
  accountId: string;
  channelId: string;
  threadRootId?: string;
};

type Entries = Record<string, DraftEntry>;

// What each file holds, by its uri, once read.
const entriesByFile = new Map<string, Entries>();

// The saved servers' IDs (servers/ServersProvider keeps them current).
// A write for a server not among them is refused: a composer saving as
// it goes away, or a send failing late, must not recreate a removed
// server's file after deleteServerDrafts, and the list is only read once
// the keychain answers, so before that nothing is saved.
let savedServerIds: ReadonlySet<string> = new Set();

// Both IDs land in a path. The server's is the app's own six characters,
// but the account's comes from a server somebody added, so neither is
// trusted to be more than a plain word.
const PLAIN_ID = /^[A-Za-z0-9_-]+$/;

const draftsFolder = () => new Directory(Paths.document, "drafts");
const serverFolder = (serverId: string) => new Directory(draftsFolder(), serverId);

export function rememberSavedServers(serverIds: Iterable<string>): void {
  savedServerIds = new Set(serverIds);
}

export function readDraft(address: DraftAddress): DraftEntry | undefined {
  const file = fileFor(address);
  if (!file) return undefined;
  return entriesOf(file)?.[draftKey(address)];
}

// An empty entry is a deletion, so a rule's result goes straight back.
export function writeDraft(address: DraftAddress, entry: DraftEntry | undefined): void {
  const file = fileFor(address);
  if (!file) return;
  const entries = entriesOf(file);
  if (!entries) return;
  const key = draftKey(address);
  const next = { ...entries };
  if (entry) next[key] = entry;
  else delete next[key];
  store(file, next);
}

export function deleteDraft(address: DraftAddress): void {
  writeDraft(address, undefined);
}

// Signing out of a server, or removing it: every account's drafts for it
// go. Meant to run after the server is forgotten, by which time the
// saved list has reached the store; taking the server off the set here
// too makes writes refused even for a caller that didn't forget first.
export function deleteServerDrafts(serverId: string): void {
  savedServerIds = new Set([...savedServerIds].filter((saved) => saved !== serverId));
  if (!PLAIN_ID.test(serverId)) return;
  const folder = serverFolder(serverId);
  forgetFolder(folder);
  try {
    if (folder.exists) folder.delete();
  } catch {
    // Left for the sweep at the next start, which drops any folder
    // whose server isn't saved.
  }
}

// Once at app start, after rememberSavedServers: a folder whose server
// isn't saved goes, since a server added again gets a new ID and the
// file would never be read; an entry whose every slot has expired goes,
// since it would never show again.
export function sweepDrafts(now: number = Date.now()): void {
  let folders: (Directory | File)[];
  try {
    const root = draftsFolder();
    if (!root.exists) return;
    folders = root.list();
  } catch {
    return;
  }
  for (const folder of folders) {
    try {
      if (!(folder instanceof Directory) || !savedServerIds.has(folder.name)) {
        if (folder instanceof Directory) forgetFolder(folder);
        folder.delete();
        continue;
      }
      for (const file of folder.list()) sweepFile(file, now);
    } catch {
      // Another go at the next start.
    }
  }
}

function sweepFile(file: Directory | File, now: number): void {
  if (!(file instanceof File)) {
    file.delete();
    return;
  }
  // One the disk refused is left for the next start, in case the disk
  // was only busy.
  const entries = entriesOf(file);
  if (!entries) return;
  const kept: Entries = {};
  for (const [key, entry] of Object.entries(entries)) {
    if (!isEntryExpired(entry, now)) kept[key] = entry;
  }
  // Nothing kept is its own case: a file whose content parsed as no
  // entries at all had nothing to drop, and goes all the same.
  const keptCount = Object.keys(kept).length;
  if (keptCount === 0 || keptCount !== Object.keys(entries).length) store(file, kept);
}

// The file an address lives in, or nothing when its server isn't saved
// or an ID can't be a file name.
function fileFor({ serverId, accountId }: DraftAddress): File | undefined {
  if (!savedServerIds.has(serverId)) return undefined;
  if (!PLAIN_ID.test(serverId) || !PLAIN_ID.test(accountId)) return undefined;
  return new File(serverFolder(serverId), `${accountId}.json`);
}

// The file's entries, from memory after the first read that succeeded;
// undefined when the disk refused this time.
function entriesOf(file: File): Entries | undefined {
  const held = entriesByFile.get(file.uri);
  if (held) return held;
  try {
    const entries = file.exists ? parseEntries(file.textSync()) : {};
    entriesByFile.set(file.uri, entries);
    return entries;
  } catch {
    return undefined;
  }
}

// What is held for the files under a folder about to go.
function forgetFolder(folder: Directory): void {
  // Whether or not the platform ends a folder's uri with a slash.
  const inside = `${folder.uri.replace(/\/+$/, "")}/`;
  for (const uri of [...entriesByFile.keys()]) {
    if (uri.startsWith(inside)) entriesByFile.delete(uri);
  }
}

// Whatever the bytes hold that is a draft entry; garbage is no entry.
function parseEntries(text: string): Entries {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const entries: Entries = {};
  for (const [key, value] of Object.entries(parsed)) {
    const entry = toDraftEntry(value);
    if (entry) entries[key] = entry;
  }
  return entries;
}

// Disk first, memory after, so a write the disk refused leaves the two
// agreeing on what is there. A file with nothing left in it is deleted
// rather than written empty.
function store(file: File, entries: Entries): void {
  try {
    if (Object.keys(entries).length === 0) {
      if (file.exists) file.delete();
    } else {
      file.parentDirectory.create({ intermediates: true, idempotent: true });
      file.writeSync(JSON.stringify(entries));
    }
    entriesByFile.set(file.uri, entries);
  } catch {
    // Full or refused: the words stay in the field for this session.
  }
}
