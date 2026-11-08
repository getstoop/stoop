import { describe, expect, it } from "vitest";
import {
  beginSend,
  DRAFT_EXPIRY_MS,
  type Draft,
  draftKey,
  failSend,
  fieldDraft,
  finishSend,
  isEntryExpired,
  isExpired,
  isStalled,
  joinDraft,
  openEntry,
  SEND_STALL_MS,
  toDraftEntry,
  withDraft,
} from "./drafts";

const NOW = 1_700_000_000_000;
const at = (ageMs: number, text = "words"): Draft => ({
  text,
  writtenAt: NOW - ageMs,
});

describe("draftKey", () => {
  it("names the account, channel and thread root", () => {
    expect(draftKey({ accountId: "acct", channelId: "chan" })).toBe(
      "acct/chan/",
    );
    expect(
      draftKey({ accountId: "acct", channelId: "chan", threadRootId: "root" }),
    ).toBe("acct/chan/root");
  });

  it("leads with the server when one is given", () => {
    expect(
      draftKey({ serverId: "srv", accountId: "acct", channelId: "chan" }),
    ).toBe("srv/acct/chan/");
  });

  it("keeps a channel's and its thread's drafts apart", () => {
    const channel = draftKey({ accountId: "acct", channelId: "chan" });
    const thread = draftKey({
      accountId: "acct",
      channelId: "chan",
      threadRootId: "root",
    });
    expect(channel).not.toBe(thread);
  });
});

describe("isExpired", () => {
  it("is false under the expiry and true from exactly the expiry", () => {
    expect(isExpired(at(DRAFT_EXPIRY_MS - 1), NOW)).toBe(false);
    expect(isExpired(at(DRAFT_EXPIRY_MS), NOW)).toBe(true);
    expect(isExpired(at(DRAFT_EXPIRY_MS + 1), NOW)).toBe(true);
  });

  it("is false for a draft written just now", () => {
    expect(isExpired(at(0), NOW)).toBe(false);
  });
});

describe("isStalled", () => {
  it("is false under the stall age and true from exactly the stall age", () => {
    expect(isStalled(at(SEND_STALL_MS - 1), NOW)).toBe(false);
    expect(isStalled(at(SEND_STALL_MS), NOW)).toBe(true);
    expect(isStalled(at(SEND_STALL_MS + 1), NOW)).toBe(true);
  });
});

describe("fieldDraft", () => {
  it("is the field's words", () => {
    expect(fieldDraft("hello", undefined, NOW)).toEqual({
      text: "hello",
      writtenAt: NOW,
    });
  });

  it("is nothing when the field is emptied", () => {
    expect(fieldDraft("", undefined, NOW)).toBeUndefined();
    expect(fieldDraft("   ", undefined, NOW)).toBeUndefined();
  });

  it("keeps an emptied field's quote until it is cancelled", () => {
    expect(fieldDraft("", "msg1", NOW)).toEqual({
      text: "",
      quotedMessageId: "msg1",
      writtenAt: NOW,
    });
  });
});

describe("withDraft", () => {
  it("replaces the draft and keeps the sending words", () => {
    const sending = at(1000, "out");
    expect(withDraft({ sending }, at(0, "new"))).toEqual({
      draft: at(0, "new"),
      sending,
    });
  });

  it("drops an emptied draft, and the entry when nothing is left", () => {
    const sending = at(1000, "out");
    expect(withDraft({ draft: at(0), sending }, undefined)).toEqual({
      sending,
    });
    expect(withDraft({ draft: at(0) }, undefined)).toBeUndefined();
    expect(withDraft(undefined, undefined)).toBeUndefined();
  });
});

