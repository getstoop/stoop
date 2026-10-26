import { formatBytes } from "@stoop/core/attachments";
import type { Attachment } from "@stoop/gen/stoop/chat/v1/message_pb";

// What a screen reader says for each file, and the words a card shows
// while it downloads. There is no alt text in Stoop, so an image is read
// by its name, led by its kind: a phone's names are "IMG_2041.jpg".

export const imageLabel = (attachment: Attachment) => `Image, ${attachment.name}`;

export const videoLabel = (attachment: Attachment) => `Video, ${attachment.name}, ${formatBytes(attachment.size)}`;

// A grid's tile: "Image 2 of 4, IMG_2111.jpg", "Video 3 of 4, IMG_2112.mov".
export const tileLabel = (attachment: Attachment, index: number, count: number, video = false) =>
  `${video ? "Video" : "Image"} ${index + 1} of ${count}, ${attachment.name}`;

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

// An audio file's button: "Play voice-note.m4a", "Pause voice-note.m4a".
export const audioLabel = (attachment: Attachment, playing: boolean) =>
  `${playing ? "Pause" : "Play"} ${attachment.name}`;

// "1:12", "12:05", "1:02:09".
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const s = String(whole % 60).padStart(2, "0");
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes}:${s}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${s}`;
}

// The player's time: "0:27 / 1:12" once it has started, its length at
// rest. The length is known only once a player has read the file, so
// one never played says "0:00".
export function audioTime(started: boolean, position: number, duration: number): string {
  // A file's length is read a little short of its whole seconds (71.98
  // for a minute and twelve), so it is rounded; the position counts up.
  const length = clock(Math.round(duration));
  if (!started) return length;
  return duration > 0 ? `${clock(position)} / ${length}` : clock(position);
}
