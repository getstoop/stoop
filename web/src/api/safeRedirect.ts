// ?redirect=<path> sends the user back where they were headed after login
// (e.g. an invite link). Only same-origin absolute paths are accepted, and
// never /login or /setup — either would leave someone who just signed in
// looking at a page that is finished with them.
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Same-origin paths only. "//host" and "/\host" both leave the site: a
  // browser reads a backslash there as a slash (loginflow.go's
  // safeRedirectPath refuses both too).
  if (!value.startsWith("/") || value[1] === "/" || value[1] === "\\") {
    return undefined;
  }
  // Never back onto a page whose job is done: the login form, or setup,
  // which exists only while the instance has no accounts.
  for (const done of ["/login", "/setup"]) {
    if (value === done || value.startsWith(`${done}?`)) return undefined;
    if (value.startsWith(`${done}/`)) return undefined;
  }
  return value;
}
