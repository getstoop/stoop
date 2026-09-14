import { Permission } from "../gen/stoop/access/v1/access_pb";

// The token pickers' choices: a few permissions under one plain label,
// grouped by where they apply. The server holds the real list; this is
// only how it's offered. People and bots get different sets, phrased for
// each: a person's token is offered only what they hold somewhere; a
// bot's token is offered what a member holds, plus the server group when
// the bot is an instance admin, and never the account actions a bot is
// refused (profile, DMs, mutes).
//
// Deliberately offered to nobody, and listed by name if a token somehow
// holds one: SPACE_TRANSFER and SPACE_DELETE (one-off, destructive, done
// in the app); for bots also SPACES_CREATE, SPACES_JOIN_ANY and
// DMS_REACH_ANYONE, which the server refuses a bot.

export type TokenGroup = "space" | "account" | "server";

export type TokenOption = {
  key: string;
  label: string;
  hint?: string;
  group: TokenGroup;
  permissions: Permission[];
};

export const TOKEN_OPTIONS: TokenOption[] = [
  {
    key: "read",
    label: "Read messages",
    hint: "and see channels and members",
    group: "space",
    permissions: [Permission.SPACE_READ, Permission.MESSAGES_READ],
  },
  {
    key: "post",
    label: "Post messages",
    hint: "and edit, react to and delete its own",
    group: "space",
    permissions: [Permission.MESSAGES_POST],
  },
  {
    key: "voice",
    label: "Join voice",
    group: "space",
    permissions: [Permission.VOICE_JOIN],
  },
  {
    key: "invites",
    label: "Create invites",
    hint: "and revoke its own",
    group: "space",
    permissions: [Permission.INVITES_CREATE],
  },
  {
    key: "invites-manage",
    label: "Revoke anyone's invites",
    group: "space",
    permissions: [Permission.INVITES_MANAGE],
  },
  {
    key: "everyone",
    label: "Mention everyone",
    group: "space",
    permissions: [Permission.MESSAGES_NOTIFY_EVERYONE],
  },
  {
    key: "moderate",
    label: "Delete other people's messages",
    group: "space",
    permissions: [Permission.MESSAGES_MODERATE],
  },
  {
    key: "channels",
    label: "Manage channels",
    group: "space",
    permissions: [Permission.CHANNELS_MANAGE],
  },
  {
    key: "members",
    label: "Manage members",
    group: "space",
    permissions: [Permission.MEMBERS_MANAGE],
  },
  {
    key: "space",
    label: "Change space settings",
    group: "space",
    permissions: [Permission.SPACE_MANAGE],
  },
  {
    key: "dms-read",
    label: "Read direct messages",
    group: "account",
    permissions: [Permission.DMS_READ],
  },
  {
    key: "dms-post",
    label: "Send direct messages",
    group: "account",
    permissions: [Permission.DMS_POST],
  },
  {
    key: "activity",
    label: "Read activity",
    group: "account",
    permissions: [Permission.ACTIVITY_READ],
  },
  {
    key: "profile",
    label: "Change your profile",
    group: "account",
    permissions: [Permission.PROFILE_MANAGE],
  },
  {
    key: "preferences",
    label: "Change mutes and blocks",
    group: "account",
    permissions: [Permission.PREFERENCES_MANAGE],
  },
  {
    key: "instance-read",
    label: "View server administration",
    group: "server",
    permissions: [Permission.INSTANCE_READ],
  },
  {
    key: "instance-settings",
    label: "Change server settings",
    group: "server",
    permissions: [Permission.INSTANCE_SETTINGS_MANAGE],
  },
  {
    key: "instance-users",
    label: "Manage accounts",
    group: "server",
    permissions: [Permission.INSTANCE_USERS_MANAGE],
  },
  {
    key: "instance-integrations",
    label: "Manage bots and webhooks",
    group: "server",
    permissions: [Permission.INSTANCE_INTEGRATIONS_MANAGE],
  },
  {
    key: "instance-files",
    label: "Manage file storage",
    group: "server",
    permissions: [Permission.INSTANCE_FILES_MANAGE],
  },
  {
    key: "spaces-create",
    label: "Create spaces",
    group: "server",
    permissions: [Permission.SPACES_CREATE],
  },
  {
    key: "spaces-join-any",
    label: "Join any space without an invite",
    group: "server",
    permissions: [Permission.SPACES_JOIN_ANY],
  },
  {
    key: "dms-reach-anyone",
    label: "Message people you don't share a space with",
    group: "server",
    permissions: [Permission.DMS_REACH_ANYONE],
  },
];

export const GROUP_LABELS: Record<TokenGroup, string> = {
  space: "In spaces",
  account: "Your account",
  server: "On this server",
};

