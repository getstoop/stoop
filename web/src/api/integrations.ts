import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Permission } from "../gen/stoop/access/v1/access_pb";
import type {
  Delivery,
  IncomingWebhook,
} from "../gen/stoop/integrations/v1/webhook_pb";

// Pure helpers for the Integrations sections (docs/proposals/webhooks.md).

export const EVENT_TYPES: { key: string; label: string }[] = [
  { key: "message.created", label: "A message is posted" },
  { key: "message.updated", label: "A message is edited" },
  { key: "message.deleted", label: "A message is deleted" },
  { key: "member.joined", label: "Someone joins" },
  { key: "member.left", label: "Someone leaves or is removed" },
  { key: "channel.created", label: "A channel is created" },
  { key: "channel.deleted", label: "A channel is deleted" },
];

export function eventLabel(key: string): string {
  return EVENT_TYPES.find((e) => e.key === key)?.label ?? key;
}

// What an incoming hook may do, in the member's words.
export function hookCanText(
  hook: Pick<IncomingWebhook, "permissions">,
): string {
  return hook.permissions.includes(Permission.MESSAGES_NOTIFY_EVERYONE)
    ? "Post, and notify everyone"
    : "Post";
}

export function canNotifyEveryone(
  hook: Pick<IncomingWebhook, "permissions">,
): boolean {
  return hook.permissions.includes(Permission.MESSAGES_NOTIFY_EVERYONE);
}

// The receiver as a member sees it: scheme and host, never the path.
export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url;
  }
}

export type DeliveryState = "delivered" | "failed" | "pending";

export function deliveryState(d: Delivery): DeliveryState {
  if (!d.finishedAt) return "pending";
  const code = d.statusCode ?? 0;
  return code >= 200 && code < 300 ? "delivered" : "failed";
}

// One line for the log: the outcome and what the receiver said.
export function deliveryText(d: Delivery): string {
  const state = deliveryState(d);
  const attempts = `${d.attempts} attempt${d.attempts === 1 ? "" : "s"}`;
  if (state === "pending") {
    const next = d.nextAttemptAt && timestampDate(d.nextAttemptAt);
    return next && next.getTime() > Date.now()
      ? `Retrying at ${next.toLocaleTimeString()} · ${attempts}`
      : `Waiting to send · ${attempts}`;
  }
  const status = d.statusCode ? `HTTP ${d.statusCode}` : d.error || "no answer";
  return state === "delivered"
    ? `Delivered (${status}) · ${attempts}`
    : `Failed (${status}) · ${attempts}`;
}

// A hook URL from the create response is a path alone when the server has
// no public URL; the client prepends its own origin.
export function absoluteHookUrl(url: string, origin: string): string {
  return url.startsWith("/") ? origin.replace(/\/$/, "") + url : url;
}
