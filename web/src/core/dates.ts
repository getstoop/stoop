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

// Where a time is shown: the reader's locale and zone, which are the
// device's unless given (the tests give them).
export type Reader = { locale?: string; timeZone?: string };

// The calendar year an instant falls in, in the reader's zone.
const yearIn = (d: Date, reader: Reader): number =>
  Number(
    new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      timeZone: reader.timeZone,
    }).format(d),
  );

const slotDay = (
  d: Date,
  now: Date,
  reader: Reader,
): Intl.DateTimeFormatOptions => ({
  weekday: "short",
  day: "numeric",
  month: "short",
  ...(yearIn(d, reader) !== yearIn(now, reader) ? { year: "numeric" } : {}),
  timeZone: reader.timeZone,
});

const slotTime = (reader: Reader): Intl.DateTimeFormatOptions => ({
  hour: "numeric",
  minute: "2-digit",
  timeZone: reader.timeZone,
});

// A time poll's option in the reader's zone and locale: "Thu, Dec 3,
// 7:00 PM", "Thu 3 Dec, 19:00", as the locale writes it, with the year
// when it is not this year in that zone. The same words DateTimeField
// shows for a picked time.
export function slotLabel(
  at: Date,
  now: Date = new Date(),
  reader: Reader = {},
): string {
  return at.toLocaleString(reader.locale ?? [], {
    ...slotDay(at, now, reader),
    ...slotTime(reader),
  });
}

// The same time worded to sit in a sentence that joins several with
// commas (a closed poll's winners): "Thu Dec 3 at 7:00 PM", with no
// comma of its own, so "A, B and C" still reads as three.
export function slotPhrase(
  at: Date,
  now: Date = new Date(),
  reader: Reader = {},
): string {
  const day = new Intl.DateTimeFormat(
    reader.locale ?? [],
    slotDay(at, now, reader),
  )
    .formatToParts(at)
    .map((part) =>
      part.type === "literal"
        ? part.value.replace(/\s*[,،，]\s*/g, " ")
        : part.value,
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  const time = at.toLocaleTimeString(reader.locale ?? [], slotTime(reader));
  return `${day} at ${time}`;
}

// The reader's time zone as a time poll names it: the place in the
// zone's name and its offset now, "New York (GMT−5)", "Kolkata
// (GMT+5:30)", "London (GMT+0)"; a zone with no place (UTC, Etc/GMT+5)
// by its offset alone, "UTC", "GMT−5". timeZone is the device's unless
// given. The offset is worked out, never read from a formatted zone name:
// engines split "GMT-5" into parts differently (iOS's gives "GMT" as the
// zone name and the "-5" as plain text).
export function zoneLabel(now: Date = new Date(), timeZone?: string): string {
  let zone = timeZone ?? "";
  try {
    zone ||= Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    // A runtime without zone names: the offset alone, from the clock.
  }
  const offset = offsetText(offsetMinutes(now, timeZone));
  if (/^(Etc\/)?(UTC|GMT|UCT|Universal|Zulu)$/.test(zone)) return "UTC";
  if (!zone.includes("/") || zone.startsWith("Etc/")) return offset;
  const place = (zone.split("/").pop() ?? "").replace(/_/g, " ");
  return `${place} (${offset})`;
}

// How far ahead of UTC a zone's clock is at now, in minutes: the device's
// from its own clock, or a named zone's from the wall-clock time it reads
// at now (plain numeric parts, which every engine gives alike) less now.
function offsetMinutes(now: Date, timeZone?: string): number {
  if (!timeZone) return -now.getTimezoneOffset();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((each) => each.type === type)?.value);
    const wall = Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour") % 24,
      part("minute"),
      part("second"),
    );
    const whole = Math.floor(now.getTime() / 1000) * 1000;
    const minutes = Math.round((wall - whole) / 60_000);
    if (Number.isFinite(minutes)) return minutes;
  } catch {
    // A zone the runtime does not know: the device's clock.
  }
  return -now.getTimezoneOffset();
}

// "GMT−5", "GMT+5:30", "GMT+0", with a typographic minus.
function offsetText(minutes: number): string {
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  return `GMT${minutes < 0 ? "\u2212" : "+"}${hours}${rest ? `:${pad(rest)}` : ""}`;
}
