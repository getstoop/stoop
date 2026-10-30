import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import {
  inviteGone,
  inviteStatus,
  inviteStatusLabel,
  usesText,
} from "./invites";

describe("inviteGone", () => {
  it("is the server saying the invite can't be used", () => {
    for (const code of [
      Code.NotFound,
      Code.FailedPrecondition,
      Code.ResourceExhausted,
    ]) {
      expect(inviteGone(new ConnectError("gone", code))).toBe(true);
    }
  });

  it("is not a failure worth retrying", () => {
    expect(inviteGone(new ConnectError("down", Code.Unavailable))).toBe(false);
    expect(inviteGone(new ConnectError("oops", Code.Internal))).toBe(false);
    expect(inviteGone(new TypeError("Failed to fetch"))).toBe(false);
  });
});

describe("inviteStatus", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  const at = (iso: string) => timestampFromDate(new Date(iso));
  const invite = (over: Partial<Parameters<typeof inviteStatus>[0]> = {}) => ({
    useCount: 0,
    maxUses: undefined,
    expiresAt: undefined,
    revokedAt: undefined,
    ...over,
  });

  it("is active while nothing has spent it", () => {
    expect(inviteStatus(invite(), now)).toBe("active");
    expect(
      inviteStatus(invite({ expiresAt: at("2026-11-01T00:00:00Z") }), now),
    ).toBe("active");
    expect(inviteStatus(invite({ maxUses: 5, useCount: 4 }), now)).toBe(
      "active",
    );
  });

  it("says why it is spent, revoked first", () => {
    expect(
      inviteStatus(invite({ expiresAt: at("2026-10-01T00:00:00Z") }), now),
    ).toBe("expired");
    expect(inviteStatus(invite({ maxUses: 1, useCount: 1 }), now)).toBe(
      "exhausted",
    );
    expect(
      inviteStatus(
        invite({
          revokedAt: at("2026-10-29T00:00:00Z"),
          expiresAt: at("2026-10-01T00:00:00Z"),
          maxUses: 1,
          useCount: 1,
        }),
        now,
      ),
    ).toBe("revoked");
  });

  it("counts uses against the cap, or alone", () => {
    expect(usesText({ maxUses: 10, useCount: 3 })).toBe("3 of 10");
    expect(usesText({ maxUses: undefined, useCount: 18 })).toBe("18");
    expect(inviteStatusLabel("exhausted")).toBe("Used up");
  });
});
