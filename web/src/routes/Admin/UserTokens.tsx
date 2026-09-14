import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { instanceClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useSpaces, useUserTokens } from "../../api/queries";
import {
  describePermissions,
  expiryOf,
  lastUsedText,
  whereText,
} from "../../api/tokenOptions";
import type { PersonalToken } from "../../gen/stoop/auth/v1/auth_pb";
import type { InstanceUser } from "../../gen/stoop/instance/v1/user_pb";
import { confirm } from "../../stores/dialogs";

// An account's personal tokens, opened from its row in Accounts: names,
// permissions and dates — never the token, which isn't stored — each
// revocable.
export function UserTokens({ user }: { user: InstanceUser }) {
  const queryClient = useQueryClient();
  const { data: tokens, isLoading } = useUserTokens(user.id, true);
  const { data: spaces } = useSpaces();
  const [error, setError] = useState<string | null>(null);
  const nameOf = (id: string) => spaces?.find((s) => s.id === id)?.name;

  const revoke = async (t: PersonalToken) => {
    const ok = await confirm({
      title: `Revoke @${user.username}'s “${t.name}”?`,
      body: "Anything using it stops working straight away. They can make another.",
      action: "Revoke",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await instanceClient.revokeUserToken({ userId: user.id, tokenId: t.id });
      await queryClient.invalidateQueries({
        queryKey: ["user-tokens", user.id],
      });
      await queryClient.invalidateQueries({ queryKey: ["instance-users"] });
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <li className="user-tokens" data-tokens-of={user.username}>
      {isLoading && <p className="muted small">Loading…</p>}
      {tokens?.map((t) => {
        const expiry = expiryOf(t.expiresAt && timestampDate(t.expiresAt));
        return (
          <div key={t.id} className="user-token-row">
            <strong>{t.name}</strong>
            <span>
              {describePermissions(t.permissions).join(", ")}
              {t.limited && <> · limited to {whereText(t, nameOf)}</>}
            </span>
            <span className="muted">
              {lastUsedText(t.lastUsedAt && timestampDate(t.lastUsedAt))}
            </span>
            <span className="muted">{t.blocked ? "blocked" : expiry.text}</span>
            <button
              type="button"
              className="chip danger"
              onClick={() => revoke(t)}
            >
              Revoke
            </button>
          </div>
        );
      })}
      {tokens && tokens.length === 0 && (
        <p className="muted small">No tokens.</p>
      )}
      {error && <p className="error">{error}</p>}
    </li>
  );
}
