import { timestampDate } from "@bufbuild/protobuf/wkt";
import { startsDay } from "@stoop/core/activity";
import { dayLabel } from "@stoop/core/dates";
import type { ActivityItem } from "@stoop/gen/stoop/chat/v1/activity_pb";

// The Activity tab's list, as web's inbox lays it out
// (web/src/routes/Activity): New, what is unread, newest first, under a
// heading with its count; then Read, the rest, the first row of each day
// carrying the day's label, and the last row no rule under it. A row
// that is read moves from one to the other because the feed stamps it.
export type FeedRow =
  | { kind: "newHead"; key: string; count: number }
  | { kind: "readHead"; key: string }
  | { kind: "new"; key: string; item: ActivityItem }
  | { kind: "read"; key: string; item: ActivityItem; day?: string; last: boolean };

// items is the whole feed shown, newest first (core withOlderPages).
export function feedRows(items: ActivityItem[], now: Date = new Date()): FeedRow[] {
  const fresh = items.filter((item) => !item.readAt);
  const read = items.filter((item) => item.readAt);
  const rows: FeedRow[] = [];
  if (fresh.length > 0) {
    rows.push({ kind: "newHead", key: "head:new", count: fresh.length });
    for (const item of fresh) rows.push({ kind: "new", key: item.id, item });
  }
  if (read.length > 0) {
    rows.push({ kind: "readHead", key: "head:read" });
    read.forEach((item, i) => {
      const day = item.createdAt && startsDay(item, read[i - 1]) ? dayLabel(timestampDate(item.createdAt), now) : undefined;
      rows.push({ kind: "read", key: item.id, item, day, last: i === read.length - 1 });
    });
  }
  return rows;
}
