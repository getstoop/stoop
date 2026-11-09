import {
  beginSend,
  type Draft,
  failSend,
  fieldDraft,
  finishSend,
  openEntry,
  type Words,
  withDraft,
} from "@stoop/core/drafts";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { type DraftAddress, readDraft, writeDraft } from "../../api/drafts";

// The composer's words, kept on the device under their address
// (api/drafts) so they are there when the channel or thread opens again
// (docs/architecture/messaging.md → The composer); web's routes/Channel/useSavedDraft is the
// same shape. The composer asks `restoredDraft` for its field's first
// state, tells this hook each render what it holds as a draft (`words`:
// the field, or the draft set aside while a message is edited), and
// brackets each send with `startSend`. This saves the words a moment
// after they stop changing, as the app leaves the front, and as the
// composer goes; and only when they differ from what was last saved or
// restored, so the same channel open twice in the stack (through a
// channel link) can't have the screen beneath overwrite the newer draft,
// or bring back a sent one, as it unmounts.

// Typing stopped this long ago: save. The save that matters, since a
// killed app never unmounts anything.
const SAVE_DEBOUNCE_MS = 1000;

// A send under way: every one ends in finish or fail, or its words would
// stall and come back a second time (core/drafts.ts).
export interface SendTicket {
  finish(): void;
  fail(): void;
}

// What is stored for the address, opened: expired slots gone, a stalled
// send's words back in the draft, and written back when that changed
// anything. The read is synchronous, so the draft goes in the field on
// the first render with nothing typed yet to merge.
export function restoredDraft(address: DraftAddress, now: number = Date.now()): Draft | undefined {
  const entry = readDraft(address);
  const opened = openEntry(entry, now);
  if (opened !== entry) writeDraft(address, opened);
  return opened?.draft;
}

export function useSavedDraft({
  address,
  restored,
  words,
  onRestoreQuote,
}: {
  address: DraftAddress;
  // What restoredDraft gave the composer, so what it shows counts as saved.
  restored: Draft | undefined;
  // What the field holds as a draft, with the reply set on screen.
  words: Words;
  // The restored draft's quote: the screen sets the reply if the message
  // is there. None takes back one still waiting.
  onRestoreQuote: (messageId: string | undefined) => void;
}) {
  // The composer is keyed by channel and root, so the address it mounted
  // with is the one it keeps; the object given may be new each render.
  const mountAddress = useRef(address).current;
  const wordsRef = useRef(words);
  wordsRef.current = words;
  const onRestoreQuoteRef = useRef(onRestoreQuote);
  onRestoreQuoteRef.current = onRestoreQuote;
  // What the field showed when it was last saved or restored; the words
  // are unsaved while they differ, and only then does this composer write.
  // At restore the field shows the words and no quote: the reply is the
  // screen's to set, and when it does the field shows what is stored and
  // counts as saved (the debounce sees to that); when it never does (the
  // message isn't loaded, or is deleted) nothing is written and the
  // stored quote waits for the next visit, as on web.
  const savedRef = useRef<Words>({ text: restored?.text ?? "", quotedMessageId: undefined });

  const unsaved = () => !sameWords(wordsRef.current, savedRef.current);
  const save = () => {
    const { text, quotedMessageId } = wordsRef.current;
    writeDraft(mountAddress, withDraft(readDraft(mountAddress), fieldDraft(text, quotedMessageId, Date.now())));
    savedRef.current = { text, quotedMessageId };
  };

  // Opening: the quote is the screen's to put back. Leaving: the
  // keystrokes since the last debounce.
  useEffect(() => {
    const quotedMessageId = restored?.quotedMessageId;
    if (quotedMessageId) onRestoreQuoteRef.current(quotedMessageId);
    return () => {
      if (unsaved()) save();
    };
  }, []);

  // The debounce: every change restarts it, and it only fires with
  // something still unsaved (a save as the app left the front may have
  // come first). A field that shows what is stored, as it does once the
  // screen sets a restored quote back, has nothing to write and is saved
  // as it stands; otherwise a cancelled quote would go unheeded until the
  // debounce wrote the same words again.
  useEffect(() => {
    if (!unsaved()) return;
    const stored = readDraft(mountAddress)?.draft;
    if (stored && sameWords(wordsRef.current, stored)) {
      savedRef.current = { text: stored.text, quotedMessageId: stored.quotedMessageId };
      return;
    }
    const timer = setTimeout(() => {
      if (unsaved()) save();
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [words.text, words.quotedMessageId]);

  // The app leaving the front (inactive: the app switcher, a system
  // sheet; background), from where it may be killed with nothing
  // unmounted.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" && unsaved()) save();
    });
    return () => sub.remove();
  }, []);

  // Send pressed: the words are held apart from the draft, hidden from
  // the field, until the server answers. The field was cleared with the
  // send: nothing of the draft is left to save, and a restored quote the
  // screen has yet to set was for words that are gone. A send holding
  // nothing (attachments only) has no words to hold apart and its ticket
  // does nothing, but words shown here and erased just before it, not
  // yet saved as gone, go from the store; a field that showed nothing
  // leaves a draft saved elsewhere (the same channel open again on top)
  // alone.
  const startSend = (sent: Words): SendTicket => {
    onRestoreQuoteRef.current(undefined);
    const sending = beginSend(sent, Date.now());
    if (sending) writeDraft(mountAddress, sending);
    else if (unsaved()) writeDraft(mountAddress, withDraft(readDraft(mountAddress), undefined));
    savedRef.current = { text: "", quotedMessageId: undefined };
    if (!sending) return { finish: () => {}, fail: () => {} };
    return {
      finish: () => writeDraft(mountAddress, finishSend(readDraft(mountAddress))),
      // The words join whatever draft is stored by now, wherever the
      // person is: on screen the composer puts them in the field as well.
      fail: () => writeDraft(mountAddress, failSend(readDraft(mountAddress), sent, Date.now())),
    };
  };

  return { startSend };
}

function sameWords(one: Words, other: Words): boolean {
  return one.text === other.text && one.quotedMessageId === other.quotedMessageId;
}
