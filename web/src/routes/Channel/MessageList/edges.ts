import type { Message } from "../../../gen/stoop/chat/v1/message_pb";

// Where the view stands against the window's edges, and how the window's
// newest message changed: the pure halves of the list's scrolling rules.

export interface Edges {
  older: boolean;
  newer: boolean;
}

// Whether the rows on screen are within `lead` rows of either end of the
// window, so the next page is asked for before the reader reaches it.
// `range` is the virtualiser's visible range over all `count` items.
export function edgesReached(
  range: { startIndex: number; endIndex: number } | null,
  count: number,
  lead: number,
): Edges {
  if (!range || count === 0) return { older: false, newer: false };
  return {
    older: range.startIndex <= lead,
    newer: range.endIndex >= count - 1 - lead,
  };
}

// How the window's newest message changed since `seen`: "first" when no
// window was seen before, "arrival" when one message was added at the
// end, "same" when the newest is as it was (a page prepended, an edit),
// "replaced" when the window was swapped or pruned under it. Only the
// first two may move the view.
export function newestChange(
  seen: string | undefined,
  messages: Message[],
): "first" | "arrival" | "same" | "replaced" {
  if (seen === undefined) return "first";
  const newest = messages[messages.length - 1]?.id;
  if (newest === seen) return "same";
  return messages[messages.length - 2]?.id === seen ? "arrival" : "replaced";
}
