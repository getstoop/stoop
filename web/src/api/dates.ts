// Timeline date helpers. Times in the timeline are time-of-day only; day
// separators and a hover title carry the date.

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

// "Today", "Yesterday", a weekday within the last week, then a date
// (with the year once it isn't this year).
export function dayLabel(d: Date, now: Date = new Date()): string {
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round(
    (startOf(now).getTime() - startOf(d).getTime()) / DAY_MS,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7)
    return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

// The hover title on a timestamp: the whole thing, unambiguously.
export function fullDateTime(d: Date): string {
  return d.toLocaleString([], {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// A row's timestamp where space is short: the time today, otherwise the
// day and time, with the year only when it differs.
export function shortDateTime(d: Date, now: Date = new Date()): string {
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay(d, now)) return time;
  const day = d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
  return `${day}, ${time}`;
}
