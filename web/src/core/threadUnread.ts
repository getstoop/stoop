import type { Message, ThreadSummary } from "../gen/stoop/chat/v1/message_pb";
import type { ThreadOverlay } from "./channelLog";

// The reader's own half of a thread summary as replies arrive. The server
// fills it per request; between requests each client moves it on from the
// shared half a ThreadChanged carries (docs/architecture/messaging.md →
// Threads): a reply by someone else adds to the count of a thread the
// reader is in and hasn't muted, and reading it clears it.

// Whether a reply names the reader, which counts them in to its thread
// when its ThreadChanged lands (@channel and @here don't).
export function namesMe(message: Message, me: string | undefined): boolean {
  return (
    !!message.threadRootId &&
    !!me &&
    !message.mentionsEntireChannel &&
    !message.mentionsHere &&
    message.mentionUserIds.includes(me)
  );
}

// The reader's half after a new shared summary (next) for the held root:
// namedIn is whether a reply since named them (namesMe).
export function viewerHalfAfter(
  root: Message,
  next: ThreadSummary,
  me: string | undefined,
  namedIn: boolean,
): Required<ThreadOverlay> {
  // A first reply has no summary to carry: the root says whether we
  // started it or were named in it (@channel and @here don't count).
  const previous = root.thread ?? {
    replyCount: 0,
    participating:
      root.author?.id === me ||
      (!root.mentionsEntireChannel &&
        !root.mentionsHere &&
        !!me &&
        root.mentionUserIds.includes(me)),
    muted: false,
    unreadCount: 0,
  };
  const added = next.replyCount - previous.replyCount;
  const byMe = next.recentAuthors[0]?.id === me;
  const participating =
    previous.participating || (added > 0 && byMe) || namedIn;
  const counts = participating && !previous.muted;
  return {
    participating,
    muted: previous.muted,
    unreadCount: Math.min(
      next.replyCount,
      previous.unreadCount + (counts && added > 0 && !byMe ? added : 0),
    ),
  };
}
