import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ConnectError } from "@connectrpc/connect";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { chatClient } from "../api/clients";
import { inviteLink } from "../api/invites";
import { grantableRoles, roleLabel } from "../api/permissions";
import { useInstanceStatus, useInvites, useMe } from "../api/queries";
import type { Invite } from "../gen/stoop/chat/v1/invite_pb";
import { type Space, SpaceRole } from "../gen/stoop/chat/v1/space_pb";
import { Modal } from "./Modal";

// Expiry presets, in seconds. 0 = never.
const EXPIRY_OPTIONS: { label: string; seconds: number }[] = [
  { label: "Never", seconds: 0 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "1 day", seconds: 24 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
  { label: "30 days", seconds: 30 * 24 * 60 * 60 },
];

export function InviteModal({
  space,
  onClose,
}: {
  space: Space;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const { data: instanceStatus } = useInstanceStatus();
  const { data: invites, isLoading } = useInvites(space.id);
  const [expiry, setExpiry] = useState(EXPIRY_OPTIONS[3].seconds);
  const [maxUses, setMaxUses] = useState("");
  const [role, setRole] = useState<SpaceRole>(SpaceRole.MEMBER);
  const roles = grantableRoles(space);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["invites", space.id] });

  const createInvite = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const uses = maxUses.trim() === "" ? undefined : Number(maxUses);
      if (uses !== undefined && (!Number.isInteger(uses) || uses < 1)) {
        throw new Error("Max uses must be a whole number of at least 1");
      }
      const res = await chatClient.createInvite({
        spaceId: space.id,
        expiresIn: expiry > 0 ? { seconds: BigInt(expiry) } : undefined,
        maxUses: uses,
        role,
      });
      await refresh();
      if (res.invite) copy(res.invite.code, res.invite.id);
    } catch (err) {
      setError(err instanceof ConnectError ? err.rawMessage : String(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (invite: Invite) => {
    setError(null);
    try {
      await chatClient.revokeInvite({ inviteId: invite.id });
      await refresh();
    } catch (err) {
      setError(err instanceof ConnectError ? err.rawMessage : String(err));
    }
  };

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(key);
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
      },
      () => setError("Couldn't copy to the clipboard"),
    );
  };

  return (
    <Modal title={`Invite people to ${space.name}`} onClose={onClose}>
      <form className="invite-form" onSubmit={createInvite}>
        <label>
          Expires after
          <select
            value={expiry}
            onChange={(e) => setExpiry(Number(e.target.value))}
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.seconds} value={o.seconds}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Max uses
          <input
            type="number"
            min={1}
            step={1}
            placeholder="Unlimited"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
          />
        </label>
        <label>
          Joins as
          <select
            value={role}
            onChange={(e) => setRole(Number(e.target.value) as SpaceRole)}
            disabled={roles.length < 2}
            title={
              roles.length < 2
                ? "You can only invite people at your own role"
                : undefined
            }
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="primary" disabled={busy}>
          Create invite
        </button>
      </form>
      {error && <p className="error">{error}</p>}

      <ul className="invite-list">
        {isLoading && <li className="muted">Loading…</li>}
        {invites?.length === 0 && (
          <li className="muted">No invites yet — create one above.</li>
        )}
        {invites?.map((invite) => {
          const status = inviteStatus(invite);
          const canRevoke =
            status === "active" &&
            (me?.id === invite.createdBy || me?.id === space.ownerId);
          return (
            <li
              key={invite.id}
              className={`invite-row ${status === "active" ? "" : "inactive"}`}
            >
              <div className="invite-main">
                <code className="invite-code">{invite.code}</code>
                <span className="invite-meta muted">
                  {describeInvite(invite, status)}
                </span>
              </div>
              <div className="invite-actions">
                <button
                  type="button"
                  className="chip"
                  onClick={() => copy(invite.code, invite.id)}
                  title="Copy invite code"
                >
                  {copied === invite.id ? "Copied!" : "Copy code"}
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() =>
                    copy(
                      inviteLink(
                        invite.code,
                        space.name,
                        instanceStatus?.publicUrl,
                      ),
                      `${invite.id}:link`,
                    )
                  }
                  title="Copy join link"
                >
                  {copied === `${invite.id}:link` ? "Copied!" : "Copy link"}
                </button>
                {canRevoke && (
                  <button
                    type="button"
                    className="chip danger"
                    onClick={() => revoke(invite)}
                    title="Revoke this invite"
                  >
                    Revoke
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

type InviteStatus = "active" | "revoked" | "expired" | "exhausted";

function inviteStatus(invite: Invite): InviteStatus {
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt && timestampDate(invite.expiresAt) <= new Date()) {
    return "expired";
  }
  if (invite.maxUses !== undefined && invite.useCount >= invite.maxUses) {
    return "exhausted";
  }
  return "active";
}

function describeInvite(invite: Invite, status: InviteStatus): string {
  const uses =
    invite.maxUses === undefined
      ? `${invite.useCount} uses`
      : `${invite.useCount}/${invite.maxUses} uses`;
  const joinsAs = `joins as ${roleLabel(invite.role)}`;
  switch (status) {
    case "revoked":
      return `Revoked · ${uses}`;
    case "expired":
      return `Expired · ${uses}`;
    case "exhausted":
      return `All uses claimed · ${uses}`;
    default: {
      const expires = invite.expiresAt
        ? `expires ${timestampDate(invite.expiresAt).toLocaleString()}`
        : "never expires";
      return `${joinsAs} · ${uses} · ${expires}`;
    }
  }
}
