import { timestampDate } from "@bufbuild/protobuf/wkt";
import { attachmentKind, galleryMedia } from "@stoop/core/attachments";
import { dayAndTime, sameDay } from "@stoop/core/dates";
import type { Attachment, Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { authorName } from "../../api/authors";

// What the viewer steps through, and what it says about each page.

export type ViewerItem = { attachment: Attachment; message: Message };

// Web's list (core/attachments galleryMedia): every image and video in
// the loaded messages, oldest first, across messages, each with the
// message it came in so the top bar can say whose it is.
export function viewerItems(messages: Message[]): ViewerItem[] {
  return messages.flatMap((message) => galleryMedia([message]).map((attachment) => ({ attachment, message })));
}

export const isVideo = (item: ViewerItem) => attachmentKind(item.attachment) === "video";

// One file can come in more than one message.
export const itemKey = (item: ViewerItem) => `${item.message.id}:${item.attachment.fileId}`;

// Who sent it, as the rows name them.
export const senderName = (item: ViewerItem) => authorName(item.message.author);

// When: the time today, the day and time before, as a thread's rows say it.
export function sentAt(item: ViewerItem, now: Date = new Date()): string {
  const created = item.message.createdAt ? timestampDate(item.message.createdAt) : undefined;
  if (!created) return "";
  if (sameDay(created, now)) return created.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return dayAndTime(created, now);
}

// "2 of 4".
export const positionText = (index: number, count: number) => `${index + 1} of ${count}`;

// The page as a screen reader reads it: "IMG_2041.jpg, image 2 of 4,
// from Theo Kim, 9:31 AM", or "…, video 3 of 4, …".
export function pageLabel(item: ViewerItem, index: number, count: number, now: Date = new Date()): string {
  const time = sentAt(item, now);
  const kind = isVideo(item) ? "video" : "image";
  return `${item.attachment.name}, ${kind} ${positionText(index, count)}, from ${senderName(item)}${time ? `, ${time}` : ""}`;
}
