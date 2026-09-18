import { timestampDate } from "@bufbuild/protobuf/wkt";
import { hookCanText } from "../../api/integrations";
import {
  BOT_TOKEN_OPTIONS,
  describePermissions,
  lastUsedText,
} from "../../api/tokenOptions";
import { StateCell } from "../../components/DataTable";
import type { BotToken } from "../../gen/stoop/integrations/v1/bot_pb";
import type { IncomingWebhook } from "../../gen/stoop/integrations/v1/webhook_pb";

// A bot's tokens and webhooks, opened under its row in Bots. Tokens are
// revoked here; webhooks are changed from their space's settings.
export function BotCredentials({
  tokens,
  hooks,
  onRevoke,
}: {
  tokens: BotToken[];
  hooks: IncomingWebhook[];
  onRevoke: (token: BotToken) => void;
}) {
  return (
    <table className="dt-sub">
      <colgroup>
        <col style={{ width: "22%" }} />
        <col style={{ width: "12%" }} />
        <col />
        <col style={{ width: "12%" }} />
        <col style={{ width: "14%" }} />
        <col style={{ width: 90 }} />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Kind</th>
          <th scope="col">Reaches / can</th>
          <th scope="col">Key</th>
          <th scope="col">Last used</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {tokens.map((t) => (
          <tr key={t.id} data-token={t.name}>
            <td className="dt-primary">{t.name}</td>
            <td>Token</td>
            <td>
              {describePermissions(t.permissions, BOT_TOKEN_OPTIONS).join(", ")}
            </td>
            <td>…{t.hint}</td>
            <td>{lastUsedText(t.lastUsedAt && timestampDate(t.lastUsedAt))}</td>
            <td className="dt-actions">
              <button
                type="button"
                className="chip danger"
                onClick={() => onRevoke(t)}
              >
                Revoke
              </button>
            </td>
          </tr>
        ))}
        {hooks.map((h) => (
          <tr key={h.id} data-hook={h.name}>
            <td className="dt-primary">{h.name}</td>
            <td>Webhook</td>
            <td>
              {h.spaceName} · {hookCanText(h)}
              {!h.enabled && (
                <span className="dt-subline">
                  <StateCell on={false} reason={h.disabledReason} />
                </span>
              )}
            </td>
            <td>…{h.hint}</td>
            <td>{lastUsedText(h.lastUsedAt && timestampDate(h.lastUsedAt))}</td>
            <td />
          </tr>
        ))}
      </tbody>
    </table>
  );
}
