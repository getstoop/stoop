import {
  chainCommands,
  createParagraphNear,
  liftEmptyBlock,
  newlineInCode,
  setBlockType,
  splitBlock,
  toggleMark,
  wrapIn,
} from "prosemirror-commands";
import type { MarkType, NodeType } from "prosemirror-model";
import {
  liftListItem,
  splitListItem,
  wrapInList,
} from "prosemirror-schema-list";
import {
  type Command,
  type EditorState,
  TextSelection,
} from "prosemirror-state";
import type { Format } from "../../api/formatting";
import { type MentionRef, mentionText } from "../../core/mentions";
import { linkAround } from "./links";
import { schema } from "./schema";

// A blank last line in a code block, then a new line: leave the block
// instead of growing it.
const exitCodeOnBlankLine: Command = (state, dispatch) => {
  const { $head, empty } = state.selection;
  if (!empty || !$head.parent.type.spec.code) return false;
  const text = $head.parent.textContent;
  if ($head.parentOffset !== text.length || !text.endsWith("\n")) {
    return false;
  }
  if (dispatch) {
    const tr = state.tr.delete($head.pos - 1, $head.pos);
    const after = $head.after() - 1;
    tr.insert(after, schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

// What a new line means where the caret is: a line in a code block, the
// next list item, or out of an empty quote or item.
export const newLine: Command = chainCommands(
  exitCodeOnBlankLine,
  newlineInCode,
  splitListItem(schema.nodes.listItem),
  createParagraphNear,
  liftEmptyBlock,
  splitBlock,
);

function inNode(state: EditorState, type: NodeType): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === type) return true;
  }
  return false;
}

const toggleQuote: Command = (state, dispatch) =>
  inNode(state, schema.nodes.blockquote)
    ? liftOut(schema.nodes.blockquote)(state, dispatch)
    : wrapIn(schema.nodes.blockquote)(state, dispatch);

function toggleList(type: NodeType): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    const list = $from.depth >= 2 ? $from.node($from.depth - 2) : null;
    if (list?.type === type) {
      return liftListItem(schema.nodes.listItem)(state, dispatch);
    }
    return wrapInList(type)(state, dispatch);
  };
}

function liftOut(type: NodeType): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    const range = $from.blockRange($to, (node) => node.type === type);
    if (!range) return false;
    if (dispatch) dispatch(state.tr.lift(range, range.depth - 1));
    return true;
  };
}

// A code block holds text only, so a mention in the lines it takes over
// becomes the words it reads as instead of being dropped.
const toggleCodeBlock: Command = (state, dispatch) => {
  if (state.selection.$from.parent.type === schema.nodes.codeBlock) {
    return setBlockType(schema.nodes.paragraph)(state, dispatch);
  }
  if (!setBlockType(schema.nodes.codeBlock)(state)) return false;
  if (dispatch) {
    const { $from, $to, from, to } = state.selection;
    const tr = state.tr;
    const mentions: { pos: number; size: number; words: string }[] = [];
    state.doc.nodesBetween($from.start(), $to.end(), (node, pos) => {
      if (node.type === schema.nodes.mention) {
        const words = mentionText(node.attrs as MentionRef);
        mentions.push({ pos, size: node.nodeSize, words });
      }
    });
    for (const { pos, size, words } of mentions.reverse()) {
      tr.replaceWith(pos, pos + size, schema.text(words));
    }
    tr.setBlockType(
      tr.mapping.map(from),
      tr.mapping.map(to),
      schema.nodes.codeBlock,
    );
    dispatch(tr.scrollIntoView());
  }
  return true;
};

// A selection that is only partly styled gets the style everywhere; the
// button shows on only once all of it is.
const toggle = (type: MarkType) =>
  toggleMark(type, null, { removeWhenPresent: false });

// Link opens the link dialog instead (RichEditor/index.tsx).
export const formatCommands: Record<Exclude<Format, "link">, Command> = {
  bold: toggle(schema.marks.bold),
  italic: toggle(schema.marks.italic),
  underline: toggle(schema.marks.underline),
  strike: toggle(schema.marks.strike),
  code: toggle(schema.marks.code),
  spoiler: toggle(schema.marks.spoiler),
  quote: toggleQuote,
  list: toggleList(schema.nodes.bulletList),
  orderedList: toggleList(schema.nodes.orderedList),
  codeblock: toggleCodeBlock,
};

const MARKS = [
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "spoiler",
] as const;

// The formats in effect where the caret is: at a caret, what typing
// would carry; over a selection, what all of its text has.
export function activeFormats(state: EditorState): Format[] {
  const { empty, from, to, $from } = state.selection;
  const active: Format[] = [];
  for (const name of MARKS) {
    const type = schema.marks[name];
    const on = empty
      ? !!type.isInSet(state.storedMarks ?? $from.marks())
      : coversRange(state, from, to, type);
    if (on) active.push(name);
  }
  if (linkAround(state)) active.push("link");
  if (inNode(state, schema.nodes.blockquote)) active.push("quote");
  const list = $from.depth >= 2 ? $from.node($from.depth - 2).type : null;
  if (list === schema.nodes.bulletList) active.push("list");
  if (list === schema.nodes.orderedList) active.push("orderedList");
  if ($from.parent.type === schema.nodes.codeBlock) active.push("codeblock");
  return active;
}

function coversRange(
  state: EditorState,
  from: number,
  to: number,
  type: MarkType,
): boolean {
  let any = false;
  let all = true;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true;
    any = true;
    if (!type.isInSet(node.marks)) all = false;
    return false;
  });
  return any && all;
}
