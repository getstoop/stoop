import { describe, expect, it } from "vitest";
import { sessionKey } from "./sessionKey";

const SERVER = { id: "aaaaaa", origin: "https://a.example", name: "A", session: 2 };

describe("sessionKey", () => {
  it("changes with a new sign-in under the same ID", () => {
    expect(sessionKey({ ...SERVER, session: 3 })).not.toBe(sessionKey(SERVER));
  });

  it("differs between servers on the same session", () => {
    expect(sessionKey({ ...SERVER, id: "bbbbbb" })).not.toBe(sessionKey(SERVER));
  });

  it("stays when only the name changes", () => {
    expect(sessionKey({ ...SERVER, name: "Renamed" })).toBe(sessionKey(SERVER));
  });

  it("reads a server saved before sessions were counted as session 0", () => {
    const { session: _session, ...older } = SERVER;
    expect(sessionKey(older)).toBe(sessionKey({ ...SERVER, session: 0 }));
  });
});
