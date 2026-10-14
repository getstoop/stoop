import { describe, expect, it } from "vitest";
import { emojiOnly } from "./emojiOnly";

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
