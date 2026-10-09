import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { MyEmailSchema } from "../../../gen/stoop/auth/v1/auth_pb";
import { emailActions, emailState } from "./state";

const email = (address: string, pendingAddress: string) =>
  create(MyEmailSchema, { address, pendingAddress });

describe("emailState", () => {
  it("reads no address when GetMe carries none", () => {
    expect(emailState(undefined)).toBe("none");
    expect(emailState(email("", ""))).toBe("none");
  });

  it("tells a first address waiting for its link from a change", () => {
    expect(emailState(email("", "casey@example.com"))).toBe("pending");
    expect(emailState(email("casey@example.com", ""))).toBe("confirmed");
    expect(emailState(email("casey@example.com", "ada@example.com"))).toBe(
      "changing",
    );
  });
});

describe("emailActions", () => {
  it("offers what each state allows", () => {
    expect(emailActions("none")).toEqual(["add"]);
    expect(emailActions("confirmed")).toEqual(["change", "remove"]);
    expect(emailActions("pending")).toEqual(["resend", "cancel"]);
    expect(emailActions("changing")).toEqual(["resend", "cancel"]);
  });
});
