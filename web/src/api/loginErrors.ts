// Text for the ?error=<code> codes the provider sign-in flow redirects
// back with (see internal/auth/loginflow.go).

const LOGIN_ERRORS: Record<string, string> = {
  login_expired: "That sign-in took too long — please try again.",
  login_state: "That sign-in couldn't be verified — please try again.",
  provider_unknown: "That login provider isn't configured on this server.",
  provider_error:
    "The login provider didn't respond as expected. Try again, or tell the server admin.",
  closed: "This server isn't accepting new accounts.",
  invite_required: "Creating an account here needs an invite link.",
  invite_invalid: "That invite is no longer valid.",
  deactivated: "This account has been deactivated.",
};

export function loginErrorText(code: string): string {
  return LOGIN_ERRORS[code] ?? "Sign-in failed — please try again.";
}

const PROFILE_ERRORS: Record<string, string> = {
  identity_taken: "That identity is already linked to a different account.",
  already_linked: "That provider is already linked to your account.",
};

export function linkErrorText(code: string): string {
  return PROFILE_ERRORS[code] ?? "Linking failed — please try again.";
}
