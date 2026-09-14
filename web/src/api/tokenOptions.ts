import { Permission } from "../gen/stoop/access/v1/access_pb";

// The personal-token picker's choices: a few permissions under one plain
// label, grouped by where they apply. The server holds the real list; this
// is only how it's offered, and only options the person holds are shown.

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
    group: "space",
    permissions: [Permission.INVITES_CREATE],
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
];

export const GROUP_LABELS: Record<TokenGroup, string> = {
  space: "In spaces",
  account: "Your account",
  server: "On this server",
};

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

// The labels a token's permissions add up to, for a list.
export function describePermissions(
  permissions: Iterable<Permission>,
): string[] {
  const have = new Set(permissions);
  return TOKEN_OPTIONS.filter((o) =>
    o.permissions.every((p) => have.has(p)),
  ).map((o) => o.label);
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
