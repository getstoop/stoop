import { timestampDate } from "@bufbuild/protobuf/wkt";
import { afterAll, describe, expect, it } from "vitest";
import {
  addSlot,
  canAddSlot,
  canRemoveSlot,
  checkTimePollForm,
  newTimePollForm,
  removeSlot,
  slotBounds,
  slotCount,
  slotProblemText,
  slotTimes,
  type TimePollForm,
  timePollRequest,
  withSlot,
} from "./timePollForm";

// A zone with daylight saving, so a clock change can be tested: in 2027
// New York goes forward at 2:00 on 14 March. Set for this file only,
// before any date is built.
const zone = process.env.TZ;
process.env.TZ = "America/New_York";
afterAll(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

// Local-time constructor throughout: the form reads local readings, so
// building dates this way keeps the suite honest in any TZ.
const at = (y: number, m: number, d: number, h = 12, min = 0, s = 0) =>
  new Date(y, m - 1, d, h, min, s);

const NOW = at(2026, 11, 26, 15, 30, 20);

// A form with the question and the given readings in its rows.
const filled = (values: string[], question = "Game night?"): TimePollForm => ({
  question,
  multiple: true,
  slots: values.map((value, index) => ({ key: index + 1, value })),
  nextKey: values.length + 1,
});

describe("newTimePollForm", () => {
  it("opens with two empty rows and several choices", () => {
    const form = newTimePollForm();
    expect(form.question).toBe("");
    expect(form.multiple).toBe(true);
    expect(form.slots).toEqual([
      { key: 1, value: "" },
      { key: 2, value: "" },
    ]);
    expect(slotCount(form)).toBe("2 of 10");
  });

  it("takes the words after /when as the question, trimmed and cut", () => {
    expect(newTimePollForm("  Game night?  ").question).toBe("Game night?");
    expect([...newTimePollForm("x".repeat(250)).question]).toHaveLength(200);
  });
});

describe("rows", () => {
  it("adds up to ten and removes down to two", () => {
    let form = newTimePollForm();
    expect(canRemoveSlot(form)).toBe(false);
    expect(removeSlot(form, 1)).toBe(form);
    for (let i = 0; i < 8; i++) form = addSlot(form);
    expect(form.slots).toHaveLength(10);
    expect(canAddSlot(form)).toBe(false);
    expect(addSlot(form)).toBe(form);
    expect(slotCount(form)).toBe("10 of 10");
    form = removeSlot(form, 4);
    expect(form.slots.map((slot) => slot.key)).not.toContain(4);
    expect(canAddSlot(form)).toBe(true);
    // A new row's key is never one used before.
    expect(addSlot(form).slots.at(-1)?.key).toBe(11);
  });

  it("sets one row's value", () => {
    const form = withSlot(newTimePollForm(), 2, "2026-12-03T19:00");
    expect(form.slots).toEqual([
      { key: 1, value: "" },
      { key: 2, value: "2026-12-03T19:00" },
    ]);
  });
});

describe("slotBounds", () => {
  it("is today to a year ahead", () => {
    expect(slotBounds(NOW)).toEqual({
      min: "2026-11-26T15:30",
      max: "2027-11-26T15:30",
    });
  });
});

describe("checkTimePollForm", () => {
  it("posts a question and two times ahead", () => {
    const check = checkTimePollForm(
      filled(["2026-12-03T19:00", "2026-12-04T20:00"]),
      NOW,
    );
    expect(check).toEqual({
      question: null,
      slots: {},
      filled: 2,
      canPost: true,
    });
  });

  it("needs a question and two times, and drops empty rows", () => {
    expect(checkTimePollForm(filled(["2026-12-03T19:00", ""]), NOW)).toEqual({
      question: null,
      slots: {},
      filled: 1,
      canPost: false,
    });
    expect(
      checkTimePollForm(
        filled(["2026-12-03T19:00", "2026-12-04T20:00"], "  "),
        NOW,
      ).canPost,
    ).toBe(false);
    expect(
      checkTimePollForm(
        filled(["", "2026-12-03T19:00", "", "2026-12-04T20:00"]),
        NOW,
      ),
    ).toMatchObject({ filled: 2, canPost: true });
  });

  it("says the question's problem as the poll form does", () => {
    expect(
      checkTimePollForm(
        filled(["2026-12-03T19:00", "2026-12-04T20:00"], "a\tb"),
        NOW,
      ),
    ).toMatchObject({ question: "control", canPost: false });
  });

  it("marks the later of two rows on the same minute", () => {
    const check = checkTimePollForm(
      filled(["2026-12-03T19:00", "2026-12-04T20:00", "2026-12-03T19:00"]),
      NOW,
    );
    expect(check.slots).toEqual({ 3: "duplicate" });
    expect(check.canPost).toBe(false);
  });

  it("calls two readings of the same instant across a clock change the same", () => {
    // 2:30 is skipped and read as 3:30, the time the other row names.
    const check = checkTimePollForm(
      filled(["2027-03-14T03:30", "2027-03-14T02:30"]),
      NOW,
    );
    expect(check.slots).toEqual({ 2: "duplicate" });
    expect(check.canPost).toBe(false);
  });

  it("takes any time after now, to the whole minute, with no lead", () => {
    const check = (value: string) =>
      checkTimePollForm(filled([value, "2026-12-04T20:00"]), NOW).slots[1];
    // Now is 15:30:20: this minute has begun, the next has not.
    expect(check("2026-11-26T15:30")).toBe("past");
    expect(check("2026-11-26T09:00")).toBe("past");
    expect(check("2026-11-26T15:31")).toBeUndefined();
  });

  it("takes a year ahead and no further", () => {
    const check = (value: string) =>
      checkTimePollForm(filled([value, "2026-12-04T20:00"]), NOW).slots[1];
    expect(check("2027-11-26T15:30")).toBeUndefined();
    expect(check("2027-11-26T15:31")).toBe("far");
  });

  it("refuses a reading that is not a date and time", () => {
    const check = checkTimePollForm(
      filled(["2026-02-30T19:00", "2026-12-04T20:00"]),
      NOW,
    );
    expect(check.slots).toEqual({ 1: "invalid" });
  });

  it("has words for every problem", () => {
    for (const problem of ["invalid", "past", "far", "duplicate"] as const)
      expect(slotProblemText(problem)).toMatch(/\.$/);
    expect(slotProblemText("duplicate")).toBe(
      "This time is already in the list.",
    );
  });
});

describe("slotTimes", () => {
  it("gives the rows that hold a whole time, in their order", () => {
    expect(
      slotTimes(
        filled(["2026-12-04T20:00", "", "2026-12-04", "2027-06-10T19:00"]),
      ),
    ).toEqual([at(2026, 12, 4, 20, 0), at(2027, 6, 10, 19, 0)]);
    expect(slotTimes(filled(["", ""]))).toEqual([]);
  });
});

describe("timePollRequest", () => {
  it("sends times as instants in the order picked, and no options", () => {
    const form = {
      ...filled(["2026-12-04T20:00", "", "2026-12-03T19:00"], " Game night? "),
      multiple: false,
    };
    const request = timePollRequest(form, "c1");
    expect(Object.keys(request).sort()).toEqual([
      "channelId",
      "multiple",
      "question",
      "times",
    ]);
    expect(request.channelId).toBe("c1");
    expect(request.question).toBe("Game night?");
    expect(request.multiple).toBe(false);
    expect(request.times.map((time) => timestampDate(time))).toEqual([
      at(2026, 12, 4, 20, 0),
      at(2026, 12, 3, 19, 0),
    ]);
  });
});
