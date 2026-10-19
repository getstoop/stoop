import { describe, expect, it } from "vitest";
import { safeRedirect } from "./safeRedirect";

describe("safeRedirect", () => {
  it("keeps a path on this site", () => {
    expect(safeRedirect("/profile?tab=security")).toBe("/profile?tab=security");
  });

  it("refuses anything that leaves the site", () => {
    for (const away of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "evil.example",
    ]) {
      expect(safeRedirect(away), away).toBeUndefined();
    }
  });

  it("refuses pages whose job is done", () => {
    for (const done of ["/login", "/login?x=1", "/setup/2"]) {
      expect(safeRedirect(done), done).toBeUndefined();
    }
  });
});
