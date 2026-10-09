import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  SmtpSecurity,
  type SmtpSettings,
  type SmtpSettingsSchema,
} from "../../gen/stoop/instance/v1/email_pb";

// The form's state model: what the inputs hold, how it is seeded from the
// server, and the settings it sends. Nothing here renders.

// What the inputs hold. The password is apart: it is write-only, so the
// server never sends one back to compare with.
export type EmailFields = {
  enabled: boolean;
  host: string;
  port: string;
  security: SmtpSecurity;
  username: string;
  fromAddress: string;
  fromName: string;
  hourlyLimit: string;
};

export type SetEmailField = <K extends keyof EmailFields>(
  key: K,
  value: EmailFields[K],
) => void;

// Where a refusal can land, as fieldError() spells the server's paths.
export const EMAIL_FIELDS = [
  "smtp.host",
  "smtp.port",
  "smtp.security",
  "smtp.username",
  "smtp.password",
  "smtp.fromAddress",
  "smtp.fromName",
  "smtp.hourlyLimit",
  "to",
] as const;
export type EmailField = (typeof EMAIL_FIELDS)[number];
export type EmailErrors = Partial<Record<EmailField, string>>;

export const DEFAULT_PORT: Record<SmtpSecurity, number> = {
  [SmtpSecurity.UNSPECIFIED]: 587,
  [SmtpSecurity.STARTTLS]: 587,
  [SmtpSecurity.TLS]: 465,
  [SmtpSecurity.NONE]: 25,
};

export const SECURITY_OPTIONS: { value: SmtpSecurity; label: string }[] = [
  { value: SmtpSecurity.STARTTLS, label: "STARTTLS" },
  { value: SmtpSecurity.TLS, label: "TLS" },
  { value: SmtpSecurity.NONE, label: "None (local relay only)" },
];

export const EMPTY: EmailFields = {
  enabled: false,
  host: "",
  port: "587",
  security: SmtpSecurity.STARTTLS,
  username: "",
  fromAddress: "",
  fromName: "",
  hourlyLimit: "100",
};

export function fieldsFrom(smtp: SmtpSettings | undefined): EmailFields {
  if (!smtp) return EMPTY;
  const security =
    smtp.security === SmtpSecurity.UNSPECIFIED
      ? SmtpSecurity.STARTTLS
      : smtp.security;
  return {
    enabled: smtp.enabled,
    host: smtp.host,
    port: String(smtp.port || DEFAULT_PORT[security]),
    security,
    username: smtp.username,
    fromAddress: smtp.fromAddress,
    fromName: smtp.fromName,
    hourlyLimit: String(smtp.hourlyLimit),
  };
}

// The server stores trimmed values, so the baseline is trimmed too, or a
// stray space reads as an unsaved change for ever after.
export function normalize(f: EmailFields): EmailFields {
  return {
    ...f,
    host: f.host.trim(),
    port: f.port.trim(),
    username: f.username.trim(),
    fromAddress: f.fromAddress.trim(),
    fromName: f.fromName.trim(),
    hourlyLimit: f.hourlyLimit.trim(),
  };
}

export function isDirty(
  now: EmailFields,
  base: EmailFields,
  password: string,
): boolean {
  return (
    password !== "" ||
    JSON.stringify(normalize(now)) !== JSON.stringify(normalize(base))
  );
}

// Port follows Security only while it holds the old mode's default, so a
// port someone typed stays.
export function portAfterSecurity(
  port: string,
  from: SmtpSecurity,
  to: SmtpSecurity,
): string {
  return port.trim() === String(DEFAULT_PORT[from])
    ? String(DEFAULT_PORT[to])
    : port;
}

// The test row needs somewhere to send through.
export const canTest = (f: EmailFields) => f.host.trim() !== "";

const wholeNumber = (v: string) => /^\d+$/.test(v.trim());

// Checks the server can't make: a box that doesn't hold a number at all.
// A blank port is fine; the server takes the mode's default.
export function numberErrors(f: EmailFields): EmailErrors {
  const errors: EmailErrors = {};
  if (f.port.trim() !== "" && !wholeNumber(f.port)) {
    errors["smtp.port"] = "Enter a port from 1 to 65535.";
  }
  if (!wholeNumber(f.hourlyLimit)) {
    errors["smtp.hourlyLimit"] = "Enter a number from 0 to 100000.";
  }
  return errors;
}

// The settings as sent, for a save or a test. A blank password keeps the
// saved one. The hourly limit is always the field's, which holds what was
// loaded when the form doesn't show it: 0 means no cap, so it is never
// sent for a field nobody saw.
export function settingsFrom(
  f: EmailFields,
  password: string,
): MessageInitShape<typeof SmtpSettingsSchema> {
  const n = normalize(f);
  return {
    enabled: n.enabled,
    host: n.host,
    port: n.port === "" ? 0 : Number(n.port),
    security: n.security,
    username: n.username,
    password,
    fromAddress: n.fromAddress,
    fromName: n.fromName,
    hourlyLimit: Number(n.hourlyLimit),
  };
}
