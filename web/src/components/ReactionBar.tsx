import { useQueryClient } from "@tanstack/react-query";
import { usePeople } from "../api/dms";
import { emojiName } from "../api/emoji";
import { useMe } from "../api/queries";
import { toggleReaction } from "../api/reactions";
import type { Message } from "../gen/stoop/chat/v1/message_pb";

// The row of reaction chips under a message: "👍 3", highlighted when the
// viewer is among the reactors, tooltip naming them. Clicking toggles the
// viewer's own reaction (optimistically).
export function ReactionBar({
  message,
  spaceId,
}: {
  message: Message;
  spaceId: string;
}) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const members = usePeople(spaceId, message.channelId);
  if (message.reactions.length === 0) return null;

  const nameOf = (id: string) => {
    const m = members?.find((x) => x.userId === id);
    return m ? m.displayName || m.username : "someone";
  };

  return (
    <div className="reaction-bar">
      {message.reactions.map((r) => {
        const mine = !!me && r.userIds.includes(me.id);
        const names = r.userIds.map(nameOf);
        return (
          <button
            key={r.emoji}
            type="button"
            className={`reaction-chip${mine ? " mine" : ""}`}
            title={`${listNames(names)} reacted with ${emojiName(r.emoji)}`}
            aria-label={`${r.emoji} ${r.userIds.length}, ${listNames(names)}`}
            aria-pressed={mine}
            onClick={() =>
              me && toggleReaction(queryClient, message, r.emoji, me.id)
            }
          >
            <span className="reaction-emoji">{r.emoji}</span>
            <span className="reaction-count">{r.userIds.length}</span>
          </button>
        );
      })}
    </div>
  );
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
