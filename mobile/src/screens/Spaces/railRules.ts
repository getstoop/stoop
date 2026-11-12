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
