// "Add provider" presets: UI-only prefill of the generic OIDC form.
// Google and Microsoft are ordinary OIDC issuers; nothing provider-
// specific runs on the server.

export type Preset = {
  label: string;
  id: string;
  displayName: string;
  icon: string;
  issuer: string;
  hint?: string;
};

export const PRESETS: Preset[] = [
  {
    label: "Google",
    id: "google",
    displayName: "Continue with Google",
    icon: "google",
    issuer: "https://accounts.google.com",
  },
  {
    label: "Microsoft",
    id: "microsoft",
    displayName: "Continue with Microsoft",
    icon: "microsoft",
    // The admin replaces <tenant-id>; the "common" pseudo-tenant is not
    // supported because its discovery issuer is templated.
    issuer: "https://login.microsoftonline.com/<tenant-id>/v2.0",
    hint: "Replace <tenant-id> with your Entra tenant id.",
  },
  {
    label: "Generic OIDC",
    id: "sso",
    displayName: "Continue with single sign-on",
    icon: "key",
    issuer: "",
  },
];
