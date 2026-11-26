// The rules of DateTimeField that need no page: the value's shape, days
// and months as plain numbers, the month grid, the bounds, the half-hour
// list, reading a typed time and the words the field shows.
//
// A value is a local reading, "2026-12-12T10:00", as a native
// date-and-time field holds it. A day is "2026-12-12" or a Day; day
// arithmetic goes through UTC, so a daylight-saving change never moves a
// date.

export type Day = { year: number; month: number; day: number };

const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (value: number) => String(value).padStart(2, "0");

export const dayKey = (d: Day): string =>
  `${d.year}-${pad(d.month)}-${pad(d.day)}`;

// A day from "YYYY-MM-DD" (or the date part of a value), or null.
export function parseDay(text: string): Day | null {
  const found = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!found) return null;
  const [year, month, day] = found.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month))
    return null;
  return { year, month, day };
}

// A time of day from "HH:MM", or null.
export function parseTime(text: string): string | null {
  const found = /^(\d{2}):(\d{2})$/.exec(text);
  if (!found) return null;
  const [hour, minute] = found.slice(1).map(Number);
  return hour < 24 && minute < 60 ? text : null;
}

// A value's day and time, each null when it is not one.
export function splitValue(value: string): {
  day: string | null;
  time: string | null;
} {
  const [date = "", time = ""] = value.split("T");
  const day = parseDay(date);
  return {
    day: day && date.length === 10 ? dayKey(day) : null,
    time: parseTime(time),
  };
}

export const joinValue = (day: string, time: string): string =>
  `${day}T${time}`;

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const serial = (d: Day) => Date.UTC(d.year, d.month - 1, d.day) / DAY_MS;

