import { useMemo, useRef } from "react";
import {
  DataTable,
  PersonCell,
  StateCell,
  type TableColumn,
} from "../../components/DataTable";
import { DotsMenu } from "../../components/DotsMenu";
import { IdentityKind } from "../../gen/stoop/access/v1/access_pb";
import type { Bot, BotToken } from "../../gen/stoop/integrations/v1/bot_pb";
import type { IncomingWebhook } from "../../gen/stoop/integrations/v1/webhook_pb";
import { BotCredentials } from "./BotCredentials";

const isDeactivated = (b: Bot) => !!b.deactivatedAt;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Every bot on the server. Its tokens and webhooks open under its row;
// deactivated bots wait behind the toolbar's switch.
export function BotsTable({
  bots,
  hooks,
  spaceName,
  failed,
  onNewToken,
  onEdit,
  onDeactivate,
  onRevoke,
}: {
  bots: Bot[] | undefined;
  hooks: IncomingWebhook[] | undefined;
  spaceName: (id: string) => string | undefined;
  failed: { id: string; text: string } | null;
  onNewToken: (bot: Bot) => void;
  onEdit: (bot: Bot) => void;
  onDeactivate: (bot: Bot) => void;
  onRevoke: (bot: Bot, token: BotToken) => void;
}) {
  const hooksOf = (b: Bot) => hooks?.filter((h) => h.botUserId === b.id) ?? [];
  const view = { hooksOf, spaceName, onNewToken, onEdit, onDeactivate };
  const latest = useRef(view);
  latest.current = view;

  const columns = useMemo<TableColumn<Bot>[]>(
    () => [
      {
        id: "bot",
        header: "Bot",
        accessorFn: (b) => b.displayName || b.username,
        cell: ({ row: { original: b } }) => (
          <PersonCell
            name={b.displayName}
            username={b.username}
            avatarFileId={b.avatarFileId}
            kind={IdentityKind.BOT}
          />
        ),
      },
      {
        id: "credentials",
        header: "Credentials",
        enableSorting: false,
        meta: { width: "24%" },
        cell: ({ row: { original: b } }) => {
          if (b.deactivatedAt) return "Deactivated";
          const own = latest.current.hooksOf(b);
          const off = own.filter((h) => !h.enabled).length;
          if (own.length === 0 && b.tokens.length === 0) return "None";
          return (
            <>
              {[
                own.length > 0 && plural(own.length, "webhook"),
                b.tokens.length > 0 && plural(b.tokens.length, "token"),
              ]
                .filter(Boolean)
                .join(", ")}
              {off > 0 && (
                <span className="dt-subline">
                  <StateCell on={false} reason={`${off} off`} />
                </span>
              )}
            </>
          );
        },
      },
      {
        id: "spaces",
        header: "Spaces",
        enableSorting: false,
        meta: { width: "22%" },
        cell: ({ row: { original: b } }) =>
          b.spaceIds.length === 0
            ? "None yet"
            : b.spaceIds
                .map((id) => latest.current.spaceName(id) ?? "a space")
                .join(", "),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { width: 170, actions: true },
        cell: ({ row: { original: b } }) => {
          if (b.deactivatedAt) return null;
          const v = latest.current;
          return (
            <>
              <button
                type="button"
                className="chip"
                onClick={() => v.onNewToken(b)}
              >
                New token
              </button>
              <DotsMenu
                label={`Actions for @${b.username}`}
                items={[
                  { label: "Edit", onSelect: () => v.onEdit(b) },
                  {
                    label: "Deactivate",
                    danger: true,
                    onSelect: () => v.onDeactivate(b),
                  },
                ]}
              />
            </>
          );
        },
      },
    ],
    [],
  );

  return (
    <DataTable
      rows={bots}
      columns={columns}
      rowId={(b) => b.id}
      search={{
        placeholder: "Filter by name or @username",
        label: "Filter bots",
        text: (b) => `${b.displayName} @${b.username}`,
      }}
      noun={["bot", "bots"]}
      empty="No bots yet."
      hidden={{ label: "Show deactivated", when: isDeactivated }}
      rowInactive={isDeactivated}
      rowError={(b) => (failed && failed.id === b.id ? failed.text : null)}
      rowProps={(b) => ({ "data-bot": b.username })}
      detail={{
        canExpand: (b) => b.tokens.length > 0 || hooksOf(b).length > 0,
        label: (b) => `Tokens and webhooks of @${b.username}`,
        render: (b) => (
          <BotCredentials
            tokens={b.tokens}
            hooks={hooksOf(b)}
            onRevoke={(t) => onRevoke(b, t)}
          />
        ),
      }}
    />
  );
}
