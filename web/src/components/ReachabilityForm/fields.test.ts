import { describe, expect, it } from "vitest";
import { changesFrom, EMPTY, NO_SECRETS, withTunnelProxy } from "./fields";

describe("withTunnelProxy", () => {
  it("adds the connector's address once", () => {
    expect(withTunnelProxy("", true)).toBe("127.0.0.1");
    expect(withTunnelProxy("10.0.0.0/8", true)).toBe("10.0.0.0/8, 127.0.0.1");
    expect(withTunnelProxy("127.0.0.1, 10.0.0.0/8", true)).toBe(
      "10.0.0.0/8, 127.0.0.1",
    );
  });

  it("takes it back out and leaves the rest", () => {
    expect(withTunnelProxy("10.0.0.0/8, 127.0.0.1", false)).toBe("10.0.0.0/8");
    expect(withTunnelProxy("127.0.0.1", false)).toBe("");
  });
});

describe("changesFrom", () => {
  it("sends the tunnel only when it changed", () => {
    expect(changesFrom(EMPTY, EMPTY, NO_SECRETS)).toEqual({});
    expect(
      changesFrom({ ...EMPTY, tunnelEnabled: true }, EMPTY, {
        ...NO_SECRETS,
        tunnelToken: " eyJh ",
      }),
    ).toEqual({ cloudflareTunnel: { enabled: true, token: "eyJh" } });
  });

  it("sends a new token on its own", () => {
    const on = { ...EMPTY, tunnelEnabled: true };
    expect(changesFrom(on, on, { ...NO_SECRETS, tunnelToken: "eyJh" })).toEqual(
      { cloudflareTunnel: { enabled: true, token: "eyJh" } },
    );
  });
});
