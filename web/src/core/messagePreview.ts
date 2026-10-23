import type { Message } from "../gen/stoop/chat/v1/message_pb";
import { plainText } from "./markdown";

// One-line form of a message, for a reply strip or an activity preview:
// its text, or its first file's name when it has none, as the server
// previews a quote (internal/chat previewText). Web's and the phone's
// composers both say it this way.
export function messagePreview(message: Message): string {
  const text = plainText(message.content);
  if (text) return text;
  const first = message.attachments[0];
  if (!first) return "";
  return first.expired ? "📎 Expired attachment" : `📎 ${first.name}`;
}
