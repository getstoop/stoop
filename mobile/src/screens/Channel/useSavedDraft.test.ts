import { type Draft, type DraftEntry, SEND_STALL_MS, type Words } from "@stoop/core/drafts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftAddress } from "../../api/drafts";
import type { SendTicket } from "./useSavedDraft";

// The hook over a draft store held in memory, with React Native's
// AppState faked; it renders with web's react-dom into a stub element,
// as RealtimeProvider's test does. What is asserted is what the store
// holds after each thing the composer does, and when nothing is written.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { store, app } = vi.hoisted(() => ({
  store: { entries: new Map<string, unknown>(), writes: 0 },
  app: { listeners: new Set<(state: string) => void>() },
}));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_type: string, listener: (state: string) => void) => {
      app.listeners.add(listener);
      return { remove: () => app.listeners.delete(listener) };
    },
  },
}));
vi.mock("../../api/drafts", () => ({
  readDraft: (address: DraftAddress) => store.entries.get(JSON.stringify(address)),
  writeDraft: (address: DraftAddress, entry: unknown) => {
    store.writes++;
    if (entry) store.entries.set(JSON.stringify(address), entry);
    else store.entries.delete(JSON.stringify(address));
  },
}));
// react-dom looks for a window as it loads, and for this much of an
// element to render into.
vi.stubGlobal("window", {});
const { restoredDraft, useSavedDraft } = await import("./useSavedDraft");

const ignore = () => {};
const container = {
  nodeType: 1,
  tagName: "DIV",
  addEventListener: ignore,
  removeEventListener: ignore,
  ownerDocument: {
    addEventListener: ignore,
    removeEventListener: ignore,
    defaultView: { document: {}, HTMLIFrameElement: class {} },
  },
} as unknown as Element;

const NOW = 1_700_000_000_000;
const ADDRESS: DraftAddress = { serverId: "abc123", accountId: "me", channelId: "general" };
const QUOTE = "0190a5c4-0000-7000-8000-00000000000a";
const held = () => store.entries.get(JSON.stringify(ADDRESS)) as DraftEntry | undefined;
const keep = (entry: DraftEntry) => store.entries.set(JSON.stringify(ADDRESS), entry);
const words = (text: string, quotedMessageId?: string): Words => ({ text, quotedMessageId });

describe("restoredDraft", () => {
  beforeEach(() => {
    store.entries.clear();
    store.writes = 0;
  });

  it("gives the stored draft and writes nothing when opening changed nothing", () => {
    keep({ draft: { text: "hello", quotedMessageId: QUOTE, writtenAt: NOW - 1000 } });
    expect(restoredDraft(ADDRESS, NOW)).toEqual({ text: "hello", quotedMessageId: QUOTE, writtenAt: NOW - 1000 });
    expect(store.writes).toBe(0);
  });

  it("brings a stalled send back as the draft and writes that back", () => {
    keep({ sending: { text: "lost", writtenAt: NOW - SEND_STALL_MS } });
    expect(restoredDraft(ADDRESS, NOW)).toEqual({ text: "lost", writtenAt: NOW });
    expect(held()).toEqual({ draft: { text: "lost", writtenAt: NOW } });
  });

  it("leaves a younger send hidden", () => {
    keep({ sending: { text: "out", writtenAt: NOW - 1000 } });
    expect(restoredDraft(ADDRESS, NOW)).toBeUndefined();
    expect(held()).toEqual({ sending: { text: "out", writtenAt: NOW - 1000 } });
  });
});

