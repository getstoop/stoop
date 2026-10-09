import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  SmtpSecurity,
  SmtpSettingsSchema,
} from "../../gen/stoop/instance/v1/email_pb";
import {
  canTest,
  EMPTY,
  fieldsFrom,
  isDirty,
  numberErrors,
  portAfterSecurity,
  settingsFrom,
} from "./fields";

const saved = create(SmtpSettingsSchema, {
  enabled: true,
  host: "smtp.example.net",
  port: 587,
  security: SmtpSecurity.STARTTLS,
  username: "casey@example.net",
  hasPassword: true,
  fromAddress: "stoop@example.net",
  hourlyLimit: 250,
});

describe("portAfterSecurity", () => {
  it("moves a default port to the new mode's default", () => {
    expect(
      portAfterSecurity("587", SmtpSecurity.STARTTLS, SmtpSecurity.TLS),
    ).toBe("465");
    expect(portAfterSecurity("465", SmtpSecurity.TLS, SmtpSecurity.NONE)).toBe(
      "25",
    );
    expect(
      portAfterSecurity("25", SmtpSecurity.NONE, SmtpSecurity.STARTTLS),
    ).toBe("587");
  });

  it("keeps a port someone typed", () => {
    expect(
      portAfterSecurity("2525", SmtpSecurity.STARTTLS, SmtpSecurity.TLS),
    ).toBe("2525");
    expect(
      portAfterSecurity("465", SmtpSecurity.STARTTLS, SmtpSecurity.TLS),
    ).toBe("465");
    expect(portAfterSecurity("", SmtpSecurity.STARTTLS, SmtpSecurity.TLS)).toBe(
      "",
    );
  });
});

describe("settingsFrom", () => {
  it("sends a blank password when none was typed", () => {
    expect(settingsFrom(fieldsFrom(saved), "").password).toBe("");
    expect(settingsFrom(fieldsFrom(saved), "hunter2").password).toBe("hunter2");
  });

  it("sends back the loaded hourly limit", () => {
    expect(settingsFrom(fieldsFrom(saved), "").hourlyLimit).toBe(250);
    const uncapped = create(SmtpSettingsSchema, { ...saved, hourlyLimit: 0 });
    expect(settingsFrom(fieldsFrom(uncapped), "").hourlyLimit).toBe(0);
  });

  it("trims, and sends a blank port as 0 for the server's default", () => {
    const sent = settingsFrom(
      { ...fieldsFrom(saved), host: " smtp.example.com ", port: " " },
      "",
    );
    expect(sent.host).toBe("smtp.example.com");
    expect(sent.port).toBe(0);
  });
});

describe("fieldsFrom", () => {
  it("fills an unsaved port and security with STARTTLS's", () => {
    const blank = fieldsFrom(create(SmtpSettingsSchema, { hourlyLimit: 100 }));
    expect(blank.security).toBe(SmtpSecurity.STARTTLS);
    expect(blank.port).toBe("587");
    expect(blank.hourlyLimit).toBe("100");
  });
});

describe("isDirty", () => {
  const base = fieldsFrom(saved);
  it("is clean when nothing changed but whitespace", () => {
    expect(isDirty(base, base, "")).toBe(false);
    expect(isDirty({ ...base, host: `${base.host} ` }, base, "")).toBe(false);
  });

  it("is dirty for an edit or a typed password", () => {
    expect(isDirty({ ...base, enabled: false }, base, "")).toBe(true);
    expect(isDirty(base, base, "hunter2")).toBe(true);
  });
});

describe("numberErrors", () => {
  it("refuses a box with no number in it", () => {
    expect(numberErrors(EMPTY)).toEqual({});
    expect(numberErrors({ ...EMPTY, port: "" })).toEqual({});
    expect(Object.keys(numberErrors({ ...EMPTY, port: "abc" }))).toEqual([
      "smtp.port",
    ]);
    expect(Object.keys(numberErrors({ ...EMPTY, hourlyLimit: "" }))).toEqual([
      "smtp.hourlyLimit",
    ]);
  });
});

describe("canTest", () => {
  it("shows the test row once a host is filled in", () => {
    expect(canTest(EMPTY)).toBe(false);
    expect(canTest({ ...EMPTY, host: "  " })).toBe(false);
    expect(canTest({ ...EMPTY, host: "smtp.example.net" })).toBe(true);
  });
});
