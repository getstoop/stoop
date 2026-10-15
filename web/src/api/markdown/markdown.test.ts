import { describe, expect, it } from "vitest";
import {
  type Inline,
  isBlankMessage,
  linksIn,
  parseInline,
  parseMarkdown,
  plainText,
} from ".";

const text = (t: string): Inline => ({ type: "text", text: t });
const code = (t: string): Inline => ({ type: "code", text: t });
const link = (href: string): Inline => ({ type: "link", href });
const bold = (...children: Inline[]): Inline => ({ type: "bold", children });
const italic = (...children: Inline[]): Inline => ({
  type: "italic",
  children,
});
const underline = (...children: Inline[]): Inline => ({
  type: "underline",
  children,
});
const strike = (...children: Inline[]): Inline => ({
  type: "strike",
  children,
});
const spoiler = (...children: Inline[]): Inline => ({
  type: "spoiler",
  children,
});
// The server's tests use the same tokens.
const ID = "00000000-0000-4000-8000-000000000001";
const TOKEN = `<@u:${ID}:casey>`;
const UNDERLINE_HANDLE = `<@u:${ID}:a__b__c>`;
const mention = (handle: string): Inline => ({
  type: "mention",
  mention: { kind: "person", id: ID, handle },
});

describe("parseInline", () => {
  it("returns nothing for an empty string", () => {
    expect(parseInline("")).toEqual([]);
  });

  it("leaves unmarked text alone", () => {
    expect(parseInline("hello casey")).toEqual([text("hello casey")]);
  });

  it("parses each of the five styles", () => {
    expect(parseInline("**b**")).toEqual([bold(text("b"))]);
    expect(parseInline("*i*")).toEqual([italic(text("i"))]);
    expect(parseInline("__u__")).toEqual([underline(text("u"))]);
    expect(parseInline("~~s~~")).toEqual([strike(text("s"))]);
    expect(parseInline("||sp||")).toEqual([spoiler(text("sp"))]);
  });

  it("parses a code span", () => {
    expect(parseInline("`x = 1`")).toEqual([code("x = 1")]);
  });

  it("reads ***both*** as bold around italic", () => {
    expect(parseInline("***both***")).toEqual([bold(italic(text("both")))]);
  });

  it("nests one style inside another", () => {
    expect(parseInline("**bold *and* more**")).toEqual([
      bold(text("bold "), italic(text("and")), text(" more")),
    ]);
  });

  it("keeps adjacent spans apart", () => {
    expect(parseInline("**a** **b**")).toEqual([
      bold(text("a")),
      text(" "),
      bold(text("b")),
    ]);
  });

  it("treats markers inside a code span as literal", () => {
    expect(parseInline("`**not bold**`")).toEqual([code("**not bold**")]);
  });

  it("leaves an unterminated marker as text", () => {
    expect(parseInline("**bold")).toEqual([text("**bold")]);
    expect(parseInline("~~gone")).toEqual([text("~~gone")]);
    expect(parseInline("`code")).toEqual([text("`code")]);
  });

  it("needs a non-space after the opener", () => {
    expect(parseInline("** not bold**")).toEqual([text("** not bold**")]);
  });

  it("needs a non-space before the closer", () => {
    expect(parseInline("~~gone ~~")).toEqual([text("~~gone ~~")]);
    expect(parseInline("__under __")).toEqual([text("__under __")]);
    expect(parseInline("||sp ||")).toEqual([text("||sp ||")]);
    expect(parseInline("*it *")).toEqual([text("*it *")]);
  });

  it("needs a non-space before the closer of a bold span too", () => {
    expect(parseInline("**bold **")).toEqual([text("**bold **")]);
  });

  it("nests bold inside italic", () => {
    expect(parseInline("*a **b** c*")).toEqual([
      italic(text("a "), bold(text("b")), text(" c")),
    ]);
  });

  it("closes bold and the italic inside it on one run of stars", () => {
    expect(parseInline("**hello *world***")).toEqual([
      bold(text("hello "), italic(text("world"))),
    ]);
    expect(parseInline("***world* hello**")).toEqual([
      bold(italic(text("world")), text(" hello")),
    ]);
  });

  it("leaves a run's spare star as text when nothing inside takes it", () => {
    expect(parseInline("**a***")).toEqual([bold(text("a")), text("*")]);
  });

  it("leaves an empty backtick pair as text", () => {
    expect(parseInline("``")).toEqual([text("``")]);
  });

  it("unescapes a backslashed marker", () => {
    expect(parseInline("\\*not italic\\*")).toEqual([text("*not italic*")]);
    expect(parseInline("\\`not code\\`")).toEqual([text("`not code`")]);
  });

  it("leaves a single underscore alone so @user_names survive", () => {
    expect(parseInline("@ada_w said hi")).toEqual([text("@ada_w said hi")]);
  });

  it("leaves spaced asterisks as arithmetic", () => {
    expect(parseInline("2 * 3 * 4")).toEqual([text("2 * 3 * 4")]);
  });

  it("leaves a lone pipe pair alone", () => {
    expect(parseInline("a || b")).toEqual([text("a || b")]);
  });

  it("links a bare URL", () => {
    expect(parseInline("see https://example.com now")).toEqual([
      text("see "),
      link("https://example.com"),
      text(" now"),
    ]);
  });

  it("keeps sentence punctuation out of the href", () => {
    expect(parseInline("https://example.com.")).toEqual([
      link("https://example.com"),
      text("."),
    ]);
    expect(parseInline("(https://example.com)")).toEqual([
      text("("),
      link("https://example.com"),
      text(")"),
    ]);
  });

  // A URL is one opaque token: markers inside it are part of the address,
  // and styling them would leave a link that points somewhere else.
  it("does not style the inside of a URL", () => {
    expect(parseInline("https://example.com/**not**")).toEqual([
      link("https://example.com/**not**"),
    ]);
  });

  it("ends a URL at >, so <address> links the address", () => {
    expect(parseInline("<https://example.com>")).toEqual([
      text("<"),
      link("https://example.com"),
      text(">"),
    ]);
    expect(parseInline("<https://example.com/a>.")).toEqual([
      text("<"),
      link("https://example.com/a"),
      text(">."),
    ]);
  });

  it("keeps a closing paren that belongs to the URL", () => {
    const url = "https://example.com/wiki/Ada_(mathematician)";
    expect(parseInline(url)).toEqual([link(url)]);
    expect(parseInline(`${url}.`)).toEqual([link(url), text(".")]);
    expect(parseInline(`(see ${url})`)).toEqual([
      text("(see "),
      link(url),
      text(")"),
    ]);
  });
});

