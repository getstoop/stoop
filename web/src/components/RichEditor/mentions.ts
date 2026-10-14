import type { Node } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import {
  type MentionMembers,
  mentionClass,
  splitMentions,
} from "../../api/mentions";
import { schema } from "./schema";

// Mentions stay plain text in the document; this draws a handle that
// names a member as the pill the message will show.

export interface MentionContext {
  members: MentionMembers;
  // Whether @channel and @here are ours to use here.
  channelAndHere: boolean;
}

export const NO_MENTIONS: MentionContext = {
  members: new Map(),
  channelAndHere: false,
};

export const mentionsKey = new PluginKey<DecorationSet>("mentions");

export function mentionDecorations(
  doc: Node,
  { members, channelAndHere }: MentionContext,
): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false;
    if (!node.isText || !node.text) return true;
    if (node.marks.some((m) => m.type === schema.marks.code)) return true;
    let at = pos;
    for (const part of splitMentions(
      node.text,
      members,
      channelAndHere,
      channelAndHere,
    )) {
      if (part.mention) {
        decos.push(
          Decoration.inline(at, at + part.text.length, {
            class: mentionClass(part.mention, members),
          }),
        );
      }
      at += part.text.length;
    }
    return true;
  });
  return DecorationSet.create(doc, decos);
}

// A transaction carrying mentionsKey redraws for new members.
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
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}
