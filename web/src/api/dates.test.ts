import { describe, expect, it } from "vitest";
import { dayLabel, fullDateTime, sameDay, shortDateTime } from "./dates";

// Local-time constructor throughout: the helpers read local getters, so
// building dates this way keeps the suite honest in any TZ.
const at = (y: number, m: number, d: number, h = 12, min = 0, s = 0) =>
  new Date(y, m - 1, d, h, min, s);

// The suite runs under whatever locale CI has, so the formatted branches
// are asserted against Intl output rather than literal English strings.
const weekdayOf = (d: Date) => d.toLocaleDateString([], { weekday: "long" });
const timeOf = (d: Date) =>
  d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

describe("sameDay", () => {
  it("ignores the time of day", () => {
    expect(sameDay(at(2026, 9, 11, 0, 0), at(2026, 9, 11, 23, 59))).toBe(true);
  });

  it("separates a minute either side of midnight", () => {
    expect(sameDay(at(2026, 9, 11, 23, 59), at(2026, 9, 12, 0, 1))).toBe(false);
  });

  it("separates the same calendar day in different years", () => {
    expect(sameDay(at(2025, 9, 11), at(2026, 9, 11))).toBe(false);
  });

  it("separates the same day number in different months", () => {
    expect(sameDay(at(2026, 8, 11), at(2026, 9, 11))).toBe(false);
  });
});

describe("dayLabel", () => {
  const now = at(2026, 9, 11, 14, 30); // Friday

  it("says Today for any time on the current day", () => {
    expect(dayLabel(at(2026, 9, 11, 0, 0), now)).toBe("Today");
    expect(dayLabel(at(2026, 9, 11, 23, 59), now)).toBe("Today");
  });

  it("says Yesterday for any time on the previous day", () => {
    expect(dayLabel(at(2026, 9, 10, 0, 0), now)).toBe("Yesterday");
    expect(dayLabel(at(2026, 9, 10, 23, 59), now)).toBe("Yesterday");
  });

  it("flips from Today to Yesterday as now crosses midnight", () => {
    const d = at(2026, 9, 11, 23, 59);
    expect(dayLabel(d, at(2026, 9, 11, 23, 59, 30))).toBe("Today");
    expect(dayLabel(d, at(2026, 9, 12, 0, 0))).toBe("Yesterday");
  });

  it("gives a bare weekday from two up to six days back", () => {
    const twoBack = at(2026, 9, 9);
    const sixBack = at(2026, 9, 5);
    expect(dayLabel(twoBack, now)).toBe(weekdayOf(twoBack));
    expect(dayLabel(sixBack, now)).toBe(weekdayOf(sixBack));
  });

  it("adds the date once a week has passed, since the weekday repeats", () => {
    const sevenBack = at(2026, 9, 4);
    const label = dayLabel(sevenBack, now);
    expect(label).not.toBe(weekdayOf(sevenBack));
    expect(label).toContain(weekdayOf(sevenBack));
  });

  it("leaves the year off a full date in the current year", () => {
    expect(dayLabel(at(2026, 1, 5), now)).not.toContain("2026");
  });

  it("adds the year once the date is in another year", () => {
    expect(dayLabel(at(2024, 3, 3), now)).toContain("2024");
  });

  it("counts calendar days, not year arithmetic, across new year", () => {
    expect(dayLabel(at(2025, 12, 31, 20, 0), at(2026, 1, 1, 9, 0))).toBe(
      "Yesterday",
    );
  });

  it("counts calendar days across a month boundary", () => {
    expect(dayLabel(at(2026, 2, 28, 20, 0), at(2026, 3, 1, 9, 0))).toBe(
      "Yesterday",
    );
  });

  // Rounding, not truncation, is what keeps a 23- or 25-hour day at one.
  it("counts a DST day as one day", () => {
    expect(dayLabel(at(2026, 11, 1, 0, 30), at(2026, 11, 2, 9, 0))).toBe(
      "Yesterday",
    );
    expect(dayLabel(at(2026, 3, 8, 0, 30), at(2026, 3, 9, 9, 0))).toBe(
      "Yesterday",
    );
  });

  it("falls through to a full date for a future day", () => {
    const tomorrow = at(2026, 9, 12);
    expect(dayLabel(tomorrow, now)).toContain(weekdayOf(tomorrow));
    expect(dayLabel(tomorrow, now)).not.toBe(weekdayOf(tomorrow));
  });
});

describe("shortDateTime", () => {
  const now = at(2026, 9, 11, 14, 30);

  it("shows only the time for today", () => {
    const d = at(2026, 9, 11, 9, 5);
    expect(shortDateTime(d, now)).toBe(timeOf(d));
  });

  it("prefixes the day once the date is not today", () => {
    const d = at(2026, 9, 10, 9, 5);
    const out = shortDateTime(d, now);
    expect(out.endsWith(`, ${timeOf(d)}`)).toBe(true);
    expect(out).not.toBe(timeOf(d));
  });

  it("drops the day again when now moves onto the same date", () => {
    const d = at(2026, 9, 10, 9, 5);
    expect(shortDateTime(d, at(2026, 9, 10, 23, 59))).toBe(timeOf(d));
  });

  it("gains the day prefix a minute after midnight passes", () => {
    const d = at(2026, 9, 11, 23, 59);
    expect(shortDateTime(d, at(2026, 9, 11, 23, 59, 30))).toBe(timeOf(d));
    expect(shortDateTime(d, at(2026, 9, 12, 0, 0))).not.toBe(timeOf(d));
  });

  it("leaves the year off a date in the current year", () => {
    expect(shortDateTime(at(2026, 1, 5, 9, 5), now)).not.toContain("2026");
  });

  it("adds the year for a date in another year", () => {
    expect(shortDateTime(at(2024, 3, 3, 9, 5), now)).toContain("2024");
  });

  // Same calendar day, different year: still the long form.
  it("does not treat the same day of another year as today", () => {
    const d = at(2025, 9, 11, 14, 30);
    expect(shortDateTime(d, now)).not.toBe(timeOf(d));
  });
});

describe("fullDateTime", () => {
  const d = at(2024, 3, 3, 9, 5);

  it("spells out weekday, year and time, whatever now is", () => {
    expect(fullDateTime(d)).toContain(weekdayOf(d));
    expect(fullDateTime(d)).toContain("2024");
    expect(fullDateTime(d)).toContain("05");
  });

  it("keeps the date even for today, unlike shortDateTime", () => {
    const today = at(2026, 9, 11, 9, 5);
    expect(fullDateTime(today)).toContain("2026");
    expect(fullDateTime(today)).not.toBe(
      shortDateTime(today, at(2026, 9, 11, 14, 30)),
    );
  });
});