describe("a link with a label", () => {
  const labelled = (href: string, ...label: Inline[]): Inline => ({
    type: "link",
    href,
    label,
  });

  it("reads [words](address) as the words, linked", () => {
    expect(parseInline("see [the docs](https://example.com/a) now")).toEqual([
      text("see "),
      labelled("https://example.com/a", text("the docs")),
      text(" now"),
    ]);
  });

  it("styles the words, and is styled itself", () => {
    expect(parseInline("[**b** c](https://a.b)")).toEqual([
      labelled("https://a.b", bold(text("b")), text(" c")),
    ]);
    expect(parseInline("**[b](https://a.b)**")).toEqual([
      bold(labelled("https://a.b", text("b"))),
    ]);
  });

  it("ends the address at its own closing bracket", () => {
    expect(parseInline("([a](https://a.b/x_(y)))")).toEqual([
      text("("),
      labelled("https://a.b/x_(y)", text("a")),
      text(")"),
    ]);
  });

  // The words would show one address and the link would go to another.
  it("refuses words that are themselves an address", () => {
    const nodes = parseInline("[https://a.example](https://b.example)");
    expect(nodes[0]).toEqual(text("["));
    expect(nodes.some((n) => n.type === "link" && n.label)).toBe(false);
  });

  it("leaves anything else as typed", () => {
    for (const s of [
      "[a](b)",
      "[a](ftp://a.b)",
      "[a](https://a.b c)",
      "[ ](https://a.b)",
      "[a] (https://a.b)",
      "[a](https://",
    ]) {
      const nodes = parseInline(s);
      expect(nodes.some((n) => n.type === "link" && n.label)).toBe(false);
    }
    expect(parseInline("\\[a](https://a.b)")[0]).toEqual(text("[a]("));
  });
});

