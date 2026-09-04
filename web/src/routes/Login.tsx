import { ConnectError } from "@connectrpc/connect";
import { useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useSearch } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { authClient } from "../api/clients";
import { errorText } from "../api/errors";
import { parseInviteCode } from "../api/invites";
import { loginErrorText } from "../api/loginErrors";
import { roleLabel } from "../api/permissions";
import { useInstanceStatus, useInvitePreview } from "../api/queries";
import { LoginProviders } from "../components/LoginProviders";
import { SpaceIcon } from "../components/SpaceIcon";
import type { InvitePreview } from "../gen/stoop/chat/v1/invite_pb";
import {
  PasswordSignIn,
  RegistrationPolicy,
} from "../gen/stoop/instance/v1/instance_pb";
import { safeRedirect } from "../router";

// Set once a login succeeds in this browser, so the next invite landing
// here leads with "log in" instead of "create an account". Client-side
// only; it says nothing about which account.
const HAS_ACCOUNT_KEY = "stoop.hasAccount";
const hasLoggedInHere = () => {
  try {
    return localStorage.getItem(HAS_ACCOUNT_KEY) === "1";
  } catch {
    return false;
  }
};

export function LoginPage() {
  const {
    redirect,
    error: errorCode,
    password: forcePassword,
  } = useSearch({ from: "/login" });
  // Arriving via an invite link: a returning member of another space is
  // as likely as a newcomer, so the landing offers both paths explicitly
  // and defaults from what this browser has done before.
  const invited = redirect?.startsWith("/join/") ?? false;
  // The code from the link, if any; otherwise typed by the user.
  const linkCode = invited && redirect ? parseInviteCode(redirect) : "";
  // The server's own account of the space behind the code. The landing
  // shows this rather than the ?space= hint in the link, which is
  // whatever the sender chose to put there.
  const { data: preview, error: inviteError } = useInvitePreview(
    linkCode || undefined,
  );
  const [typedCode, setTypedCode] = useState("");
  const inviteCode = linkCode || typedCode;
  const [mode, setMode] = useState<"login" | "register">(
    invited && !hasLoggedInHere() ? "register" : "login",
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    // A provider sign-in that failed lands back here with ?error=<code>.
    errorCode ? loginErrorText(errorCode) : null,
  );
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: status, isLoading: statusLoading } = useInstanceStatus();

  // A fresh instance has no one to log in as: walk the visitor through
  // first-run setup instead.
  if (statusLoading) {
    return <div className="login-page muted">Loading…</div>;
  }
  if (status?.needsSetup) {
    return <Navigate to="/setup" replace />;
  }
  const policy = status?.registrationPolicy ?? RegistrationPolicy.INVITE;
  // Password sign-in can be restricted to admins or turned off in favour
  // of login providers; the form then hides unless asked for explicitly
  // (?password=1 — the admins' fallback). Never hide it when there are no
  // providers to fall back to.
  const passwordSignIn = status?.passwordSignIn ?? PasswordSignIn.EVERYONE;
  const providers = status?.loginProviders ?? [];
  const showPasswordForm =
    passwordSignIn === PasswordSignIn.EVERYONE ||
    forcePassword === "1" ||
    providers.length === 0;
  const canRegister =
    policy !== RegistrationPolicy.CLOSED &&
    passwordSignIn === PasswordSignIn.EVERYONE;
  const codeRequired = policy === RegistrationPolicy.INVITE;
  // A closed server can only be logged in to; never strand an invitee on
  // a create-account form with no way out.
  const effectiveMode = canRegister ? mode : "login";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let joinedSpaceId = "";
      if (effectiveMode === "register") {
        const res = await authClient.register({
          username,
          password,
          inviteCode: inviteCode.trim(),
        });
        joinedSpaceId = res.joinedSpaceId;
      }
      await authClient.login({ username, password });
      try {
        localStorage.setItem(HAS_ACCOUNT_KEY, "1");
      } catch {
        // Storage unavailable: the next landing just defaults to "new".
      }
      queryClient.clear();
      if (joinedSpaceId) {
        // Registration already redeemed the invite: go straight in.
        await navigate({
          to: "/s/$spaceId",
          params: { spaceId: joinedSpaceId },
        });
        return;
      }
      // Re-check at the point of use so a bad value can never bounce us
      // back onto the login form.
      await navigate({ to: safeRedirect(redirect) ?? "/" });
    } catch (err) {
      setError(err instanceof ConnectError ? err.rawMessage : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>Stoop</h1>
        {/* The card names the space, so the line above it only has to
            say what kind of thing this is; the next step goes under the
            card, where the buttons that take it are. */}
        <p className="login-subtitle">
          {invited && !inviteError
            ? "You've been invited to a space on someone's stoop."
            : mode === "login"
              ? "Welcome back."
              : "Pull up a seat."}
        </p>
        {invited &&
          (inviteError ? (
            <p className="error">{errorText(inviteError)}</p>
          ) : (
            preview && <InviteHero preview={preview} />
          ))}
        {invited && !inviteError && (
          <p className="login-subtitle invite-next">
            {effectiveMode === "register"
              ? "Create an account to join."
              : "Log in to join."}
          </p>
        )}
        <LoginProviders
          redirect={safeRedirect(redirect)}
          invite={invited ? inviteCode : undefined}
          divider={showPasswordForm}
        />
        {!showPasswordForm && (
          <>
            {error && <p className="error">{error}</p>}
            {passwordSignIn === PasswordSignIn.ADMINS && (
              <Link
                className="link"
                to="/login"
                search={{ redirect, password: "1" }}
              >
                Server admin? Sign in with a password
              </Link>
            )}
          </>
        )}
        {showPasswordForm && invited && (
          <fieldset className="invite-choice" aria-label="New or returning?">
            {canRegister && (
              <button
                type="button"
                data-mode="register"
                className={effectiveMode === "register" ? "active" : ""}
                aria-pressed={effectiveMode === "register"}
                onClick={() => setMode("register")}
              >
                <strong>I'm new here</strong>
                <span>Create an account</span>
              </button>
            )}
            <button
              type="button"
              data-mode="login"
              className={effectiveMode === "login" ? "active" : ""}
              aria-pressed={effectiveMode === "login"}
              onClick={() => setMode("login")}
            >
              <strong>I already have an account</strong>
              <span>Log in with it</span>
            </button>
          </fieldset>
        )}
        {showPasswordForm && (
          <>
            <label>
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={
                  effectiveMode === "login"
                    ? "current-password"
                    : "new-password"
                }
                required
              />
            </label>
            {effectiveMode === "register" && (codeRequired || invited) && (
              <label>
                Invite code
                <input
                  value={inviteCode}
                  onChange={(e) => setTypedCode(e.target.value)}
                  readOnly={linkCode !== ""}
                  placeholder="From the person who invited you"
                  required={codeRequired}
                  autoComplete="off"
                />
              </label>
            )}
            {error && <p className="error">{error}</p>}
            <button type="submit" className="primary" disabled={busy}>
              {effectiveMode === "login"
                ? invited
                  ? "Log in & join"
                  : "Log in"
                : invited
                  ? "Create account & join"
                  : "Create account"}
            </button>
            {invited ? (
              !canRegister && (
                <p className="muted small">
                  This server isn't accepting new accounts; log in with the one
                  you have.
                </p>
              )
            ) : canRegister ? (
              <button
                type="button"
                className="link"
                onClick={() => setMode(mode === "login" ? "register" : "login")}
              >
                {mode === "login"
                  ? "New here? Create an account"
                  : "Already have an account? Log in"}
              </button>
            ) : (
              <p className="muted small">
                This server isn't accepting new accounts.
              </p>
            )}
          </>
        )}
      </form>
    </div>
  );
}

// What the code is an invitation to, from the server rather than the
// link: the space's face, its size, and the role redeeming it grants.
function InviteHero({ preview }: { preview: InvitePreview }) {
  return (
    <div className="invite-hero">
      <header className="invite-hero-head">
        <span className="space-pill static" aria-hidden="true">
          <SpaceIcon
            name={preview.spaceName}
            fileId={preview.spaceIconFileId}
          />
        </span>
        <div>
          <strong>{preview.spaceName}</strong>
          <p className="muted small">
            {preview.memberCount} member{preview.memberCount === 1 ? "" : "s"} ·
            you'll join as {roleLabel(preview.role)}
          </p>
        </div>
      </header>
      {preview.spaceDescription && (
        <p className="muted small">{preview.spaceDescription}</p>
      )}
    </div>
  );
}
