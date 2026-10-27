import type { Mark, ResolvedPos } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import { Selection, TextSelection } from "prosemirror-state";
import { schema } from "./schema";

// The link the toolbar button, Ctrl/⌘+K and a double click act on.

export interface LinkRange {
  from: number;
  to: number;
  href: string;
}

// What the link form opens with: the words and address to edit, and the
// part of the document a save replaces.
export interface LinkDraft {
  from: number;
  to: number;
  text: string;
  href: string;
}

// The whole link at a position: every neighbouring piece of text with the
// same address, so a link that is partly bold is still one link.
function linkAt($pos: ResolvedPos, mark: Mark): LinkRange {
  const parent = $pos.parent;
  const start = $pos.start();
  let from = -1;
  let to = -1;
  let offset = 0;
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const end = offset + child.nodeSize;
    if (mark.isInSet(child.marks)) {
      if (from < 0) from = offset;
      to = end;
    } else if (end <= $pos.parentOffset) {
      from = -1;
    } else if (offset >= $pos.parentOffset) {
      break;
    }
    offset = end;
  }
  return { from: start + from, to: start + to, href: mark.attrs.href };
}

// The link the caret is in (not at its edge: typing there isn't linked),
// or the one a selection lies inside.
export function linkAround(state: EditorState): LinkRange | null {
  const { $from, $to, empty } = state.selection;
  const marks = empty ? $from.marks() : ($from.nodeAfter?.marks ?? []);
  const mark = schema.marks.link.isInSet(marks);
  if (!mark) return null;
  const range = linkAt($from, mark);
  return $to.pos <= range.to ? range : null;
}

export function linkAtPos(state: EditorState, pos: number): LinkRange | null {
  const $pos = state.doc.resolve(pos);
  const mark = schema.marks.link.isInSet($pos.nodeAfter?.marks ?? []);
  return mark && pos < $pos.end() ? linkAt($pos, mark) : null;
}

// The form's starting values: the link being edited, else the selected
// words, else nothing at the caret. Null where links can't go.
export function linkDraft(
  state: EditorState,
  link = linkAround(state),
): LinkDraft | null {
  // Narrowed to the text it covers: select all holds the whole document.
  const $start = Selection.near(state.selection.$from, 1).$from;
  const $end = Selection.near(state.selection.$to, -1).$to;
  if ($start.parent.type.spec.code) return null;
  if (link) {
    return { ...link, text: state.doc.textBetween(link.from, link.to) };
  }
  if ($start.sameParent($end)) {
    const { pos: from } = $start;
    const to = Math.max(from, $end.pos);
    return { from, to, text: state.doc.textBetween(from, to), href: "" };
  }
  // Across lines: a new link at the end of the last one.
  return { from: $end.pos, to: $end.pos, text: "", href: "" };
}

// Write the link over the draft's range. Unchanged words keep their own
// styles; new words take the styles where they start. The caret lands
// after the link, outside it.
export function saveLink(
  state: EditorState,
  draft: LinkDraft,
  text: string,
  href: string,
): Transaction {
  const link = schema.marks.link.create({ href: href.trim() });
  const words = text.trim() || href.trim();
  const { from, to } = draft;
  const tr = state.tr;
  let end: number;
  if (from < to && state.doc.textBetween(from, to) === words) {
    tr.removeMark(from, to, schema.marks.link).addMark(from, to, link);
    end = to;
  } else {
    const marks = schema.marks.link.removeFromSet(
      state.doc.resolve(from).marks(),
    );
    tr.replaceWith(from, to, schema.text(words, link.addToSet(marks)));
    end = from + words.length;
  }
  return tr
    .setSelection(TextSelection.create(tr.doc, end))
    .removeStoredMark(schema.marks.link);
}
