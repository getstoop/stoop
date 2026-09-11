import { describe, expect, it } from "vitest";
import { linkErrorText, loginErrorText } from "./loginErrors";

const LOGIN_FALLBACK = "Sign-in failed — please try again.";
const LINK_FALLBACK = "Linking failed — please try again.";

describe("loginErrorText", () => {
  it("maps a known code from the sign-in flow", () => {
    expect(loginErrorText("login_expired")).toBe(
      "That sign-in took too long — please try again.",
    );
    expect(loginErrorText("deactivated")).toBe(
      "This account has been deactivated.",
    );
  });

  // The code arrives in a query string, so anything can turn up there.
  it("falls back for an unknown code", () => {
    expect(loginErrorText("something_else")).toBe(LOGIN_FALLBACK);
  });

  it("falls back for an empty code", () => {
    expect(loginErrorText("")).toBe(LOGIN_FALLBACK);
  });

  it("matches codes exactly, not case-insensitively", () => {
    expect(loginErrorText("Closed")).toBe(LOGIN_FALLBACK);
  });

  it("does not treat a link-only code as a sign-in code", () => {
    expect(loginErrorText("identity_taken")).toBe(LOGIN_FALLBACK);
  });
});

describe("linkErrorText", () => {
  it("maps a code only linking can produce", () => {
    expect(linkErrorText("already_linked")).toBe(
      "That provider is already linked to your account.",
    );
  });

  // Linking is the same round trip as signing in, so it inherits those codes.
  it("reuses the sign-in text for a shared code", () => {
    expect(linkErrorText("login_state")).toBe(loginErrorText("login_state"));
    expect(linkErrorText("provider_unknown")).toBe(
      loginErrorText("provider_unknown"),
    );
  });

  it("falls back to link wording, not sign-in wording", () => {
    expect(linkErrorText("something_else")).toBe(LINK_FALLBACK);
    expect(linkErrorText("")).toBe(LINK_FALLBACK);
  });
});

// The code is whatever ?error= carried, so it reaches these maps as an
// arbitrary string. A plain index would find Object.prototype's members
// and return a function past a `: string` return type.
describe("a code that names something on Object.prototype", () => {
  for (const code of ["constructor", "toString", "valueOf", "__proto__"]) {
    it(`falls through to the fallback for ${code}`, () => {
      expect(loginErrorText(code)).toBe("Sign-in failed — please try again.");
      expect(linkErrorText(code)).toBe("Linking failed — please try again.");
    });
  }
});
