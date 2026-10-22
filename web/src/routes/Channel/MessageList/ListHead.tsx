import type { ReactNode } from "react";
import type { Message } from "../../../gen/stoop/chat/v1/message_pb";
import { FirstRunCard } from "../FirstRunCard";

// The view's older edge, the first virtual row: "Loading earlier
// messages…" while a page is in flight, the beginning marker once there
// is nothing older (with the first-run card under it in a channel), or a
// thread's root above the count of its replies. Measured like any row, so
// its contents changing moves the rows below it, never the view.
export function ListHead({
  index,
  top,
  measure,
  atStart,
  loading,
  threadRoot,
  rootRow,
  replyCount,
  channelId,
  channelName,
  channelLabel,
  dm,
  group,
  retentionNote,
}: {
  index: number;
  top: number;
  measure: (element: HTMLDivElement | null) => void;
  // The view has had its first page and nothing lies older.
  atStart: boolean;
  // A page or a jump is out for the view.
  loading: boolean;
  threadRoot?: Message;
  // The root's rendered row, when this is a thread's head.
  rootRow?: ReactNode;
  replyCount: number;
  channelId: string;
  channelName: string;
  channelLabel?: ReactNode;
  dm: boolean;
  group: boolean;
  retentionNote: string;
}) {
  return (
    <div
      className="message-list-head"
      data-index={index}
      ref={measure}
      style={{ top }}
    >
      {!(threadRoot && atStart) && (
        <div
          className={`history-head ${atStart ? "history-start" : ""}`}
          data-state={atStart ? "start" : loading ? "loading" : "idle"}
        >
          {atStart ? (
            <span>
              {group ? (
                "Beginning of this conversation"
              ) : dm ? (
                `Beginning of your conversation with ${channelName}`
              ) : (
                <>Beginning of {channelLabel ?? channelName}</>
              )}
              {retentionNote && (
                <>
                  {" · "}
                  <strong>{retentionNote}</strong>
                </>
              )}
            </span>
          ) : loading ? (
            "Loading earlier messages…"
          ) : null}
        </div>
      )}
      {!threadRoot && atStart && <FirstRunCard channelId={channelId} />}
      {threadRoot && atStart && (
        <>
          {rootRow}
          <div className="day-divider eyebrow">
            <span>{replyCountLabel(replyCount)}</span>
          </div>
        </>
      )}
    </div>
  );
}

function replyCountLabel(count: number): string {
  if (count === 0) return "No replies yet";
  return `${count} ${count === 1 ? "reply" : "replies"}`;
}
