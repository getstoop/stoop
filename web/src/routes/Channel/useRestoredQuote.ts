import { useEffect, useState } from "react";
import { hasOpened, useRow, useView } from "../../api/channelLog";
import type { Message } from "../../gen/stoop/chat/v1/message_pb";

// The quote of a shown draft belongs to the screen, which owns the reply
// (docs/architecture/messaging.md → The composer): once the log has its first page, the reply
// is the quoted message if it is held there and not deleted, and nothing
// otherwise. A draft with no quote clears the reply at once. Returns the
// setter the composer calls with the stored quote's id, or none.
export function useRestoredQuote(
  channelId: string,
  rootId: string | undefined,
  setReply: (message: Message | null) => void,
): (messageId: string | undefined) => void {
  const [pending, setPending] = useState<{ messageId?: string } | null>(null);
  const opened = hasOpened(useView(channelId, rootId));
  const quoted = useRow(channelId, pending?.messageId ?? "");
  useEffect(() => {
    if (!pending) return;
    if (pending.messageId && !opened) return;
    setReply(quoted && !quoted.deleted ? quoted : null);
    setPending(null);
  }, [pending, opened, quoted, setReply]);
  return (messageId) => setPending({ messageId });
}
