import { describe, expect, it } from "vitest";
import { threadReadDue } from "./threadReadDue";

describe("threadReadDue", () => {
  it("has nothing to do while the count stands and nothing is unread", () => {
    expect(threadReadDue(3, 3, 0, false)).toBe("done");
    expect(threadReadDue(3, 3, 0, true)).toBe("done");
  });

  it("leaves the reader's own new reply to its send", () => {
    expect(threadReadDue(3, 4, 0, true)).toBe("covered");
  });

  it("reads a new reply by someone else", () => {
    expect(threadReadDue(3, 4, 0, false)).toBe("read");
    expect(threadReadDue(3, 4, 1, false)).toBe("read");
  });

  it("reads when something is unread, even under the reader's own reply", () => {
    expect(threadReadDue(4, 4, 1, true)).toBe("read");
    expect(threadReadDue(3, 4, 1, true)).toBe("read");
  });

  it("always reads when asked again, as for an activity item landing late", () => {
    expect(threadReadDue(-1, 4, 0, true)).toBe("read");
    expect(threadReadDue(-1, 4, 0, false)).toBe("read");
  });

  it("reads on opening, and after a failure, on the reader's own newest reply", () => {
    expect(threadReadDue(-1, 1, 0, true)).toBe("read");
  });

  it("reads someone else's reply after the reader's own was skipped", () => {
    // The skip settles at the count, so the next reply's event and its
    // summary make one read between them, when the count moves.
    expect(threadReadDue(4, 4, 0, false)).toBe("done");
    expect(threadReadDue(4, 5, 0, false)).toBe("read");
  });
});
