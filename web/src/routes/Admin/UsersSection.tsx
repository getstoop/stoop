import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useMemo, useRef } from "react";
import { isBot } from "../../api/identity";
import { useInstanceUsers } from "../../api/queries";
import { AddToSpaceModal } from "../../components/AddToSpaceModal";
import { BotMark } from "../../components/BotMark";
import { CopyButton } from "../../components/CopyButton";
import { DataTable, type TableColumn } from "../../components/DataTable";
import { DotsMenu } from "../../components/DotsMenu";
import { InstanceRole } from "../../gen/stoop/auth/v1/auth_pb";
import type { InstanceUser } from "../../gen/stoop/instance/v1/user_pb";
import { notice } from "../../stores/dialogs";
import { UserTokens } from "./UserTokens";
import { useAccountActions } from "./useAccountActions";

// Owner, admins, members: sorted by rank, not by the word.
const rank = (u: InstanceUser) =>
  u.owner ? 2 : u.role === InstanceRole.ADMIN ? 1 : 0;

export function UsersSection({ meId }: { meId: string }) {
  const { data: users } = useInstanceUsers(true);
  const actions = useAccountActions(users, meId);
  // The hook rebuilds actionsFor every render; the columns reach it
  // through a ref so they can stay stable.
  const actionsFor = useRef(actions.actionsFor);
  actionsFor.current = actions.actionsFor;

  const columns = useMemo<TableColumn<InstanceUser>[]>(
    () => [
      {
        id: "account",
        header: "Account",
        accessorFn: (u) => u.displayName || u.username,
        cell: ({ row: { original: u } }) => (
          <AccountCell user={u} self={u.id === meId} />
        ),
      },
      {
        id: "role",
        header: "Role",
        accessorFn: (u) => -rank(u),
        meta: { width: "16%" },
        cell: ({ row: { original: u } }) =>
          u.owner ? (
            <span className="badge" title="Owns this server">
              owner
            </span>
          ) : u.role === InstanceRole.ADMIN ? (
            <span className="badge">admin</span>
          ) : (
            "Member"
          ),
      },
      {
        id: "tokens",
        header: "Tokens",
        accessorFn: (u) => u.personalTokenCount,
        meta: { width: "14%" },
        cell: ({ row: { original: u } }) =>
          isBot(u.kind) ? (
            <span title="Under Integrations">—</span>
          ) : u.personalTokenCount > 0 ? (
            `${u.personalTokenCount} token${u.personalTokenCount === 1 ? "" : "s"}`
          ) : (
            "None"
          ),
      },
      {
        id: "joined",
        header: "Joined",
        accessorFn: (u) =>
          u.createdAt ? timestampDate(u.createdAt).getTime() : 0,
        meta: { width: "16%" },
        cell: ({ row: { original: u } }) =>
          u.createdAt && timestampDate(u.createdAt).toLocaleDateString(),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { width: 64, actions: true },
        cell: ({ row: { original: u } }) =>
          u.id !== meId && (
            <DotsMenu
              label={`Actions for @${u.username}`}
              items={actionsFor.current(u)}
            />
          ),
      },
    ],
    [meId],
  );

  return (
    <section className="card accounts-section">
      <h3>Accounts</h3>
      <DataTable
        rows={users}
        columns={columns}
        rowId={(u) => u.id}
        search={{
          placeholder: "Filter by name or @username",
          label: "Filter accounts",
          text: (u) => `${u.displayName} @${u.username}`,
        }}
        noun={["account", "accounts"]}
        empty="No accounts yet."
        rowInactive={(u) => !!u.deactivatedAt}
        rowError={(u) =>
          actions.failed && actions.failed.userId === u.id
            ? actions.failed.text
            : null
        }
        rowProps={(u) => ({ "data-kind": isBot(u.kind) ? "bot" : "person" })}
        detail={{
          canExpand: (u) => !isBot(u.kind) && u.personalTokenCount > 0,
          label: (u) => `Tokens of @${u.username}`,
          render: (u) => <UserTokens user={u} />,
        }}
      />
      {actions.tempPassword && (
        <div className="temp-password" role="status">
          <p>
            Temporary password for{" "}
            <strong>@{actions.tempPassword.username}</strong> — pass it on now;
            it isn't shown again. They've been signed out everywhere and should
            change it on their profile page.
          </p>
          <div className="card-row">
            <code>{actions.tempPassword.password}</code>
            <CopyButton text={actions.tempPassword.password} />
            <button
              type="button"
              className="chip"
              onClick={actions.clearTempPassword}
            >
              Done
            </button>
          </div>
        </div>
      )}
      {actions.addingTo && (
        <AddToSpaceModal
          user={actions.addingTo}
          onClose={actions.doneAdding}
          onAdded={(spaceName) => {
            const who =
              actions.addingTo?.displayName || `@${actions.addingTo?.username}`;
            actions.doneAdding();
            notice({ title: `Added ${who} to ${spaceName}.` });
          }}
        />
      )}
    </section>
  );
}

function AccountCell({ user: u, self }: { user: InstanceUser; self: boolean }) {
  return (
    <>
      <strong>
        {u.displayName || u.username}
        <BotMark kind={u.kind} />
        {self && <span className="badge">you</span>}
        {u.deletedAt ? (
          <span className="badge">deleted</span>
        ) : (
          u.deactivatedAt && <span className="badge">deactivated</span>
        )}
        {u.usernameFrozen && <span className="badge">name frozen</span>}
      </strong>
      <span className="dt-subline muted small">
        @{u.username}
        {isBot(u.kind) && <> · bot</>}
        {u.pronouns && <> · {u.pronouns}</>}
      </span>
    </>
  );
}
