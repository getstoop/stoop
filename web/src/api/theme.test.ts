import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchesFilter, THEME_FILTERS, THEMES } from "./theme";

const byId = (id: string) => {
  const t = THEMES.find((t) => t.id === id);
  if (!t) throw new Error(`no theme ${id}`);
  return t;
};

describe("THEMES", () => {
  it("names every id in index.html's pre-mount list, in step", () => {
    const html = readFileSync(
      new URL("../../index.html", import.meta.url),
      "utf8",
    );
    const m = /var ids = \[([^\]]*)\]/.exec(html);
    const ids = (m?.[1] ?? "").match(/"[a-z-]+"/g)?.map((s) => s.slice(1, -1));
    expect(ids).toEqual(THEMES.map((t) => t.id));
  });

  it("has a block in themes.css for every theme", () => {
    const css = readFileSync(new URL("../themes.css", import.meta.url), "utf8");
    for (const t of THEMES) expect(css).toContain(`[data-theme="${t.id}"]`);
  });

  it("files dim themes as dark for Follow system", () => {
    for (const t of THEMES.filter((t) => t.tier === "dim"))
      expect(t.kind).toBe("dark");
    for (const t of THEMES.filter((t) => t.tier !== "dim"))
      expect(t.kind).toBe(t.tier);
  });

  it("gives every accessible theme its reason", () => {
    for (const t of THEMES) {
      if (t.tags?.includes("accessible")) expect(t.why).toBeTruthy();
      else expect(t.why).toBeUndefined();
    }
  });
});

describe("matchesFilter", () => {
  it("filters by tier", () => {
    expect(matchesFilter(byId("rooftop"), "dim")).toBe(true);
    expect(matchesFilter(byId("rooftop"), "dark")).toBe(false);
    expect(matchesFilter(byId("daylight"), "light")).toBe(true);
  });

  it("treats accessible as a tag on top of the tier", () => {
    expect(matchesFilter(byId("whiteout"), "light")).toBe(true);
    expect(matchesFilter(byId("whiteout"), "accessible")).toBe(true);
    expect(matchesFilter(byId("daylight"), "accessible")).toBe(false);
  });

  it("shows everything under all, and every filter shows something", () => {
    expect(THEMES.every((t) => matchesFilter(t, "all"))).toBe(true);
    for (const f of THEME_FILTERS)
      expect(
        THEMES.some((t) => matchesFilter(t, f.id)),
        f.id,
      ).toBe(true);
  });
});
