// Text for the error codes a provider sign-in comes back with, worded as
// web's login card words them (web/src/api/loginErrors.ts; the codes are
// internal/auth/loginflow.go's).

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

// The code arrives in a link, so it is whatever someone put there: look
// it up as an own key, never through the prototype.
export function loginErrorText(code: string): string {
  return Object.prototype.hasOwnProperty.call(LOGIN_ERRORS, code)
    ? LOGIN_ERRORS[code]
    : "Sign-in failed — please try again.";
}
