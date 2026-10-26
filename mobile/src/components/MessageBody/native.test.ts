import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import { describe, expect, it } from "vitest";
import { markdown, themes } from "../../theme/generated";
import { parse } from "./blocks";
import type { ChannelLinks } from "./channelLinks";
import { firstCovered, type Line } from "./lines";
import { type BuildInput, buildDoc } from "./native";

const theme = themes.daylight;
const ME = "11111111-1111-1111-1111-111111111111";
const DEE = "22222222-2222-2222-2222-222222222222";
const RANDOM = "33333333-3333-3333-3333-333333333333";
const COVER = "spoiler, double tap to reveal";

const links: ChannelLinks = {
  channels: new Map([[RANDOM, { id: RANDOM, name: "random" } as Channel]]),
  open: () => {},
};

// A message's first paragraph: its lines, a quote's or a list row's.
const paragraph = (content: string): { lines: Line[]; emojiOnly: boolean } => {
  const { blocks, emojiOnly } = parse(content);
  const first = blocks[0];
  if (first?.type === "list") return { lines: first.rows[0].lines, emojiOnly };
  if (first?.type === "lines" || first?.type === "quote") return { lines: first.lines, emojiOnly };
  throw new Error(`no paragraph in ${JSON.stringify(content)}`);
};

// A paragraph built as NativeParagraph builds it, everything covered
// unless `revealed` names the spoiler's path.
const build = (content: string, extra: Partial<BuildInput> & { revealed?: string[] } = {}) => {
  const { revealed = [], ...rest } = extra;
  return buildDoc({
    ...paragraph(content),
    theme,
    myUserId: ME,
    mentionsEntireChannel: false,
    mentionsHere: false,
    links,
    compact: false,
    edited: false,
    fontScale: 1,
    isCovered: (path) => !revealed.includes(path),
    cover: COVER,
    ...rest,
  });
};

const runWith = (doc: ReturnType<typeof build>["doc"], text: string) => {
  const run = doc.runs.find((candidate) => candidate.text.includes(text));
  if (!run) throw new Error(`no run with ${JSON.stringify(text)}`);
  return run;
};

describe("buildDoc: spoilers", () => {
  it("keeps a covered spoiler's words out of the label", () => {
    const { doc, spoilers } = build("Read ||burnt|| ending");
    expect(doc.label).toBe(`Read ${COVER} ending`);
    expect(doc.label).not.toContain("burnt");
    expect(spoilers).toEqual(["0.0.1"]);
  });

  it("marks a covered spoiler's runs covered and never a link", () => {
    const { doc } = build("[the ||burnt|| ending](https://example.com)");
    const covered = doc.runs.filter((run) => run.covered);
    expect(covered.length).toBeGreaterThan(0);
    for (const run of covered) {
      expect(run.spoiler).toBe(0);
      expect(run.link).toBeUndefined();
      expect(run.linkId).toBeUndefined();
    }
    // The link around it is no link element while its words hide one.
    expect(runWith(doc, "the ").linkHidden).toBe(true);
    expect(doc.label).not.toContain("burnt");
  });

  it("covers a mention and a link inside a spoiler as plain words", () => {
    const { doc } = build(`||see <@u:${DEE}:dee> at https://example.com||`);
    for (const run of doc.runs) {
      expect(run.fill).toBeUndefined();
      expect(run.link).toBeUndefined();
      expect(run.covered).toBe(true);
    }
    expect(doc.label).toBe(COVER);
  });

  it("covers an emoji with an em space, which would draw through the cover", () => {
    const { doc } = build("||oldest tree 🍂||");
    expect(doc.runs.map((run) => run.text).join("")).not.toContain("🍂");
    expect(doc.runs.map((run) => run.text).join("")).toContain(" ");
  });

  it("shows a revealed spoiler's words, and its link again", () => {
    const { doc } = build("[the ||burnt|| ending](https://example.com)", { revealed: ["0.0.0.1"] });
    const burnt = runWith(doc, "burnt");
    expect(burnt.covered).toBeUndefined();
    expect(burnt.link).toBe("https://example.com");
    expect(runWith(doc, "the ").linkHidden).toBeUndefined();
    expect(doc.label).toBe("the burnt ending");
  });

  // Our parser closes a spoiler at the first || (`||a ||b|| c||` is two
  // spoilers), so the tree is built by hand: the runs don't count on it.
  const nested: Line[] = [
    {
      path: "0.0",
      nodes: [
        {
          type: "spoiler",
          children: [
            { type: "text", text: "a " },
            { type: "spoiler", children: [{ type: "text", text: "b" }] },
            { type: "text", text: " c" },
          ],
        },
      ],
    },
  ];

  it("gives a spoiler inside a covered one the outer's id, so a tap reveals the outer", () => {
    const { doc, spoilers } = build("", { lines: nested });
    expect(spoilers).toEqual(["0.0.0", "0.0.0.1"]);
    expect(doc.runs.map((run) => [run.text, run.spoiler, run.covered])).toEqual([
      ["a ", 0, true],
      ["b", 0, true],
      [" c", 0, true],
    ]);
    expect(doc.label).toBe(COVER);
  });

  it("covers the inner spoiler on its own once the outer is revealed", () => {
    const { doc } = build("", { lines: nested, revealed: ["0.0.0"] });
    expect(doc.runs.map((run) => [run.text, run.spoiler, run.covered])).toEqual([
      ["a ", 0, undefined],
      ["b", 1, true],
      [" c", 0, undefined],
    ]);
    expect(doc.label).toBe(`a ${COVER} c`);
  });

  it("reads both spoilers once both are revealed", () => {
    const { doc } = build("", { lines: nested, revealed: ["0.0.0", "0.0.0.1"] });
    expect(doc.runs.every((run) => !run.covered)).toBe(true);
    expect(doc.label).toBe("a b c");
  });

  it("keeps every spoiler covered in the compact card, read as 'spoiler'", () => {
    const { doc } = build("Read ||burnt|| ending", { compact: true, isCovered: () => true, cover: "spoiler" });
    expect(doc.label).toBe("Read spoiler ending");
  });
});