function fromSerial(n: number): Day {
  const date = new Date(n * DAY_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export const compareDays = (a: Day, b: Day): number => serial(a) - serial(b);

export const sameDay = (a: Day, b: Day): boolean => compareDays(a, b) === 0;

export const addDays = (d: Day, days: number): Day =>
  fromSerial(serial(d) + days);

// The same day of another month, or that month's last when it is
// shorter: 31 January and a month is 28 February.
export function addMonths(d: Day, months: number): Day {
  const index = d.year * 12 + (d.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { year, month, day: Math.min(d.day, daysInMonth(year, month)) };
}

// 0 is Sunday.
export const weekday = (d: Day): number => (serial(d) + 4) % 7;

// The week starts on Sunday, for everyone; nothing is read from the
// locale for it.
export const startOfWeek = (d: Day): Day => addDays(d, -weekday(d));
export const endOfWeek = (d: Day): Day => addDays(d, 6 - weekday(d));

export const todayOf = (now: Date): Day => ({
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  day: now.getDate(),
});

// The days a min and a max allow, by day: the time in them is not read.
export type Bounds = { min: Day | null; max: Day | null };

export const boundsOf = (min?: string, max?: string): Bounds => ({
  min: min ? parseDay(min) : null,
  max: max ? parseDay(max) : null,
});

export const inBounds = (d: Day, { min, max }: Bounds): boolean =>
  (!min || compareDays(d, min) >= 0) && (!max || compareDays(d, max) <= 0);

export function clampDay(d: Day, { min, max }: Bounds): Day {
  if (min && compareDays(d, min) < 0) return min;
  if (max && compareDays(d, max) > 0) return max;
  return d;
}

// Whether the month before (-1) or after (+1) the one shown has a day
// the bounds allow.
export function canTurn(shown: Day, step: -1 | 1, { min, max }: Bounds) {
  const month = shown.year * 12 + shown.month;
  if (step < 0) return !min || min.year * 12 + min.month < month;
  return !max || max.year * 12 + max.month > month;
}

// Where a key moves the day under keyboard focus, kept to the bounds; null
// for a key the grid does not take.
export function moveByKey(d: Day, key: string, bounds: Bounds): Day | null {
  const moved = (() => {
    switch (key) {
      case "ArrowLeft":
        return addDays(d, -1);
      case "ArrowRight":
        return addDays(d, 1);
      case "ArrowUp":
        return addDays(d, -7);
      case "ArrowDown":
        return addDays(d, 7);
      case "PageUp":
        return addMonths(d, -1);
      case "PageDown":
        return addMonths(d, 1);
      case "Home":
        return startOfWeek(d);
      case "End":
        return endOfWeek(d);
      default:
        return null;
    }
  })();
  return moved && clampDay(moved, bounds);
}

// A month as rows of seven, Sunday first, with blanks before the first
// day and after the last. Each cell has a key that is stable for the
// month, so a list of them needs no index.
export type Cell = { key: string; day: Day | null };

export function monthGrid(year: number, month: number): Cell[][] {
  const first: Day = { year, month, day: 1 };
  const length = daysInMonth(year, month);
  const lead = weekday(first);
  const cells: Cell[] = [];
  for (let i = 0; i < lead; i++) cells.push({ key: `lead-${i}`, day: null });
  for (let day = 1; day <= length; day++) {
    const d = { year, month, day };
    cells.push({ key: dayKey(d), day: d });
  }
  for (let i = 0; cells.length % 7 !== 0; i++)
    cells.push({ key: `trail-${i}`, day: null });
  const weeks: Cell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// Every half hour of a day, "00:00" to "23:30": the list's rows.
export const HALF_HOURS: readonly string[] = Array.from(
  { length: 48 },
  (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 ? "30" : "00"}`,
);

// The half hour after (+1) or before (-1) a time, round the clock; from
// no time at all, 9:00.
export function stepTime(time: string | null, step: -1 | 1): string {
  if (!time) return "09:00";
  const [hour, minute] = time.split(":").map(Number);
  const at = hour * 60 + minute;
  const next =
    step > 0 ? Math.floor(at / 30) * 30 + 30 : Math.ceil(at / 30) * 30 - 30;
  const wrapped = (next + 24 * 60) % (24 * 60);
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

// A time typed into the field, as "HH:MM", or null when it is not one.
// Read: whatever timeLabel writes for the locale, and "19:30", "7.30",
// "730", "1930", "7", "7pm", "7:30 p.m.", with the period before or after
// the number, in the locale's own words for it or a/am/p/pm, and in the
// locale's digits or ASCII ones. Without a period an hour is on the
// 24-hour clock.
export function parseTypedTime(text: string, locale?: string): string | null {
  const reader = readerFor(locale);
  const squeezed = reader.squeeze(text);
  const label = reader.labels.get(squeezed);
  if (label) return label;
  const found = /^([^\d]*)(\d{1,2})(?:[:.h]?(\d{2}))?([^\d]*)$/.exec(squeezed);
  if (!found) return null;
  const [, before, hourText, minuteText, after] = found;
  if (before && after) return null;
  let hour = Number(hourText);
  const minute = Number(minuteText ?? 0);
  const word = (before || after).replace(/\./g, "");
  const period = word === "" ? null : reader.periods.get(word);
  if (period === undefined || minute > 59) return null;
  if (period) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (period === "pm" ? 12 : 0);
  } else if (hour > 23) return null;
  return `${pad(hour)}:${pad(minute)}`;
}

// What parseTypedTime knows of a locale, worked out once: its words for
// morning and afternoon, its digits, and every minute's label.
type Reader = {
  squeeze: (text: string) => string;
  periods: Map<string, "am" | "pm">;
  labels: Map<string, string>;
};

const readers = new Map<string, Reader>();

function readerFor(locale?: string): Reader {
  const key = locale ?? "";
  const known = readers.get(key);
  if (known) return known;
  const digits = new Map<string, string>();
  const numbers = new Intl.NumberFormat(locale, { useGrouping: false });
  for (let i = 0; i < 10; i++) digits.set(numbers.format(i), String(i));
  // Lower case, ASCII digits, no spaces and no direction marks.
  const squeeze = (text: string) =>
    Array.from(text.toLowerCase().replace(/[\s\u200e\u200f\u061c]/g, ""))
      .map((char) => digits.get(char) ?? char)
      .join("");
  const periods = new Map<string, "am" | "pm">([
    ["a", "am"],
    ["am", "am"],
    ["p", "pm"],
    ["pm", "pm"],
  ]);
  const format = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    hour12: true,
  });
  for (const [hour, period] of [
    [1, "am"],
    [13, "pm"],
  ] as const) {
    const part = format
      .formatToParts(new Date(2000, 0, 1, hour))
      .find((p) => p.type === "dayPeriod");
    if (part) periods.set(squeeze(part.value).replace(/\./g, ""), period);
  }
  const labels = new Map<string, string>();
  for (let minute = 0; minute < 24 * 60; minute++) {
    const time = `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
    labels.set(squeeze(timeLabel(time, locale)), time);
  }
  const reader = { squeeze, periods, labels };
  readers.set(key, reader);
  return reader;
}

// ---- Words, from Intl in the reader's locale.

// A time of day as the locale writes it: "10:00 AM", "19:30".
export function timeLabel(time: string, locale?: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return timeFormat(locale).format(new Date(2000, 0, 1, hour, minute));
}

// One formatter per locale: building one per label is what costs, and
// parseTypedTime labels every minute of the day.
const timeFormats = new Map<string, Intl.DateTimeFormat>();

function timeFormat(locale?: string): Intl.DateTimeFormat {
  const key = locale ?? "";
  let format = timeFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
    });
    timeFormats.set(key, format);
  }
  return format;
}

const noon = (d: Day) => new Date(d.year, d.month - 1, d.day, 12);

// The month a grid shows: "December 2026".
export const monthTitle = (d: Day, locale?: string): string =>
  noon(d).toLocaleDateString(locale, { month: "long", year: "numeric" });

// A day in full, as a screen reader says a cell: "Saturday, December 12,
// 2026".
export const dayName = (d: Day, locale?: string): string =>
  noon(d).toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

// The heads of the seven columns, Sunday first.
export function weekdayNames(
  locale?: string,
): { short: string; long: string }[] {
  // 4 January 2026 is a Sunday.
  return Array.from({ length: 7 }, (_, i) => {
    const d = noon({ year: 2026, month: 1, day: 4 + i });
    return {
      short: d.toLocaleDateString(locale, { weekday: "short" }),
      long: d.toLocaleDateString(locale, { weekday: "long" }),
    };
  });
}

// What the closed field says for a value: "Sat, Dec 12, 10:00 AM" in the
// reader's format, the year added when it is not this year; null for no
// value.
export function fieldLabel(
  value: string,
  now: Date,
  locale?: string,
): string | null {
  const { day, time } = splitValue(value);
  const d = day && parseDay(day);
  if (!d || !time) return null;
  const [hour, minute] = time.split(":").map(Number);
  return new Date(d.year, d.month - 1, d.day, hour, minute).toLocaleString(
    locale,
    {
      weekday: "short",
      day: "numeric",
      month: "short",
      ...(d.year !== now.getFullYear() ? { year: "numeric" } : {}),
      hour: "numeric",
      minute: "2-digit",
    },
  );
}
