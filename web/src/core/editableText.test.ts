import { describe, expect, it } from "vitest";
import { editableText, withTokensRestored } from "./editableText";

const ada = "<@u:11111111-1111-1111-1111-111111111111:ada>";
const adaGroup = "<@g:22222222-2222-2222-2222-222222222222:ada>";
const garden = "<#33333333-3333-3333-3333-333333333333:garden>";

describe("editableText", () => {
  it("shows each token as the words it reads as", () => {
    expect(editableText(`${ada} see ${garden} and ${adaGroup}`)).toBe(
      "@ada see #garden and @ada",
    );
  });

  it("leaves words alone", () => {
    expect(editableText("plain @words and #tags")).toBe(
      "plain @words and #tags",
    );
  });

  it("shows a token stuck to a word raw", () => {
    expect(editableText(`cc${ada}`)).toBe(`cc${ada}`);
    expect(editableText(`${ada}cc`)).toBe(`${ada}cc`);
    expect(editableText(`${ada}${ada}`)).toBe(`@ada${ada}`);
    expect(editableText(`${garden}${ada}`)).toBe(`#garden${ada}`);
  });

  it("shows a token beside punctuation as words", () => {
    expect(editableText(`${ada}'s (${ada}) ${ada}.`)).toBe(
      "@ada's (@ada) @ada.",
    );
  });
});

describe("withTokensRestored", () => {
  it("round-trips content put back unchanged", () => {
    for (const original of [
      `${ada} who's bringing the copy?`,
      `see ${garden} for ${ada}, ${adaGroup} too`,
      `@ada said so, ${ada}`,
      `${ada} said so, @ada`,
      "no tokens, @ada and #garden as words",
      "",
      // Tokens stuck to words, or to each other.
      `cc${ada}`,
      `${ada}cc`,
      `${ada}${ada}`,
      `${garden}${ada}`,
      `${ada}@ada`,
      `#garden${ada}`,
      // Beside punctuation.
      `${ada}'s (${ada}) ${ada}.`,
      `${ada} @channel @here`,
    ]) {
      expect(withTokensRestored(editableText(original), original)).toBe(
        original,
      );
    }
  });

  it("restores a token around changed words", () => {
    const original = `${ada} who's bringing the copy?`;
    expect(
      withTokensRestored("@ada who's bringing the second copy?", original),
    ).toBe(`${ada} who's bringing the second copy?`);
  });

  it("restores a channel link", () => {
    const original = `details in ${garden}`;
    expect(withTokensRestored("all the details in #garden now", original)).toBe(
      `all the details in ${garden} now`,
    );
  });

  it("restores a token beside punctuation", () => {
    expect(
      withTokensRestored("(@ada) has @ada's copy, @ada.", `${ada} has it`),
    ).toBe(`(${ada}) has ${ada}'s copy, ${ada}.`);
  });

  it("keeps a removed mention removed", () => {
    expect(
      withTokensRestored("who's bringing it?", `${ada} who's bringing it?`),
    ).toBe("who's bringing it?");
  });

  it("keeps a moved mention's token", () => {
    expect(
      withTokensRestored(
        "who's bringing it, @ada?",
        `${ada} who's bringing it?`,
      ),
    ).toBe(`who's bringing it, ${ada}?`);
  });

  it("gives a repeated mention the token too", () => {
    expect(withTokensRestored("@ada and @ada again", `${ada} once`)).toBe(
      `${ada} and ${ada} again`,
    );
  });

  it("matches the handle whatever its case", () => {
    expect(withTokensRestored("thanks @Ada", `${ada} thanks`)).toBe(
      `thanks ${ada}`,
    );
  });

  it("leaves a @name the original had no token for as words", () => {
    expect(withTokensRestored("@ada and @bea", `${ada} alone`)).toBe(
      `${ada} and @bea`,
    );
    expect(withTokensRestored("@bea alone", "@bea alone")).toBe("@bea alone");
  });

  it("leaves @channel and @here as the words they are", () => {
    expect(
      withTokensRestored("@channel @here and @ada", `${ada} @channel @here`),
    ).toBe(`@channel @here and ${ada}`);
  });

  it("matches whole words only", () => {
    const original = `${ada} and ${garden}`;
    expect(
      withTokensRestored("@adam mail@ada #gardening a#garden", original),
    ).toBe("@adam mail@ada #gardening a#garden");
  });

  it("keeps the n-th as it was where the original had both forms", () => {
    const original = `@ada as words, ${ada} as a mention`;
    expect(
      withTokensRestored("@ada as words, @ada as a mention", original),
    ).toBe(original);
    // The first stays words even when the second has gone.
    expect(withTokensRestored("@ada as words", original)).toBe("@ada as words");
    // A third, beyond what the original had, stays as typed.
    expect(withTokensRestored("@ada @ada @ada", original)).toBe(
      `@ada ${ada} @ada`,
    );
  });

  it("never respells words to match the original's plain form", () => {
    const original = `@Ada as words, ${ada} as a mention`;
    expect(
      withTokensRestored("@ada as words, @ada as a mention", original),
    ).toBe(`@ada as words, ${ada} as a mention`);
  });

  it("tells a person's token from a group's by position", () => {
    const original = `${ada} then ${adaGroup}`;
    expect(withTokensRestored("@ada then @ada, both", original)).toBe(
      `${ada} then ${adaGroup}, both`,
    );
  });

  it("leaves a token typed in full alone", () => {
    expect(withTokensRestored(`${ada} typed whole`, `${ada} typed whole`)).toBe(
      `${ada} typed whole`,
    );
  });

  it("puts a token into a code span too, as things stand", () => {
    // The field can't tell code from words; the server saves a token in
    // code as its @handle text, so the message reads the same.
    expect(withTokensRestored("`@ada` hi", `${ada} hi`)).toBe(`\`${ada}\` hi`);
  });
});
