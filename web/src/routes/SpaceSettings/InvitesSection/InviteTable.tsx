import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useMemo } from "react";
import {
  inviteLink,
  inviteStatus,
  inviteStatusLabel,
  usesText,
} from "../../../api/invites";
import { useInstanceStatus } from "../../../api/queries";
import { expiryOf } from "../../../api/tokenOptions";
import { CopyButton } from "../../../components/CopyButton";
import {
  DataTable,
  PersonCell,
  type TableColumn,
} from "../../../components/DataTable";
import { DotsMenu, type MenuItem } from "../../../components/DotsMenu";
import { dateAndTime, fullDateTime } from "../../../core/dates";
import type { Invite } from "../../../gen/stoop/chat/v1/invite_pb";
import { type Space, SpaceRole } from "../../../gen/stoop/chat/v1/space_pb";
import { notice } from "../../../stores/dialogs";
import { InviteUses } from "./InviteUses";

// Spent invites (revoked, expired, used up) stay behind the toolbar's
// switch; a search still finds them.
const spent = (invite: Invite) => inviteStatus(invite) !== "active";

// A row's name for the chevron and the confirm: its label, else its code.
export const inviteName = (invite: Invite) => invite.label || invite.code;

// The invites list: what each is, who made it, how far it has been used
// and when it runs out, with Copy link on the row and the rest in a menu.
// Opening a row shows who joined through it.
export function InviteTable({
  invites,
  space,
  manages,
  myId,
  onRevoke,
  rowError,
}: {
  invites: Invite[] | undefined;
  space: Space;
  // With invites.manage the list is everyone's, so it says who made each.
  manages: boolean;
  myId: string | undefined;
  onRevoke: (invite: Invite) => void;
  rowError: (invite: Invite) => string | null;
}) {
  const { data: instanceStatus } = useInstanceStatus();
  const publicUrl = instanceStatus?.publicUrl;

  const columns = useMemo<TableColumn<Invite>[]>(() => {
    const link = (invite: Invite) =>
      inviteLink(invite.code, space.name, publicUrl);
    const actionsFor = (invite: Invite): MenuItem[] => {
      const items: MenuItem[] = [
        {
          label: "Copy code",
          onSelect: async () => {
            try {
              await navigator.clipboard.writeText(invite.code);
            } catch {
              notice({ title: "Couldn't copy to the clipboard" });
              return false;
            }
          },
          done: "Copied!",
        },
      ];
      if (
        inviteStatus(invite) === "active" &&
        (manages || invite.createdBy === myId)
      ) {
        items.push({
          label: "Revoke",
          danger: true,
          onSelect: () => onRevoke(invite),
        });
      }
      return items;
    };
    const cols: TableColumn<Invite>[] = [
      {
        id: "invite",
        header: "Invite",
        accessorFn: (invite) => inviteName(invite).toLowerCase(),
        sortFn: "text",
        cell: ({ row: { original: invite } }) => (
          <div className="invite-cell">
            {invite.label ? (
              <strong className="invite-label">{invite.label}</strong>
            ) : (
              <span className="invite-label muted">No label</span>
            )}
            <code className="invite-code">
              {invite.code}
              {invite.role === SpaceRole.ADMIN && (
                <span
                  className="badge warn"
                  title="Made before admin invites were withdrawn; it still grants admin while its creator holds it"
                >
                  joins as admin
                </span>
              )}
            </code>
          </div>
        ),
      },
    ];
    if (manages) {
      cols.push({
        id: "creator",
        header: "Created by",
        accessorFn: (invite) =>
          invite.creator?.displayName || invite.creator?.username || "",
        sortFn: "text",
        meta: { width: "22%" },
        cell: ({ row: { original: invite } }) => (
          <PersonCell
            name={invite.creator?.displayName ?? ""}
            username={invite.creator?.username ?? "?"}
            avatarFileId={invite.creator?.avatarFileId}
            kind={invite.creator?.kind}
          />
        ),
      });
    }
    cols.push(
      {
        id: "uses",
        header: "Uses",
        accessorFn: (invite) => invite.useCount,
        meta: { width: 90 },
        cell: ({ row: { original: invite } }) => usesText(invite),
      },
      {
        id: "expires",
        header: "Expires",
        // Live ones by when they run out (never last); spent ones after.
        accessorFn: (invite) =>
          inviteStatus(invite) !== "active"
            ? Number.MAX_SAFE_INTEGER
            : invite.expiresAt
              ? timestampDate(invite.expiresAt).getTime()
              : Number.MAX_SAFE_INTEGER - 1,
        meta: { width: 190 },
        cell: ({ row: { original: invite } }) => {
          const status = inviteStatus(invite);
          if (status !== "active") {
            return (
              <span className={`badge ${status === "revoked" ? "danger" : ""}`}>
                {inviteStatusLabel(status)}
              </span>
            );
          }
          if (!invite.expiresAt) return "Never";
          // The moment itself; the warning colour when it is within a week.
          const at = timestampDate(invite.expiresAt);
          return (
            <span
              className={`invite-expiry ${expiryOf(at).state}`}
              title={fullDateTime(at)}
            >
              {dateAndTime(at)}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { width: 150, actions: true },
        cell: ({ row: { original: invite } }) => (
          <>
            {inviteStatus(invite) === "active" && (
              <CopyButton text={link(invite)} label="Copy link" />
            )}
            <DotsMenu
              label={`Options for ${inviteName(invite)}`}
              items={actionsFor(invite)}
            />
          </>
        ),
      },
    );
    return cols;
  }, [manages, myId, onRevoke, publicUrl, space.name]);

  return (
    <DataTable
      rows={invites}
      columns={columns}
      rowId={(invite) => invite.id}
      search={{
        placeholder: manages
          ? "Filter by label, code or creator"
          : "Filter by label or code",
        label: "Filter invites",
        text: (invite) =>
          `${invite.label} ${invite.code} ${invite.creator?.displayName ?? ""} @${invite.creator?.username ?? ""}`,
      }}
      noun={["invite", "invites"]}
      empty="No invites yet. Make one with New invite."
      hidden={{ label: "Show spent", when: spent }}
      rowInactive={spent}
      rowError={rowError}
      rowProps={(invite) => ({ "data-code": invite.code })}
      detail={{
        canExpand: (invite) => invite.useCount > 0,
        label: (invite) => `Who joined with ${inviteName(invite)}`,
        render: (invite) => <InviteUses invite={invite} />,
      }}
    />
  );
}
