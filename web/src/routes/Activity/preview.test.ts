import { describe, expect, it } from "vitest";
import { splitPreview } from "./preview";

describe("splitPreview", () => {
  it("highlights the reader's handle", () => {
    expect(splitPreview("@ada can you bring the key?", "ada")).toEqual([
      { text: "@ada", mention: true },
      { text: " can you bring the key?", mention: false },
    ]);
  });

  it("does not match a longer handle that starts the same", () => {
    expect(splitPreview("@adam and @ada", "ada")).toEqual([
      { text: "@adam and ", mention: false },
      { text: "@ada", mention: true },
    ]);
  });

  it("highlights @channel and @here whoever reads", () => {
    expect(splitPreview("@channel mockups are in, @here too", "bea")).toEqual([
      { text: "@channel", mention: true },
      { text: " mockups are in, ", mention: false },
      { text: "@here", mention: true },
      { text: " too", mention: false },
    ]);
  });

  it("matches the handle case-insensitively and in the middle", () => {
    expect(splitPreview("thanks @Ada.", "ada")).toEqual([
      { text: "thanks ", mention: false },
      { text: "@Ada", mention: true },
      { text: ".", mention: false },
    ]);
  });

  it("leaves a preview without a mention whole", () => {
    expect(splitPreview("yes, Thursday works", "ada")).toEqual([
      { text: "yes, Thursday works", mention: false },
    ]);
    expect(splitPreview("", "ada")).toEqual([]);
  });
});
