import { describe, expect, it } from "vitest";
import {
  addOption,
  canAddOption,
  canRemoveOption,
  checkPollForm,
  moveOption,
  newPollForm,
  POLL_OPTIONS_FULL,
  type PollForm,
  pollOptionCount,
  pollOptionKey,
  pollProblemText,
  pollRequest,
  pollTextLength,
  pollTextProblem,
  removeOption,
  trimPollText,
  withMultiple,
  withOptionText,
  withQuestion,
} from "./pollForm";

// A form with these lines, in order.
function formOf(question: string, ...options: string[]): PollForm {
  let form = withQuestion(newPollForm(), question);
  while (form.options.length < options.length) form = addOption(form);
  options.forEach((text, index) => {
    form = withOptionText(form, form.options[index].key, text);
  });
  return form;
}

const texts = (form: PollForm) => form.options.map((option) => option.text);

describe("the fields", () => {
  it("opens with no question, one choice and two empty options", () => {
    const form = newPollForm();
    expect(form.question).toBe("");
    expect(form.multiple).toBe(false);
    expect(texts(form)).toEqual(["", ""]);
    expect(pollOptionCount(form)).toBe("2 of 10");
  });

  it("adds up to ten, each with a key of its own", () => {
    let form = newPollForm();
    while (canAddOption(form)) form = addOption(form);
    expect(form.options).toHaveLength(10);
    expect(new Set(form.options.map((option) => option.key)).size).toBe(10);
    expect(addOption(form)).toBe(form);
    expect(pollOptionCount(form)).toBe("10 of 10");
    expect(POLL_OPTIONS_FULL).toBe(
      "A poll takes up to 10 options. Remove one to add another.",
    );
  });

  it("removes down to two, and keys are never reused", () => {
    let form = formOf("Q", "a", "b", "c");
    const [, second] = form.options;
    form = removeOption(form, second.key);
    expect(texts(form)).toEqual(["a", "c"]);
    expect(canRemoveOption(form)).toBe(false);
    expect(removeOption(form, form.options[0].key)).toBe(form);
    form = addOption(form);
    expect(form.options.at(-1)?.key).not.toBe(second.key);
  });

  it("moves an option, clamped to the list", () => {
    const form = formOf("Q", "a", "b", "c");
    const [first, , last] = form.options;
    expect(texts(moveOption(form, last.key, 0))).toEqual(["c", "a", "b"]);
    expect(texts(moveOption(form, first.key, 1))).toEqual(["b", "a", "c"]);
    expect(texts(moveOption(form, first.key, 99))).toEqual(["b", "c", "a"]);
    expect(moveOption(form, 12345, 0)).toBe(form);
  });

  it("changes one field and leaves the rest", () => {
    const form = withMultiple(formOf("Q", "a", "b"), true);
    expect(form.multiple).toBe(true);
    expect(form.question).toBe("Q");
    expect(texts(withOptionText(form, form.options[1].key, "B"))).toEqual([
      "a",
      "B",
    ]);
  });
});

describe("counting and trimming as the server does", () => {
  it("trims the space Go trims, not JavaScript's", () => {
    expect(trimPollText(" \t\u00a0\u3000Pizza\u2029 ")).toBe("Pizza");
    // Go trims U+0085 and keeps U+FEFF; trim() does the opposite.
    expect(trimPollText("\u0085Pizza")).toBe("Pizza");
    expect(trimPollText("\ufeffPizza")).toBe("\ufeffPizza");
  });

  it("counts code points, not UTF-16 units", () => {
    expect(pollTextLength("  🍕🍕  ")).toBe(2);
    expect(pollTextProblem("🍕".repeat(80), 80)).toBeNull();
    expect(pollTextProblem("🍕".repeat(81), 80)).toBe("long");
    expect(pollTextProblem(` ${"a".repeat(200)} `, 200)).toBeNull();
  });
});

