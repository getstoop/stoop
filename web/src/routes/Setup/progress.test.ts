import { describe, expect, it } from "vitest";
import { parseProgress } from "./progress";
import { nextStep, previousStep, STEPS } from "./steps";

describe("parseProgress", () => {
  it("reads back what was saved", () => {
    const space = { id: "s1", channelId: "c1", name: "The Porch" };
    const raw = JSON.stringify({
      steps: { account: "done", space: "done", reach: "skipped" },
      space,
    });
    expect(parseProgress(raw)).toEqual({
      steps: { account: "done", space: "done", reach: "skipped" },
      space,
    });
  });

  it("drops unknown steps and states", () => {
    const raw = JSON.stringify({
      steps: { account: "done", email: "done", space: "maybe" },
    });
    expect(parseProgress(raw)).toEqual({
      steps: { account: "done" },
      space: undefined,
    });
  });

  it("drops a malformed space", () => {
    const raw = JSON.stringify({ steps: {}, space: { id: 1 } });
    expect(parseProgress(raw)?.space).toBeUndefined();
  });

  it("treats nothing or garbage as no record", () => {
    expect(parseProgress(null)).toBeNull();
    expect(parseProgress("")).toBeNull();
    expect(parseProgress("{nope")).toBeNull();
    expect(parseProgress("null")).toBeNull();
  });
});

describe("nextStep", () => {
  it("is the first step neither done nor skipped", () => {
    expect(nextStep(STEPS, { steps: {} }).id).toBe("account");
    expect(
      nextStep(STEPS, { steps: { account: "done", space: "done" } }).id,
    ).toBe("reach");
    expect(
      nextStep(STEPS, {
        steps: { account: "done", space: "done", reach: "skipped" },
      }).id,
    ).toBe("invite");
  });

  it("stays on the last step once everything is done", () => {
    expect(
      nextStep(STEPS, {
        steps: {
          account: "done",
          space: "done",
          reach: "done",
          invite: "done",
        },
      }).id,
    ).toBe("invite");
  });
});

describe("previousStep", () => {
  it("never goes back onto a step that created something", () => {
    expect(previousStep(STEPS, "account")).toBeUndefined();
    expect(previousStep(STEPS, "space")).toBeUndefined();
    expect(previousStep(STEPS, "reach")).toBeUndefined();
  });

  it("goes back to a settings step", () => {
    expect(previousStep(STEPS, "invite")?.id).toBe("reach");
  });
});
