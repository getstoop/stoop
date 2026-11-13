import { describe, expect, it } from "vitest";
import { sharedLink } from "./sharedLink";

const origin = "https://chat.example.com";
const none = { origin, spaceId: "", channelId: "", threadRootId: "", messageId: "" };

describe("a shared link", () => {
  it("is a space", () => {
    expect(sharedLink(origin, "/s/books")).toEqual({ ...none, spaceId: "books" });
  });

  it("is a channel, and a direct message with no space", () => {
    expect(sharedLink(origin, "/s/books/c/general")).toEqual({ ...none, spaceId: "books", channelId: "general" });
    expect(sharedLink(origin, "/dm/d1")).toEqual({ ...none, channelId: "d1" });
  });

  it("is a channel at a message", () => {
    expect(sharedLink(origin, "/s/books/c/general?m=m1")).toEqual({
      ...none,
      spaceId: "books",
      channelId: "general",
      messageId: "m1",
    });
    expect(sharedLink(origin, "/dm/d1?m=m1")).toEqual({ ...none, channelId: "d1", messageId: "m1" });
  });

  it("is a thread, at a reply when it names one", () => {
    const thread = { ...none, spaceId: "books", channelId: "general", threadRootId: "root" };
    expect(sharedLink(origin, "/s/books/c/general?t=root")).toEqual(thread);
    expect(sharedLink(origin, "/s/books/c/general?t=root&m=root")).toEqual(thread);
    expect(sharedLink(origin, "/s/books/c/general?t=root&m=m2")).toEqual({ ...thread, messageId: "m2" });
  });

  it("takes the server's address as typed, down to its origin", () => {
    expect(sharedLink("https://chat.example.com/", "/dm/d1")?.origin).toBe(origin);
    expect(sharedLink("http://192.168.1.5:8080", "/dm/d1")?.origin).toBe("http://192.168.1.5:8080");
  });

  it("is nothing for an invite, a sign-in hand-back or a path nobody shares", () => {
    expect(sharedLink(origin, "/join/CODE")).toBeNull();
    expect(sharedLink(origin, "/login?error=denied")).toBeNull();
    expect(sharedLink(origin, "/profile?error=denied")).toBeNull();
    expect(sharedLink(origin, "/s/books/settings")).toBeNull();
    expect(sharedLink(origin, "/s/books/search")).toBeNull();
    expect(sharedLink(origin, "/s/books/c/general/more")).toBeNull();
    expect(sharedLink(origin, "/dm")).toBeNull();
    expect(sharedLink(origin, "/")).toBeNull();
  });

  it("is nothing without a server, or for a path that isn't one", () => {
    expect(sharedLink("", "/dm/d1")).toBeNull();
    expect(sharedLink("ftp://chat.example.com", "/dm/d1")).toBeNull();
    expect(sharedLink(origin, "dm/d1")).toBeNull();
    expect(sharedLink(origin, "//evil.example.com/dm/d1")).toBeNull();
    expect(sharedLink(origin, "/\\evil.example.com/dm/d1")).toBeNull();
  });
});