describe("parseMarkdown", () => {
  it("makes one empty line out of an empty message", () => {
    expect(parseMarkdown("")).toEqual([{ type: "lines", lines: [[]] }]);
  });

  it("gathers consecutive plain lines into one block", () => {
    expect(parseMarkdown("first\nsecond")).toEqual([
      { type: "lines", lines: [[text("first")], [text("second")]] },
    ]);
  });

  it("gathers consecutive quote lines into one block", () => {
    expect(parseMarkdown("> a\n> b")).toEqual([
      { type: "quote", lines: [[text("a")], [text("b")]] },
    ]);
  });

  it("takes a quote without a space after the marker", () => {
    expect(parseMarkdown(">a")).toEqual([
      { type: "quote", lines: [[text("a")]] },
    ]);
  });

  it("styles the content of a quote", () => {
    expect(parseMarkdown("> **hi**")).toEqual([
      { type: "quote", lines: [[bold(text("hi"))]] },
    ]);
  });

  it("ends the quote block at the first unquoted line", () => {
    expect(parseMarkdown("> a\nb\n> c").map((b) => b.type)).toEqual([
      "quote",
      "lines",
      "quote",
    ]);
  });

  it("takes -, * and both number styles as bullets", () => {
    for (const line of ["- x", "* x", "1. x", "1) x"]) {
      expect(parseMarkdown(line)[0].type).toBe("list");
    }
  });

  it("puts bullets and numbers in one block, marking each row", () => {
    expect(parseMarkdown("1. first\n- child")).toEqual([
      {
        type: "list",
        items: [
          { ordered: true, depth: 0, content: [text("first")] },
          { ordered: false, depth: 0, content: [text("child")] },
        ],
      },
    ]);
  });

  it("counts two spaces of indent as a level", () => {
    expect(parseMarkdown("- a\n  - b\n    - c\n      - d")).toEqual([
      {
        type: "list",
        items: [
          { ordered: false, depth: 0, content: [text("a")] },
          { ordered: false, depth: 1, content: [text("b")] },
          { ordered: false, depth: 2, content: [text("c")] },
          { ordered: false, depth: 3, content: [text("d")] },
        ],
      },
    ]);
  });

  it("stops being a list past six spaces of indent", () => {
    expect(parseMarkdown("        - deep")[0].type).toBe("lines");
  });

  it("needs a space after the bullet, so *italic* still opens a line", () => {
    expect(parseMarkdown("*italic* line")).toEqual([
      { type: "lines", lines: [[italic(text("italic")), text(" line")]] },
    ]);
  });

  it("styles a list row's content", () => {
    expect(parseMarkdown("- a ||secret|| item")).toEqual([
      {
        type: "list",
        items: [
          {
            ordered: false,
            depth: 0,
            content: [text("a "), spoiler(text("secret")), text(" item")],
          },
        ],
      },
    ]);
  });

  it("keeps a fenced block's language and body", () => {
    expect(parseMarkdown("```go\nfmt.Println()\n```")).toEqual([
      { type: "codeblock", text: "fmt.Println()", lang: "go" },
    ]);
  });

  it("keeps a language with symbols in it", () => {
    for (const lang of ["c++", "objective-c", "f#"]) {
      expect(parseMarkdown(`\`\`\`${lang}\nint x;\n\`\`\`\nafter`)).toEqual([
        { type: "codeblock", text: "int x;", lang },
        { type: "lines", lines: [[text("after")]] },
      ]);
    }
  });

  it("takes a one-line fence", () => {
    expect(parseMarkdown("```one liner```")).toEqual([
      { type: "codeblock", text: "one liner", lang: "" },
    ]);
  });

  it("runs an unterminated fence to the end of the message", () => {
    expect(parseMarkdown("```\nstill typing\nmore")).toEqual([
      { type: "codeblock", text: "still typing\nmore", lang: "" },
    ]);
  });

  it("keeps a fence's contents literal", () => {
    expect(parseMarkdown("```\n- **a**\n```")).toEqual([
      { type: "codeblock", text: "- **a**", lang: "" },
    ]);
  });

  it("shows a mention token in code as its handle", () => {
    const token = "<@u:00000000-0000-4000-8000-000000000001:casey>";
    expect(parseInline(`run \`${token}\``)).toEqual([
      text("run "),
      code("@casey"),
    ]);
    expect(parseMarkdown(`\`\`\`\nping ${token}\n\`\`\``)).toEqual([
      { type: "codeblock", text: "ping @casey", lang: "" },
    ]);
  });

  it("shows a mention token in a link's words as its handle", () => {
    const token = "<@u:00000000-0000-4000-8000-000000000001:casey>";
    expect(parseInline(`[hi ${token}](https://a.example)`)).toEqual([
      { type: "link", href: "https://a.example", label: [text("hi @casey")] },
    ]);
  });

  it("shows a mention token in a spoiler as its handle", () => {
    const token = "<@u:00000000-0000-4000-8000-000000000001:casey>";
    expect(parseInline(`||hi ${token}||`)).toEqual([
      spoiler(text("hi @casey")),
    ]);
  });

  it("reads a token whole, even with __ in its handle", () => {
    expect(parseInline(`hi ${TOKEN}`)).toEqual([text("hi "), mention("casey")]);
    expect(parseInline(`${UNDERLINE_HANDLE} hi`)).toEqual([
      mention("a__b__c"),
      text(" hi"),
    ]);
    expect(parseInline(`**${TOKEN}**`)).toEqual([bold(mention("casey"))]);
  });

  it("never pairs backticks across a style's edge", () => {
    expect(parseInline(`*x \`${TOKEN}* y\``)).toEqual([
      italic(text("x `"), mention("casey")),
      text(" y`"),
    ]);
    expect(parseInline(`**a \`b** c\` d ${TOKEN} \`e\``)).toEqual([
      bold(text("a `b")),
      text(" c"),
      code(" d @casey "),
      text("e`"),
    ]);
  });

  it("keeps blocks in source order", () => {
    expect(parseMarkdown("intro\n- one\nafter").map((b) => b.type)).toEqual([
      "lines",
      "list",
      "lines",
    ]);
  });

  // Blocks do not nest: a quote's content is inline-only, so the bullet
  // stays as text and the reader sees the dash.
  it("does not make a list inside a quote", () => {
    expect(parseMarkdown("> - item")).toEqual([
      { type: "quote", lines: [[text("- item")]] },
    ]);
  });

  it("reads an escaped number as a line, not a list", () => {
    expect(parseMarkdown("1\\. not a list")).toEqual([
      { type: "lines", lines: [[text("1. not a list")]] },
    ]);
  });
});

