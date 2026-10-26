import { canDeleteAnyMessage } from "@stoop/core/permissions";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { createContext, useMemo } from "react";

// What the screen showing the messages knows that their cards need: the
// server's origins (api/instance useServerStatus), to leave out a link to
// one of its messages as web does; whether the reader moderates the
// space, who with the author may take a card off (DeleteMessage's rule,
// as on web); and how to. Without it every card shows and none has a ×.
export type LinkPreviewActions = {
  origins: string[];
  canModerate: boolean;
  dismiss: (message: Message, url: string) => void;
};

export const LinkPreviewsContext = createContext<LinkPreviewActions | null>(null);

export function useLinkPreviewActions(
  origins: string[],
  space: Space | undefined,
  dismiss: (message: Message, url: string) => void,
): LinkPreviewActions {
  const canModerate = !!space && canDeleteAnyMessage(space);
  return useMemo(() => ({ origins, canModerate, dismiss }), [origins, canModerate, dismiss]);
}
