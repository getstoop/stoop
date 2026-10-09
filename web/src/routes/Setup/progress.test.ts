import { describe, expect, it } from "vitest";
import { parseProgress } from "./progress";
import { nextStep, previousStep, STEPS, visibleSteps } from "./steps";

describe("parseProgress", () => {
  it("reads back what was saved", () => {
    const space = { id: "s1", channelId: "c1", name: "The Porch" };
    const raw = JSON.stringify({
      steps: { account: "done", space: "done", remote: "skipped" },
      space,
      access: "tunnel",
      invite: "AbCdEfGh12",
    });
    expect(parseProgress(raw)).toEqual({
      steps: { account: "done", space: "done", remote: "skipped" },
      space,
      access: "tunnel",
      invite: "AbCdEfGh12",
    });
  });

  it("drops unknown steps and states", () => {
    const raw = JSON.stringify({
      steps: { account: "done", email: "done", space: "maybe" },
    });
    expect(parseProgress(raw)).toEqual({
      steps: { account: "done" },
      space: undefined,
      access: undefined,
      invite: undefined,
    });
  });

  it("drops a malformed space, access or invite", () => {
    const raw = JSON.stringify({
      steps: {},
      space: { id: 1 },
      access: "vpn",
      invite: 42,
    });
    expect(parseProgress(raw)?.space).toBeUndefined();
    expect(parseProgress(raw)?.access).toBeUndefined();
    expect(parseProgress(raw)?.invite).toBeUndefined();
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
    ).toBe("remote");
    expect(
      nextStep(STEPS, {
        steps: {
          account: "done",
          space: "done",
          remote: "skipped",
          address: "done",
          voice: "skipped",
        },
      }).id,
    ).toBe("invite");
  });

  it("stays on the last step once everything is done", () => {
    expect(
      nextStep(STEPS, {
        steps: {
          account: "done",
          space: "done",
          remote: "done",
          address: "done",
          voice: "done",
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
    expect(previousStep(STEPS, "remote")).toBeUndefined();
  });

  it("goes back to a settings step", () => {
    expect(previousStep(STEPS, "address")?.id).toBe("remote");
    expect(previousStep(STEPS, "invite")?.id).toBe("voice");
  });

  it("skips a step that isn't shown", () => {
    const steps = visibleSteps({ voiceAvailable: false });
    expect(previousStep(steps, "invite")?.id).toBe("address");
  });
});

describe("visibleSteps", () => {
  it("leaves voice out when the server has none", () => {
    expect(visibleSteps({ voiceAvailable: false }).map((s) => s.id)).toEqual([
      "account",
      "space",
      "remote",
      "address",
      "invite",
    ]);
    expect(visibleSteps({ voiceAvailable: true })).toHaveLength(6);
  });
});
