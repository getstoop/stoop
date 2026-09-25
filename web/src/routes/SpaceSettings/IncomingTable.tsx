import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useMemo, useRef } from "react";
import { canNotifyEveryone, hookCanText } from "../../api/integrations";
import { lastUsedText } from "../../api/tokenOptions";
import { Avatar } from "../../components/Avatar";
import {
  DataTable,
  StateCell,
  type TableColumn,
} from "../../components/DataTable";
import { DotsMenu } from "../../components/DotsMenu";
import type { Secret } from "../../components/Integrations/SecretModal";
import { useIncomingActions } from "../../components/Integrations/useIncomingActions";
import { Switch } from "../../components/Switch";
import { IdentityKind } from "../../gen/stoop/access/v1/access_pb";
import type { Member } from "../../gen/stoop/chat/v1/member_pb";
import { SpaceRole } from "../../gen/stoop/chat/v1/space_pb";
import type { IncomingWebhook } from "../../gen/stoop/integrations/v1/webhook_pb";

// What posts into this space: a row per webhook, with the bot it posts
// as under its name.
export function IncomingTable({
  hooks,
  members,
  channelName,
  manage,
  onSecret,
}: {
  hooks: IncomingWebhook[] | undefined;
  members: Member[] | undefined;
  channelName: (id: string) => string;
  manage: boolean;
  onSecret: (secret: Secret) => void;
}) {
  const actions = useIncomingActions(onSecret);
  const view = { members, channelName, actions };
  const latest = useRef(view);
  latest.current = view;

  const columns = useMemo<TableColumn<IncomingWebhook>[]>(() => {
    const cols: TableColumn<IncomingWebhook>[] = [
      {
        id: "webhook",
        header: "Webhook",
        accessorFn: (h) => h.name,
        cell: ({ row: { original: h } }) => (
          <HookCell
            hook={h}
            bot={latest.current.members?.find((m) => m.userId === h.botUserId)}
          />
        ),
      },
      {
        id: "channel",
        header: "Channel",
        accessorFn: (h) => latest.current.channelName(h.channelId),
        meta: { width: "16%" },
        cell: ({ row: { original: h } }) =>
          `#${latest.current.channelName(h.channelId)}`,
      },
      {
        id: "notify",
        header: "Notify all",
        enableSorting: false,
        meta: manage ? { width: 110, align: "center" } : { width: "18%" },
        cell: ({ row: { original: h } }) =>
          manage ? (
            <Switch
              name={`notify-${h.id}`}
              checked={canNotifyEveryone(h)}
              disabled={!h.enabled}
              onChange={(e) =>
                latest.current.actions.setNotify(h, e.target.checked)
              }
              aria-label={`${h.name} may notify everyone`}
            />
          ) : (
            hookCanText(h)
          ),
      },
      {
        id: "state",
        header: "State",
        accessorFn: (h) => (h.enabled ? 0 : 1),
        meta: { width: "20%" },
        cell: ({ row: { original: h } }) => (
          <StateCell on={h.enabled} reason={h.disabledReason} />
        ),
      },
      {
        id: "used",
        header: "Last used",
        accessorFn: (h) =>
          h.lastUsedAt ? timestampDate(h.lastUsedAt).getTime() : 0,
        meta: { width: "12%" },
        cell: ({ row: { original: h } }) =>
          lastUsedText(h.lastUsedAt && timestampDate(h.lastUsedAt)),
      },
    ];
    if (manage) {
      cols.push({
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { width: 140, actions: true },
        cell: ({ row: { original: h } }) => {
          const a = latest.current.actions;
          return (
            <>
              <button
                type="button"
                className="chip"
                onClick={() => a.toggle(h)}
              >
                {h.enabled ? "Turn off" : "Turn on"}
              </button>
              <DotsMenu
                label={`Actions for ${h.name}`}
                items={[
                  { label: "Rename", onSelect: () => a.rename(h) },
                  { label: "Rotate URL", onSelect: () => a.rotate(h) },
                  {
                    label: "Delete",
                    danger: true,
                    onSelect: () => a.remove(h),
                  },
                ]}
              />
            </>
          );
        },
      });
    }
    return cols;
  }, [manage]);

  return (
    <DataTable
      rows={hooks}
      columns={columns}
      rowId={(h) => h.id}
      noun={["webhook", "webhooks"]}
      empty="Nothing posts into this space yet."
      rowInactive={(h) => !h.enabled}
      rowError={(h) =>
        actions.failed && actions.failed.id === h.id
          ? actions.failed.text
          : null
      }
      rowProps={(h) => ({ "data-hook": h.name })}
    />
  );
}

function HookCell({ hook, bot }: { hook: IncomingWebhook; bot?: Member }) {
  const standing = !bot
    ? "not in this space"
    : bot.role === SpaceRole.ADMIN
      ? "admin"
      : null;
  return (
    <div className="dt-person">
      <Avatar
        name={bot?.displayName || bot?.username || hook.name}
        fileId={bot?.avatarFileId}
        kind={IdentityKind.BOT}
        size="small"
      />
      <div>
        <strong>{hook.name}</strong>
        <span className="muted small">
          as @{bot?.username ?? "bot"}
          {standing && <> · {standing}</>}
          {hook.hint && <> · …{hook.hint}</>}
        </span>
      </div>
    </div>
  );
}
