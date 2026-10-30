// Helpers shared by the invites page and the join flows.

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import type { Invite } from "../gen/stoop/chat/v1/invite_pb";
import { serverOrigin } from "./origin";

// Accepts a bare code, a pasted /join/<code> link, or either with stray
// whitespace, and returns just the code.
export function parseInviteCode(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/join\/([^/?#\s]+)/);
  return (match ? match[1] : trimmed).trim();
}

// Display-only hint so /join can name the space in its "Joining …" line
// without waiting on a lookup. It's untrusted and may be absent (older
// or hand-edited links), so readers must fall back gracefully — the
// login landing asks the server instead (LookupInvite).
const MAX_SPACE_HINT = 100;

// origin is the server's configured public address when it has one, so
// an admin on the LAN doesn't hand out a link that only works on the LAN.
export function inviteLink(
  code: string,
  spaceName?: string,
  origin: string = serverOrigin(),
): string {
  const url = new URL(`/join/${code}`, origin || serverOrigin());
  if (spaceName)
    url.searchParams.set("space", spaceName.slice(0, MAX_SPACE_HINT));
  return url.toString();
}

// Whether a lookup failed because the invite itself is gone (unknown,
// revoked, expired or used up), rather than for a reason worth retrying.
export function inviteGone(err: unknown): boolean {
  return (
    err instanceof ConnectError &&
    (err.code === Code.NotFound ||
      err.code === Code.FailedPrecondition ||
      err.code === Code.ResourceExhausted)
  );
}

export type InviteStatus = "active" | "revoked" | "expired" | "exhausted";

// Why an invite can't be used, or that it can. Revoked wins over expired
// over used up, the order a reader cares about: a revoked one was
// stopped on purpose.
export function inviteStatus(
  invite: Pick<Invite, "revokedAt" | "expiresAt" | "maxUses" | "useCount">,
  now: Date = new Date(),
): InviteStatus {
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt && timestampDate(invite.expiresAt) <= now) {
    return "expired";
  }
  if (invite.maxUses !== undefined && invite.useCount >= invite.maxUses) {
    return "exhausted";
  }
  return "active";
}

// The word for a spent invite's state.
export function inviteStatusLabel(status: Exclude<InviteStatus, "active">) {
  switch (status) {
    case "revoked":
      return "Revoked";
    case "expired":
      return "Expired";
    default:
      return "Used up";
  }
}

// "3 of 10", or the count alone for an unlimited invite.
export function usesText(invite: Pick<Invite, "maxUses" | "useCount">) {
  return invite.maxUses === undefined
    ? String(invite.useCount)
    : `${invite.useCount} of ${invite.maxUses}`;
}
