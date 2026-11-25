import { afterAll, describe, expect, it } from "vitest";
import { ReminderPreset } from "../gen/stoop/chat/v1/chat_pb";
import { futureDay, futureTime } from "./dates";
import {
  checkReminderForm,
  customBounds,
  deviceTimeZone,
  latestReminderTime,
  localInputValue,
  newReminderForm,
  parseLocalInput,
  plausibleZone,
  presetLabel,
  presetTime,
  REMINDER_PRESETS,
  type ReminderForm,
  reminderPlace,
  reminderRefusal,
  reminderRequest,
  reminderSetText,
  reminderTextProblemText,
  reminderTimeProblem,
  reminderTimeProblemText,
  withChoice,
  withCustom,
  withText,
} from "./reminderForm";

// A zone with daylight saving, so the changes can be tested: in 2026 New
// York goes forward at 2:00 on 8 March and back at 2:00 on 1 November.
// Set for this file only, before any date is built (describe bodies run
// as the file loads); dates are built with the local constructor.
const zone = process.env.TZ;
process.env.TZ = "America/New_York";
afterAll(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

const at = (y: number, m: number, d: number, h = 12, min = 0, s = 0) =>
  new Date(y, m - 1, d, h, min, s);

// The suite runs under whatever locale CI has, so formatted words are
// asserted against Intl output.
const timeOf = (d: Date) =>
  d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe("presetTime", () => {
  const now = at(2026, 11, 24, 16, 10, 30);

  it("adds a fixed span for the first three", () => {
    expect(presetTime("20m", now).getTime() - now.getTime()).toBe(20 * MINUTE);
    expect(presetTime("1h", now).getTime() - now.getTime()).toBe(HOUR);
    expect(presetTime("3h", now).getTime() - now.getTime()).toBe(3 * HOUR);
  });

  it("lands tomorrow at 9:00 local", () => {
    expect(presetTime("tomorrow", now)).toEqual(at(2026, 11, 25, 9, 0));
  });

  it("crosses a month and a year to reach tomorrow", () => {
    expect(presetTime("tomorrow", at(2026, 11, 30, 23, 59))).toEqual(
      at(2026, 12, 1, 9, 0),
    );
    expect(presetTime("tomorrow", at(2026, 12, 31, 0, 5))).toEqual(
      at(2027, 1, 1, 9, 0),
    );
  });

  it("is tomorrow even a minute after midnight", () => {
    expect(presetTime("tomorrow", at(2026, 11, 25, 0, 1))).toEqual(
      at(2026, 11, 26, 9, 0),
    );
  });

  it("keeps 9:00 across the spring change, a day of 23 hours", () => {
    const tomorrow = presetTime("tomorrow", at(2026, 3, 7, 22, 0));
    expect(tomorrow.getHours()).toBe(9);
    expect(tomorrow.getDate()).toBe(8);
    expect(tomorrow.getTime() - at(2026, 3, 7, 22, 0).getTime()).toBe(
      10 * HOUR,
    );
  });

  it("keeps 9:00 across the autumn change, a day of 25 hours", () => {
    const tomorrow = presetTime("tomorrow", at(2026, 10, 31, 22, 0));
    expect(tomorrow.getHours()).toBe(9);
    expect(tomorrow.getTime() - at(2026, 10, 31, 22, 0).getTime()).toBe(
      12 * HOUR,
    );
  });

  it("waits the full span across a change: the clock reads an hour off", () => {
    // 1:30 on the spring morning, plus one hour, is 3:30 on the clock.
    const spring = presetTime("1h", at(2026, 3, 8, 1, 30));
    expect(spring.getHours()).toBe(3);
    expect(spring.getMinutes()).toBe(30);
    // 0:30 on the autumn morning, plus three hours, is 2:30 on the clock.
    const autumn = presetTime("3h", at(2026, 11, 1, 0, 30));
    expect(autumn.getHours()).toBe(2);
  });
});

describe("presetLabel", () => {
  it("names each preset, the last with its hour", () => {
    expect(REMINDER_PRESETS.map(presetLabel).slice(0, 3)).toEqual([
      "In 20 minutes",
      "In 1 hour",
      "In 3 hours",
    ]);
    expect(presetLabel("tomorrow")).toBe(
      `Tomorrow at ${timeOf(at(2026, 1, 1, 9, 0))}`,
    );
  });
});

describe("futureTime", () => {
  const now = at(2026, 11, 24, 16, 10);

  it("says today and tomorrow by name", () => {
    const later = at(2026, 11, 24, 16, 30);
    expect(futureTime(later, now)).toBe(`today at ${timeOf(later)}`);
    const nine = at(2026, 11, 25, 9, 0);
    expect(futureTime(nine, now)).toBe(`tomorrow at ${timeOf(nine)}`);
  });

  it("is tomorrow from a minute before midnight", () => {
    const late = at(2026, 11, 24, 23, 59);
    const early = at(2026, 11, 25, 0, 1);
    expect(futureTime(early, late)).toBe(`tomorrow at ${timeOf(early)}`);
    expect(futureTime(at(2026, 11, 24, 23, 59, 59), late)).toMatch(/^today/);
  });

  it("says the day and date further on, the year only when it differs", () => {
    const tuesday = at(2026, 12, 1, 9, 0);
    expect(futureTime(tuesday, now)).toBe(
      `${futureDay(tuesday, now)} at ${timeOf(tuesday)}`,
    );
    expect(futureDay(tuesday, now)).not.toMatch(/2026/);
    const next = at(2027, 1, 2, 9, 0);
    expect(futureDay(next, now)).toMatch(/2027/);
  });

  it("counts calendar days across a daylight-saving change", () => {
    // 23 and 25 hours from noon to the next morning's 11:00 or 13:00.
    expect(futureTime(at(2026, 3, 8, 11, 0), at(2026, 3, 7, 12, 0))).toMatch(
      /^tomorrow/,
    );
    expect(
      futureTime(at(2026, 11, 2, 0, 30), at(2026, 10, 31, 23, 30)),
    ).not.toMatch(/^(today|tomorrow)/);
    expect(
      futureTime(at(2026, 11, 1, 23, 30), at(2026, 10, 31, 23, 30)),
    ).toMatch(/^tomorrow/);
  });
});

describe("the date-and-time field", () => {
  it("writes and reads local time to the minute", () => {
    const d = at(2026, 12, 2, 9, 5);
    expect(localInputValue(d)).toBe("2026-12-02T09:05");
    expect(parseLocalInput("2026-12-02T09:05")).toEqual(d);
    expect(parseLocalInput("2026-12-02T09:05:30")).toEqual(
      at(2026, 12, 2, 9, 5, 30),
    );
  });

  it("refuses what is not a date and time", () => {
    for (const value of ["", "2026-12-02", "tomorrow", "2026-02-30T09:00"])
      expect(parseLocalInput(value)).toBeNull();
  });

  it("reads a time the spring change skips as the clock shows it after", () => {
    const skipped = parseLocalInput("2026-03-08T02:30");
    expect(skipped?.getHours()).toBe(3);
  });

  it("bounds the field a day wider than a minute to a year ahead", () => {
    // A guide for the picker, wide enough for a device clock that is off:
    // the server's clock judges the time.
    const now = at(2026, 11, 24, 16, 10, 30);
    expect(customBounds(now)).toEqual({
      min: "2026-11-23T16:10",
      max: "2027-11-25T16:10",
    });
  });

  it("takes a leap day's year ahead as the server does", () => {
    expect(latestReminderTime(at(2028, 2, 29, 12))).toEqual(at(2029, 3, 1, 12));
  });
});

describe("reminderTimeProblem", () => {
  const now = at(2026, 11, 24, 16, 10, 0);

  it("refuses a time passed, one under a minute away and one past a year", () => {
    expect(reminderTimeProblem(at(2026, 11, 24, 15, 0), now)).toBe("past");
    expect(reminderTimeProblem(now, now)).toBe("past");
    expect(reminderTimeProblem(at(2026, 11, 24, 16, 10, 59), now)).toBe("soon");
    expect(reminderTimeProblem(at(2027, 11, 24, 16, 10, 1), now)).toBe("far");
  });

  it("takes a minute ahead and a year ahead exactly", () => {
    expect(reminderTimeProblem(at(2026, 11, 24, 16, 11, 0), now)).toBeNull();
    expect(reminderTimeProblem(at(2027, 11, 24, 16, 10, 0), now)).toBeNull();
  });

  it("words each problem", () => {
    expect(reminderTimeProblemText("past")).toBe(
      "That time has passed by this device's clock. Pick one at least a minute from now.",
    );
    expect(reminderTimeProblemText("soon")).toMatch(/at least a minute/);
    expect(reminderTimeProblemText("far")).toMatch(/year/);
  });
});

describe("checkReminderForm", () => {
  const now = at(2026, 11, 24, 16, 10, 0);
  const filled = (form: ReminderForm) => withText(form, "Order the pizza");

  it("opens with nothing chosen and Set reminder off", () => {
    const form = newReminderForm();
    expect(form).toEqual({ text: "", choice: null, custom: "" });
    expect(checkReminderForm(form, now).canSet).toBe(false);
  });

  it("opens with the words given, trimmed and cut to 200", () => {
    expect(newReminderForm("  Order the pizza  ").text).toBe("Order the pizza");
    expect([...newReminderForm("é".repeat(250)).text].length).toBe(200);
  });

  it("needs text and a time", () => {
    expect(
      checkReminderForm(withChoice(newReminderForm(), "1h"), now).canSet,
    ).toBe(false);
    expect(checkReminderForm(filled(newReminderForm()), now).canSet).toBe(
      false,
    );
    const ready = withChoice(filled(newReminderForm()), "1h");
    expect(checkReminderForm(ready, now)).toEqual({
      text: null,
      when: null,
      at: new Date(now.getTime() + HOUR),
      canSet: true,
    });
  });

  it("judges the text as the server does", () => {
    const check = (text: string) =>
      checkReminderForm(
        withChoice(withText(newReminderForm(), text), "1h"),
        now,
      );
    expect(check("   ").canSet).toBe(false);
    expect(check("   ").text).toBeNull();
    expect(check("a".repeat(201)).text).toBe("long");
    expect(check("a".repeat(200)).canSet).toBe(true);
    expect(check("one\ntwo").text).toBe("control");
    expect(check("a‮b").text).toBe("direction");
    expect(check("​").text).toBe("invisible");
    expect(reminderTextProblemText("long")).toBe(
      "A reminder can be up to 200 characters.",
    );
  });

  it("says when a picked time has passed, and still lets it be sent", () => {
    const form = filled(newReminderForm());
    expect(checkReminderForm(withChoice(form, "custom"), now).canSet).toBe(
      false,
    );
    const past = withCustom(form, "2026-11-24T15:00");
    // This device's clock may be ahead of the server's, which decides.
    expect(checkReminderForm(past, now)).toMatchObject({
      when: "past",
      canSet: true,
    });
    const fine = withCustom(form, "2026-12-02T09:00");
    expect(checkReminderForm(fine, now)).toMatchObject({
      when: null,
      at: at(2026, 12, 2, 9, 0),
      canSet: true,
    });
  });

  it("keeps the picked time while a preset is chosen", () => {
    const form = withChoice(
      withCustom(filled(newReminderForm()), "2026-12-02T09:00"),
      "20m",
    );
    expect(form.custom).toBe("2026-12-02T09:00");
    expect(withChoice(form, "custom").custom).toBe("2026-12-02T09:00");
  });
});

describe("reminderRequest", () => {
  const form = withChoice(
    withText(newReminderForm(), "  Order the pizza "),
    "20m",
  );
  const now = at(2026, 11, 24, 16, 10);
  const zone = "America/New_York";

  it("names a preset and the zone, never an instant", () => {
    expect(reminderRequest(form, "c1", now, zone)).toEqual({
      channelId: "c1",
      text: "Order the pizza",
      preset: ReminderPreset.IN_20_MINUTES,
      localTime: "",
      timeZone: zone,
    });
    const wire = (choice: "1h" | "3h" | "tomorrow") =>
      reminderRequest(withChoice(form, choice), "c1", now, zone)?.preset;
    expect(wire("1h")).toBe(ReminderPreset.IN_1_HOUR);
    expect(wire("3h")).toBe(ReminderPreset.IN_3_HOURS);
    expect(wire("tomorrow")).toBe(ReminderPreset.TOMORROW_AT_9);
  });

  it("sends a picked time as the field holds it, with the zone", () => {
    expect(
      reminderRequest(withCustom(form, "2026-12-02T09:00"), "c1", now, zone),
    ).toEqual({
      channelId: "c1",
      text: "Order the pizza",
      preset: ReminderPreset.UNSPECIFIED,
      localTime: "2026-12-02T09:00",
      timeZone: zone,
    });
  });

  it("sends a preset whatever this device's clock reads", () => {
    // A clock a day off still sends the preset: the server decides.
    expect(
      reminderRequest(form, "c1", at(2020, 1, 1, 0, 0), zone)?.preset,
    ).toBe(ReminderPreset.IN_20_MINUTES);
  });

  it("stops only a missing or unreal picked time", () => {
    const picked = withCustom(form, "2026-11-24T16:30");
    expect(reminderRequest(picked, "c1", now, zone)).not.toBeNull();
    // Less than a minute ahead by this clock: said, but sent; the
    // server's clock decides.
    expect(
      reminderRequest(picked, "c1", at(2026, 11, 24, 16, 29, 30), zone),
    ).not.toBeNull();
    // Gone by on this clock: said, and still sent.
    expect(
      reminderRequest(picked, "c1", at(2026, 11, 24, 18, 0), zone)?.localTime,
    ).toBe("2026-11-24T16:30");
    expect(reminderRequest(withCustom(form, ""), "c1", now, zone)).toBeNull();
    expect(
      reminderRequest(withCustom(form, "2026-02-30T09:00"), "c1", now, zone),
    ).toBeNull();
  });

  it("sends with no zone when the device names none", () => {
    expect(reminderRequest(form, "c1", now, "")?.timeZone).toBe("");
  });
});

describe("deviceTimeZone", () => {
  it("is the runtime's zone name", () => {
    expect(deviceTimeZone()).toBe("America/New_York");
  });

  it("sends no zone for a name the server would not know", () => {
    for (const zone of [
      "UTC",
      "Europe/London",
      "America/Argentina/Buenos_Aires",
      "America/Port-au-Prince",
      "Etc/GMT+5",
    ])
      expect(plausibleZone(zone), zone).toBe(zone);
    for (const zone of [
      "",
      "Etc/Unknown",
      "+05:30",
      "GMT+5",
      "Europe",
      "a/b/c/d",
      undefined,
      42,
    ])
      expect(plausibleZone(zone), String(zone)).toBe("");
  });
});

describe("reminderRefusal", () => {
  it("puts the server's words about the text on the text", () => {
    expect(
      reminderRefusal(
        "a reminder can't contain a line break, a tab or another control character",
      ),
    ).toEqual({
      field: "text",
      text: "A reminder can't contain a line break, a tab or another control character.",
    });
    expect(reminderRefusal("a reminder needs some text").field).toBe("text");
  });

  it("puts the server's words about the time on the time", () => {
    expect(
      reminderRefusal("a reminder's time must be at least a minute from now"),
    ).toEqual({
      field: "when",
      text: "A reminder's time must be at least a minute from now.",
    });
    expect(reminderRefusal("a reminder needs a time").field).toBe("when");
  });

  it("puts every refusal of a time on When", () => {
    for (const said of [
      "a reminder's time is a preset or a date and time, not both",
      "a reminder's time is not a preset the server knows",
      "a reminder's time needs a time zone",
      "a reminder's time zone is not one the server knows",
      "a reminder's time must read like 2026-12-02T09:00",
      "a reminder's time is not a real date and time",
      "a reminder's time can be at most a year from now",
    ])
      expect(reminderRefusal(said).field).toBe("when");
  });

  it("says anything else above the actions", () => {
    expect(
      reminderRefusal("you can have at most 50 reminders waiting"),
    ).toEqual({
      field: null,
      text: "Couldn't set the reminder. You can have at most 50 reminders waiting.",
    });
    expect(reminderRefusal(null)).toEqual({
      field: null,
      text: "Couldn't set the reminder. Try again.",
    });
    expect(reminderRefusal("  ").text).toBe(
      "Couldn't set the reminder. Try again.",
    );
  });
});

describe("reminderSetText", () => {
  it("says the time as stored", () => {
    const now = at(2026, 11, 24, 16, 10);
    const stored = at(2026, 11, 24, 16, 30);
    expect(reminderSetText(stored, now)).toBe(
      `Reminder set for today at ${timeOf(stored)}`,
    );
  });

  it("names where it posts when shown elsewhere", () => {
    const now = at(2026, 11, 24, 16, 10);
    const stored = at(2026, 11, 24, 16, 30);
    const channel = reminderPlace({ conversation: false, name: "#general" });
    expect(reminderSetText(stored, now, channel)).toBe(
      `Reminder set in #general for today at ${timeOf(stored)}`,
    );
    expect(reminderPlace({ conversation: true, name: "Sam Reyes" })).toBe(
      "your conversation with Sam Reyes",
    );
  });
});