describe("joinDraft", () => {
  it("puts the words ahead of what was typed since", () => {
    expect(joinDraft({ text: "sent" }, at(0, "typed since"), NOW)).toEqual({
      text: "sent\ntyped since",
      writtenAt: NOW,
    });
  });

  it("gives the words back when nothing was typed", () => {
    expect(joinDraft({ text: "sent" }, undefined, NOW)).toEqual({
      text: "sent",
      writtenAt: NOW,
    });
    expect(joinDraft({ text: "sent" }, at(0, "  "), NOW)?.text).toBe("sent");
  });

  it("keeps the draft's quote over the words' quote", () => {
    const draft: Draft = { text: "typed", quotedMessageId: "m2", writtenAt: 1 };
    expect(
      joinDraft({ text: "sent", quotedMessageId: "m1" }, draft, NOW)
        ?.quotedMessageId,
    ).toBe("m2");
    expect(
      joinDraft({ text: "sent", quotedMessageId: "m1" }, at(0), NOW)
        ?.quotedMessageId,
    ).toBe("m1");
  });

  it("is nothing when the joined words are blank and nothing is quoted", () => {
    expect(joinDraft({ text: "" }, undefined, NOW)).toBeUndefined();
    expect(joinDraft({ text: " " }, at(0, ""), NOW)).toBeUndefined();
    expect(joinDraft({ text: "" }, at(0, "typed"), NOW)?.text).toBe("typed");
    expect(
      joinDraft({ text: "", quotedMessageId: "m1" }, undefined, NOW),
    ).toEqual({ text: "", quotedMessageId: "m1", writtenAt: NOW });
  });
});

describe("openEntry", () => {
  it("is nothing for nothing, and for an entry with no slots", () => {
    expect(openEntry(undefined, NOW)).toBeUndefined();
    expect(openEntry({}, NOW)).toBeUndefined();
  });

  it("returns the same entry when nothing changed", () => {
    const entry = { draft: at(1000), sending: at(SEND_STALL_MS - 1, "out") };
    expect(openEntry(entry, NOW)).toBe(entry);
  });

  it("drops an expired draft", () => {
    expect(openEntry({ draft: at(DRAFT_EXPIRY_MS) }, NOW)).toBeUndefined();
    expect(
      openEntry({ draft: at(DRAFT_EXPIRY_MS), sending: at(0, "out") }, NOW),
    ).toEqual({ sending: at(0, "out") });
  });

  it("keeps a young send hidden", () => {
    const sending = at(SEND_STALL_MS - 1, "out");
    expect(openEntry({ sending }, NOW)).toEqual({ sending });
  });

  it("brings a stalled send back into the draft", () => {
    const sending = at(SEND_STALL_MS, "out");
    expect(openEntry({ sending }, NOW)).toEqual({
      draft: { text: "out", writtenAt: NOW },
    });
    expect(openEntry({ sending, draft: at(5000, "more") }, NOW)).toEqual({
      draft: { text: "out\nmore", writtenAt: NOW },
    });
  });

  it("keeps a stalled send's quote", () => {
    const sending: Draft = {
      text: "out",
      quotedMessageId: "m1",
      writtenAt: NOW - SEND_STALL_MS,
    };
    expect(openEntry({ sending }, NOW)).toEqual({
      draft: { text: "out", quotedMessageId: "m1", writtenAt: NOW },
    });
  });

  it("brings nothing back from a stalled send of blank words", () => {
    expect(openEntry({ sending: at(SEND_STALL_MS, "") }, NOW)).toBeUndefined();
  });

  it("drops a send older than the expiry instead of bringing it back", () => {
    const sending = at(DRAFT_EXPIRY_MS, "out");
    expect(openEntry({ sending }, NOW)).toBeUndefined();
    expect(openEntry({ sending, draft: at(0, "kept") }, NOW)).toEqual({
      draft: at(0, "kept"),
    });
  });
});

describe("beginSend", () => {
  it("holds the words as sending with the field cleared", () => {
    expect(beginSend({ text: "out" }, NOW)).toEqual({
      sending: { text: "out", writtenAt: NOW },
    });
    expect(beginSend({ text: "out", quotedMessageId: "m1" }, NOW)).toEqual({
      sending: { text: "out", quotedMessageId: "m1", writtenAt: NOW },
    });
  });

  it("holds nothing for an attachments-only send", () => {
    expect(beginSend({ text: "" }, NOW)).toBeUndefined();
    expect(beginSend({ text: "", quotedMessageId: "m1" }, NOW)).toEqual({
      sending: { text: "", quotedMessageId: "m1", writtenAt: NOW },
    });
  });
});

