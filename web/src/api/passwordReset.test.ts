import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import { PasswordSignIn } from "../gen/stoop/instance/v1/instance_pb";
import {
  confirmPasswordError,
  emailAddressError,
  forgotLinkShown,
  isSpentLink,
  PASSWORDS_DIFFER,
  passwordFormShown,
} from "./passwordReset";

describe("passwordFormShown", () => {
  it("shows for everyone", () => {
    expect(passwordFormShown(PasswordSignIn.EVERYONE, false, 2)).toBe(true);
  });

  it("hides for admins-only unless asked for", () => {
    expect(passwordFormShown(PasswordSignIn.ADMINS, false, 1)).toBe(false);
    expect(passwordFormShown(PasswordSignIn.ADMINS, true, 1)).toBe(true);
  });

  it("hides when off unless asked for", () => {
    expect(passwordFormShown(PasswordSignIn.OFF, false, 1)).toBe(false);
  });

  it("shows when there is no provider to fall back to", () => {
    expect(passwordFormShown(PasswordSignIn.OFF, false, 0)).toBe(true);
  });
});

describe("forgotLinkShown", () => {
  it("shows on the sign-in form when reset is available", () => {
    expect(forgotLinkShown(true, true, "login")).toBe(true);
  });

  it("hides when the server cannot send the link", () => {
    expect(forgotLinkShown(false, true, "login")).toBe(false);
  });

  it("hides when the password form is hidden", () => {
    const shown = passwordFormShown(PasswordSignIn.ADMINS, false, 1);
    expect(forgotLinkShown(true, shown, "login")).toBe(false);
  });

  it("shows on the admins' ?password=1 form", () => {
    const shown = passwordFormShown(PasswordSignIn.ADMINS, true, 1);
    expect(forgotLinkShown(true, shown, "login")).toBe(true);
  });

  it("hides on the create-account form", () => {
    expect(forgotLinkShown(true, true, "register")).toBe(false);
  });
});

describe("emailAddressError", () => {
  it("accepts one address", () => {
    expect(emailAddressError("casey@example.com")).toBeNull();
    expect(emailAddressError("  ada@example.com ")).toBeNull();
  });

  it("asks for an address when empty", () => {
    expect(emailAddressError("   ")).toBe("Enter an email address.");
  });

  it.each([
    "casey",
    "@example.com",
    "casey@",
    "casey@@example.com",
    "casey @example.com",
    "ada@example.com, bea@example.com",
    "Casey <casey@example.com>",
  ])("refuses %s", (address) => {
    expect(emailAddressError(address)).toBe(
      "Enter one email address, like casey@example.com.",
    );
  });
});

describe("confirmPasswordError", () => {
  it("passes when the two match", () => {
    expect(confirmPasswordError("hunter2hunter2", "hunter2hunter2")).toBeNull();
  });

  it("refuses when they differ", () => {
    expect(confirmPasswordError("hunter2hunter2", "hunter2hunter")).toBe(
      PASSWORDS_DIFFER,
    );
    expect(PASSWORDS_DIFFER).toBe("The two new passwords don't match.");
  });
});

describe("isSpentLink", () => {
  it("is a spent link for the server's refusals of the token", () => {
    expect(isSpentLink(new ConnectError("gone", Code.FailedPrecondition))).toBe(
      true,
    );
    expect(isSpentLink(new ConnectError("gone", Code.NotFound))).toBe(true);
  });

  it("is not for a server or network failure", () => {
    expect(isSpentLink(new ConnectError("down", Code.Unavailable))).toBe(false);
    expect(isSpentLink(new Error("offline"))).toBe(false);
  });
});
