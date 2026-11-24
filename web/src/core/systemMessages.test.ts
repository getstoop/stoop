import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { ChannelPostPolicy } from "../gen/stoop/chat/v1/channel_pb";
import {
  type Message,
  type MessageAuthor,
  MessageAuthorSchema,
  MessageSchema,
  SystemEventSchema,
} from "../gen/stoop/chat/v1/message_pb";
import {
  isHiddenSystemRow,
  isSystemRow,
  systemLine,
  systemText,
  withoutHiddenSystemRows,
} from "./systemMessages";

const person = (id: string, displayName: string, deleted = false) =>
  create(MessageAuthorSchema, { id, username: id, displayName, deleted });

const maya = person("maya", "Maya Okafor");
const people = [
  person("jun", "Jun Watanabe"),
  person("priya", "Priya Nair"),
  person("tomas", "Tomas Lind"),
  person("elif", "Elif Demir"),
  person("sam", "Sam Reyes"),
];

const row = (
  kind: MessageInitShape<typeof SystemEventSchema>["kind"],
  extra: MessageInitShape<typeof MessageSchema> = {},
): Message => {
  const made = create(MessageSchema, { id: "m1", quiet: true, ...extra });
  made.author ??= maya;
  made.event = create(SystemEventSchema, { kind });
  return made;
};

const said = (message: Message) => {
  const line = systemLine(message);
  return line && { glyph: line.glyph, text: systemText(line.parts) };
};

const added = (members: MessageAuthor[]) =>
  row({ case: "membersAdded", value: { members } });

