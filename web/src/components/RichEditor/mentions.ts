import type { Mark, Node } from "prosemirror-model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import {
  CHANNEL_LINK_CLASS,
  groupMentionClass,
  mentionClass,
} from "../../api/mentionClasses";
import {
  ADDRESS,
  currentHandle,
  type MentionChannels,
  type MentionGroups,
  type MentionMembers,
  type MentionRef,
  mentionText,
  NO_CHANNELS,
  NO_GROUPS,
  NO_MEMBERS,
  soleChannel,
  soleMention,
  splitEveryone,
  TYPED_CHANNEL,
  TYPED_HANDLE,
} from "../../core/mentions";
import { schema } from "./schema";

// A mention is a node carrying who it names. This plugin draws each as
// its pill, keeps its handle current, and turns a handle typed in full
// into one when exactly one person or group has it, and a #name typed in
// full into a channel link. A mention given the code style, a link or a
// spoiler becomes its words, as mentions don't work there.

export interface MentionContext {
  // The people who can read the channel, by user ID.
  members: MentionMembers;
  // Whether @channel and @here are ours to use here.
  channelAndHere: boolean;
  // The groups mentions name here, by ID; none in a private channel or a DM.
  groups: MentionGroups;
  // The channels a link may name, by ID; none in a private channel or a DM.
  channels: MentionChannels;
}

export const NO_MENTIONS: MentionContext = {
  members: NO_MEMBERS,
  channelAndHere: false,
  groups: NO_GROUPS,
  channels: NO_CHANNELS,
};

function pillClass(
  ref: MentionRef,
  { members, groups }: MentionContext,
): string {
  if (ref.kind === "channel") return CHANNEL_LINK_CLASS;
  if (ref.kind === "group") return groupMentionClass(groups.get(ref.id));
  return mentionClass(members.get(ref.id));
}

export const mentionsKey = new PluginKey<DecorationSet>("mentions");

const inCode = (node: Node) =>
  node.marks.some((mark) => mark.type === schema.marks.code);

// A mention in code, a link's words or a spoiler reads as its handle.
const WORDS_ONLY = [schema.marks.code, schema.marks.link, schema.marks.spoiler];
const onlyWords = (node: Node) =>
  node.marks.some((mark) => WORDS_ONLY.includes(mark.type));

// Whether what is typed at the caret can't be a mention: in a code block,
// in code or a spoiler, or at the end of a link's or a spoiler's words.
export function mentionsOffAtCaret(state: EditorState): boolean {
  const { $from } = state.selection;
  if ($from.parent.type.spec.code) return true;
  const marks = state.storedMarks ?? $from.marks();
  return [...marks, ...($from.nodeBefore?.marks ?? [])].some((mark) =>
    WORDS_ONLY.includes(mark.type),
  );
}

export function mentionDecorations(
  doc: Node,
  context: MentionContext,
): DecorationSet {
  const { channelAndHere } = context;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false;
    if (node.type === schema.nodes.mention) {
      const ref = node.attrs as MentionRef;
      decos.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: pillClass(ref, context),
        }),
      );
      return false;
    }
    if (!node.isText || !node.text || inCode(node)) return true;
    let at = pos;
    for (const part of splitEveryone(
      node.text,
      channelAndHere,
      channelAndHere,
    )) {
      if (part.everyone) {
        decos.push(
          Decoration.inline(at, at + part.text.length, { class: "mention" }),
        );
      }
      at += part.text.length;
    }
    return true;
  });
  return DecorationSet.create(doc, decos);
}

