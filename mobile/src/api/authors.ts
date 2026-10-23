import type { MessageAuthor } from "@stoop/gen/stoop/chat/v1/message_pb";

// Who a message is from, as the rows and the composer name them: their
// display name, else their username; "Someone" for an author the server
// left off the row.
export const authorName = (author: MessageAuthor | undefined): string =>
  author ? author.displayName || author.username : "Someone";
