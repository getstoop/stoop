import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import { FieldViolationSchema } from "../gen/stoop/common/v1/field_violation_pb";
import { errorText, fieldError, localName } from "./errors";

const refusal = (field?: string) =>
  new ConnectError(
    "username is taken",
    Code.AlreadyExists,
    undefined,
    field === undefined
      ? undefined
      : [
          {
            desc: FieldViolationSchema,
            value: create(FieldViolationSchema, { field }),
          },
        ],
  );

describe("fieldError", () => {
  it("reads the field and keeps the server's sentence", () => {
    expect(fieldError(refusal("username"))).toEqual({
      field: "username",
      message: "username is taken",
    });
  });

  it("spells the field as the request type does", () => {
    expect(fieldError(refusal("new_password"))?.field).toBe("newPassword");
  });

  it("is null when the server named no field", () => {
    expect(fieldError(refusal())).toBeNull();
    expect(fieldError(refusal(""))).toBeNull();
    expect(fieldError(new Error("offline"))).toBeNull();
  });
});

describe("localName", () => {
  it("keeps the path and camel-cases each segment", () => {
    expect(localName("name")).toBe("name");
    expect(localName("turn.stun_urls")).toBe("turn.stunUrls");
    expect(localName("providers[2].client_id")).toBe("providers[2].clientId");
  });
});

describe("errorText", () => {
  it("drops the code prefix", () => {
    expect(errorText(refusal("username"))).toBe("username is taken");
  });
});
