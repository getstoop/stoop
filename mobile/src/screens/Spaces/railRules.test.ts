import { describe, expect, it } from "vitest";
import { pickSpace, railItem } from "./railRules";

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

describe("railItem", () => {
  const space = { name: "Book club", muted: false, hasUnread: false, alertCount: 0 };

  it("shows nothing on a space with nothing waiting", () => {
    expect(railItem(space, false)).toEqual({ mark: "none", mentions: 0, dimmed: false, label: "Book club" });
  });

  it("marks an unread space", () => {
    expect(railItem({ ...space, hasUnread: true }, false)).toEqual({
      mark: "unread",
      mentions: 0,
      dimmed: false,
      label: "Book club, unread",
    });
  });

  it("badges mentions, and says them rather than unread", () => {
    expect(railItem({ ...space, hasUnread: true, alertCount: 1 }, false)).toMatchObject({
      mark: "unread",
      mentions: 1,
      label: "Book club, 1 mention",
    });
    expect(railItem({ ...space, hasUnread: true, alertCount: 3 }, false).label).toBe("Book club, 3 mentions");
  });

  it("gives the selected space the bar, with its badge kept", () => {
    expect(railItem(space, true)).toMatchObject({ mark: "selected", label: "Book club, selected" });
    expect(railItem({ ...space, hasUnread: true, alertCount: 2 }, true)).toMatchObject({
      mark: "selected",
      mentions: 2,
      label: "Book club, selected, 2 mentions",
    });
    expect(railItem({ ...space, hasUnread: true }, true).label).toBe("Book club, selected, unread");
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