describe("finishSend", () => {
  it("deletes the sending words and keeps a newer draft", () => {
    expect(finishSend({ sending: at(0, "out") })).toBeUndefined();
    expect(finishSend({ sending: at(0, "out"), draft: at(0, "next") })).toEqual(
      { draft: at(0, "next") },
    );
    expect(finishSend(undefined)).toBeUndefined();
  });
});

describe("failSend", () => {
  it("puts the words into the draft and clears the sending slot", () => {
    expect(failSend({ sending: at(0, "out") }, { text: "out" }, NOW)).toEqual({
      draft: { text: "out", writtenAt: NOW },
    });
    expect(
      failSend(
        { sending: at(0, "out"), draft: at(0, "since") },
        { text: "out" },
        NOW,
      ),
    ).toEqual({ draft: { text: "out\nsince", writtenAt: NOW } });
    expect(failSend(undefined, { text: "out" }, NOW)).toEqual({
      draft: { text: "out", writtenAt: NOW },
    });
  });

  it("leaves nothing for a failed attachments-only send", () => {
    expect(failSend(undefined, { text: "" }, NOW)).toBeUndefined();
    expect(failSend({ sending: at(0, "") }, { text: "" }, NOW)).toBeUndefined();
  });
});

describe("isEntryExpired", () => {
  it("is true only when every slot is past the expiry", () => {
    expect(isEntryExpired({ draft: at(DRAFT_EXPIRY_MS) }, NOW)).toBe(true);
    expect(isEntryExpired({ draft: at(DRAFT_EXPIRY_MS - 1) }, NOW)).toBe(false);
    expect(
      isEntryExpired(
        { draft: at(DRAFT_EXPIRY_MS), sending: at(0, "out") },
        NOW,
      ),
    ).toBe(false);
    expect(
      isEntryExpired(
        { draft: at(DRAFT_EXPIRY_MS), sending: at(DRAFT_EXPIRY_MS, "out") },
        NOW,
      ),
    ).toBe(true);
  });

  it("is true for an entry with no slots", () => {
    expect(isEntryExpired({}, NOW)).toBe(true);
  });
});

describe("toDraftEntry", () => {
  it("reads a stored entry back", () => {
    const entry = {
      draft: { text: "a", quotedMessageId: "m1", writtenAt: 1 },
      sending: { text: "b", writtenAt: 2 },
    };
    expect(toDraftEntry(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
  });

  it("is nothing for anything that is not one", () => {
    expect(toDraftEntry(undefined)).toBeUndefined();
    expect(toDraftEntry(null)).toBeUndefined();
    expect(toDraftEntry("words")).toBeUndefined();
    expect(toDraftEntry({})).toBeUndefined();
    expect(toDraftEntry({ draft: { text: 1, writtenAt: 1 } })).toBeUndefined();
    expect(toDraftEntry({ draft: { text: "a" } })).toBeUndefined();
    expect(
      toDraftEntry({ draft: { text: "a", writtenAt: Number.NaN } }),
    ).toBeUndefined();
    expect(
      toDraftEntry({ draft: { text: "a", writtenAt: 1, quotedMessageId: 2 } }),
    ).toBeUndefined();
  });

  it("reads a stored blank slot with no quote as nothing", () => {
    expect(toDraftEntry({ draft: { text: "", writtenAt: 1 } })).toBeUndefined();
  });

  it("keeps the good slot when the other is malformed", () => {
    expect(
      toDraftEntry({ draft: { text: "a", writtenAt: 1 }, sending: "no" }),
    ).toEqual({ draft: { text: "a", writtenAt: 1 } });
  });
});
