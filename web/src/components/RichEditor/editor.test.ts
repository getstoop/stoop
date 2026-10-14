import { Node } from "prosemirror-model";
import {
  AllSelection,
  type Command,
  EditorState,
  Selection,
  TextSelection,
} from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { IdentityKind } from "../../gen/stoop/access/v1/access_pb";
import type { Member } from "../../gen/stoop/chat/v1/member_pb";
import { activeFormats, formatCommands, newLine } from "./commands";
import { checkLink, linkAround, linkDraft, saveLink } from "./links";
import { fromMarkdown, toMarkdown } from "./markdown";
import { mentionDecorations } from "./mentions";
import { indentItem, linkSelection, markdownSlice } from "./plugins";
import { schema } from "./schema";

const stateOf = (md: string) =>
  EditorState.create({ doc: Node.fromJSON(schema, fromMarkdown(md)) });

const md = (state: EditorState) => toMarkdown(state.doc.toJSON());

// The document position where `text` starts (or ends, with `end`).
function posOf(state: EditorState, text: string, end = false): number {
  let found = -1;
  state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return found < 0;
    const i = node.text?.indexOf(text) ?? -1;
    if (i >= 0) found = pos + i + (end ? text.length : 0);
    return false;
  });
  if (found < 0) throw new Error(`no "${text}" in the document`);
  return found;
}

const selecting = (state: EditorState, text: string) =>
  state.apply(
    state.tr.setSelection(
      TextSelection.create(
        state.doc,
        posOf(state, text),
        posOf(state, text, true),
      ),
    ),
  );

const caretAfter = (state: EditorState, text: string) =>
  state.apply(
    state.tr.setSelection(
      TextSelection.create(state.doc, posOf(state, text, true)),
    ),
  );

const caretAtEnd = (state: EditorState) =>
  state.apply(state.tr.setSelection(Selection.atEnd(state.doc)));

function run(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null;
  command(state, (tr) => {
    next = state.apply(tr);
  });
  return next;
}

describe("pasting plain text", () => {
  const paste = (state: EditorState, text: string) =>
    md(state.apply(state.tr.replaceSelection(markdownSlice(text))));

  it("reads it as Markdown", () => {
    expect(paste(stateOf(""), "**bold** and [words](https://a.example)")).toBe(
      "**bold** and [words](https://a.example)",
    );
  });

  it("merges one line into the line it lands in", () => {
    expect(paste(caretAfter(stateOf("before after"), "before "), "*it* ")).toBe(
      "before *it* after",
    );
  });

  it("keeps blocks as blocks", () => {
    expect(paste(stateOf(""), "> quoted\n- one\n- two")).toBe(
      "> quoted\n- one\n- two",
    );
  });
});

describe("pasting an address over words", () => {
  it("links the words", () => {
    const state = selecting(stateOf("see the words here"), "the words");
    const tr = linkSelection(state, " https://a.example/x ");
    expect(tr && md(state.apply(tr))).toBe(
      "see [the words](https://a.example/x) here",
    );
  });

  it.each([
    ["nothing is selected", stateOf("words"), "https://a.example"],
    [
      "the paste is not an address",
      selecting(stateOf("words"), "words"),
      "words",
    ],
    [
      "the words hold an address",
      selecting(stateOf("go https://a.example now"), "go https://a.example"),
      "https://b.example",
    ],
  ])("leaves the paste alone when %s", (_, state, pasted) => {
    expect(linkSelection(state, pasted)).toBeNull();
  });
});

describe("Tab in a list", () => {
  it("indents an item under the one before", () => {
    const next = run(caretAtEnd(stateOf("- one\n- two")), indentItem);
    expect(next && md(next)).toBe("- one\n  - two");
  });

  it("stops at the deepest level the format keeps", () => {
    const third = "- a\n  - b\n    - c\n    - d";
    const fourth = run(caretAtEnd(stateOf(third)), indentItem);
    expect(fourth && md(fourth)).toBe("- a\n  - b\n    - c\n      - d");
    const deepest = "- a\n  - b\n    - c\n      - d\n      - e";
    expect(run(caretAtEnd(stateOf(deepest)), indentItem)).toBeNull();
  });
});