describe("a line the server refuses", () => {
  it("refuses control characters, separators and direction overrides", () => {
    expect(pollTextProblem("a\tb", 80)).toBe("control");
    expect(pollTextProblem("a\nb", 80)).toBe("control");
    expect(pollTextProblem("a\u0000b", 80)).toBe("control");
    expect(pollTextProblem("a\u0085b", 80)).toBe("control");
    expect(pollTextProblem("a\u2028b", 80)).toBe("control");
    expect(pollTextProblem("a\u202eb", 80)).toBe("direction");
    expect(pollTextProblem("a\u2067b", 80)).toBe("direction");
    // Whichever comes first, as the server reads it.
    expect(pollTextProblem("a\u202e\tb", 80)).toBe("direction");
  });

  it("needs something visible", () => {
    expect(pollTextProblem("\u200b", 80)).toBe("invisible");
    expect(pollTextProblem("\u200b\u0301", 80)).toBe("invisible");
    expect(pollTextProblem("🍕", 80)).toBeNull();
    expect(pollTextProblem("?", 80)).toBeNull();
  });

  it("judges the character before the length", () => {
    expect(pollTextProblem(`${"a".repeat(90)}\t`, 80)).toBe("long");
    expect(pollTextProblem(`${"a".repeat(90)}\tb`, 80)).toBe("control");
  });

  it("leaves an empty line to the caller", () => {
    expect(pollTextProblem("   ", 80)).toBeNull();
  });
});

describe("duplicate options", () => {
  it("ignores case, invisible format characters and normalisation", () => {
    expect(pollOptionKey("Racing League")).toBe(pollOptionKey("racing league"));
    expect(pollOptionKey("pizza")).toBe(pollOptionKey("pi\u200bzza"));
    expect(pollOptionKey("caf\u00e9")).toBe(pollOptionKey("cafe\u0301"));
    expect(pollOptionKey(" pizza ")).toBe(pollOptionKey("pizza"));
  });

  it("folds as Go's simple folding does for the usual surprises", () => {
    // Final and medial sigma, the Kelvin sign, the long s.
    expect(pollOptionKey("ΟΔΟΣ")).toBe(pollOptionKey("οδος"));
    expect(pollOptionKey("\u212a")).toBe(pollOptionKey("k"));
    expect(pollOptionKey("\u017f")).toBe(pollOptionKey("s"));
    // No full folding: ß is not "ss".
    expect(pollOptionKey("straße")).not.toBe(pollOptionKey("strasse"));
  });

  it("marks the later of two, not the first", () => {
    const form = formOf("Q", "Racing league", "Co-op", "racing LEAGUE");
    const check = checkPollForm(form);
    expect(check.options).toEqual({ [form.options[2].key]: "duplicate" });
    expect(check.canPost).toBe(false);
  });
});

describe("when Post is on", () => {
  it("is off as the form opens", () => {
    expect(checkPollForm(newPollForm()).canPost).toBe(false);
  });

  it("needs a question and two filled options", () => {
    expect(checkPollForm(formOf("Q", "a", "b")).canPost).toBe(true);
    expect(checkPollForm(formOf("  ", "a", "b")).canPost).toBe(false);
    expect(checkPollForm(formOf("Q", "a", "  ")).canPost).toBe(false);
  });

  it("drops empty options, wherever they are", () => {
    const form = formOf("Q", "", "a", " ", "b", "");
    const check = checkPollForm(form);
    expect(check.filled).toBe(2);
    expect(check.canPost).toBe(true);
    expect(pollRequest(form, "c1")).toEqual({
      channelId: "c1",
      question: "Q",
      options: ["a", "b"],
      multiple: false,
    });
  });

  it("is off while any field has a problem, which is named", () => {
    const long = formOf("x".repeat(201), "a", "b");
    expect(checkPollForm(long)).toMatchObject({
      question: "long",
      canPost: false,
    });
    const tab = formOf("Q", "a\tb", "c");
    expect(checkPollForm(tab)).toMatchObject({
      options: { [tab.options[0].key]: "control" },
      canPost: false,
    });
  });
});

describe("the request", () => {
  it("trims each line and carries the choice", () => {
    const form = withMultiple(formOf("  What?  ", " a ", "b\u00a0"), true);
    expect(pollRequest(form, "c1")).toEqual({
      channelId: "c1",
      question: "What?",
      options: ["a", "b"],
      multiple: true,
    });
  });
});

describe("the words", () => {
  it("says each problem for its field", () => {
    expect(pollProblemText("duplicate", "option")).toBe(
      "This option is already in the list.",
    );
    expect(pollProblemText("long", "question")).toBe(
      "A question can be up to 200 characters.",
    );
    expect(pollProblemText("long", "option")).toBe(
      "An option can be up to 80 characters.",
    );
    for (const problem of ["control", "direction", "invisible"] as const) {
      expect(pollProblemText(problem, "option")).toMatch(/\.$/);
    }
  });
});
