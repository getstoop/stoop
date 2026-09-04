import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { editChannelTopic } from "../api/channels";
import { canManageChannels } from "../api/permissions";
import { type Channel, ChannelKind } from "../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import { Modal } from "./Modal";

// The channel's topic in full, for when the header could only show a
// slice of it. Opened by clicking that slice; the twin of SpaceAbout.
export function ChannelAbout({
  channel,
  space,
  onClose,
}: {
  channel: Channel;
  space?: Space;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const manage = !!space && canManageChannels(space);
  const kind =
    channel.kind === ChannelKind.VOICE ? "Voice channel" : "Text channel";
  return (
    <Modal title={`About #${channel.name}`} onClose={onClose}>
      <div className="channel-about">
        {channel.topic ? (
          <p>{channel.topic}</p>
        ) : (
          <p className="muted">
            {manage
              ? "This channel hasn't said what it's for yet."
              : "This channel hasn't said what it's for."}
          </p>
        )}
        <p className="muted small">
          {kind}
          {channel.createdAt &&
            ` · created ${timestampDate(channel.createdAt).toLocaleDateString()}`}
        </p>
      </div>
      {manage && (
        <footer className="modal-actions">
          <button
            type="button"
            className="chip"
            onClick={() => {
              onClose();
              editChannelTopic(channel, queryClient);
            }}
          >
            {channel.topic ? "Edit topic" : "Add a topic"}
          </button>
        </footer>
      )}
    </Modal>
  );
}
