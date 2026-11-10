import { isBlankMessage } from "./markdown/text";
import { restoreDraft } from "./unsent";

// The rules for an unsent message kept on the device
// (docs/architecture/messaging.md → The composer). A key names one account's words in one channel or thread;
// its entry has two slots, the `draft` the field shows and the `sending`
// it hides while a send is out. Every rule is a pure function taking the
// time, so each client's store (web: api/drafts.ts over localStorage;
// mobile: a file per server and account) only reads and writes. Web's
// composer applies them through routes/Channel/useSavedDraft.ts.

// Untouched this long, a draft is a stale fragment and the sweep drops it.
export const DRAFT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
// A send still out after this has failed; both clients time out sends at it.
export const SEND_STALL_MS = 10_000;

export interface Draft {
  // Markdown, as the composer holds it.
  text: string;
  // The message quoted (the reply target), if any.
  quotedMessageId?: string;
  // When it was last written, ms since the epoch.
  writtenAt: number;
}

export interface DraftEntry {
  draft?: Draft;
  sending?: Draft;
}

// A Draft before its time is stamped: what the composer hands over.
export interface Words {
  text: string;
  quotedMessageId?: string;
}

// Mobile holds several servers in one app and passes the server too; web
// is one server per origin and leaves it out.
export function draftKey(parts: {
  serverId?: string;
  accountId: string;
  channelId: string;
  threadRootId?: string;
}): string {
  const head = parts.serverId ? `${parts.serverId}/` : "";
  return `${head}${parts.accountId}/${parts.channelId}/${parts.threadRootId ?? ""}`;
}

export function isExpired(slot: Draft, now: number): boolean {
  return now - slot.writtenAt >= DRAFT_EXPIRY_MS;
}

// Told by age, not by run: another tab or a restarted app can't ask the
// composer that sent whether it is still waiting.
export function isStalled(sending: Draft, now: number): boolean {
  return now - sending.writtenAt >= SEND_STALL_MS;
}

// The one way a slot is made. Blank words with no quote are nothing, so
// an attachments-only send, an emptied field or a merge of blanks never
// leaves a slot behind to outlive its expiry; a quote keeps an empty
// slot, until it is cancelled. The quote key is left out rather than
// set to undefined so a stored slot reads back equal.
function toSlot(words: Words, writtenAt: number): Draft | undefined {
  if (isBlankMessage(words.text) && !words.quotedMessageId) return undefined;
  return words.quotedMessageId
    ? { text: words.text, quotedMessageId: words.quotedMessageId, writtenAt }
    : { text: words.text, writtenAt };
}

// Nothing left in either slot means nothing to keep.
function entryOrNothing(entry: DraftEntry): DraftEntry | undefined {
  return entry.draft || entry.sending ? entry : undefined;
}

// What the field holds as a draft: nothing once it has been emptied, so
// leaving discards it.
export function fieldDraft(
  text: string,
  quotedMessageId: string | undefined,
  now: number,
): Draft | undefined {
  return toSlot({ text, quotedMessageId }, now);
}

// The entry with its draft slot replaced; the sending slot is untouched.
export function withDraft(
  entry: DraftEntry | undefined,
  draft: Draft | undefined,
): DraftEntry | undefined {
  const sending = entry?.sending;
  const next: DraftEntry = {};
  if (draft) next.draft = draft;
  if (sending) next.sending = sending;
  return entryOrNothing(next);
}

// Words coming back ahead of the draft typed since, the way a refused
// send puts them back in the field; blank words (an attachments-only
// send) add nothing, not a blank line. The draft's own quote wins when
// it has one, as it does on screen. A merge counts as a write.
export function joinDraft(
  words: Words,
  draft: Draft | undefined,
  now: number,
): Draft | undefined {
  const typedSince = draft?.text ?? "";
  return toSlot(
    {
      text: isBlankMessage(words.text)
        ? typedSince
        : restoreDraft(words.text, typedSince),
      quotedMessageId: draft?.quotedMessageId ?? words.quotedMessageId,
    },
    now,
  );
}

// The entry as the composer opens: expired slots go, a stalled send's
// words join the draft, a younger send stays hidden. A send older than
// the expiry is dropped like any draft, never brought back. Returns the
// same object when nothing changed; the caller writes back only when a
// different one comes back.
export function openEntry(
  entry: DraftEntry | undefined,
  now: number,
): DraftEntry | undefined {
  if (!entry) return undefined;
  const draft =
    entry.draft && !isExpired(entry.draft, now) ? entry.draft : undefined;
  const sending =
    entry.sending && !isExpired(entry.sending, now) ? entry.sending : undefined;
  if (sending && isStalled(sending, now)) {
    return withDraft(undefined, joinDraft(sending, draft, now));
  }
  if (draft === entry.draft && sending === entry.sending)
    return entryOrNothing(entry);
  return withDraft(sending ? { sending } : undefined, draft);
}

// Send pressed: the field clears and its words are held apart from the
// draft. A send still out under this key is replaced; last edit wins.
export function beginSend(words: Words, now: number): DraftEntry | undefined {
  return withDraft({ sending: toSlot(words, now) }, undefined);
}

// Every send ends in finishSend or failSend, whether or not the person
// is still on the screen; otherwise the sending slot lingers, stalls,
// and its words come back a second time.

// The server accepted it: the sending words go, a newer draft stays.
export function finishSend(
  entry: DraftEntry | undefined,
): DraftEntry | undefined {
  return entry?.draft ? { draft: entry.draft } : undefined;
}

// The send was refused or failed: its words join the draft and the
// sending slot goes. On screen the field shows the same words; after
// leaving, they wait here. The words come from the composer that sent,
// which still has them, not from the slot, which another tab may have
// replaced.
export function failSend(
  entry: DraftEntry | undefined,
  words: Words,
  now: number,
): DraftEntry | undefined {
  return withDraft(undefined, joinDraft(words, entry?.draft, now));
}

// The sweep's test: every slot it has is past the expiry, so nothing in
// it would ever show again.
export function isEntryExpired(entry: DraftEntry, now: number): boolean {
  const live = (slot: Draft | undefined) => slot && !isExpired(slot, now);
  return !live(entry.draft) && !live(entry.sending);
}

// A stored entry read back, or nothing if it is not one: storage can hold
// anything, and a malformed entry behaves as no draft.
export function toDraftEntry(value: unknown): DraftEntry | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { draft, sending } = value as Record<string, unknown>;
  return withDraft({ sending: toDraft(sending) }, toDraft(draft));
}

function toDraft(value: unknown): Draft | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { text, quotedMessageId, writtenAt } = value as Record<string, unknown>;
  if (typeof text !== "string" || typeof writtenAt !== "number")
    return undefined;
  if (!Number.isFinite(writtenAt)) return undefined;
  if (quotedMessageId !== undefined && typeof quotedMessageId !== "string")
    return undefined;
  return toSlot({ text, quotedMessageId }, writtenAt);
}
