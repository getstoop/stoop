import { describe, expect, it } from "vitest";
import {
  addMonths,
  boundsOf,
  canTurn,
  clampDay,
  type Day,
  dayKey,
  fieldLabel,
  HALF_HOURS,
  inBounds,
  joinValue,
  monthGrid,
  moveByKey,
  parseDay,
  parseTypedTime,
  splitValue,
  stepTime,
  timeLabel,
  weekday,
  weekdayNames,
} from "./calendar";

const day = (year: number, month: number, d: number): Day => ({
  year,
  month,
  day: d,
});

describe("the value", () => {
  it("splits into a day and a time", () => {
    expect(splitValue("2026-12-12T10:00")).toEqual({
      day: "2026-12-12",
      time: "10:00",
    });
  });

  it("is nothing while empty or broken", () => {
    expect(splitValue("")).toEqual({ day: null, time: null });
    expect(splitValue("2026-02-30T10:00").day).toBeNull();
    expect(splitValue("2026-12-12T24:00").time).toBeNull();
    expect(splitValue("2026-12-12T9:00").time).toBeNull();
  });

  it("joins back as a native field holds it", () => {
    expect(joinValue("2026-12-12", "09:30")).toBe("2026-12-12T09:30");
  });

  it("reads a day and writes it back the same", () => {
    expect(dayKey(parseDay("2027-01-05") as Day)).toBe("2027-01-05");
    expect(parseDay("2027-13-05")).toBeNull();
    expect(parseDay("2028-02-29")).toEqual(day(2028, 2, 29));
    expect(parseDay("2027-02-29")).toBeNull();
  });
});

