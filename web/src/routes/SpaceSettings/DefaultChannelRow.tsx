import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { defaultChannelChoices } from "../../api/channels";
import { chatClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { SettingRow } from "../../components/SettingRow";
import type { Channel } from "../../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";

// Where the space puts someone who arrives without a channel of their
// own: a new member following an invite, or anyone opening /s/{id} with
// nothing after it. Unset — "First channel" — is what every space did
// before this setting existed.
export function DefaultChannelRow({
  space,
  channels,
}: {
  space: Space;
  channels: Channel[];
}) {
  const queryClient = useQueryClient();
  const choices = defaultChannelChoices(channels);
  // A default naming a channel that isn't here is one that was deleted
  // without us hearing the event yet. Show it as unset, which is where
  // arrivals are already going.
  const current = choices.some((c) => c.id === space.defaultChannelId)
    ? space.defaultChannelId
    : "";
  // The value comes from the server, so without somewhere to hold the
  // pick it would snap back to the old channel until the save lands.
  // Holding it also closes the control while one save is in flight, so
  // two quick picks can't finish out of order.
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (channelId: string) => {
    setError(null);
    setPending(channelId);
    try {
      await chatClient.updateSpace({
        spaceId: space.id,
        defaultChannelId: channelId,
      });
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(null);
    }
  };

  return (
    <SettingRow
      id="default-channel"
      title="New members start in"
      description="Where an invite lands someone, and where the space opens when no channel is chosen."
      error={error}
    >
      <select
        id="default-channel"
        name="default-channel"
        value={pending ?? current}
        disabled={pending !== null}
        onChange={(e) => choose(e.target.value)}
      >
        <option value="">First channel</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            # {c.name}
          </option>
        ))}
      </select>
    </SettingRow>
  );
}
