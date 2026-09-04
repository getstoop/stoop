import type { GetLoginProvidersResponse } from "../../gen/stoop/instance/v1/providers_pb";

// The form's state model. The whole list is edited and saved as one
// (UpdateLoginProviders replaces it), so a row is plain input state and
// dirtiness is "the rows differ from the last server snapshot".

export type ProviderRowState = {
  // Stable React key; unrelated to the provider id, which is editable.
  key: string;
  id: string;
  displayName: string;
  icon: string;
  issuer: string;
  clientId: string;
  // Write-only: the server never sends secrets back. A non-empty box is
  // the change; blank keeps the saved secret (while clientId is unchanged).
  secret: string;
  hasSecret: boolean;
  callbackUrl: string;
  fromEnv: boolean;
};

let nextKey = 0;
export const rowKey = () => `row-${nextKey++}`;

export function rowsFrom(resp: GetLoginProvidersResponse): ProviderRowState[] {
  return resp.providers.map((p) => ({
    key: rowKey(),
    id: p.id,
    displayName: p.displayName,
    icon: p.icon,
    issuer: p.issuer,
    clientId: p.clientId,
    secret: "",
    hasSecret: p.hasClientSecret,
    callbackUrl: p.callbackUrl,
    fromEnv: p.fromEnv,
  }));
}

export function requestFrom(rows: ProviderRowState[]) {
  return {
    providers: rows.map((r) => ({
      id: r.id.trim(),
      displayName: r.displayName.trim(),
      icon: r.icon,
      issuer: r.issuer.trim(),
      clientId: r.clientId.trim(),
      clientSecret: r.secret,
    })),
  };
}
