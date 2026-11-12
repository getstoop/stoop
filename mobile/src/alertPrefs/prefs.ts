import { ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";

// What this phone alerts about, kept on the device alone: which kinds of
// activity show a banner, and whether a banner says the message. The
// same for every server on it.

export type AlertPrefs = {
  // A mention, or a reply to the person's own message.
  mentions: boolean;
  directMessages: boolean;
  // A new reply in a thread the person is in.
  threads: boolean;
  // Off, a banner says where and not who or what.
  showText: boolean;
};

// The switches that decide a kind of activity.
export type KindSwitches = Pick<AlertPrefs, "mentions" | "directMessages" | "threads">;

// Everything on: what rang before there were switches goes on ringing.
export const DEFAULT_PREFS: AlertPrefs = { mentions: true, directMessages: true, threads: true, showText: true };

// The prefs as they were saved. What can't be understood is the
// defaults, and so is a single value that isn't a boolean, so a partly
// bad or older save keeps what it can.
export function parsePrefs(raw: string | null): AlertPrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const saved = JSON.parse(raw) as Record<string, unknown>;
    if (typeof saved !== "object" || saved === null) return DEFAULT_PREFS;
    const read = (key: keyof AlertPrefs) => (typeof saved[key] === "boolean" ? (saved[key] as boolean) : DEFAULT_PREFS[key]);
    return {
      mentions: read("mentions"),
      directMessages: read("directMessages"),
      threads: read("threads"),
      showText: read("showText"),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

// Whether a kind of activity may show a banner. A kind that fits no
// switch (an unspecified one, or one a newer server adds) is not held
// back: it keeps ringing.
export function kindAlerts(prefs: KindSwitches, kind: number): boolean {
  switch (kind) {
    case ActivityKind.MENTION:
    case ActivityKind.REPLY:
      return prefs.mentions;
    case ActivityKind.DM:
      return prefs.directMessages;
    case ActivityKind.THREAD_REPLY:
      return prefs.threads;
    default:
      return true;
  }
}
