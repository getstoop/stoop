import { describe, expect, it } from "vitest";
import { checkLink } from "./links";

describe("checkLink", () => {
  it("refuses an address the format can't read, and words holding one", () => {
    expect(checkLink("docs", "example.com").href).toBeTruthy();
    expect(checkLink("docs", "https://example.com")).toEqual({});
    expect(checkLink("see https://a.b", "https://c.d").text).toBeTruthy();
    expect(checkLink("https://c.d", "https://c.d")).toEqual({});
    expect(checkLink("docs", "https://x.com/a_(b)")).toEqual({});
    for (const href of [
      "https://x.com/a)b",
      "https://x.com/a(b",
      "https://x.com/a<b",
    ]) {
      expect(checkLink("docs", href).href).toMatch(/unpaired bracket/);
    }
  });
});
