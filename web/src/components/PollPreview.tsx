import { pollPreview } from "../core/polls";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import { PollIcon } from "./Icons";
import { marked } from "./MessageBody";

// A poll, or its closing row, where a message is shown in brief (a pin, a
// search result, a linked message's card): its one-line preview, "Poll:"
// and the question as typed, never as Markdown. Nothing for another row.
// highlight marks a search's terms.
export function PollPreview({
  message,
  highlight,
}: {
  message: Message;
  highlight?: RegExp | null;
}) {
  const preview = pollPreview(message);
  if (preview === null) return null;
  return (
    <span className="poll-preview">
      <PollIcon />
      <span>{marked(preview, highlight)}</span>
    </span>
  );
}
