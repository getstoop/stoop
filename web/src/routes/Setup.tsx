import { ConnectError } from "@connectrpc/connect";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { authClient, chatClient } from "../api/clients";
import { inviteLink } from "../api/invites";
import { useInstanceStatus } from "../api/queries";
import { LoginProviders } from "../components/LoginProviders";
import { ReachabilityForm } from "../components/ReachabilityForm";

// First-run setup for a fresh instance. Four steps on one card: the admin
// account (the first account operates the server), the first space, how
// people will reach the server (skippable; it's also on the admin page),
// and an invite link to hand out. Reached only while the instance has no
// users.

type Step = 1 | 2 | 3 | 4;

const STEPS = [
  "Your account",
  "Your space",
  "Reaching your server",
  "Invite people",
];

// The onboarding invite is deliberately generous (a week, unlimited uses)
// so a link pasted into a group chat keeps working; it can be revoked from
// the space's Invite panel.
const ONBOARDING_INVITE_SECONDS = 7 * 24 * 60 * 60;

export function SetupPage() {
  const { data: status, isLoading } = useInstanceStatus();
  const [step, setStep] = useState<Step>(1);

  if (isLoading) {
    return <div className="login-page muted">Loading…</div>;
  }
  // Someone else already set the instance up (or this tab is stale).
  if (step === 1 && status && !status.needsSetup) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="login-page">
      <div className="login-card setup-card">
        <h1>Stoop</h1>
        <ol className="setup-steps">
          {STEPS.map((label, i) => {
            const n = (i + 1) as Step;
            const cls = n < step ? "done" : n === step ? "current" : "";
            return (
              <li key={label} className={cls}>
                {n}. {label}
              </li>
            );
          })}
        </ol>
        {step === 1 && <AccountStep onDone={() => setStep(2)} />}
        {step === 2 && <SpaceStep onDone={() => setStep(3)} />}
        {step === 3 && <ReachStep onDone={() => setStep(4)} />}
        {step === 4 && <InviteStep />}
      </div>
    </div>
  );
}

function errorText(err: unknown): string {
  return err instanceof ConnectError ? err.rawMessage : String(err);
}

function AccountStep({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authClient.register({ username, password });
      await authClient.login({ username, password });
      queryClient.clear();
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="login-card"
      style={{ padding: 0, border: 0 }}
      onSubmit={submit}
    >
      <p>
        <strong>Welcome to your new Stoop.</strong>
      </p>
      <p className="hint">
        This first account is the server admin: it manages server settings and
        has admin powers in every space. Pick a username you'll keep.
      </p>
      <LoginProviders redirect="/setup" />
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
          autoComplete="new-password"
          minLength={8}
          required
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" className="primary" disabled={busy}>
        Create admin account
      </button>
    </form>
  );
}

// Shared across steps 2 → 3 so the invite step knows where to land.
let createdSpace: { id: string; channelId: string; name: string } | null = null;

function SpaceStep({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await chatClient.createSpace({ name });
      if (!res.space || !res.defaultChannel) {
        throw new Error("space was created without a default channel");
      }
      createdSpace = {
        id: res.space.id,
        channelId: res.defaultChannel.id,
        name: res.space.name,
      };
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="login-card"
      style={{ padding: 0, border: 0 }}
      onSubmit={submit}
    >
      <p>
        <strong>Create your first space.</strong>
      </p>
      <p className="hint">
        A space is where your people hang out — it holds channels for text and
        voice. You can make more later.
      </p>
      <label>
        Space name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="The Porch"
          maxLength={100}
          required
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" className="primary" disabled={busy}>
        Create space
      </button>
    </form>
  );
}

function ReachStep({ onDone }: { onDone: () => void }) {
  return (
    <div className="login-card" style={{ padding: 0, border: 0 }}>
      <p>
        <strong>How will people reach this server?</strong>
      </p>
      <p className="hint">
        Right now it's reachable on this machine and its network. Pick what
        you'll put in front of it so invite links point at the right address and
        voice knows how to get through. You can change all of this later under
        Server admin.
      </p>
      <ReachabilityForm onSkip={onDone} />
    </div>
  );
}

function InviteStep() {
  const navigate = useNavigate();
  const { data: instanceStatus } = useInstanceStatus();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const space = createdSpace;

  if (!space) {
    return <Navigate to="/" replace />;
  }

  // Mint the invite once on first render of this step.
  if (link === null && error === null) {
    chatClient
      .createInvite({
        spaceId: space.id,
        expiresIn: { seconds: BigInt(ONBOARDING_INVITE_SECONDS) },
      })
      .then((res) => {
        if (res.invite)
          setLink(
            inviteLink(res.invite.code, space.name, instanceStatus?.publicUrl),
          );
      })
      .catch((err) => setError(errorText(err)));
  }

  const copy = () => {
    if (!link) return;
    navigator.clipboard.writeText(link).then(
      () => setCopied(true),
      () => setError("Couldn't copy to the clipboard"),
    );
  };

  const go = () =>
    navigate({
      to: "/s/$spaceId/c/$channelId",
      params: { spaceId: space.id, channelId: space.channelId },
      replace: true,
    });

  return (
    <div className="login-card" style={{ padding: 0, border: 0 }}>
      <p>
        <strong>Invite your people to {space.name}.</strong>
      </p>
      <p className="hint">
        Anyone with this link can create an account and join. It works for 7
        days; you can make more (or revoke this one) any time from the Invite
        button in your space.
      </p>
      {link ? (
        <div className="link-box">
          <code title={link}>{link}</code>
          <button type="button" className="chip" onClick={copy}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      ) : error ? (
        <p className="error">{error}</p>
      ) : (
        <p className="muted">Creating your invite…</p>
      )}
      <button type="button" className="primary" onClick={go}>
        Go to your space
      </button>
    </div>
  );
}
