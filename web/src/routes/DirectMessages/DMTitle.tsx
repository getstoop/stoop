import {
  dmFaces,
  dmIsGroup,
  dmOther,
  dmTitle,
  personName,
  useDirectMessages,
} from "../../api/dms";
import { useMe } from "../../api/queries";
import { presenceClass } from "../../api/status";
import { AvatarStack } from "../../components/AvatarStack";
import { useConnectionStore } from "../../stores/connection";

// The channel header for a DM: the other person with their presence, or a
// group's faces and how many people are in it. A group has no name of its
// own, so the title is made from who is in it (api/dms.ts → dmTitle).
export function DMTitle({ channelId }: { channelId: string }) {
  const { data: dms } = useDirectMessages();
  const { data: me } = useMe();
  const dm = dms?.find((d) => d.channel?.id === channelId);
  const group = !!dm && dmIsGroup(dm);
  const other = dm && !group ? dmOther(dm, me?.id) : undefined;
  const otherId = other?.id ?? "";
  const isOnline = useConnectionStore(
    (s) => otherId !== "" && s.online.has(otherId),
  );
  const status = useConnectionStore((s) => s.presence[otherId]);
  if (!dm) return <span className="channel-hash">…</span>;
  const title = dmTitle(dm, me?.id);
  return (
    <span className="dm-title">
      <AvatarStack people={dmFaces(dm, me?.id)} name={title} size="small">
        {isOnline && <span className={`online-dot ${presenceClass(status)}`} />}
      </AvatarStack>
      <span className="channel-title">{title}</span>
      {group ? (
        <span
          className="muted dm-handle"
          title={dm.participants.map(personName).join(", ")}
        >
          {dm.participants.length} people
        </span>
      ) : (
        other && <span className="muted dm-handle">@{other.username}</span>
      )}
    </span>
  );
}