describe("monthGrid", () => {
  const days = (weeks: ReturnType<typeof monthGrid>) =>
    weeks.map((week) => week.map((cell) => cell.day?.day ?? 0));

  it("starts the week on Sunday", () => {
    // 1 December 2026 is a Tuesday.
    expect(weekday(day(2026, 12, 1))).toBe(2);
    expect(days(monthGrid(2026, 12))).toEqual([
      [0, 0, 1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10, 11, 12],
      [13, 14, 15, 16, 17, 18, 19],
      [20, 21, 22, 23, 24, 25, 26],
      [27, 28, 29, 30, 31, 0, 0],
    ]);
  });

  it("needs no blank before a month that starts on Sunday", () => {
    // 1 November 2026 is a Sunday; February 2026 fills four rows exactly.
    expect(days(monthGrid(2026, 11))[0]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(days(monthGrid(2026, 2))).toHaveLength(4);
  });

  it("gives every cell a key of its own", () => {
    const keys = monthGrid(2026, 12)
      .flat()
      .map((cell) => cell.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("bounds", () => {
  const bounds = boundsOf("2026-11-25T16:10", "2027-11-27T16:10");

  it("are read by day, whatever the time in them", () => {
    expect(inBounds(day(2026, 11, 25), bounds)).toBe(true);
    expect(inBounds(day(2026, 11, 24), bounds)).toBe(false);
    expect(inBounds(day(2027, 11, 27), bounds)).toBe(true);
    expect(inBounds(day(2027, 11, 28), bounds)).toBe(false);
  });

  it("allow everything when there are none", () => {
    expect(inBounds(day(1999, 1, 1), boundsOf())).toBe(true);
  });

  it("clamp a day to the nearest allowed", () => {
    expect(clampDay(day(2026, 1, 1), bounds)).toEqual(day(2026, 11, 25));
    expect(clampDay(day(2030, 1, 1), bounds)).toEqual(day(2027, 11, 27));
    expect(clampDay(day(2027, 3, 3), bounds)).toEqual(day(2027, 3, 3));
  });

  it("stop the month arrows at the first and last months", () => {
    expect(canTurn(day(2026, 11, 1), -1, bounds)).toBe(false);
    expect(canTurn(day(2026, 11, 1), 1, bounds)).toBe(true);
    expect(canTurn(day(2027, 11, 1), 1, bounds)).toBe(false);
    expect(canTurn(day(2027, 11, 1), -1, bounds)).toBe(true);
  });
});

describe("moveByKey", () => {
  const none = boundsOf();

  it("moves a day, a week and a month", () => {
    const from = day(2026, 12, 31);
    expect(moveByKey(from, "ArrowRight", none)).toEqual(day(2027, 1, 1));
    expect(moveByKey(from, "ArrowLeft", none)).toEqual(day(2026, 12, 30));
    expect(moveByKey(from, "ArrowDown", none)).toEqual(day(2027, 1, 7));
    expect(moveByKey(from, "ArrowUp", none)).toEqual(day(2026, 12, 24));
    expect(moveByKey(from, "PageUp", none)).toEqual(day(2026, 11, 30));
  });

  it("goes to the ends of the week, Sunday to Saturday", () => {
    // Thursday 10 December 2026.
    const from = day(2026, 12, 10);
    expect(moveByKey(from, "Home", none)).toEqual(day(2026, 12, 6));
    expect(moveByKey(from, "End", none)).toEqual(day(2026, 12, 12));
  });

  it("keeps to the bounds", () => {
    const bounds = boundsOf("2026-11-25", "2026-12-05");
    expect(moveByKey(day(2026, 11, 25), "ArrowLeft", bounds)).toEqual(
      day(2026, 11, 25),
    );
    expect(moveByKey(day(2026, 11, 30), "PageDown", bounds)).toEqual(
      day(2026, 12, 5),
    );
  });

  it("takes no other key", () => {
    expect(moveByKey(day(2026, 12, 1), "a", none)).toBeNull();
  });
});

describe("addMonths", () => {
  it("lands on a shorter month's last day", () => {
    expect(addMonths(day(2027, 1, 31), 1)).toEqual(day(2027, 2, 28));
    expect(addMonths(day(2027, 3, 31), -1)).toEqual(day(2027, 2, 28));
  });

  it("crosses a year either way", () => {
    expect(addMonths(day(2026, 12, 12), 1)).toEqual(day(2027, 1, 12));
    expect(addMonths(day(2027, 1, 12), -1)).toEqual(day(2026, 12, 12));
  });
});

describe("the time list", () => {
  it("is every half hour of the day", () => {
    expect(HALF_HOURS).toHaveLength(48);
    expect(HALF_HOURS[0]).toBe("00:00");
    expect(HALF_HOURS[19]).toBe("09:30");
    expect(HALF_HOURS[47]).toBe("23:30");
  });

  it("steps by half hours, round the clock", () => {
    expect(stepTime(null, 1)).toBe("09:00");
    expect(stepTime("10:00", 1)).toBe("10:30");
    expect(stepTime("10:00", -1)).toBe("09:30");
    expect(stepTime("10:10", 1)).toBe("10:30");
    expect(stepTime("10:10", -1)).toBe("10:00");
    expect(stepTime("23:30", 1)).toBe("00:00");
    expect(stepTime("00:00", -1)).toBe("23:30");
  });
});

describe("parseTypedTime", () => {
  it.each([
    ["19:30", "19:30"],
    ["7.30", "07:30"],
    ["7:05", "07:05"],
    ["730", "07:30"],
    ["1930", "19:30"],
    ["7", "07:00"],
    ["0:00", "00:00"],
    ["19h30", "19:30"],
    ["7pm", "19:00"],
    ["7 PM", "19:00"],
    ["7:30 p.m.", "19:30"],
    ["7:30a", "07:30"],
    ["12am", "00:00"],
    ["12:15 pm", "12:15"],
    [" 9:00 ", "09:00"],
  ])("reads %j as %s", (typed, time) => {
    expect(parseTypedTime(typed)).toBe(time);
  });

  it.each([
    "",
    "7:75",
    "24:00",
    "13pm",
    "0am",
    "7:",
    "seven",
    "7:30 xm",
    "12:345",
  ])("refuses %j", (typed) => {
    expect(parseTypedTime(typed)).toBeNull();
  });

  it("refuses a word that is not a period", () => {
    expect(parseTypedTime("7constructor")).toBeNull();
    expect(parseTypedTime("7tostring")).toBeNull();
    expect(parseTypedTime("pm7pm")).toBeNull();
  });

  it.each(["en-US", "en-GB", "de", "ko", "ar-EG", "ja"])(
    "reads back every minute %s writes",
    (locale) => {
      for (let minute = 0; minute < 24 * 60; minute += 5) {
        const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
        expect(parseTypedTime(timeLabel(time, locale), locale)).toBe(time);
      }
    },
  );

  it("reads the locale's period before the number, and its digits", () => {
    // The runtime's own words: ICU data differs between runtimes.
    const period = (locale: string, hour: number) =>
      new Intl.DateTimeFormat(locale, { hour: "numeric", hour12: true })
        .formatToParts(new Date(2000, 0, 1, hour))
        .find((part) => part.type === "dayPeriod")?.value ?? "";
    expect(parseTypedTime(`${period("ko", 13)} 7:30`, "ko")).toBe("19:30");
    expect(parseTypedTime(`${period("ko", 1)}7`, "ko")).toBe("07:00");
    expect(parseTypedTime(`7:30 ${period("ar-EG", 13)}`, "ar-EG")).toBe(
      "19:30",
    );
    const arabic = new Intl.NumberFormat("ar-EG").format(7);
    expect(parseTypedTime(`${arabic} ${period("ar-EG", 1)}`, "ar-EG")).toBe(
      "07:00",
    );
    expect(parseTypedTime("19:30", "ar-EG")).toBe("19:30");
  });

  it("reads ASCII 24-hour time in every locale, as the error suggests", () => {
    for (const locale of ["en-US", "en-GB", "de", "ko", "ar-EG", "ja"])
      expect(parseTypedTime("19:30", locale)).toBe("19:30");
  });
});

describe("words", () => {
  it("names the columns Sunday first", () => {
    const names = weekdayNames();
    expect(names).toHaveLength(7);
    expect(names[0].long).toBe(
      new Date(2026, 10, 29, 12).toLocaleDateString([], { weekday: "long" }),
    );
  });

  it("adds the year to the field only when it is not this year", () => {
    const now = new Date(2026, 10, 26, 16, 10);
    const thisYear = fieldLabel("2026-12-12T10:00", now) ?? "";
    const nextYear = fieldLabel("2027-01-12T10:00", now) ?? "";
    expect(thisYear).not.toContain("2026");
    expect(nextYear).toContain("2027");
    expect(thisYear).toContain(timeLabel("10:00"));
  });

  it("says nothing for a value that is not whole", () => {
    expect(fieldLabel("", new Date())).toBeNull();
    expect(fieldLabel("2026-12-12T", new Date())).toBeNull();
  });
});
