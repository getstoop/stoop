import { describe, expect, it } from "vitest";
import {
  COMMON_EMOJI,
  emojiName,
  parseRecent,
  RECENT_MAX,
  searchEmoji,
  withRecent,
} from "./emoji";
import { EMOJI_GROUPS } from "./emojiData";

describe("searchEmoji", () => {
  it("finds an emoji by its Unicode name", () => {
    expect(searchEmoji("party popper").map((e) => e.emoji)).toEqual(["🎉"]);
  });

  it("finds it by a keyword or a shortcode alias too", () => {
    expect(searchEmoji("tada").map((e) => e.emoji)).toEqual(["🎉"]);
    expect(searchEmoji("+1").map((e) => e.emoji)).toContain("👍");
  });

  it("needs every word of the query", () => {
    const hits = searchEmoji("face heart");
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      const hay = `${hit.name} ${hit.keywords ?? ""}`;
      expect(hay).toMatch(/face/);
      expect(hay).toMatch(/heart/);
    }
  });

  it("ignores case and stray spaces, and finds nothing for nothing", () => {
    expect(searchEmoji("  TADA ")).toEqual(searchEmoji("tada"));
    expect(searchEmoji("   ")).toEqual([]);
  });

  it("stops at the limit", () => {
    expect(searchEmoji("face", 5)).toHaveLength(5);
    expect(searchEmoji("face").length).toBeLessThanOrEqual(48);
  });
});

describe("emojiName", () => {
  it("names a known emoji and hands back an unknown one", () => {
    expect(emojiName("🎉")).toBe("party popper");
    expect(emojiName("not an emoji")).toBe("not an emoji");
  });

  it("knows every common emoji", () => {
    const all = new Set(
      EMOJI_GROUPS.flatMap(([, entries]) => entries.map(([emoji]) => emoji)),
    );
    for (const emoji of COMMON_EMOJI) expect(all.has(emoji), emoji).toBe(true);
  });
});

describe("recent emoji", () => {
  it("reads a stored list and nothing else", () => {
    expect(parseRecent('["🎉","👍"]')).toEqual(["🎉", "👍"]);
    expect(parseRecent('["🎉", 1, null]')).toEqual(["🎉"]);
    expect(parseRecent("{}")).toEqual([]);
    expect(parseRecent("not json")).toEqual([]);
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent(undefined)).toEqual([]);
  });

  it("puts the newest first, once", () => {
    expect(withRecent(["👍", "🎉"], "🎉")).toEqual(["🎉", "👍"]);
    expect(withRecent([], "🎉")).toEqual(["🎉"]);
  });

  it("drops the oldest past the cap", () => {
    const full = Array.from({ length: RECENT_MAX }, (_, index) => `e${index}`);
    const next = withRecent(full, "new");
    expect(next).toHaveLength(RECENT_MAX);
    expect(next[0]).toBe("new");
    expect(next).not.toContain(`e${RECENT_MAX - 1}`);
  });
});