describe("parseMarkdown agrees with the server on \\r", () => {
  // Old messages may still hold \r; the server's parser reads it as text.
  const cases: [string, string[]][] = [
    ["- a\r\n- b", ["list"]],
    ["> a\r\n> b", ["quote"]],
    ["```a\rb```", ["codeblock"]],
  ];
  for (const [input, want] of cases) {
    it(`reads ${JSON.stringify(input)} as ${want.join(", ")}`, () => {
      expect(parseMarkdown(input).map((block) => block.type)).toEqual(want);
    });
  }
});

describe("plainText mirrors the server", () => {
  const cases: [string, string][] = [
    ["**bold** and *italic*", "bold and italic"],
    ["__under__ ~~gone~~ `code`", "under gone code"],
    ["***both***", "both"],
    ["**hello *world***", "hello world"],
    ["**a *******", "a *****"],
    ["> quoted\n> lines", "quoted lines"],
    ["```go\nfmt.Println()\n```", "fmt.Println()"],
    ["```one liner```", "one liner"],
    ["2 * 3 * 4", "2 * 3 * 4"],
    ["@ada_w said hi", "@ada_w said hi"],
    ["\\*not bold\\*", "*not bold*"],
    ["first\nsecond", "first second"],
    ["plain", "plain"],
    ["", ""],
    ["- milk\n- eggs", "milk eggs"],
    ["* milk\n* eggs", "milk eggs"],
    ["1. first\n2. second", "first second"],
    ["1) first\n2) second", "first second"],
    ["  - nested", "nested"],
    ["||the butler did it||", "the butler did it"],
    ["it was ||him|| all along", "it was him all along"],
    ["- a ||secret|| item", "a secret item"],
    ["**bold** and ||hidden||", "bold and hidden"],
    ["*italic* line", "italic line"],
    ["a || b", "a || b"],
    ["\\- not a list", "- not a list"],
    ["1\\. not a list", "1. not a list"],
    ["see [the docs](https://example.com/a) now", "see the docs now"],
    ["[**bold** words](https://a.b/x_(y))", "bold words"],
    ["[a](not an address)", "[a](not an address)"],
    [
      "[https://a.example](https://b.example)",
      "[https://a.example](https://b.example)",
    ],
    ["\\[a](https://a.b)", "[a](https://a.b)"],
    [`hi ${TOKEN}`, "hi @casey"],
    [`${UNDERLINE_HANDLE} hi`, "@a__b__c hi"],
    [`\`${TOKEN}\``, "@casey"],
    [`\`\`\`\n${TOKEN}\n\`\`\``, "@casey"],
    [`||${TOKEN}||`, "@casey"],
    [`[see ${TOKEN}](https://x.example)`, "see @casey"],
  ];
  for (const [input, want] of cases) {
    it(`strips ${JSON.stringify(input)}`, () => {
      expect(plainText(input)).toBe(want);
    });
  }
});

