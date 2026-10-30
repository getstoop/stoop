import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { chatClient } from "../../../api/clients";
import { errorText } from "../../../api/errors";
import { useInvites, useMe } from "../../../api/queries";
import { PlusIcon } from "../../../components/Icons";
import { canManageInvites } from "../../../core/permissions";
import type { Invite } from "../../../gen/stoop/chat/v1/invite_pb";
import type { Space } from "../../../gen/stoop/chat/v1/space_pb";
import { confirm } from "../../../stores/dialogs";
import { InviteTable } from "./InviteTable";
import { NewInviteModal } from "./NewInviteModal";

// Space settings → Invites: where invites are made, copied and revoked.
// Open to anyone who may invite; who sees whose follows invites.manage
// (docs/architecture/permissions.md → Invites): an admin sees everyone's,
// a member who may invite only their own.
export function InvitesSection({ space }: { space: Space }) {
  const queryClient = useQueryClient();
  const { data: invites } = useInvites(space.id);
  const { data: me } = useMe();
  const [creating, setCreating] = useState(false);
  // The last failed action, shown on the row it was for.
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(
    null,
  );
  const manages = canManageInvites(space);

  const revoke = useCallback(
    async (invite: Invite) => {
      const ok = await confirm({
        title: `Revoke ${invite.label ? `“${invite.label}”` : invite.code}?`,
        body: "Nobody new can join with it. People who already joined stay.",
        action: "Revoke",
        danger: true,
      });
      if (!ok) return;
      setFailed(null);
      try {
        await chatClient.revokeInvite({ inviteId: invite.id });
        await queryClient.invalidateQueries({
          queryKey: ["invites", space.id],
        });
      } catch (err) {
        setFailed({ id: invite.id, text: errorText(err) });
      }
    },
    [queryClient, space.id],
  );

  return (
    <>
      <section className="card">
        <div className="invites-head">
          <h3>Invites</h3>
          <button
            type="button"
            className="primary"
            onClick={() => setCreating(true)}
          >
            <PlusIcon />
            New invite
          </button>
        </div>
        <p className="hint">
          {manages
            ? `Everyone's invites to ${space.name}. Anyone with a link joins as a member; make them an admin from Members once they're in.`
            : `Invites you made. Anyone with a link joins ${space.name} as a member.`}
        </p>
        <InviteTable
          invites={invites}
          space={space}
          manages={manages}
          myId={me?.id}
          onRevoke={revoke}
          rowError={(invite) =>
            failed && failed.id === invite.id ? failed.text : null
          }
        />
      </section>
      {creating && (
        <NewInviteModal space={space} onClose={() => setCreating(false)} />
      )}
    </>
  );
}
