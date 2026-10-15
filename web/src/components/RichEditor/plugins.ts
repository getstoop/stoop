import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  undoInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import { type MarkType, type Node, Slice } from "prosemirror-model";
import { liftListItem, sinkListItem } from "prosemirror-schema-list";
import {
  type Command,
  type EditorState,
  Plugin,
  type Transaction,
} from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { writtenLength } from "../../api/mentions";
import { newLine } from "./commands";
import { fromMarkdown, toMarkdown } from "./markdown";
import { type MentionContext, mentions, NO_MENTIONS } from "./mentions";
import { schema } from "./schema";

// Typing a marker pair styles its content, the way the message format
// would read it: "__" is underline and "_" is nothing.
function markRule(open: string, type: MarkType): InputRule {
  const d = escapeRegExp(open);
  const c = escapeRegExp(open[0]);
  // The content starts and ends on a non-space and holds no marker char.
  const pattern = new RegExp(
    `(?:^|\\s)(${d}([^\\s${c}](?:[^${c}]*[^\\s${c}])?)${d})$`,
  );
  return new InputRule(pattern, (state, match, start, end) => {
    const whole = match[1];
    const from = start + match[0].length - whole.length;
    const marks = [...state.doc.resolve(from).marks(), type.create()];
    return state.tr
      .replaceWith(from, end, schema.text(match[2], marks))
      .removeStoredMark(type);
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|~`-]/g, "\\$&");
}

const rules = inputRules({
  rules: [
    markRule("**", schema.marks.bold),
    markRule("__", schema.marks.underline),
    markRule("~~", schema.marks.strike),
    markRule("||", schema.marks.spoiler),
    markRule("`", schema.marks.code),
    // A lone "*", not the second star of "**".
    new InputRule(
      /(?:^|[^*])(\*([^\s*](?:[^*]*[^\s*])?)\*)$/,
      (state, match, start, end) => {
        const from = start + match[0].length - match[1].length;
        const marks = [
          ...state.doc.resolve(from).marks(),
          schema.marks.italic.create(),
        ];
        return state.tr
          .replaceWith(from, end, schema.text(match[2], marks))
          .removeStoredMark(schema.marks.italic);
      },
    ),
    // "[words](https://address)" links the words once its ")" is typed.
    new InputRule(
      /\[([^[\]]+)\]\((https?:\/\/[^\s()]+)\)$/,
      (state, match, start, end) => {
        const link = schema.marks.link.create({ href: match[2] });
        const marks = [...state.doc.resolve(start).marks(), link];
        return state.tr
          .replaceWith(start, end, schema.text(match[1], marks))
          .removeStoredMark(schema.marks.link);
      },
    ),
    wrappingInputRule(/^>\s$/, schema.nodes.blockquote),
    wrappingInputRule(/^[-*]\s$/, schema.nodes.bulletList),
    wrappingInputRule(/^\d+[.)]\s$/, schema.nodes.orderedList),
    textblockTypeInputRule(/^```$/, schema.nodes.codeBlock),
  ],
});

// The message format reads four levels (indents 0 to 3); Tab stops there
// rather than the writer flattening a deeper item.
const MAX_LIST_DEPTH = 3;

function sinkUpTo(max: number): Command {
  const sink = sinkListItem(schema.nodes.listItem);
  return (state, dispatch) => {
    const { $from } = state.selection;
    let lists = 0;
    for (let d = $from.depth; d > 0; d--) {
      const { type } = $from.node(d);
      if (
        type === schema.nodes.bulletList ||
        type === schema.nodes.orderedList
      ) {
        lists++;
      }
    }
    return lists <= max && sink(state, dispatch);
  };
}

export const indentItem = sinkUpTo(MAX_LIST_DEPTH);

const keys = keymap({
  "Mod-z": undo,
  "Shift-Mod-z": redo,
  "Mod-y": redo,
  Backspace: undoInputRule,
  Enter: newLine,
  "Shift-Enter": newLine,
  Tab: indentItem,
  "Shift-Tab": liftListItem(schema.nodes.listItem),
});

function placeholder(text: () => string) {
  return new Plugin({
    props: {
      decorations: (state) => {
        const { doc } = state;
        const first = doc.firstChild;
        if (doc.childCount !== 1 || !first?.isTextblock || first.content.size) {
          return null;
        }
        return DecorationSet.create(doc, [
          Decoration.node(0, first.nodeSize, {
            class: "is-editor-empty",
            "data-placeholder": text(),
          }),
        ]);
      },
    },
  });
}

const ADDRESS = /^https?:\/\/\S+$/i;

// An address pasted over selected words links them. The words stay on
// one line and can't hold an address of their own, as the format requires.
export function linkSelection(
  state: EditorState,
  pasted: string,
): Transaction | null {
  const href = pasted.trim();
  const { from, to, empty, $from, $to } = state.selection;
  if (empty || !ADDRESS.test(href) || !$from.sameParent($to)) return null;
  if ($from.parent.type.spec.code) return null;
  if (/https?:\/\//i.test(state.doc.textBetween(from, to))) return null;
  return state.tr.addMark(from, to, schema.marks.link.create({ href }));
}

const linkOnPaste = new Plugin({
  props: {
    handlePaste: (view, event) => {
      const pasted = event.clipboardData?.getData("text/plain") ?? "";
      const tr = linkSelection(view.state, pasted);
      if (!tr) return false;
      view.dispatch(tr);
      return true;
    },
  },
});

// Bare addresses stay plain text in the document (the message format
// links them on its own); this only styles them as links.
const BARE = /https?:\/\/[^\s<]+/gi;

function bareLinks(doc: Node): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false;
    if (!node.isText || !node.text) return true;
    if (
      node.marks.some(
        (m) => m.type === schema.marks.link || m.type === schema.marks.code,
      )
    ) {
      return true;
    }
    for (const m of node.text.matchAll(BARE)) {
      const href = m[0].replace(/[.,;:!?)\]'"]+$/, "");
      decos.push(
        Decoration.inline(pos + m.index, pos + m.index + href.length, {
          class: "rich-autolink",
        }),
      );
    }
    return true;
  });
  return DecorationSet.create(doc, decos);
}

const autolink = new Plugin<DecorationSet>({
  state: {
    init: (_, state) => bareLinks(state.doc),
    apply: (tr, old) => (tr.docChanged ? bareLinks(tr.doc) : old),
  },
  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});

// Pasted plain text is read as Markdown, so a message's source pastes
// back with its formatting. ProseMirror keeps a paste into a code block
// literal before this runs, and pasted HTML goes through the schema. One
// line merges into the line it lands in.
export function markdownSlice(text: string): Slice {
  const doc = schema.nodeFromJSON(fromMarkdown(text.replace(/\r\n?/g, "\n")));
  return doc.childCount === 1 && doc.firstChild?.type === schema.nodes.paragraph
    ? new Slice(doc.content, 1, 1)
    : Slice.maxOpen(doc.content);
}

const markdownPaste = new Plugin({
  props: { clipboardTextParser: markdownSlice },
});

// The message limit counts each mention as its handle, as the server does.
function maxLength(limit: number) {
  return new Plugin({
    filterTransaction: (tr) =>
      !tr.docChanged || writtenLength(toMarkdown(tr.doc.toJSON())) <= limit,
  });
}

export function editorPlugins(
  placeholderText: () => string,
  mentionContext: () => MentionContext = () => NO_MENTIONS,
): Plugin[] {
  return [
    rules,
    keys,
    keymap(baseKeymap),
    history(),
    linkOnPaste,
    markdownPaste,
    autolink,
    mentions(mentionContext),
    placeholder(placeholderText),
    maxLength(4000),
  ];
}
