import { describe, expect, it } from "vitest";
import { restoreDraft } from "./unsent";

describe("restoreDraft", () => {
  it("gives the text back to an empty box", () => {
    expect(restoreDraft("see attached", "")).toBe("see attached");
  });

  it("keeps what was typed while the send was in flight", () => {
    expect(restoreDraft("see attached", "one more thing")).toBe(
      "see attached\none more thing",
    );
  });
});
