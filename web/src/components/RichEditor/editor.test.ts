import { Node } from "prosemirror-model";
import {
  type Command,
  EditorState,
  Selection,
  TextSelection,
} from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { formatCommands, newLine } from "./commands";
import { fromMarkdown, toMarkdown } from "./markdown";
import { linkSelection, markdownSlice } from "./plugins";
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
