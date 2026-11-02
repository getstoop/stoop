import { ConnectError } from "@connectrpc/connect";
import { FieldViolationSchema } from "@stoop/gen/stoop/common/v1/field_violation_pb";

// The message worth showing a person, as web's api/errors.ts words it:
// the server's own words for a Connect error, and whatever the runtime
// said for anything else (a timeout, no network).
export function errorText(err: unknown): string {
  if (err instanceof ConnectError) return err.rawMessage;
  return err instanceof Error ? err.message : String(err);
}

// The request field a refusal is about, when the server named one
// (docs/architecture/contracts.md → Errors), spelled as the generated
// request type spells it, as web's api/errors.ts.
export function fieldOf(err: unknown): string | null {
  if (!(err instanceof ConnectError)) return null;
  const [violation] = err.findDetails(FieldViolationSchema);
  return violation?.field ? violation.field.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()) : null;
}