describe("a new line", () => {
  it("starts the next list item", () => {
    const next = run(caretAtEnd(stateOf("- one")), newLine);
    expect(next && next.doc.firstChild?.childCount).toBe(2);
  });

  it("leaves the list from an empty item", () => {
    const twice = run(run(caretAtEnd(stateOf("- one")), newLine)!, newLine);
    expect(twice && md(twice)).toBe("- one");
    expect(twice?.selection.$from.parent.type).toBe(schema.nodes.paragraph);
    expect(twice?.selection.$from.depth).toBe(1);
  });

  it("adds a line inside a code block", () => {
    const next = run(caretAtEnd(stateOf("```\nx\n```")), newLine);
    expect(next?.doc.firstChild?.textContent).toBe("x\n");
  });

  it("leaves a code block from its blank last line", () => {
    const blank = run(caretAtEnd(stateOf("```\nx\n```")), newLine)!;
    const next = run(blank, newLine)!;
    expect(next.doc.firstChild?.textContent).toBe("x");
    expect(next.selection.$from.parent.type).toBe(schema.nodes.paragraph);
  });
});

describe("the format commands", () => {
  it("bold wraps the selection", () => {
    const next = run(selecting(stateOf("a word"), "word"), formatCommands.bold);
    expect(next && md(next)).toBe("a **word**");
  });

  it("quote wraps the line and unwraps it again", () => {
    const quoted = run(caretAtEnd(stateOf("line")), formatCommands.quote)!;
    expect(md(quoted)).toBe("> line");
    const back = run(quoted, formatCommands.quote);
    expect(back && md(back)).toBe("line");
  });

  it("a list toggles off from inside it", () => {
    const listed = run(caretAtEnd(stateOf("item")), formatCommands.list)!;
    expect(md(listed)).toBe("- item");
    const back = run(listed, formatCommands.list);
    expect(back && md(back)).toBe("item");
  });

  // A quote holds lines only, as the message format does.
  it("quote does nothing in a list item", () => {
    expect(run(caretAtEnd(stateOf("- item")), formatCommands.quote)).toBeNull();
  });

  it("code block toggles the line", () => {
    const code = run(caretAtEnd(stateOf("x = 1")), formatCommands.codeblock)!;
    expect(md(code)).toBe("```\nx = 1\n```");
    const back = run(code, formatCommands.codeblock);
    expect(back && md(back)).toBe("x = 1");
  });
});

describe("the toolbar's pressed buttons", () => {
  it("show the style the caret is inside", () => {
    expect(activeFormats(caretAfter(stateOf("a **bold** word"), "bo"))).toEqual(
      ["bold"],
    );
    expect(activeFormats(caretAfter(stateOf("a **bold** word"), "wo"))).toEqual(
      [],
    );
  });

  it("show a style switched on at the caret, before anything is typed", () => {
    const on = run(caretAtEnd(stateOf("plain")), formatCommands.bold);
    expect(on && activeFormats(on)).toEqual(["bold"]);
    const typed = on && on.apply(on.tr.insertText("er"));
    expect(typed && md(typed)).toBe("plain**er**");
    const off = typed && run(typed, formatCommands.bold);
    expect(off && activeFormats(off)).toEqual([]);
  });

  it("keep inline code on for everything typed after it", () => {
    const on = run(caretAtEnd(stateOf("run ")), formatCommands.code);
    const one = on && on.apply(on.tr.insertText("x"));
    const more = one && one.apply(one.tr.insertText(" = 1"));
    expect(more && md(more)).toBe("run `x = 1`");
    expect(more && activeFormats(more)).toEqual(["code"]);
  });

  it("show a style only when all of the selection has it", () => {
    const doc = stateOf("**bold** plain");
    const mixed = doc.apply(
      doc.tr.setSelection(
        TextSelection.create(
          doc.doc,
          posOf(doc, "bold"),
          posOf(doc, "plain", true),
        ),
      ),
    );
    expect(activeFormats(mixed)).toEqual([]);
    const bolded = run(mixed, formatCommands.bold);
    expect(bolded && md(bolded)).toBe("**bold plain**");
    expect(bolded && activeFormats(bolded)).toEqual(["bold"]);
  });

  it("show the block the caret is in", () => {
    expect(activeFormats(caretAtEnd(stateOf("> said")))).toEqual(["quote"]);
    expect(activeFormats(caretAtEnd(stateOf("1. first")))).toEqual([
      "orderedList",
    ]);
    expect(activeFormats(caretAtEnd(stateOf("```\nx\n```")))).toEqual([
      "codeblock",
    ]);
  });
});

