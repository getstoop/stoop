import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { isAnnouncement, setAnnouncement } from "../../api/channels";
import { DataTable, type TableColumn } from "../../components/DataTable";
import { DotsMenu } from "../../components/DotsMenu";
import { CheckIcon } from "../../components/Icons";
import { SpeakerIcon } from "../../components/VoiceIcons";
import { type Channel, ChannelKind } from "../../gen/stoop/chat/v1/channel_pb";

// One kind's channels, in the order the sidebar shows them: drag a row's
// handle to move it. Only text channels can be announcement channels, so
// the voice table leaves that column out.
export function ChannelTable({
  kind,
  channels,
  total,
  onEdit,
  onDelete,
  onReorder,
  rowError,
}: {
  kind: ChannelKind;
  // undefined while loading.
  channels: Channel[] | undefined;
  // Every channel in the space: the last one can't be deleted.
  total: number;
  onEdit: (channel: Channel) => void;
  onDelete: (channel: Channel) => void;
  onReorder: (channelIds: string[]) => void;
  rowError: (channel: Channel) => string | null;
}) {
  const queryClient = useQueryClient();
  const voice = kind === ChannelKind.VOICE;

  // The cells read this render's state and handlers through a ref, so
  // the columns stay stable.
  const latest = useRef({ total, onEdit, onDelete });
  latest.current = { total, onEdit, onDelete };

  const columns = useMemo<TableColumn<Channel>[]>(() => {
    // The column says which channels are announcement channels; the row's
    // menu is what changes one.
    const announcement: TableColumn<Channel> = {
      id: "announcement",
      header: "Announcement",
      meta: { width: 130, align: "center" },
      cell: ({ row: { original: c } }) =>
        isAnnouncement(c) ? (
          <span className="dt-yes" role="img" aria-label="Yes">
            <CheckIcon />
          </span>
        ) : (
          <span role="img" aria-label="No">
            —
          </span>
        ),
    };
    return [
      {
        id: "channel",
        header: "Channel",
        meta: { width: "24%" },
        cell: ({ row: { original: c } }) => (
          <strong className="dt-channel">
            {voice ? <SpeakerIcon /> : "#"} {c.name}
          </strong>
        ),
      },
      {
        id: "topic",
        header: "Topic",
        cell: ({ row: { original: c } }) => c.topic || "No topic",
      },
      ...(voice ? [] : [announcement]),
      {
        id: "actions",
        header: "",
        meta: { width: 60, actions: true },
        cell: ({ row: { original: c } }) => {
          const v = latest.current;
          return (
            <DotsMenu
              label={`Actions for #${c.name}`}
              items={[
                { label: "Edit", onSelect: () => v.onEdit(c) },
                ...(voice
                  ? []
                  : [
                      {
                        label: isAnnouncement(c)
                          ? "Make open chat channel"
                          : "Make announcement channel",
                        onSelect: () =>
                          setAnnouncement(
                            c,
                            !isAnnouncement(c),
                            queryClient,
                            true,
                          ),
                      },
                    ]),
                {
                  label: "Delete",
                  danger: true,
                  disabled: v.total <= 1,
                  title:
                    v.total <= 1
                      ? "A space needs at least one channel"
                      : "Delete channel",
                  onSelect: () => v.onDelete(c),
                },
              ]}
            />
          );
        },
      },
    ];
  }, [queryClient, voice]);

  return (
    <DataTable
      rows={channels}
      columns={columns}
      rowId={(c) => c.id}
      noun={
        voice ? ["voice channel", "voice channels"] : ["channel", "channels"]
      }
      empty={voice ? "No voice channels yet." : "No text channels yet."}
      ordered
      reorder={{
        label: (c) => `Reorder #${c.name}`,
        onReorder,
      }}
      rowError={rowError}
    />
  );
}
