import { Schema } from "prosemirror-model";
import { readableAddress } from "./markdown";

// The message format as a document schema, and nothing more: a quote holds
// lines, a list item holds a line and maybe a nested list, and a code
// block holds plain text. Anything the format can't write can't be made.

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    blockquote: {
      group: "block",
      content: "paragraph+",
      defining: true,
      parseDOM: [{ tag: "blockquote" }],
      toDOM: () => ["blockquote", 0],
    },
    bulletList: {
      group: "block",
      content: "listItem+",
      parseDOM: [{ tag: "ul" }],
      toDOM: () => ["ul", 0],
    },
    orderedList: {
      group: "block",
      content: "listItem+",
      parseDOM: [{ tag: "ol" }],
      toDOM: () => ["ol", 0],
    },
    listItem: {
      content: "paragraph (bulletList | orderedList)*",
      defining: true,
      parseDOM: [{ tag: "li" }],
      toDOM: () => ["li", 0],
    },
    codeBlock: {
      group: "block",
      content: "text*",
      marks: "",
      code: true,
      defining: true,
      attrs: { language: { default: null } },
      parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
      toDOM: () => ["pre", ["code", 0]],
    },
    text: { group: "inline" },
    // A mention is one unit: it carries who it names, and reads as the
    // handle. The mentions plugin keeps the handle current.
    mention: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { kind: {}, id: {}, handle: {} },
      leafText: (node) => `@${node.attrs.handle}`,
      parseDOM: [
        {
          tag: "span[data-mention-id]",
          getAttrs: (dom) => {
            const el = dom as HTMLElement;
            return {
              kind: el.dataset.mentionKind,
              id: el.dataset.mentionId,
              handle: el.dataset.mentionHandle,
            };
          },
        },
      ],
      toDOM: (node) => [
        "span",
        {
          class: "mention",
          "data-mention-kind": node.attrs.kind,
          "data-mention-id": node.attrs.id,
          "data-mention-handle": node.attrs.handle,
        },
        `@${node.attrs.handle}`,
      ],
    },
  },
  marks: {
    link: {
      attrs: { href: {} },
      inclusive: false,
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (dom) => {
            const href = (dom as HTMLElement).getAttribute("href") ?? "";
            return readableAddress(href) ? { href } : false;
          },
        },
      ],
      toDOM: (mark) => [
        "a",
        { href: mark.attrs.href, title: mark.attrs.href },
        0,
      ],
    },
    spoiler: {
      parseDOM: [{ tag: "span[data-spoiler]" }],
      toDOM: () => ["span", { "data-spoiler": "", class: "rich-spoiler" }, 0],
    },
    bold: {
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
      toDOM: () => ["strong", 0],
    },
    italic: {
      parseDOM: [{ tag: "em" }, { tag: "i" }],
      toDOM: () => ["em", 0],
    },
    underline: {
      parseDOM: [{ tag: "u" }],
      toDOM: () => ["u", 0],
    },
    strike: {
      parseDOM: [{ tag: "s" }, { tag: "del" }],
      toDOM: () => ["s", 0],
    },
    code: {
      parseDOM: [{ tag: "code" }],
      toDOM: () => ["code", 0],
    },
  },
});
