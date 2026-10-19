import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import { needsConfirming } from "./askToConfirm";

describe("needsConfirming", () => {
  const refused = (code: Code, marker?: string) =>
    new ConnectError(
      "sign in again first, then make this change",
      code,
      marker ? new Headers({ "Stoop-Confirm": marker }) : undefined,
    );

  it("is the server's marked refusal", () => {
    expect(needsConfirming(refused(Code.FailedPrecondition, "required"))).toBe(
      true,
    );
  });

  it("is nothing else", () => {
    expect(needsConfirming(refused(Code.FailedPrecondition))).toBe(false);
    expect(needsConfirming(refused(Code.PermissionDenied, "required"))).toBe(
      false,
    );
    expect(needsConfirming(new Error("sign in again first"))).toBe(false);
  });
});