describe("buildDoc: pills", () => {
  it("draws a person mention as a pill, the reader's own filled", () => {
    const { doc } = build(`<@u:${DEE}:dee> and <@u:${ME}:ada>`);
    const dee = runWith(doc, "@dee");
    expect(dee.fill).toBe(theme[markdown.mentionBg]);
    expect(dee.color).toBe(theme[markdown.mentionColor]);
    expect(dee.weight).toBe(markdown.mentionWeight);
    expect(dee.link).toBeUndefined();
    const me = runWith(doc, "@ada");
    expect(me.fill).toBe(theme[markdown.mentionMeBg]);
    expect(me.color).toBe(theme[markdown.mentionMeColor]);
    expect(me.fillId).not.toBe(dee.fillId);
  });

  it("draws @here as a pill only when the message carried it", () => {
    expect(runWith(build("for @here").doc, "@here").fill).toBeUndefined();
    const carried = runWith(build("for @here", { mentionsHere: true }).doc, "@here");
    expect(carried.text).toBe("@here");
    expect(carried.fill).toBe(theme[markdown.mentionMeBg]);
  });

  it("gives inline code its own box", () => {
    const { doc } = build("`a` and `b`");
    const first = runWith(doc, "a");
    const second = runWith(doc, "b");
    expect(first.mono).toBe(true);
    expect(first.fill).toBe(theme[markdown.codeBg]);
    expect(first.fillId).not.toBe(second.fillId);
  });
});

describe("buildDoc: links", () => {
  it("makes a link's runs one link, underlined in the link colour", () => {
    const { doc } = build("[the **docs**](https://example.com) now");
    const the = runWith(doc, "the ");
    const docs = runWith(doc, "docs");
    expect(the.link).toBe("https://example.com");
    expect(docs.link).toBe("https://example.com");
    expect(docs.linkId).toBe(the.linkId);
    expect(docs.weight).toBe(700);
    expect(the.underline).toBe(true);
    expect(the.color).toBe(theme[markdown.linkColor]);
    expect(runWith(doc, " now").link).toBeUndefined();
  });

  it("gives two links their own ids", () => {
    const { doc } = build("https://a.example and https://b.example");
    expect(runWith(doc, "a.example").linkId).not.toBe(runWith(doc, "b.example").linkId);
  });

  it("keeps a link's id when a reveal adds a link before it", () => {
    const content = "||[a](https://a.example)|| then https://b.example";
    const covered = build(content).doc;
    const revealed = build(content, { revealed: ["0.0.0"] }).doc;
    expect(runWith(covered, "a").link).toBeUndefined();
    expect(runWith(revealed, "a").link).toBe("https://a.example");
    expect(runWith(revealed, "b.example").linkId).toBe(runWith(covered, "b.example").linkId);
    expect(runWith(revealed, "a").linkId).not.toBe(runWith(revealed, "b.example").linkId);
  });

  it("keeps a link's id when the channel list arrives", () => {
    const content = `<#${RANDOM}:random> and https://b.example`;
    const before = build(content, { links: null }).doc;
    const after = build(content).doc;
    expect(runWith(before, "random").link).toBeUndefined();
    expect(runWith(after, "#random").link).toBe(`channel:${RANDOM}`);
    expect(runWith(after, "b.example").linkId).toBe(runWith(before, "b.example").linkId);
  });

  it("links nothing in the compact card", () => {
    const { doc } = build(`[docs](https://example.com) in <#${RANDOM}:random>`, { compact: true });
    expect(doc.runs.every((run) => run.link === undefined)).toBe(true);
    expect(runWith(doc, "#random").fill).toBe(theme[markdown.mentionBg]);
  });
});

