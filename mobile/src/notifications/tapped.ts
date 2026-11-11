import { type NotificationData, notificationData } from "./content";

// Which of the system's responses to a notification is a tap to open,
// and the key it is accepted under (pendingTap.ts). Only the tap itself
// counts, which the library reports as its default action, on a
// notification whose data is ours and whose server is still saved:
// anything else has opened the app, and that is all. The key is the
// notification's identifier and when it was shown, since a
// conversation's next notification reuses the identifier.

// As much of the library's NotificationResponse as is read.
export type TapResponse = {
  actionIdentifier: string;
  notification: { date: number; request: { identifier: string; content: { data?: unknown } } };
};

export function tappedNotification(
  response: TapResponse,
  saved: string[],
  defaultAction: string,
): { key: string; data: NotificationData } | null {
  if (response.actionIdentifier !== defaultAction) return null;
  const { date, request } = response.notification;
  const data = notificationData(request.content.data);
  if (!data || !saved.includes(data.serverId)) return null;
  return { key: `${request.identifier}@${date}`, data };
}
