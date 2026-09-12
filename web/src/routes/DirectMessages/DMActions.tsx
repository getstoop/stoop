import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  dmIsGroup,
  dmOthers,
  leaveDirectMessage,
  personName,
  useDirectMessages,
} from "../../api/dms";
import { errorText } from "../../api/errors";
import { useMe } from "../../api/queries";
import { NewConversation } from "../../components/NewConversation";
import { confirm, notice } from "../../stores/dialogs";

// What a conversation's own header can do: add people, and leave a group.
// A DM has no roles, so there is nothing else to manage.
export function DMActions({ channelId }: { channelId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: dms } = useDirectMessages();
  const { data: me } = useMe();
  const [adding, setAdding] = useState(false);
  const dm = dms?.find((d) => d.channel?.id === channelId);
  if (!dm) return null;
  const group = dmIsGroup(dm);

  const leave = async () => {
    const others = dmOthers(dm, me?.id).map(personName).join(", ");
    if (
      !(await confirm({
        title: "Leave this conversation?",
        body: `${others || "Nobody"} keeps it, and you won't see it again unless somebody adds you back.`,
        action: "Leave",
        danger: true,
      }))
    )
      return;
    try {
      await leaveDirectMessage(queryClient, channelId);
      navigate({ to: "/dm" });
    } catch (err) {
      notice({ title: "Couldn't leave", body: errorText(err) });
    }
  };

  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label="Add people"
        title="Add people"
        onClick={() => setAdding(true)}
      >
        +
      </button>
      {group && (
        <button type="button" className="chip dm-leave" onClick={leave}>
          Leave
        </button>
      )}
      {adding && (
        <NewConversation
          group={group ? channelId : undefined}
          carry={group ? [] : dmOthers(dm, me?.id).map((p) => p.id)}
          present={dm.participants.map((p) => p.id)}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}
