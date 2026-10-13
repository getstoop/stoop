import { useQuery } from "@tanstack/react-query";
import { mutedByCaller } from "../../api/mutes";
import { channelsQuery, useSpaces } from "../../api/queries";
import { SidePanelFrame, SidePanelUnavailable } from "../SidePanel";
import { MutedRow } from "./MutedRow";

export { MutedBar } from "./MutedBar";

// The side panel's list of the text channels the reader muted in one
// space, which the sidebar leaves out. docs/architecture/messaging.md →
// Mutes.
export function MutedChannels({ params }: { params: Record<string, string> }) {
  const spaceId = params.spaceId ?? "";
  const { data: spaces } = useSpaces();
  // The sidebar already holds this list; a refetch here would drop read
  // markers the cache has moved ahead of the server.
  const { data: channels } = useQuery({
    ...channelsQuery(spaceId),
    refetchOnMount: false,
  });
  const space = spaces?.find((candidate) => candidate.id === spaceId);
  const muted = channels?.filter(mutedByCaller) ?? [];

  return (
    <SidePanelFrame title="Muted channels" subtitle={space?.name}>
      {spaces && !space ? (
        <SidePanelUnavailable message="You are no longer in this space." />
      ) : muted.length === 0 ? (
        <p className="muted-empty">No muted channels.</p>
      ) : (
        <ul className="muted-list">
          {muted.map((channel) => (
            <MutedRow key={channel.id} channel={channel} />
          ))}
        </ul>
      )}
    </SidePanelFrame>
  );
}
