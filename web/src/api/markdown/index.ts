// The message format: a small chat-style Markdown subset, parsed into a
// tree that the renderer turns into React nodes (never HTML strings).
// The server's port is internal/chat/markdown.go; the two share test cases.

export { parseMarkdown } from "./blocks";
export { parseInline } from "./inline";
export { isBlankMessage, linksIn, plainText } from "./text";
export type { Block, Inline, ListItem } from "./types";
