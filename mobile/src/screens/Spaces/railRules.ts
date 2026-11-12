import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { mentionLabel } from "../../api/spaces";

// The rules of the Spaces tab's rail: which space is selected, and what
// each space's button shows and says.

// The space to show, given the spaces in the rail and the one wanted
// (the one last picked, if any): the wanted one while the account is
// still in it, else the first, and none when there are no spaces.
export function pickSpace(spaces: readonly Pick<Space, "id">[], wanted: string | undefined): string | undefined {
  if (wanted !== undefined && spaces.some((space) => space.id === wanted)) return wanted;
  return spaces[0]?.id;
}

// One space's button is this tall, and the rail's content is padded by
// this much above the first and below the last.
export const RAIL_ITEM_HEIGHT = 56;
export const RAIL_PADDING = 8;

// How far down the rail starts, so the selected space (the one at
// `index` of `count`) is in sight as the tab first shows its list: not
// at all while its button is already whole above what lies over the
// rail's bottom (`obstruction`, which the content is also padded by),
// else far enough to put it mid-way, short of scrolling past the end.
export function railOffset(index: number, count: number, height: number, obstruction: number): number {
  if (index < 0 || height <= 0) return 0;
  const top = RAIL_PADDING + index * RAIL_ITEM_HEIGHT;
  const clear = height - obstruction;
  if (top + RAIL_ITEM_HEIGHT <= clear) return 0;
  const content = RAIL_PADDING + count * RAIL_ITEM_HEIGHT + RAIL_PADDING + obstruction;
  const middle = top - (clear - RAIL_ITEM_HEIGHT) / 2;
  return Math.round(Math.max(0, Math.min(middle, content - height)));
}

export type RailItemView = {
  // The mark at the rail's edge: the selected space's bar, else a short
  // one while something in the space is unread.
  mark: "selected" | "unread" | "none";
  // The mention count to badge the icon with; 0 for no badge.
  mentions: number;
  dimmed: boolean;
  label: string;
};

// What one space's button shows: the space's `alertCount` as its badge
// (docs/architecture/messaging.md → Alert counts) and a mark while it
// has something unread. A muted space is dimmed and shows neither, as
// on web's rail (the server already counts a muted space as 0, so the
// check here only keeps the button honest), but selected it still
// carries the bar. The label is the name, "selected", then what waits.
export function railItem(
  space: Pick<Space, "name" | "muted" | "hasUnread" | "alertCount">,
  selected: boolean,
): RailItemView {
  const mentions = space.muted ? 0 : space.alertCount;
  const unread = !space.muted && space.hasUnread;
  const waiting = space.muted ? "muted" : mentions > 0 ? mentionLabel(mentions) : unread ? "unread" : null;
  return {
    mark: selected ? "selected" : unread ? "unread" : "none",
    mentions,
    dimmed: space.muted,
    label: [space.name, selected ? "selected" : null, waiting].filter(Boolean).join(", "),
  };
}