describe("systemLine", () => {
  it("names who was added: one, two, three, then two and a count", () => {
    expect(said(added(people.slice(0, 1)))).toEqual({
      glyph: "person-plus",
      text: "Maya Okafor added Jun Watanabe",
    });
    expect(said(added(people.slice(0, 2)))?.text).toBe(
      "Maya Okafor added Jun Watanabe and Priya Nair",
    );
    expect(said(added(people.slice(0, 3)))?.text).toBe(
      "Maya Okafor added Jun Watanabe, Priya Nair and Tomas Lind",
    );
    expect(said(added(people))?.text).toBe(
      "Maya Okafor added Jun Watanabe, Priya Nair and 3 others",
    );
  });

  it("keeps the people a long list leaves out, for the unfold", () => {
    const line = systemLine(added(people));
    const others = line?.parts.find((part) => part.kind === "others");
    expect(others).toEqual({
      kind: "others",
      label: "3 others",
      people: people.slice(2),
    });
    const named = line?.parts.filter((part) => part.kind === "person");
    expect(
      named?.map((part) => part.kind === "person" && part.person.id),
    ).toEqual(["maya", "jun", "priya"]);
  });

  it("unfolds a long list to every name, and says which way it is", () => {
    const unfolded = systemLine(added(people), true);
    expect(unfolded && systemText(unfolded.parts)).toBe(
      "Maya Okafor added Jun Watanabe, Priya Nair, Tomas Lind, Elif Demir and Sam Reyes",
    );
    expect(unfolded?.parts.some((part) => part.kind === "others")).toBe(false);
    expect(unfolded?.fold).toBe("unfolded");
    expect(systemLine(added(people))?.fold).toBe("folded");
    expect(systemLine(added(people.slice(0, 4)))?.fold).toBe("folded");
  });

  it("has nothing to fold in a list of three or fewer", () => {
    for (const count of [1, 2, 3]) {
      const folded = systemLine(added(people.slice(0, count)));
      const unfolded = systemLine(added(people.slice(0, count)), true);
      expect(folded?.fold).toBeUndefined();
      expect(unfolded).toEqual(folded);
    }
    expect(systemLine(added([maya]), true)?.fold).toBeUndefined();
    expect(
      systemLine(row({ case: "memberLeft", value: {} }), true)?.fold,
    ).toBeUndefined();
  });

  it("says joined when the only person added is the author", () => {
    expect(said(added([maya]))).toEqual({
      glyph: "arrow-in",
      text: "Maya Okafor joined",
    });
  });

  it("says left", () => {
    expect(said(row({ case: "memberLeft", value: {} }))).toEqual({
      glyph: "arrow-out",
      text: "Maya Okafor left",
    });
  });

  it("says a rename, the new name the current one", () => {
    const message = row({
      case: "channelRenamed",
      value: { oldName: "games", newName: "game-night" },
    });
    expect(said(message)).toEqual({
      glyph: "pencil",
      text: "Maya Okafor renamed the channel from #games to #game-night",
    });
    const channels = systemLine(message)?.parts.filter(
      (part) => part.kind === "channel",
    );
    expect(channels).toEqual([
      { kind: "channel", name: "games", current: false },
      { kind: "channel", name: "game-night", current: true },
    ]);
  });

  it("says a topic set, and one cleared", () => {
    expect(
      said(
        row({
          case: "topicChanged",
          value: { topic: "Friday nights, mostly co-op" },
        }),
      ),
    ).toEqual({
      glyph: "text-lines",
      text: "Maya Okafor set the topic: Friday nights, mostly co-op",
    });
    expect(said(row({ case: "topicChanged", value: { topic: "" } }))).toEqual({
      glyph: "text-lines",
      text: "Maya Okafor cleared the topic",
    });
  });

  it("says a pin with its excerpt, and nothing once its message is gone", () => {
    const pin = { case: "pin", value: {} } as const;
    const kept = row(pin, {
      reference: {
        messageId: "m0",
        author: people[0],
        preview: "House rules: mute…",
      },
    });
    expect(said(kept)).toEqual({
      glyph: "pin",
      text: "Maya Okafor pinned a message: House rules: mute…",
    });
    expect(systemLine(kept)?.parts.at(-1)).toEqual({
      kind: "excerpt",
      messageId: "m0",
      text: "House rules: mute…",
    });
    // Its message deleted (a row from before the server removed them):
    // the id alone. Swept by retention: no reference at all.
    expect(systemLine(row(pin, { reference: { messageId: "m0" } }))).toBeNull();
    expect(systemLine(row(pin))).toBeNull();
  });

  it("says a pin of a live message with no excerpt, and still goes to it", () => {
    // An empty code block excerpts to nothing; the author says it is there.
    const blank = row(
      { case: "pin", value: {} },
      { reference: { messageId: "m0", author: people[0], preview: "" } },
    );
    expect(said(blank)).toEqual({
      glyph: "pin",
      text: "Maya Okafor pinned a message",
    });
    expect(systemLine(blank)?.parts.at(-1)).toEqual({
      kind: "excerpt",
      messageId: "m0",
      text: "",
    });
    expect(isHiddenSystemRow(blank)).toBe(false);
  });

  it("says the announcement switch both ways", () => {
    const policy = (postPolicy: ChannelPostPolicy) =>
      said(row({ case: "postPolicyChanged", value: { postPolicy } }));
    expect(policy(ChannelPostPolicy.ADMINS)).toEqual({
      glyph: "megaphone",
      text: "Maya Okafor made this an announcement channel",
    });
    expect(policy(ChannelPostPolicy.EVERYONE)?.text).toBe(
      "Maya Okafor opened this channel to everyone's messages again",
    );
  });

  it("marks a deleted account by its name", () => {
    const gone = person("noor", "Noor Haddad", true);
    expect(
      said(row({ case: "memberLeft", value: {} }, { author: gone }))?.text,
    ).toBe("Noor Haddad (deleted) left");
  });

  it("hides an unknown kind when quiet, and asks for an update otherwise", () => {
    const unknown = { case: undefined } as const;
    expect(systemLine(row(unknown))).toBeNull();
    expect(said(row(unknown, { quiet: false }))).toEqual({
      glyph: "update",
      text: "Update Stoop to see this message.",
    });
  });

  it("has nothing to say for a message someone wrote", () => {
    expect(systemLine(create(MessageSchema, { content: "hi" }))).toBeNull();
  });

  it("asks for an update on a poll and its closing row, not drawn yet", () => {
    const update = {
      glyph: "update",
      text: "Update Stoop to see this message.",
    };
    const poll = row(
      { case: "poll", value: { question: "Friday?" } },
      { quiet: false, content: "Friday?" },
    );
    const closed = row(
      { case: "pollClosed", value: { question: "Friday?" } },
      { quiet: false, content: "Friday?" },
    );
    expect(said(poll)).toEqual(update);
    expect(said(closed)).toEqual(update);
    expect(isSystemRow(poll)).toBe(true);
    expect(isHiddenSystemRow(poll)).toBe(false);
    expect(isHiddenSystemRow(closed)).toBe(false);
  });

  // A kind added to the wire must get its wording here. The two poll
  // kinds are on the wire ahead of their wording (the test above).
  it("has wording for every kind the wire has", () => {
    const notDrawnYet = ["poll", "pollClosed"];
    const cases = SystemEventSchema.fields
      .map((field) => field.localName)
      .filter((kindCase) => !notDrawnYet.includes(kindCase));
    expect(cases.length).toBeGreaterThanOrEqual(6);
    for (const kindCase of cases) {
      const event = create(SystemEventSchema);
      // biome-ignore lint/suspicious/noExplicitAny: each case's empty message
      (event.kind as any) = {
        case: kindCase,
        value: create(
          // biome-ignore lint/style/noNonNullAssertion: every case is a message
          SystemEventSchema.fields.find(
            (field) => field.localName === kindCase,
          )!.message!,
        ),
      };
      // A row about a message carries its excerpt.
      const reference = {
        messageId: "m0",
        author: people[0],
        preview: "House rules",
      };
      const line = systemLine(
        create(MessageSchema, { author: maya, quiet: true, event, reference }),
      );
      expect(line, kindCase).not.toBeNull();
      expect(line?.glyph, kindCase).not.toBe("update");
    }
  });
});

