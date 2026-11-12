import { describe, expect, it } from "vitest";
import { pickSpace, railItem, railOffset } from "./railRules";

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
    // Content 8 + 30 × 56 + 8 + 80 = 1776, less the rail's 600.
    expect(offset(29, 30)).toBe(1176);
    expect(offset(28, 30)).toBe(1176);
  });

  it("stays at the top with no space selected or a rail not yet measured", () => {
    expect(offset(-1, 30)).toBe(0);
    expect(railOffset(3, 4, 0, 0)).toBe(0);
  });
});

describe("railItem", () => {
  const space = { name: "Book club", muted: false, hasUnread: false, alertCount: 0 };

  it("shows nothing on a space with nothing waiting", () => {
    expect(railItem(space, false)).toEqual({
      selected: false,
      unread: false,
      mentions: 0,
      dimmed: false,
      label: "Book club",
    });
  });

  it("gives an unread space the tab", () => {
    expect(railItem({ ...space, hasUnread: true }, false)).toEqual({
      selected: false,
      unread: true,
      mentions: 0,
      dimmed: false,
      label: "Book club, unread",
    });
  });

  it("shows the tab and the badge together, and says the mentions", () => {
    expect(railItem({ ...space, hasUnread: true, alertCount: 1 }, false)).toEqual({
      selected: false,
      unread: true,
      mentions: 1,
      dimmed: false,
      label: "Book club, 1 mention",
    });
    expect(railItem({ ...space, hasUnread: true, alertCount: 3 }, false).label).toBe("Book club, 3 mentions");
  });

  it("badges mentions without the tab when nothing is unread", () => {
    expect(railItem({ ...space, alertCount: 2 }, false)).toMatchObject({ unread: false, mentions: 2 });
  });

  it("gives the selected space the bar", () => {
    expect(railItem(space, true)).toEqual({
      selected: true,
      unread: false,
      mentions: 0,
      dimmed: false,
      label: "Book club, selected",
    });
  });

  it("keeps the tab on a selected space with something unread", () => {
    expect(railItem({ ...space, hasUnread: true }, true)).toEqual({
      selected: true,
      unread: true,
      mentions: 0,
      dimmed: false,
      label: "Book club, selected, unread",
    });
    expect(railItem({ ...space, hasUnread: true, alertCount: 2 }, true)).toEqual({
      selected: true,
      unread: true,
      mentions: 2,
      dimmed: false,
      label: "Book club, selected, 2 mentions",
    });
  });

  it("dims a muted space and shows nothing waiting in it", () => {
    expect(railItem({ ...space, muted: true, hasUnread: true, alertCount: 4 }, false)).toEqual({
      selected: false,
      unread: false,
      mentions: 0,
      dimmed: true,
      label: "Book club, muted",
    });
  });

  it("still gives a muted space the bar when it is selected, without the tab", () => {
    expect(railItem({ ...space, muted: true, hasUnread: true }, true)).toEqual({
      selected: true,
      unread: false,
      mentions: 0,
      dimmed: true,
      label: "Book club, selected, muted",
    });
  });
});
