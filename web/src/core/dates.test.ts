import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dayAndTime,
  dayLabel,
  fullDateTime,
  sameDay,
  shortDateTime,
  slotLabel,
  slotPhrase,
  yearAhead,
  zoneLabel,
} from "./dates";

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

describe("dayAndTime", () => {
  it("puts the day before the time", () => {
    const now = at(2026, 9, 11, 12, 0);
    const time = (d: Date) =>
      d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const today = at(2026, 9, 11, 19, 4);
    const monday = at(2026, 9, 6, 19, 6);
    expect(dayAndTime(today, now)).toBe(`Today at ${time(today)}`);
    expect(dayAndTime(monday, now)).toBe(
      `${dayLabel(monday, now)} at ${time(monday)}`,
    );
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

describe("yearAhead", () => {
  it("is a calendar year on, as Go's AddDate counts it", () => {
    expect(yearAhead(at(2026, 11, 26, 15, 30))).toEqual(
      at(2027, 11, 26, 15, 30),
    );
    expect(yearAhead(at(2028, 2, 29, 12))).toEqual(at(2029, 3, 1, 12));
  });
});

// Fixed readers, so the words are known whatever the machine's own
// locale and zone. ICU writes a narrow no-break space before AM and PM
// in some versions, so spaces are compared as spaces.
const US = { locale: "en-US", timeZone: "America/New_York" };
const GB = { locale: "en-GB", timeZone: "Europe/London" };
const spaced = (text: string) => text.replace(/\s/g, " ");
// 3 December 2026 at 19:00 in New York, which is midnight on the 4th in
// London.
const THURSDAY = new Date(Date.UTC(2026, 11, 4, 0, 0));
const NOW = new Date(Date.UTC(2026, 10, 26, 17, 0));

describe("slotLabel", () => {
  it("writes the weekday, date and time as each locale does", () => {
    expect(spaced(slotLabel(THURSDAY, NOW, US))).toBe("Thu, Dec 3, 7:00 PM");
    expect(spaced(slotLabel(THURSDAY, NOW, GB))).toBe("Fri 4 Dec, 0:00");
  });

  it("adds the year when it is not this year in the reader's zone", () => {
    const later = new Date(Date.UTC(2027, 0, 2, 19, 0));
    expect(spaced(slotLabel(later, NOW, US))).toBe("Sat, Jan 2, 2027, 2:00 PM");
    expect(spaced(slotLabel(later, NOW, GB))).toBe("Sat, 2 Jan 2027, 19:00");
  });

  it("reads the New Year in the reader's zone", () => {
    // 2027 in London already, still 2026 in New York.
    const eve = new Date(Date.UTC(2027, 0, 1, 1, 0));
    const nowEve = new Date(Date.UTC(2026, 11, 31, 12, 0));
    expect(spaced(slotLabel(eve, nowEve, US))).toBe("Thu, Dec 31, 8:00 PM");
    expect(spaced(slotLabel(eve, nowEve, GB))).toBe("Fri, 1 Jan 2027, 1:00");
  });
});

describe("slotPhrase", () => {
  it("puts the time after the day, with no comma", () => {
    expect(spaced(slotPhrase(THURSDAY, NOW, US))).toBe("Thu Dec 3 at 7:00 PM");
    expect(spaced(slotPhrase(THURSDAY, NOW, GB))).toBe("Fri 4 Dec at 0:00");
  });

  it("adds the year when it is not this year, still with no comma", () => {
    const later = new Date(Date.UTC(2027, 0, 2, 19, 0));
    expect(spaced(slotPhrase(later, NOW, US))).toBe(
      "Sat Jan 2 2027 at 2:00 PM",
    );
    expect(spaced(slotPhrase(later, NOW, GB))).toBe("Sat 2 Jan 2027 at 19:00");
  });
});

describe("zoneLabel", () => {
  const winter = new Date(Date.UTC(2026, 10, 26, 12));
  const summer = new Date(Date.UTC(2026, 6, 1, 12));

  it("names the place and the offset now", () => {
    expect(zoneLabel(winter, "America/New_York")).toBe("New York (GMT\u22125)");
    expect(zoneLabel(summer, "America/New_York")).toBe("New York (GMT\u22124)");
    expect(zoneLabel(winter, "America/Argentina/Buenos_Aires")).toBe(
      "Buenos Aires (GMT\u22123)",
    );
  });

  it("writes a half-hour offset", () => {
    expect(zoneLabel(winter, "Asia/Kolkata")).toBe("Kolkata (GMT+5:30)");
  });

  it("names a zone with no place by its offset alone", () => {
    // POSIX signs: Etc/GMT+5 is five hours behind.
    expect(zoneLabel(winter, "Etc/GMT+5")).toBe("GMT\u22125");
    expect(zoneLabel(winter, "Etc/GMT-3")).toBe("GMT+3");
    expect(zoneLabel(winter, "UTC")).toBe("UTC");
    expect(zoneLabel(winter, "Etc/UTC")).toBe("UTC");
  });

  it("writes a behind half-hour offset and the furthest ahead", () => {
    expect(zoneLabel(winter, "America/St_Johns")).toBe(
      "St Johns (GMT\u22123:30)",
    );
    expect(zoneLabel(summer, "America/St_Johns")).toBe(
      "St Johns (GMT\u22122:30)",
    );
    // Southern summer in November: thirteen hours ahead.
    expect(zoneLabel(winter, "Pacific/Auckland")).toBe("Auckland (GMT+13)");
    expect(zoneLabel(winter, "Pacific/Kiritimati")).toBe("Kiritimati (GMT+14)");
    expect(zoneLabel(winter, "Europe/London")).toBe("London (GMT+0)");
  });

  describe("on an engine that splits a zone name's offset off", () => {
    // iOS's engine words shortOffset as "GMT" with the "-5" as plain
    // text; the label must not lean on how a zone name is split.
    const original = Intl.DateTimeFormat.prototype.formatToParts;
    beforeEach(() => {
      vi.spyOn(
        Intl.DateTimeFormat.prototype,
        "formatToParts",
      ).mockImplementation(function (
        this: Intl.DateTimeFormat,
        date?: Date | number,
      ) {
        const parts = original.call(this, date);
        if (!this.resolvedOptions().timeZoneName) return parts;
        return parts.flatMap((part) =>
          part.type === "timeZoneName"
            ? [
                { type: "timeZoneName", value: "GMT" },
                { type: "literal", value: part.value.replace("GMT", "") },
              ]
            : [part],
        );
      });
    });
    afterEach(() => vi.restoreAllMocks());

    it("still names the offset of a given zone", () => {
      expect(zoneLabel(winter, "America/New_York")).toBe(
        "New York (GMT\u22125)",
      );
      expect(zoneLabel(winter, "Asia/Tokyo")).toBe("Tokyo (GMT+9)");
    });

    it("still names the device's own offset", () => {
      vi.spyOn(
        Intl.DateTimeFormat.prototype,
        "resolvedOptions",
      ).mockReturnValue({
        ...new Intl.DateTimeFormat().resolvedOptions(),
        timeZone: "America/New_York",
      });
      vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(300);
      expect(zoneLabel(winter)).toBe("New York (GMT\u22125)");
    });
  });
});