describe("useSavedDraft", () => {
  let root: Root;
  let startSend: (sent: Words) => SendTicket;
  const restoredQuotes: (string | undefined)[] = [];
  // The composer, as the hook sees it: what its field holds as a draft.
  function Harness({ restored, words }: { restored: Draft | undefined; words: Words }) {
    const saved = useSavedDraft({
      address: ADDRESS,
      restored,
      words,
      onRestoreQuote: (messageId) => restoredQuotes.push(messageId),
    });
    startSend = saved.startSend;
    return null;
  }
  const show = (restored: Draft | undefined, shown: Words) =>
    act(() => root.render(createElement(Harness, { restored, words: shown })));
  const unmount = () => act(() => root.unmount());
  const typingStops = () => act(() => vi.advanceTimersByTime(1000));
  const appGoes = (state: string) =>
    act(() => {
      for (const listener of app.listeners) listener(state);
    });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(NOW);
    store.entries.clear();
    store.writes = 0;
    restoredQuotes.length = 0;
    root = createRoot(container);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the screen for a restored quote once, at mount", async () => {
    const restored = { text: "hello", quotedMessageId: QUOTE, writtenAt: NOW };
    await show(restored, words("hello"));
    await show(restored, words("hello", QUOTE));
    expect(restoredQuotes).toEqual([QUOTE]);
    await unmount();
  });

  it("saves what was typed once it stops, with the quote, keeping a send still out", async () => {
    keep({ sending: { text: "out", writtenAt: NOW - 1000 } });
    await show(undefined, words(""));
    await show(undefined, words("hel", QUOTE));
    await act(() => vi.advanceTimersByTime(500));
    await show(undefined, words("hello", QUOTE));
    await act(() => vi.advanceTimersByTime(500));
    expect(store.writes).toBe(0);
    await act(() => vi.advanceTimersByTime(500));
    expect(held()).toEqual({
      draft: { text: "hello", quotedMessageId: QUOTE, writtenAt: NOW + 1500 },
      sending: { text: "out", writtenAt: NOW - 1000 },
    });
    expect(store.writes).toBe(1);
    await unmount();
    expect(store.writes).toBe(1);
  });

  it("counts the restored quote as saved once the screen sets the reply, writing nothing", async () => {
    const restored = { text: "hello", quotedMessageId: QUOTE, writtenAt: NOW - 1000 };
    keep({ draft: restored });
    await show(restored, words("hello"));
    await typingStops();
    await show(restored, words("hello", QUOTE));
    await typingStops();
    await appGoes("background");
    expect(store.writes).toBe(0);
    expect(held()).toEqual({ draft: restored });
    // A screen beneath, with the same channel open again on top: the
    // newer draft saved there is not overwritten as this one goes.
    keep({ draft: { text: "newer", writtenAt: NOW } });
    await unmount();
    expect(store.writes).toBe(0);
    expect(held()).toEqual({ draft: { text: "newer", writtenAt: NOW } });
  });

  it("saves a restored quote cancelled as soon as the screen set it", async () => {
    const restored = { text: "hello", quotedMessageId: QUOTE, writtenAt: NOW - 1000 };
    keep({ draft: restored });
    await show(restored, words("hello"));
    await show(restored, words("hello", QUOTE));
    await show(restored, words("hello"));
    await typingStops();
    expect(held()).toEqual({ draft: { text: "hello", writtenAt: NOW + 1000 } });
    await unmount();
    expect(store.writes).toBe(1);
  });

  it("lets a save as the app leaves the front stand in for the debounce", async () => {
    await show(undefined, words(""));
    await show(undefined, words("hello"));
    await appGoes("background");
    expect(held()).toEqual({ draft: { text: "hello", writtenAt: NOW } });
    // Saved elsewhere meanwhile (the same channel open again on top): the
    // debounce, firing with nothing unsaved here, leaves it be.
    keep({ draft: { text: "newer", writtenAt: NOW } });
    await typingStops();
    expect(store.writes).toBe(1);
    expect(held()).toEqual({ draft: { text: "newer", writtenAt: NOW } });
    await unmount();
  });

  it("leaves a stored quote waiting when the screen never sets the reply", async () => {
    const restored = { text: "hello", quotedMessageId: QUOTE, writtenAt: NOW - 1000 };
    keep({ draft: restored });
    await show(restored, words("hello"));
    await typingStops();
    await appGoes("background");
    await unmount();
    expect(store.writes).toBe(0);
    expect(held()).toEqual({ draft: restored });
  });

  it("writes nothing for a change taken back before typing stops", async () => {
    const restored = { text: "hello", writtenAt: NOW - 1000 };
    keep({ draft: restored });
    await show(restored, words("hello"));
    await show(restored, words("hello!"));
    await act(() => vi.advanceTimersByTime(500));
    await show(restored, words("hello"));
    await typingStops();
    await unmount();
    expect(store.writes).toBe(0);
  });

  it("saves as the app leaves the front and as the composer goes", async () => {
    await show(undefined, words(""));
    await show(undefined, words("hel"));
    await appGoes("inactive");
    expect(held()).toEqual({ draft: { text: "hel", writtenAt: NOW } });
    await appGoes("active");
    expect(store.writes).toBe(1);
    await show(undefined, words("hello"));
    await unmount();
    expect(held()).toEqual({ draft: { text: "hello", writtenAt: NOW } });
    expect(store.writes).toBe(2);
  });

  it("deletes the draft when the field is emptied", async () => {
    const restored = { text: "hello", writtenAt: NOW - 1000 };
    keep({ draft: restored });
    await show(restored, words("hello"));
    await show(restored, words(""));
    await typingStops();
    expect(held()).toBeUndefined();
  });

  it("saves the draft set aside for an edit, which has no quote", async () => {
    const restored = { text: "hello", quotedMessageId: QUOTE, writtenAt: NOW - 1000 };
    keep({ draft: restored });
    await show(restored, words("hello"));
    // The screen sets the reply, and the field shows the stored draft.
    await show(restored, words("hello", QUOTE));
    await typingStops();
    expect(store.writes).toBe(0);
    // The composer hands over the set-aside draft while the field holds
    // the edit; an edit begun drops the quote.
    await show(restored, words("hello"));
    await typingStops();
    expect(held()).toEqual({ draft: { text: "hello", writtenAt: NOW + 2000 } });
    await unmount();
    expect(store.writes).toBe(1);
  });

  it("holds a send apart from the draft until it finishes", async () => {
    await show(undefined, words(""));
    await show(undefined, words("hello", QUOTE));
    await typingStops();
    let ticket: SendTicket | undefined;
    await act(() => {
      ticket = startSend(words("hello", QUOTE));
    });
    await show(undefined, words(""));
    expect(held()).toEqual({ sending: { text: "hello", quotedMessageId: QUOTE, writtenAt: NOW + 1000 } });
    // A quote the screen was still to set is taken back with the send.
    expect(restoredQuotes).toEqual([undefined]);
    await show(undefined, words("more"));
    await typingStops();
    expect(held()?.draft?.text).toBe("more");
    ticket?.finish();
    expect(held()).toEqual({ draft: { text: "more", writtenAt: NOW + 2000 } });
    await unmount();
  });

  it("joins a send that fails after leaving to the stored draft", async () => {
    await show(undefined, words(""));
    let ticket: SendTicket | undefined;
    await act(() => {
      ticket = startSend(words("hello", QUOTE));
    });
    await show(undefined, words(""));
    await unmount();
    // Typed meanwhile from the same channel opened again.
    keep({ ...held(), draft: { text: "since", writtenAt: NOW } });
    ticket?.fail();
    expect(held()).toEqual({ draft: { text: "hello\nsince", quotedMessageId: QUOTE, writtenAt: NOW } });
  });

  it("holds a refused send's words once when the field shows them again", async () => {
    await show(undefined, words(""));
    let ticket: SendTicket | undefined;
    await act(() => {
      ticket = startSend(words("hello"));
    });
    await show(undefined, words(""));
    ticket?.fail();
    expect(held()).toEqual({ draft: { text: "hello", writtenAt: NOW } });
    // The composer puts the words back in the field with the reason: the
    // field shows what is stored, and nothing is written again.
    await show(undefined, words("hello"));
    await typingStops();
    expect(held()).toEqual({ draft: { text: "hello", writtenAt: NOW } });
    await unmount();
    expect(store.writes).toBe(2);
  });

  it("drops the stored draft for an attachments-only send, whose ticket does nothing", async () => {
    // The words were erased and the photo sent before typing had stopped.
    const restored = { text: "hello", writtenAt: NOW - 1000 };
    keep({ draft: restored, sending: { text: "out", writtenAt: NOW - 500 } });
    await show(restored, words("hello"));
    await show(restored, words(""));
    let ticket: SendTicket | undefined;
    await act(() => {
      ticket = startSend(words(""));
    });
    ticket?.finish();
    ticket?.fail();
    expect(store.writes).toBe(1);
    expect(held()).toEqual({ sending: { text: "out", writtenAt: NOW - 500 } });
    await typingStops();
    await unmount();
    expect(store.writes).toBe(1);
  });

  it("leaves a draft saved elsewhere alone for an attachments-only send from an empty field", async () => {
    await show(undefined, words(""));
    // Typed on the same channel opened again on top, and saved as it went.
    keep({ draft: { text: "hello", writtenAt: NOW } });
    await act(() => {
      startSend(words(""));
    });
    expect(store.writes).toBe(0);
    expect(held()).toEqual({ draft: { text: "hello", writtenAt: NOW } });
    await unmount();
  });
});
