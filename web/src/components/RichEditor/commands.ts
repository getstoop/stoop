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
import type { NodeType } from "prosemirror-model";
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

const toggleCodeBlock: Command = (state, dispatch) =>
  state.selection.$from.parent.type === schema.nodes.codeBlock
    ? setBlockType(schema.nodes.paragraph)(state, dispatch)
    : setBlockType(schema.nodes.codeBlock)(state, dispatch);

export const formatCommands: Record<Format, Command> = {
  bold: toggleMark(schema.marks.bold),
  italic: toggleMark(schema.marks.italic),
  underline: toggleMark(schema.marks.underline),
  strike: toggleMark(schema.marks.strike),
  code: toggleMark(schema.marks.code),
  spoiler: toggleMark(schema.marks.spoiler),
  quote: toggleQuote,
  list: toggleList(schema.nodes.bulletList),
  orderedList: toggleList(schema.nodes.orderedList),
  codeblock: toggleCodeBlock,
};