// A bot's token: the space options in a bot's words, one thing about
// itself, and the server group for an instance-admin bot.
const BOT_SPACE_KEYS = [
  "read",
  "post",
  "everyone",
  "moderate",
  "voice",
  "invites",
  "invites-manage",
  "channels",
  "members",
  "space",
];
const BOT_SERVER_KEYS = [
  "instance-read",
  "instance-settings",
  "instance-users",
  "instance-integrations",
  "instance-files",
];

export const BOT_TOKEN_OPTIONS: TokenOption[] = [
  ...TOKEN_OPTIONS.filter((o) => BOT_SPACE_KEYS.includes(o.key)),
  {
    key: "activity",
    label: "Read its mentions and replies",
    group: "account",
    permissions: [Permission.ACTIVITY_READ],
  },
  ...TOKEN_OPTIONS.filter((o) => BOT_SERVER_KEYS.includes(o.key)),
];

export const BOT_GROUP_LABELS: Record<TokenGroup, string> = {
  space: "In the spaces it's in",
  account: "About itself",
  server: "On this server",
};

// The options a bot's token may be offered: everything a member holds in
// its spaces, plus the server group when the bot is an instance admin.
export function botOptions(bot: { instanceAdmin: boolean }): TokenOption[] {
  return BOT_TOKEN_OPTIONS.filter(
    (o) => o.group !== "server" || bot.instanceAdmin,
  );
}

// Options whose every permission the person holds somewhere.
export function heldOptions(held: Iterable<Permission>): TokenOption[] {
  const have = new Set(held);
  return TOKEN_OPTIONS.filter((o) => o.permissions.every((p) => have.has(p)));
}

// The permissions behind the chosen options, deduplicated.
export function permissionsFor(keys: Iterable<string>): Permission[] {
  const chosen = new Set(keys);
  const out = new Set<Permission>();
  for (const o of TOKEN_OPTIONS) {
    if (chosen.has(o.key)) {
      for (const p of o.permissions) out.add(p);
    }
  }
  return [...out];
}

export function canCreate(form: { name: string; keys: string[] }): boolean {
  return form.name.trim() !== "" && permissionsFor(form.keys).length > 0;
}

// The labels a token's permissions add up to, for a list. A permission
// no option covers is still named, from the enum, so a row never reads
// blank.
export function describePermissions(
  permissions: Iterable<Permission>,
  options: TokenOption[] = TOKEN_OPTIONS,
): string[] {
  const have = new Set(permissions);
  const matched = options.filter((o) =>
    o.permissions.every((p) => have.has(p)),
  );
  const covered = new Set(matched.flatMap((o) => o.permissions));
  const rest = [...have]
    .filter((p) => !covered.has(p) && p !== Permission.UNSPECIFIED)
    .map(permissionName);
  return [...matched.map((o) => o.label), ...rest];
}

// PERMISSION_SPACE_DELETE → "space delete": the action, in words.
export function permissionName(p: Permission): string {
  return (Permission[p] ?? "unknown").toLowerCase().replace(/_/g, " ");
}

// Where a token made before the space limit was withdrawn still works,
// naming the spaces the viewer knows. New tokens are never limited.
export function whereText(
  token: { limited: boolean; spaceIds: string[] },
  nameOf: (id: string) => string | undefined,
): string {
  if (!token.limited) return "Everywhere";
  if (token.spaceIds.length === 0) return "Nowhere — its spaces are gone";
  const names = token.spaceIds.map(nameOf);
  if (names.every((n) => n !== undefined)) return names.join(", ");
  const n = token.spaceIds.length;
  return `${n} space${n === 1 ? "" : "s"}`;
}

export const EXPIRY_CHOICES = [
  { days: 30, label: "In 30 days" },
  { days: 90, label: "In 90 days" },
  { days: 365, label: "In 365 days" },
  { days: 0, label: "Never" },
];

export const DEFAULT_EXPIRY_DAYS = 90;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function lastUsedText(
  at: Date | undefined,
  now: Date = new Date(),
): string {
  if (!at) return "Never";
  const ms = now.getTime() - at.getTime();
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) {
    const n = Math.floor(ms / MINUTE);
    return `${n} minute${n === 1 ? "" : "s"} ago`;
  }
  if (ms < DAY) {
    const n = Math.floor(ms / HOUR);
    return `${n} hour${n === 1 ? "" : "s"} ago`;
  }
  const n = Math.floor(ms / DAY);
  return n === 1 ? "yesterday" : `${n} days ago`;
}

export type Expiry = {
  text: string;
  state: "never" | "ok" | "soon" | "expired";
};

// When a token runs out; "soon" is within a week.
export function expiryOf(at: Date | undefined, now: Date = new Date()): Expiry {
  if (!at) return { text: "Never", state: "never" };
  const ms = at.getTime() - now.getTime();
  if (ms <= 0) return { text: "Expired", state: "expired" };
  const days = Math.ceil(ms / DAY);
  return {
    text: days <= 1 ? "Within a day" : `In ${days} days`,
    state: days <= 7 ? "soon" : "ok",
  };
}
