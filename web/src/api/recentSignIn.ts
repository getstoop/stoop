// What an account without a password is told beside a change the password
// would otherwise guard: the server takes a recent sign-in in its place
// (docs/architecture/identity.md → Passwords), and refuses after ten
// minutes with "sign in again first".
export const RECENT_SIGN_IN_HINT =
  "Your account has no password, so this only works within ten minutes of signing in.";
