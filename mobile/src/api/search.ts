import { Code, ConnectError } from "@connectrpc/connect";
import { SEARCH_REFUSALS } from "@stoop/core/search";
import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import type { SearchMessagesResponse } from "@stoop/gen/stoop/chat/v1/chat_pb";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { authClient, chatClient } from "./clients";
import { errorText } from "./errors";

// The search screen (screens/Search): the space it searches, for its
// name in the field's label and the channels its rows name, and the
// pages of matches, newest first, the server parsing the query
// (docs/architecture/messaging.md → Search). The words to highlight and
// the channel chips' filter are core/search, shared with web.

const TIMEOUT_MS = 10000;

export type SearchScope = {
  space: Space;
  // Every channel of the space, in the server's order, for a result's
  // "in #name" and the chip's filter.
  channels: Channel[];
  myUserId: string;
};

export async function loadSearchScope(origin: string, token: string, spaceId: string): Promise<SearchScope> {
  const chat = chatClient(origin, token);
  const options = { timeoutMs: TIMEOUT_MS };
  const [{ space }, { channels }, { user }] = await Promise.all([
    chat.getSpace({ spaceId }, options),
    chat.listChannels({ spaceId }, options),
    authClient(origin, token).getMe({}, options),
  ]);
  if (!space || !user) throw new Error("The server answered with nothing.");
  return { space, channels, myUserId: user.id };
}

// One page of matches: the newest, or the page before beforeId.
export function searchMessages(
  origin: string,
  token: string,
  spaceId: string,
  query: string,
  beforeId = "",
): Promise<SearchMessagesResponse> {
  return chatClient(origin, token).searchMessages(
    { scope: { case: "spaceId", value: spaceId }, query, beforeId },
    { timeoutMs: TIMEOUT_MS },
  );
}

// What to tell the person when a search fails, as web's
// api/search.ts words it: the guards' refusals in core's words, and
// otherwise the server's own.
export function searchErrorText(err: unknown): string {
  if (err instanceof ConnectError) {
    if (err.code === Code.ResourceExhausted) return SEARCH_REFUSALS.tooMany;
    if (err.code === Code.DeadlineExceeded) return SEARCH_REFUSALS.tooLong;
  }
  return errorText(err);
}