describe("hidden system rows", () => {
  const unknownQuiet = row({ case: undefined }, { id: "m2" });
  const unknownLoud = row({ case: undefined }, { id: "m3", quiet: false });
  const known = row({ case: "memberLeft", value: {} }, { id: "m4" });
  const written = create(MessageSchema, { id: "m5", content: "hi" });
  const pin = { case: "pin", value: {} } as const;
  const pinKept = row(pin, {
    id: "m6",
    reference: { messageId: "m5", author: maya, preview: "hi" },
  });
  const pinOfDeleted = row(pin, { id: "m7", reference: { messageId: "m5" } });
  const pinOfSwept = row(pin, { id: "m8" });

  it("is an unknown kind that is quiet, or a pin whose message is gone", () => {
    expect(isHiddenSystemRow(unknownQuiet)).toBe(true);
    expect(isHiddenSystemRow(unknownLoud)).toBe(false);
    expect(isHiddenSystemRow(known)).toBe(false);
    expect(isHiddenSystemRow(written)).toBe(false);
    expect(isHiddenSystemRow(pinKept)).toBe(false);
    expect(isHiddenSystemRow(pinOfDeleted)).toBe(true);
    expect(isHiddenSystemRow(pinOfSwept)).toBe(true);
    expect(isSystemRow(known)).toBe(true);
    expect(isSystemRow(written)).toBe(false);
  });

  it("is left out of a list, which is the same array when none is", () => {
    const rows = [
      written,
      unknownQuiet,
      known,
      pinKept,
      pinOfDeleted,
      unknownLoud,
      pinOfSwept,
    ];
    expect(withoutHiddenSystemRows(rows).map((message) => message.id)).toEqual([
      "m5",
      "m4",
      "m6",
      "m3",
    ]);
    const none = [written, known];
    expect(withoutHiddenSystemRows(none)).toBe(none);
  });
});
