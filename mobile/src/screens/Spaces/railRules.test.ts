import { describe, expect, it } from "vitest";
import { pickSpace, railItem, railOffset, railReveal } from "./railRules";

const spaces = [{ id: "books" }, { id: "climbing" }, { id: "garden" }];

describe("pickSpace", () => {
  it("opens on the first space when none is wanted", () => {
    expect(pickSpace(spaces, undefined)).toBe("books");
  });

  it("keeps the wanted space while it is in the list", () => {
    expect(pickSpace(spaces, "garden")).toBe("garden");
  });

  it("moves to the first space when the wanted one has gone", () => {
    expect(pickSpace(spaces, "left")).toBe("books");
  });

  it("picks nothing from no spaces", () => {
    expect(pickSpace([], "books")).toBeUndefined();
    expect(pickSpace([], undefined)).toBeUndefined();
  });
});

describe("railOffset", () => {
  // A rail 600 tall with 80 of its bottom under the tab bar: 520 clear,
  // so nine buttons (8 + 9 × 56 = 512) show whole.
  const offset = (index: number, count: number) => railOffset(index, count, 600, 80);

  it("stays at the top while the selected space is whole in sight", () => {
    expect(offset(0, 30)).toBe(0);
    expect(offset(8, 30)).toBe(0);
  });

  it("puts a space further down mid-way in what is clear", () => {
    // Its top at 8 + 15 × 56 = 848, less half of 520 − 56.
    expect(offset(15, 30)).toBe(616);
    // The first one that isn't whole: cut by the tab bar at the top of the rail.
    expect(offset(9, 30)).toBe(280);
  });

  it("stops at the end of the rail for the last spaces", () => {
    // Content 8 + 30 × 56, the rule's 13 and Add a space's 56, then
    // 8 + 80 = 1845, less the rail's 600.
    expect(offset(29, 30)).toBe(1245);
    expect(offset(28, 30)).toBe(1245);
  });

  it("stays at the top with no space selected or a rail not yet measured", () => {
    expect(offset(-1, 30)).toBe(0);
    expect(railOffset(3, 4, 0, 0)).toBe(0);
  });
});

describe("railReveal", () => {
  // The same rail: 600 tall, 520 of it clear.
  const reveal = (index: number, offset: number) => railReveal(index, 600, 80, offset);

  it("leaves the rail alone while the space is whole in sight", () => {
    expect(reveal(0, 0)).toBeNull();
    expect(reveal(8, 0)).toBeNull();
    expect(reveal(12, 300)).toBeNull();
  });

  it("brings a space below up to the bottom of what is clear", () => {
    // Its bottom at 8 + 10 × 56 = 568, the padding's 8 under it, less 520.
    expect(reveal(9, 0)).toBe(56);
    expect(reveal(20, 0)).toBe(672);
  });

  it("brings a space above down to the top", () => {
    expect(reveal(3, 400)).toBe(168);
    expect(reveal(0, 400)).toBe(0);
  });

  it("does nothing with no space or a rail not yet measured", () => {
    expect(reveal(-1, 0)).toBeNull();
    expect(railReveal(3, 0, 0, 0)).toBeNull();
  });
});

describe("railItem", () => {
  const space = { name: "Book club", muted: false, hasUnread: false, alertCount: 0 };

  it("shows nothing on a space with nothing waiting", () => {
    expect(railItem(space, false)).toEqual({ mark: "none", mentions: 0, dimmed: false, label: "Book club" });
  });

  it("gives the selected space the bar", () => {
    expect(railItem(space, true)).toEqual({
      mark: "selected",
      mentions: 0,
      dimmed: false,
      label: "Book club, selected",
    });
  });

  it("gives a selected space with something unread the bar alone", () => {
    expect(railItem({ ...space, hasUnread: true }, true)).toEqual({
      mark: "selected",
      mentions: 0,
      dimmed: false,
      label: "Book club, selected, unread",
    });
  });

  it("gives a selected space with mentions the bar and the badge", () => {
    expect(railItem({ ...space, hasUnread: true, alertCount: 2 }, true)).toEqual({
      mark: "selected",
      mentions: 2,
      dimmed: false,
      label: "Book club, selected, 2 mentions",
    });
  });

  it("gives an unread space the tab", () => {
    expect(railItem({ ...space, hasUnread: true }, false)).toEqual({
      mark: "unread",
      mentions: 0,
      dimmed: false,
      label: "Book club, unread",
    });
  });

  it("shows the tab and the badge together, and says the mentions", () => {
    expect(railItem({ ...space, hasUnread: true, alertCount: 1 }, false)).toEqual({
      mark: "unread",
      mentions: 1,
      dimmed: false,
      label: "Book club, 1 mention",
    });
    expect(railItem({ ...space, hasUnread: true, alertCount: 3 }, false).label).toBe("Book club, 3 mentions");
  });

  it("badges mentions without the tab when nothing is unread", () => {
    expect(railItem({ ...space, alertCount: 2 }, false)).toEqual({
      mark: "none",
      mentions: 2,
      dimmed: false,
      label: "Book club, 2 mentions",
    });
  });

  it("dims a muted space and shows nothing waiting in it", () => {
    expect(railItem({ ...space, muted: true, hasUnread: true, alertCount: 4 }, false)).toEqual({
      mark: "none",
      mentions: 0,
      dimmed: true,
      label: "Book club, muted",
    });
  });

  it("still gives a muted space the bar when it is selected", () => {
    expect(railItem({ ...space, muted: true, hasUnread: true }, true)).toEqual({
      mark: "selected",
      mentions: 0,
      dimmed: true,
      label: "Book club, selected, muted",
    });
  });
});