describe("links", () => {
  const LINKED = "see [the **docs** page](https://example.com/d) now";

  it("are found from anywhere inside, as one link across styles", () => {
    const state = caretAfter(stateOf(LINKED), "do");
    expect(linkAround(state)?.href).toBe("https://example.com/d");
    expect(activeFormats(state)).toContain("link");
    const link = linkAround(state);
    expect(link && state.doc.textBetween(link.from, link.to)).toBe(
      "the docs page",
    );
  });

  it("aren't found at their edge, where typing isn't linked", () => {
    expect(linkAround(caretAfter(stateOf(LINKED), "page"))).toBeNull();
  });

  it("open the form with the selected words", () => {
    const draft = linkDraft(selecting(stateOf("read this"), "this"));
    expect(draft && { text: draft.text, href: draft.href }).toEqual({
      text: "this",
      href: "",
    });
  });

  it("take a one-line draft's words from select all", () => {
    const state = stateOf("just this");
    const all = state.apply(state.tr.setSelection(new AllSelection(state.doc)));
    expect(linkDraft(all)?.text).toBe("just this");
  });

  it("go at the end of the last line when the selection spans lines", () => {
    const state = stateOf("one\ntwo");
    const all = state.apply(state.tr.setSelection(new AllSelection(state.doc)));
    const draft = linkDraft(all);
    expect(draft?.text).toBe("");
    const saved =
      draft && all.apply(saveLink(all, draft, "it", "https://x.org"));
    expect(saved && md(saved)).toBe("one\ntwo[it](https://x.org)");
  });

  it("can't go in a code block", () => {
    expect(linkDraft(caretAtEnd(stateOf("```\nx\n```")))).toBeNull();
  });

  it("save over the selected words, keeping their styles", () => {
    const state = selecting(stateOf("read **this** now"), "this");
    const draft = linkDraft(state);
    const saved =
      draft && state.apply(saveLink(state, draft, "this", "https://x.org"));
    expect(saved && md(saved)).toBe("read [**this**](https://x.org) now");
    expect(saved && activeFormats(saved), "the caret is past the link").toEqual(
      ["bold"],
    );
  });

  it("save new words at the caret, or the address when there are none", () => {
    const state = caretAfter(stateOf("go "), "go ");
    const draft = linkDraft(state);
    const named =
      draft && state.apply(saveLink(state, draft, "here", "https://x.org"));
    expect(named && md(named)).toBe("go [here](https://x.org)");
    const bare =
      draft && state.apply(saveLink(state, draft, " ", "https://x.org"));
    expect(bare && md(bare)).toBe("go https://x.org");
  });

  it("save an edit over the whole link", () => {
    const state = caretAfter(stateOf(LINKED), "do");
    const draft = linkDraft(state);
    const edited =
      draft && state.apply(saveLink(state, draft, "guide", "https://x.org/g"));
    expect(edited && md(edited)).toBe("see [guide](https://x.org/g) now");
  });

  it("refuse an address the format can't read, and words holding one", () => {
    expect(checkLink("docs", "example.com").href).toBeTruthy();
    expect(checkLink("docs", "https://example.com")).toEqual({});
    expect(checkLink("see https://a.b", "https://c.d").text).toBeTruthy();
    expect(checkLink("https://c.d", "https://c.d")).toEqual({});
  });
});

describe("mentions", () => {
  const members = new Map([
    ["casey", { kind: IdentityKind.PERSON } as Member],
    ["uptime", { kind: IdentityKind.BOT } as Member],
  ]);

  const drawn = (markdown: string, channelAndHere = false) => {
    const state = stateOf(markdown);
    return mentionDecorations(state.doc, { members, channelAndHere })
      .find()
      .map((d) => ({
        text: state.doc.textBetween(d.from, d.to),
        class: (d as unknown as { type: { attrs: { class: string } } }).type
          .attrs.class,
      }));
  };

  it("draws a member's handle as a person or a bot", () => {
    expect(drawn("hi @casey and @Uptime")).toEqual([
      { text: "@casey", class: "mention person" },
      { text: "@Uptime", class: "mention bot" },
    ]);
  });

  it("leaves a handle that isn't a member, and code", () => {
    expect(drawn("@nobody `@casey`\n\n```\n@casey\n```")).toEqual([]);
  });

  it("draws @channel and @here only where they may be used", () => {
    expect(drawn("@channel @here")).toEqual([]);
    expect(drawn("@channel @here", true)).toEqual([
      { text: "@channel", class: "mention" },
      { text: "@here", class: "mention" },
    ]);
  });
});
