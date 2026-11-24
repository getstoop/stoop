import { dayAndTime, sameDay } from "@stoop/core/dates";

// A row's time, as the list shows it under its day lines; on a menu's
// card and in a thread (`withDay`) the day too, as web's thread shows a
// reply's, unless it is today.
export function messageTime(created: Date, withDay: boolean): string {
  if (!withDay || sameDay(created, new Date())) {
    return created.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return dayAndTime(created);
}
