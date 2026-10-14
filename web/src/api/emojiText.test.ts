import { describe, expect, it } from "vitest";
import { emojiOnly, splitEmoji } from "./emojiText";

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
