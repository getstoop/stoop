import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  removeChannelPerson,
  useAllChannels,
  useChannelPeople,
} from "../../api/channelPeople";
import { chatClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { canManageChannels } from "../../api/permissions";
import { channelsQuery, useMe, useMembers, useSpaces } from "../../api/queries";
import type { Member } from "../../gen/stoop/chat/v1/member_pb";
import { confirm, notice } from "../../stores/dialogs";
import { memberName } from "../MembersPanel/groups";
import { SidePanelFrame, SidePanelUnavailable } from "../SidePanel";
import { useCloseSidePanel } from "../SidePanel/context";
import { AddPeopleModal } from "./AddPeopleModal";
import { PersonRow } from "./PersonRow";

export { PeopleButton } from "./PeopleButton";

// The side panel's list of who is in a private channel. Someone who
// manages the space's channels adds and removes people here; anyone in
// it can leave.
export function ChannelPeople({ params }: { params: Record<string, string> }) {
  const spaceId = params.spaceId ?? "";
  const channelId = params.channelId ?? "";
  const queryClient = useQueryClient();
  const close = useCloseSidePanel();
  const { data: me } = useMe();
  const { data: spaces } = useSpaces();
  const { data: members } = useMembers(spaceId);
  // The sidebar already holds this list; a refetch here would drop read
  // markers the cache has moved ahead of the server.
  const { data: channels } = useQuery({
    ...channelsQuery(spaceId),
    refetchOnMount: false,
  });
  const space = spaces?.find((candidate) => candidate.id === spaceId);
  const manages = !!space && canManageChannels(space);
  const joined = channels?.find((candidate) => candidate.id === channelId);
  // Someone who manages channels opens this from Space settings for a
  // channel they are not in, which their own list does not hold.
  const { data: all } = useAllChannels(
    spaceId,
    manages && !!channels && !joined,
  );
  const channel =
    joined ?? all?.find((row) => row.channel?.id === channelId)?.channel;
  const { data: ids } = useChannelPeople(channelId, !!channel);
  const [adding, setAdding] = useState(false);

  if (channels && !channel && (!manages || all)) {
    return (
      <SidePanelFrame title="People">
        <SidePanelUnavailable message="You are no longer in this channel." />
      </SidePanelFrame>
    );
  }

  const byId = new Map(
    (members ?? []).map((member) => [member.userId, member]),
  );
  const people = (ids ?? [])
    .map((id) => byId.get(id))
    .filter((member): member is Member => !!member);
  const inChannel = new Set(ids ?? []);
  const outside = (members ?? []).filter(
    (member) => !inChannel.has(member.userId),
  );
  const remove = async (member: Member) => {
    const ok = await confirm({
      title: `Remove ${memberName(member)} from ${channel?.name}?`,
      body: "They won't see this channel or anything in it until someone adds them again.",
      action: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeChannelPerson(queryClient, channelId, member.userId);
    } catch (err) {
      notice({ title: "Couldn't remove them", body: errorText(err) });
    }
  };

  const leave = async () => {
    const ok = await confirm({
      title: `Leave ${channel?.name}?`,
      body: "You won't see this channel or anything in it. Coming back takes someone who manages channels adding you.",
      action: "Leave channel",
      danger: true,
    });
    if (!ok) return;
    try {
      await chatClient.leaveChannel({ channelId });
      await queryClient.invalidateQueries({ queryKey: ["channels", spaceId] });
      close();
    } catch (err) {
      notice({ title: "Couldn't leave the channel", body: errorText(err) });
    }
  };

  // The dialog sits outside the frame, whose Escape closes the panel.
  return (
    <>
      <SidePanelFrame
        title="People"
        subtitle={
          channel
            ? `${channel.name}${ids ? ` · ${ids.length}` : ""}`
            : undefined
        }
        footer={
          joined && (
            <div className="people-foot">
              <button type="button" className="chip danger" onClick={leave}>
                Leave channel
              </button>
            </div>
          )
        }
      >
        {manages && (
          <div className="people-bar">
            <button
              type="button"
              className="chip"
              onClick={() => setAdding(true)}
            >
              Add people
            </button>
          </div>
        )}
        <ul className="people-list">
          {people.map((member) => (
            <PersonRow
              key={member.userId}
              member={member}
              self={member.userId === me?.id}
              onRemove={manages ? () => remove(member) : undefined}
            />
          ))}
        </ul>
      </SidePanelFrame>
      {adding && channel && (
        <AddPeopleModal
          channel={channel}
          spaceName={space?.name ?? "the space"}
          candidates={outside}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}
