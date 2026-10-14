// The message format's tree: what MessageBody renders and the previews and
// the editor read. Markers are gone by this point; escapes are resolved.

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  // label is the words of a [words](address) link; a bare URL has none.
  | { type: "link"; href: string; label?: Inline[] }
  | {
      type: "bold" | "italic" | "underline" | "strike" | "spoiler";
      children: Inline[];
    };

// One list row: whether its marker was a number, its nesting depth (two
// spaces a level, capped), and the content after the marker. Kept flat —
// the renderer builds the tree. Ordered-ness rides on the row, not the
// block, because a numbered item's children are usually bullets.
export interface ListItem {
  ordered: boolean;
  depth: number;
  content: Inline[];
}

export type Block =
  | { type: "lines"; lines: Inline[][] }
  | { type: "quote"; lines: Inline[][] }
  | { type: "list"; items: ListItem[] }
  | { type: "codeblock"; text: string; lang: string };