describe("plainText", () => {
  it("collapses blank lines and trims the ends", () => {
    expect(plainText("  a\n\n  b  ")).toBe("a b");
  });

  it("runs a quote, a list and a fence together in one line", () => {
    expect(plainText("> quoted\n- item\n```\ncode\n```")).toBe(
      "quoted item code",
    );
  });

  it("keeps a bare URL as the address it links to", () => {
    expect(plainText("see https://example.com now")).toBe(
      "see https://example.com now",
    );
  });
});

// Where the client and the server disagree. The client is the one that
// renders the message, so each of these asserts the client's answer and
// notes what the server says instead.
describe("plainText where the server differs", () => {
  it("keeps markers inside a code span", () => {
    expect(plainText("`a *b* c`")).toBe("a *b* c"); // server: "a b c"
  });

  it("keeps markup inside a fenced block", () => {
    expect(plainText("```\n- a\n```")).toBe("- a"); // server: "a"
  });

  it("keeps a URL whole", () => {
    // server: "https://example.com/not", a different address
    expect(plainText("https://example.com/**not**")).toBe(
      "https://example.com/**not**",
    );
  });

  it("does not let a marker span two lines", () => {
    expect(plainText("a *b\nc* d")).toBe("a *b c* d"); // server: "a b c d"
  });

  it("keeps a bullet that is inside a quote", () => {
    expect(plainText("> - item")).toBe("- item"); // server: "item"
  });
});

describe("isBlankMessage", () => {
  // As the editor writes an empty block, before the send trims it.
  it.each([
    "",
    "  \n ",
    ">",
    "> \n>",
    "- ",
    "1. ",
    "- \n  - ",
    "```\n\n```",
    "```\n```",
  ])("%j is blank", (content) => {
    expect(isBlankMessage(content)).toBe(true);
  });

  it.each([
    "👍",
    "<@u:00000000-0000-4000-8000-000000000001:casey>",
    "<@g:00000000-0000-4000-8000-000000000002:crew>",
    "```\nx = 1\n```",
    "> quoted",
    "- item",
    "-",
    "\\- not a list",
    "[](https://example.com)",
  ])("%j has content", (content) => {
    expect(isBlankMessage(content)).toBe(false);
  });
});

describe("linksIn", () => {
  it("lists each link once, in order, wherever it sits", () => {
    expect(
      linksIn(
        "see https://a.example/x and **https://b.example**\n- https://a.example/x\n> https://c.example",
      ),
    ).toEqual([
      "https://a.example/x",
      "https://b.example",
      "https://c.example",
    ]);
  });

  it("takes an address in angle brackets without the >", () => {
    expect(linksIn("write to <https://a.example/x>")).toEqual([
      "https://a.example/x",
    ]);
  });

  it("skips a fenced block whose language has symbols", () => {
    expect(
      linksIn("```c++\nhttps://a.example\n```\nhttps://b.example"),
    ).toEqual(["https://b.example"]);
  });

  it("skips code", () => {
    expect(linksIn("`https://a.example`\n```\nhttps://b.example\n```")).toEqual(
      [],
    );
  });
});
