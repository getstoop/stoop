import { formatBytes } from "@stoop/core/attachments";
import type { Attachment } from "@stoop/gen/stoop/chat/v1/message_pb";

// What a screen reader says for each file, and the words a card shows
// while it downloads. There is no alt text in Stoop, so an image is read
// by its name, led by its kind: a phone's names are "IMG_2041.jpg".

export const imageLabel = (attachment: Attachment) => `Image, ${attachment.name}`;

export const tileLabel = (attachment: Attachment, index: number, count: number) =>
  `Image ${index + 1} of ${count}, ${attachment.name}`;

export const cardLabel = (attachment: Attachment) => `${attachment.name}, ${formatBytes(attachment.size)}`;

export const expiredText = (attachment: Attachment) => `Expired attachment · ${formatBytes(attachment.size)}`;

export const expiredLabel = (attachment: Attachment) => `Expired attachment, ${formatBytes(attachment.size)}`;

const MB = 1024 * 1024;

// "1.1 of 2.4 MB": what has arrived of the whole, in the whole's unit.
// Below a megabyte, or before the first bytes, it only says it is going.
export function downloadedText(written: number, size: number | bigint): string {
  const total = Number(size);
  if (total < MB || written <= 0) return "Downloading…";
  return `${(Math.min(written, total) / MB).toFixed(1)} of ${formatBytes(total)}`;
}
