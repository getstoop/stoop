import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import {
  useInstanceStatus,
  useMe,
  usePersonalTokens,
  useSpaces,
} from "../../api/queries";
import {
  describePermissions,
  expiryOf,
  lastUsedText,
  whereText,
} from "../../api/tokenOptions";
import { ListHead } from "../../components/ListHead";
import {
  InstanceRole,
  type PersonalToken,
} from "../../gen/stoop/auth/v1/auth_pb";
import { PersonalTokens } from "../../gen/stoop/instance/v1/instance_pb";
import { confirm } from "../../stores/dialogs";
import { NewTokenModal } from "./NewTokenModal";
import { TokenCreatedModal } from "./TokenCreatedModal";

// Security → Personal tokens: a person's own tokens for scripts, each with
// only the permissions it was given (docs/proposals/access-model.md).
export function PersonalTokensSection() {
  const queryClient = useQueryClient();
  const { data: tokens } = usePersonalTokens();
  const { data: spaces } = useSpaces();
  const { data: status } = useInstanceStatus();
  const { data: me } = useMe();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{
    name: string;
    secret: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setting = status?.personalTokens ?? PersonalTokens.EVERYONE;
  const allowed =
    setting === PersonalTokens.EVERYONE ||
    (setting === PersonalTokens.ADMINS && me?.role === InstanceRole.ADMIN);
  const nameOf = (id: string) => spaces?.find((s) => s.id === id)?.name;

  const revoke = async (t: PersonalToken) => {
    const expired =
      expiryOf(t.expiresAt && timestampDate(t.expiresAt)).state === "expired";
    if (
      !expired &&
      !(await confirm({
        title: `Revoke “${t.name}”?`,
        body: "Anything using it stops working straight away.",
        action: "Revoke",
        danger: true,
      }))
    ) {
      return;
    }
    setError(null);
    try {
      await authClient.revokePersonalToken({ tokenId: t.id });
      await queryClient.invalidateQueries({ queryKey: ["personal-tokens"] });
    } catch (err) {
      setError(errorText(err));
    }
  };

  const hasTokens = (tokens?.length ?? 0) > 0;
  if (!allowed && !hasTokens) {
    return (
      <section className="card personal-tokens">
        <h3>Personal access tokens</h3>
        <p className="hint">
          {setting === PersonalTokens.OFF
            ? "Personal tokens are turned off on this server."
            : "Only server admins can use personal tokens on this server."}
        </p>
      </section>
    );
  }

  return (
    <section className="card personal-tokens">
      <h3>Personal access tokens</h3>
      <p className="hint">
        A token lets a script act as you, with only the permissions you give it.
        It can never change your password, link an account or make another
        token.
      </p>
      {!allowed && (
        <p className="hint">
          {setting === PersonalTokens.OFF
            ? "Personal tokens are turned off on this server, so these don't work right now."
            : "Only server admins can use personal tokens on this server, so these don't work right now."}
        </p>
      )}
      {tokens && tokens.length === 0 && (
        <p className="muted small">No tokens yet.</p>
      )}
      {hasTokens && (
        <ul className="user-list table tokens">
          <ListHead columns={["Name", "Can", "Last used", "Expires", ""]} />
          {tokens?.map((t) => {
            const expiry = expiryOf(t.expiresAt && timestampDate(t.expiresAt));
            const expired = expiry.state === "expired";
            return (
              <li
                key={t.id}
                className={`user-row ${expired ? "inactive" : ""}`}
                data-token={t.name}
              >
                <div className="user-row-main">
                  <strong>{t.name}</strong>
                  <span className="muted small">
                    <code>…{t.hint}</code>
                  </span>
                </div>
                <span className="user-cell">
                  {describePermissions(t.permissions).join(", ")}
                  {t.limited && (
                    <span className="muted small">
                      {" "}
                      · limited to {whereText(t, nameOf)}
                    </span>
                  )}
                </span>
                <span className="user-cell">
                  {lastUsedText(t.lastUsedAt && timestampDate(t.lastUsedAt))}
                </span>
                <span className="user-cell">
                  {t.blocked ? (
                    <span className="badge">blocked</span>
                  ) : expired ? (
                    <span className="badge">expired</span>
                  ) : expiry.state === "soon" ? (
                    <span className="badge token-soon">{expiry.text}</span>
                  ) : (
                    expiry.text
                  )}
                </span>
                <div className="user-row-actions">
                  <button
                    type="button"
                    className="chip danger"
                    onClick={() => revoke(t)}
                  >
                    {expired ? "Remove" : "Revoke"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
      {allowed && (
        <div className="setting-actions">
          <button
            type="button"
            className="primary"
            onClick={() => setCreating(true)}
          >
            New token
          </button>
        </div>
      )}
      {creating && (
        <NewTokenModal
          onClose={() => setCreating(false)}
          onCreated={(name, secret) => {
            setCreating(false);
            setCreated({ name, secret });
          }}
        />
      )}
      {created && (
        <TokenCreatedModal
          name={created.name}
          secret={created.secret}
          onClose={() => setCreated(null)}
        />
      )}
    </section>
  );
}
