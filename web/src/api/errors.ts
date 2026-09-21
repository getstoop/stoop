import { ConnectError } from "@connectrpc/connect";
import { FieldViolationSchema } from "../gen/stoop/common/v1/field_violation_pb";

// The message worth showing a person: the server's own words for a
// Connect error, and whatever the runtime said for anything else.
export function errorText(err: unknown): string {
  return err instanceof ConnectError ? err.rawMessage : String(err);
}

// The request field a refusal is about, when the server named one
// (docs/architecture/contracts.md → Errors), spelled as the generated
// request type spells it.
export function fieldError(
  err: unknown,
): { field: string; message: string } | null {
  if (!(err instanceof ConnectError)) return null;
  const [violation] = err.findDetails(FieldViolationSchema);
  if (!violation?.field) return null;
  return { field: localName(violation.field), message: err.rawMessage };
}

// "new_password" → "newPassword"; "providers[2].client_id" →
// "providers[2].clientId".
export function localName(protoField: string): string {
  return protoField.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}
