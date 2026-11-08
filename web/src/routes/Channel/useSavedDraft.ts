import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { onDraftChange, readDraft, writeDraft } from "../../api/drafts";
import {
  beginSend,
  type Draft,
  failSend,
  fieldDraft,
  finishSend,
  openEntry,
  type Words,
  withDraft,
} from "../../core/drafts";

// The composer's words, kept on the device under their key (core/drafts.ts
// → draftKey) so they are there when the channel or thread opens again
// (docs/proposals/drafts.md). The composer shows `text`, reports typing
// through `setText` and brackets each send with `startSend`; this saves,
// restores and follows the other tab. Without a key (no account: the
// story) it is plain state.

// Typing stopped this long ago: save. The save that matters, since a
// closed tab or a crash never unmounts anything.
const SAVE_DEBOUNCE_MS = 1000;

// A send under way: every one ends in finish or fail, or its words would
// stall and come back a second time (core/drafts.ts).
export interface SendTicket {
  finish(): void;
  fail(): void;
}

// Nothing held: an attachments-only send, or no key.
const NO_SEND: SendTicket = { finish: () => {}, fail: () => {} };

export function useSavedDraft({
  key,
  quotedMessageId,
  onRestoreQuote,
}: {
  key: string | undefined;
  // The reply set on screen, saved with the words.
  quotedMessageId: string | undefined;
  // A shown draft's quote, or none: the screen sets the reply if the
  // message is there, and clears it for none.
  onRestoreQuote: (messageId: string | undefined) => void;
}) {
  const [text, setText] = useState("");
  const textRef = useRef(text);
  textRef.current = text;
  const quoteRef = useRef(quotedMessageId);
  quoteRef.current = quotedMessageId;
  const onRestoreQuoteRef = useRef(onRestoreQuote);
  onRestoreQuoteRef.current = onRestoreQuote;
  // What the field showed when it was last saved or shown. The field has
  // unsaved changes when it differs, and only then does this composer
  // write: the same channel open in two tabs must not overwrite the newer
  // draft or bring back a sent one.
  const savedRef = useRef<Words>({ text: "" });

  const shown = (): Words => ({
    text: textRef.current,
    quotedMessageId: quoteRef.current,
  });
  const unsaved = () =>
    textRef.current !== savedRef.current.text ||
    quoteRef.current !== savedRef.current.quotedMessageId;

  // Under the key given, not the current one: the channel composer's key
  // has already changed when its save on switching runs.
  const save = (underKey: string) => {
    const words = shown();
    const draft = fieldDraft(words.text, words.quotedMessageId, Date.now());
    writeDraft(underKey, withDraft(readDraft(underKey), draft));
    savedRef.current = words;
  };
  const saveIfUnsaved = (underKey: string) => {
    if (unsaved()) save(underKey);
  };

  // A stored draft going in the field: its quote goes to the screen, which
  // sets the reply once the log holds the message. What is recorded as
  // saved is the field as it is, with no reply yet: once the screen sets
  // it the field differs and the debounce writes the quote back, and a
  // message not in the log leaves the stored quote waiting for the next
  // visit rather than saving over it.
  const show = (draft: Draft | undefined) => {
    savedRef.current = { text: draft?.text ?? "" };
    setText(draft?.text ?? "");
    onRestoreQuoteRef.current(draft?.quotedMessageId);
  };

  // Opening: the stored draft is shown before paint; leaving (a new key or
  // unmount) saves what changed. The read is synchronous, so there is
  // nothing typed yet to merge.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the field is read through refs
  useLayoutEffect(() => {
    if (!key) return;
    const entry = readDraft(key);
    const opened = openEntry(entry, Date.now());
    if (opened !== entry) writeDraft(key, opened);
    show(opened?.draft);
    return () => saveIfUnsaved(key);
  }, [key]);

  // The debounce: every change restarts it, and it only fires with
  // something unsaved.
  // biome-ignore lint/correctness/useExhaustiveDependencies: text and the quote are what is debounced; the field is read through refs
  useEffect(() => {
    if (!key || !unsaved()) return;
    const timer = setTimeout(() => save(key), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key, text, quotedMessageId]);

  // Going to the background, closing or navigating away: the keystrokes
  // since the last debounce. Not beforeunload, which is unreliable and
  // keeps the page out of the back-forward cache.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the field is read through refs
  useEffect(() => {
    if (!key) return;
    const onHidden = () => {
      if (document.visibilityState === "hidden") saveIfUnsaved(key);
    };
    const onPageHide = () => saveIfUnsaved(key);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [key]);

  // Another tab wrote this key: with nothing unsaved here, its draft is
  // shown (and an emptied one empties the field, so words sent there can't
  // be sent again from here). With changes unsaved, the last edit wins,
  // and that is this one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the field is read through refs
  useEffect(() => {
    if (!key) return;
    return onDraftChange(key, (entry) => {
      if (!unsaved()) show(entry?.draft);
    });
  }, [key]);

  // Send pressed: the words are held apart from the draft, hidden from the
  // field, until the server answers.
  const startSend = (words: Words): SendTicket => {
    const sending = key ? beginSend(words, Date.now()) : undefined;
    if (!key || !sending) return NO_SEND;
    writeDraft(key, sending);
    // The field was cleared with the send: nothing of the draft is left
    // to save.
    savedRef.current = { text: "" };
    return {
      finish: () => writeDraft(key, finishSend(readDraft(key))),
      // The words join whatever draft is stored by now, wherever the
      // person is: on screen the composer puts them in the field as well.
      fail: () => writeDraft(key, failSend(readDraft(key), words, Date.now())),
    };
  };

  return { text, setText, startSend };
}
