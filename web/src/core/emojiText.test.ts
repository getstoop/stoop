import { describe, expect, it } from "vitest";
import { clusters, emojiOnly, splitEmoji } from "./emojiText";

describe("emojiOnly", () => {
  it("takes emoji with spaces between them", () => {
    expect(emojiOnly("🎉")).toBe(true);
    expect(emojiOnly(" 👍🏽  🎉\n❤️ ")).toBe(true);
  });

  it("counts a joined emoji, a flag and a keycap as one each", () => {
    expect(emojiOnly("👩‍👩‍👧‍👦🇳🇿1️⃣")).toBe(true);
  });

  it("refuses words, markers and an empty message", () => {
    expect(emojiOnly("nice 🎉")).toBe(false);
    expect(emojiOnly("**🎉**")).toBe(false);
    expect(emojiOnly("1")).toBe(false);
    expect(emojiOnly("   ")).toBe(false);
  });

  it("stops at 23", () => {
    expect(emojiOnly("🎉".repeat(23))).toBe(true);
    expect(emojiOnly("🎉".repeat(24))).toBe(false);
  });
});

describe("splitEmoji", () => {
  it("leaves text with no emoji whole", () => {
    expect(splitEmoji("plain words 123")).toEqual([
      { text: "plain words 123", emoji: false },
    ]);
  });

  it("splits runs of emoji from the words around them", () => {
    expect(splitEmoji("nice 🎉👍🏽 work 🇳🇿")).toEqual([
      { text: "nice ", emoji: false },
      { text: "🎉👍🏽", emoji: true },
      { text: " work ", emoji: false },
      { text: "🇳🇿", emoji: true },
    ]);
  });
});

describe("clusters", () => {
  // The app's split, without Intl.Segmenter, agrees with it here.
  it("splits as the segmenter does", () => {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    for (const sample of [
      "nice 🎉👍🏽 work 🇳🇿",
      "👩‍👩‍👧‍👦🇳🇿1️⃣ #️⃣",
      "❤️ \u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F} 🧑🏾‍🚀",
      "café ok",
      "plain words 123",
    ]) {
      expect(clusters(sample)).toEqual(
        Array.from(segmenter.segment(sample), ({ segment }) => segment),
      );
    }
  });
});
