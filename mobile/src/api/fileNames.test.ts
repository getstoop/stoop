import { describe, expect, it } from "vitest";
import { isFileId, localName } from "./fileNames";

const bytes = (text: string) => new TextEncoder().encode(text).length;

describe("isFileId", () => {
  it("takes a UUID and nothing else", () => {
    expect(isFileId("01a17664-13bf-7e86-8245-6421f5821bc6")).toBe(true);
    expect(isFileId("../..")).toBe(false);
    expect(isFileId("01a17664-13bf-7e86-8245-6421f5821bc6/..")).toBe(false);
    expect(isFileId("")).toBe(false);
  });
});

describe("localName", () => {
  it("keeps an ordinary name", () => {
    expect(localName("trail-map.pdf")).toBe("trail-map.pdf");
  });

  it("can't name another folder", () => {
    expect(localName("../../Library/x")).toBe("_.._Library_x");
    expect(localName("a\\b/c")).toBe("a_b_c");
    expect(localName("..")).toBe("file");
    expect(localName(".")).toBe("file");
    expect(localName("")).toBe("file");
    expect(localName(".hidden")).toBe("hidden");
  });

  it("cuts a long name to 200 bytes of UTF-8, keeping its extension", () => {
    const cjk = localName(`${"写".repeat(100)}.pdf`);
    expect(bytes(cjk)).toBeLessThanOrEqual(200);
    expect(cjk.endsWith(".pdf")).toBe(true);
    expect(cjk.startsWith("写写")).toBe(true);
    const ascii = localName(`${"a".repeat(300)}.jpeg`);
    expect(ascii).toBe(`${"a".repeat(195)}.jpeg`);
    // No extension worth keeping: the name is simply cut.
    expect(bytes(localName("x".repeat(300)))).toBe(200);
  });
});
