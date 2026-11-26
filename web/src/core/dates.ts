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

// A message's time where there are no day separators to carry the date
// (a thread): "Today at 7:04 PM", "Monday at 7:06 PM".
export function dayAndTime(d: Date, now: Date = new Date()): string {
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${dayLabel(d, now)} at ${time}`;
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

// A moment in a table that must stand on its own: "Oct 31, 2026, 12:25 PM".
export function dateAndTime(d: Date): string {
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
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

// Calendar days from now's day to d's, by the local dates alone, so a day
// of 23 or 25 hours (a daylight-saving change) still counts as one.
function daysAhead(d: Date, now: Date): number {
  const dayOf = (x: Date) =>
    Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  return Math.round((dayOf(d) - dayOf(now)) / DAY_MS);
}

// A day still to come where its time is said beside it: "Tue 2 Dec" (in
// the reader's locale), with the year only when it differs from now's.
export function futureDay(d: Date, now: Date = new Date()): string {
  return d.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

// A time still to come, worded to sit after "for" or "at" in a sentence:
// "today at 4:30 PM", "tomorrow at 9:00 AM", then "Tue 2 Dec at 9:00 AM".
// The time is cut to the minute, as a stored reminder is.
export function futureTime(d: Date, now: Date = new Date()): string {
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = daysAhead(d, now);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  return `${futureDay(d, now)} at ${time}`;
}

const pad = (value: number) => String(value).padStart(2, "0");

// A local date and time as a date-and-time field holds it, to the minute:
// "2026-12-02T09:00".
export function localInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The instant a date-and-time field's value names in local time, or null
// for a value that is not one. A time a daylight-saving change skips
// (2:30 on the morning clocks go forward) is read as the clock would show
// it after the change; one it repeats is read as the first.
export function parseLocalInput(value: string): Date | null {
  const found = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value,
  );
  if (!found) return null;
  const [year, month, day, hour, minute, second] = found
    .slice(1)
    .map((part) => Number(part ?? 0));
  const d = new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(d.getTime())) return null;
  // Out-of-range parts roll over in Date; a field never sends those, and
  // anything else is not a time.
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

// A year ahead on the calendar, as the server's AddDate(1, 0, 0) counts
// it: the furthest a reminder or a poll's time may be.
export function yearAhead(now: Date): Date {
  const latest = new Date(now.getTime());
  latest.setFullYear(latest.getFullYear() + 1);
  return latest;
}

const SLOT_PARTS = (d: Date, now: Date): Intl.DateTimeFormatOptions => ({
  weekday: "short",
  day: "numeric",
  month: "short",
  ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
});

// A time poll's option in the reader's zone and locale: "Thu 26 Nov,
// 7:00 PM" as the locale writes it, with the year when it is not this
// year. The same words DateTimeField shows for a picked time.
export function slotLabel(at: Date, now: Date = new Date()): string {
  return at.toLocaleString([], {
    ...SLOT_PARTS(at, now),
    hour: "numeric",
    minute: "2-digit",
  });
}

// The same time worded to sit in a sentence that joins several with
// commas (a closed poll's winners): "Thu 26 Nov at 7:00 PM", with no
// comma of its own, so "A, B and C" still reads as three.
export function slotPhrase(at: Date, now: Date = new Date()): string {
  const day = new Intl.DateTimeFormat([], SLOT_PARTS(at, now))
    .formatToParts(at)
    .map((part) =>
      part.type === "literal"
        ? part.value.replace(/\s*[,،，]\s*/g, " ")
        : part.value,
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  const time = at.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} at ${time}`;
}

// The reader's time zone as a time poll names it: the place in the
// zone's name and its offset now, "New York (GMT−5)", "UTC (GMT+0)";
// the offset alone when the runtime names no zone. Its zone and offset
// are this device's.
export function zoneLabel(now: Date = new Date()): string {
  let zone = "";
  let offset = "";
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    offset =
      new Intl.DateTimeFormat("en-US", { timeZoneName: "shortOffset" })
        .formatToParts(now)
        .find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    // A runtime without zone names: the offset alone, or nothing.
  }
  if (!offset) {
    const minutes = -now.getTimezoneOffset();
    const sign = minutes < 0 ? "-" : "+";
    const hours = Math.floor(Math.abs(minutes) / 60);
    const rest = Math.abs(minutes) % 60;
    offset =
      minutes === 0
        ? "GMT"
        : `GMT${sign}${hours}${rest ? `:${pad(rest)}` : ""}`;
  }
  // A typographic minus, as a printed offset has it.
  offset = offset.replace("-", "−");
  const place = zone.includes("/")
    ? (zone.split("/").pop() ?? "").replace(/_/g, " ")
    : zone;
  return place && place !== "GMT" ? `${place} (${offset})` : offset;
}
