import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { instanceClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useUserTokens } from "../../api/queries";
import {
  describePermissions,
  expiryOf,
  lastUsedText,
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
  const [error, setError] = useState<string | null>(null);

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
    <div data-tokens-of={user.username}>
      {isLoading && <p className="muted small">Loading…</p>}
      {tokens && tokens.length > 0 && (
        <table className="dt-sub">
          <colgroup>
            <col style={{ width: "22%" }} />
            <col />
            <col style={{ width: "16%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: 90 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Can</th>
              <th scope="col">Last used</th>
              <th scope="col">Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => {
              const expiry = expiryOf(
                t.expiresAt && timestampDate(t.expiresAt),
              );
              return (
                <tr key={t.id}>
                  <td className="dt-primary">{t.name}</td>
                  <td>{describePermissions(t.permissions).join(", ")}</td>
                  <td>
                    {lastUsedText(t.lastUsedAt && timestampDate(t.lastUsedAt))}
                  </td>
                  <td>{t.blocked ? "blocked" : expiry.text}</td>
                  <td className="dt-actions">
                    <button
                      type="button"
                      className="chip danger"
                      onClick={() => revoke(t)}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {tokens && tokens.length === 0 && (
        <p className="muted small">No tokens.</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