describe("buildDoc: channel links", () => {
  it("opens a channel the screen lists", () => {
    const pill = runWith(build(`in <#${RANDOM}:old-name>`).doc, "#random");
    expect(pill.link).toBe(`channel:${RANDOM}`);
    expect(pill.fill).toBe(theme[markdown.mentionBg]);
  });

  it("reads a channel the screen doesn't list as its saved name, no pill", () => {
    const other = "44444444-4444-4444-4444-444444444444";
    const words = runWith(build(`in <#${other}:secret>`).doc, "#secret");
    expect(words.fill).toBeUndefined();
    expect(words.link).toBeUndefined();
  });

  it("reads every channel as its saved name without the screen's links", () => {
    const words = runWith(build(`in <#${RANDOM}:old-name>`, { links: null }).doc, "#old-name");
    expect(words.fill).toBeUndefined();
    expect(words.link).toBeUndefined();
  });
});

describe("buildDoc: blocks", () => {
  it("mutes a quote's words but not its pills or links", () => {
    const { doc } = build(`> see <@u:${DEE}:dee> and https://example.com`, { muted: true });
    expect(doc.textColor).toBe(theme[markdown.quoteColor]);
    expect(runWith(doc, "see ").color).toBeUndefined();
    expect(runWith(doc, "@dee").color).toBe(theme[markdown.mentionColor]);
    expect(runWith(doc, "example.com").color).toBe(theme[markdown.linkColor]);
  });

  it("reads a list row's marker before its words, and a spoiler in it covered", () => {
    expect(build("1. first", { prefix: "1. " }).doc.label).toBe("1. first");
    const { doc, spoilers } = build("- the ||end||", { prefix: "• " });
    expect(doc.label).toBe(`• the ${COVER}`);
    expect(spoilers).toEqual(["0.0.1"]);
  });

  it("gives a link in a later block an id of its own path", () => {
    const content = "https://example.com\n- https://example.com";
    const { blocks } = parse(content);
    if (blocks[1]?.type !== "list") throw new Error("no list");
    const row = build("", { lines: blocks[1].rows[0].lines }).doc;
    const line = build(content).doc;
    expect(runWith(row, "example.com").linkId).not.toBe(runWith(line, "example.com").linkId);
  });
});

describe("buildDoc: the label", () => {
  it("says a channel link as the screen shows it, its current name", () => {
    const { doc } = build(`in <#${RANDOM}:old-name> ||burnt||`);
    expect(runWith(doc, "#random").link).toBe(`channel:${RANDOM}`);
    expect(doc.label).toBe(`in #random ${COVER}`);
  });

  it("says a channel the screen doesn't list by its saved name", () => {
    const { doc } = build(`in <#${RANDOM}:old-name> ||burnt||`, { links: null });
    expect(doc.label).toBe(`in #old-name ${COVER}`);
  });
});

describe("firstCovered", () => {
  const covered = (revealed: string[]) => (path: string) => !revealed.includes(path);

  it("finds the first covered spoiler, in a link's words too", () => {
    const { lines } = paragraph("one ||two|| [three ||four||](https://example.com)");
    expect(firstCovered(lines, covered([]))).toBe("0.0.1");
    expect(firstCovered(lines, covered(["0.0.1"]))).toBe("0.0.3.1");
    expect(firstCovered(lines, covered(["0.0.1", "0.0.3.1"]))).toBeUndefined();
  });
});

describe("buildDoc: padding", () => {
  it("pads each box by its own value", () => {
    const { doc } = build(`\`code\` <@u:${DEE}:dee>`);
    expect(runWith(doc, "code").fillPad).toBe(markdown.codePadX);
    expect(runWith(doc, "@dee").fillPad).toBe(markdown.mentionPadX);
    expect(doc.spoilerPad).toBe(markdown.spoilerPadX);
  });
});

describe("buildDoc: the rest", () => {
  it("says an edited message is edited, after its words", () => {
    const { doc } = build("hello", { edited: true });
    expect(doc.runs.at(-1)?.text).toBe(" (edited)");
    expect(doc.label).toBe("hello (edited)");
  });

  it("draws an emoji-only message large", () => {
    const { doc } = build("🌳🍂");
    expect(doc.bodySize).toBe(build("words").doc.bodySize * markdown.emojiOnlyScale);
  });

  it("puts a line break between lines", () => {
    const { doc } = build("one\ntwo");
    expect(doc.runs.map((run) => run.text).join("")).toBe("one\ntwo");
  });
});