// The transaction that turns typed handles into mentions and brings each
// mention's handle up to date, or null when there is nothing to change.
// A handle ending its line counts as typed in full unless it ends at
// typingAt, the caret; null (on send) settles that one too.
export function settleMentions(
  tr: Transaction,
  { members, groups, channels }: MentionContext,
  typingAt: number | null = tr.selection.empty ? tr.selection.head : null,
): Transaction | null {
  const replacements: Replacement[] = [];
  const renames: { pos: number; ref: MentionRef }[] = [];
  const asWords: { pos: number; node: Node }[] = [];
  tr.doc.descendants((node, pos, parent, index) => {
    if (node.type.spec.code) return false;
    if (node.type === schema.nodes.mention) {
      if (onlyWords(node)) {
        asWords.push({ pos, node });
        return false;
      }
      const ref = node.attrs as MentionRef;
      const handle = currentHandle(ref, members, groups, channels);
      if (handle && handle !== ref.handle) {
        renames.push({ pos, ref: { ...ref, handle } });
      }
      return false;
    }
    if (!node.isText || !node.text || onlyWords(node)) return true;
    const addresses = [...node.text.matchAll(ADDRESS)].map((m) => [
      m.index,
      m.index + m[0].length,
    ]);
    const typed = [
      ...[...node.text.matchAll(TYPED_HANDLE)].map((match) => ({
        match,
        ref: soleMention(match[2], members, groups),
      })),
      ...[...node.text.matchAll(TYPED_CHANNEL)].map((match) => ({
        match,
        ref: soleChannel(match[2], channels),
      })),
    ];
    for (const { match, ref } of typed) {
      const [, lead, handle] = match;
      const start = (match.index ?? 0) + lead.length;
      if (addresses.some(([from, to]) => start >= from && start < to)) continue;
      const end = start + handle.length + 1;
      if (end === node.text.length) {
        const endsLine = !!parent && index === parent.childCount - 1;
        if (!endsLine || pos + end === typingAt) continue;
      }
      if (!ref) continue;
      replacements.push({
        from: pos + start,
        to: pos + end,
        ref,
        marks: node.marks,
      });
    }
    return true;
  });
  if (
    replacements.length === 0 &&
    renames.length === 0 &&
    asWords.length === 0
  ) {
    return null;
  }
  applyMentions(tr, replacements, renames);
  // Last first, as above; these come after every replacement.
  for (const { pos, node } of asWords.reverse()) {
    const from = tr.mapping.map(pos);
    tr.replaceWith(
      from,
      from + node.nodeSize,
      schema.text(mentionText(node.attrs as MentionRef), node.marks),
    );
  }
  return tr;
}

interface Replacement {
  from: number;
  to: number;
  ref: MentionRef;
  marks: readonly Mark[];
}

function applyMentions(
  tr: Transaction,
  replacements: Replacement[],
  renames: { pos: number; ref: MentionRef }[],
): Transaction {
  for (const { pos, ref } of renames) {
    tr.setNodeMarkup(pos, undefined, { ...ref });
  }
  // Last first, so earlier positions stay where they were.
  const lastFirst = [...replacements].sort((a, b) => b.from - a.from);
  for (const { from, to, ref, marks } of lastFirst) {
    tr.replaceWith(
      from,
      to,
      schema.nodes.mention.create({ ...ref }, null, marks),
    );
  }
  return tr;
}

// A transaction carrying mentionsKey redraws for new members or groups.
export function mentions(context: () => MentionContext) {
  return new Plugin<DecorationSet>({
    key: mentionsKey,
    state: {
      init: (_, state) => mentionDecorations(state.doc, context()),
      apply: (tr, old) =>
        tr.docChanged || tr.getMeta(mentionsKey)
          ? mentionDecorations(tr.doc, context())
          : old,
    },
    appendTransaction(transactions, _old, state) {
      if (
        !transactions.some((tr) => tr.docChanged || tr.getMeta(mentionsKey))
      ) {
        return null;
      }
      const tr = state.tr;
      const settled = settleMentions(tr, context());
      if (!settled) return null;
      // Bringing a handle up to date isn't an edit to undo.
      if (!transactions.some((t) => t.docChanged)) {
        settled.setMeta("addToHistory", false);
      }
      return settled;
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}
