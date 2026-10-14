import type { Mark, ResolvedPos } from "prosemirror-model";
import type { Command, EditorState, Transaction } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
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

export const removeLink: Command = (state, dispatch) => {
  const link = linkAround(state);
  if (!link) return false;
  dispatch?.(state.tr.removeMark(link.from, link.to, schema.marks.link));
  return true;
};

// The form's starting values: the link being edited, else the selected
// words, else nothing at the caret. Null where links can't go.
export function linkDraft(
  state: EditorState,
  link = linkAround(state),
): LinkDraft | null {
  const { $from, $to, from, to } = state.selection;
  if ($from.parent.type.spec.code) return null;
  if (link) {
    return { ...link, text: state.doc.textBetween(link.from, link.to) };
  }
  if (!$from.sameParent($to)) return { from: to, to, text: "", href: "" };
  return { from, to, text: state.doc.textBetween(from, to), href: "" };
}

const ADDRESS = /^https?:\/\/\S+$/i;

// What's wrong with the form, field by field, as the message format would
// read it back: an address it links, and words that hold no address of
// their own.
export function checkLink(
  text: string,
  href: string,
): { text?: string; href?: string } {
  const errors: { text?: string; href?: string } = {};
  if (!ADDRESS.test(href.trim())) {
    errors.href = "Enter an address starting with http:// or https://";
  }
  if (text.trim() !== href.trim() && /https?:\/\//i.test(text)) {
    errors.text = "Link text can't contain an address";
  }
  return errors;
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
