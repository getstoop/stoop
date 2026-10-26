// Message attachments as both apps handle them: the limits, the queue
// that keeps uploads inside the server's per-account allowance, the rule
// that puts a refused send's files back, how a file's size and type are
// shown, and how a received file is drawn.

import type { Attachment, Message } from "../gen/stoop/chat/v1/message_pb";

// The server's own cap on one file when the operator sets none
// (GetInstanceStatus max_upload_bytes is the one in force).
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
// SendMessage.attachment_ids takes at most this many.
export const MAX_ATTACHMENTS = 10;
// The server admits this many uploads per account at once
// (files.MaxInflightUploads) and refuses the next; a message may carry
// ten, so the rest wait their turn.
export const MAX_PARALLEL_UPLOADS = 3;

// What POST /files/upload answers with: an unclaimed file, sent by id.
export type UploadedFile = {
  id: string;
  name: string;
  contentType: string;
  size: number;
};

// A queue of upload slots: the function it returns runs its task once a
// slot is free, and frees it when the task settles. One per app, so
// every composer's uploads share it.
export function uploadSlots(max: number = MAX_PARALLEL_UPLOADS) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function withUploadSlot<T>(task: () => Promise<T>): Promise<T> {
    if (running >= max) {
      await new Promise<void>((next) => waiting.push(next));
    }
    running++;
    try {
      return await task();
    } finally {
      running--;
      waiting.shift()?.();
    }
  };
}

// A refused send puts its files back in the composer, ahead of any added
// while the request was in flight, and none twice.
export function restoreFiles<Item extends { key: string }>(
  sent: Item[],
  addedSince: Item[],
): Item[] {
  const restored = new Set(sent.map((file) => file.key));
  return [...sent, ...addedSince.filter((file) => !restored.has(file.key))];
}

// Raster types the server will serve inline; everything else downloads.
export function isInlineImage(contentType: string): boolean {
  return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
    contentType,
  );
}

// Media types the server serves inline for playback
export function isPlayableVideo(contentType: string): boolean {
  return ["video/mp4", "video/webm", "video/quicktime"].includes(contentType);
}

export function isPlayableAudio(contentType: string): boolean {
  return [
    "audio/mpeg",
    "audio/mp4",
    "audio/wave",
    "audio/ogg",
    "application/ogg",
  ].includes(contentType);
}

export function formatBytes(size: number | bigint): string {
  const bytes = Number(size);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// How a received attachment is drawn, first match wins: a placeholder
// once expired, then a video, an audio player, an inline image, or a
// card for anything else.
export type AttachmentKind = "expired" | "video" | "audio" | "image" | "file";

export function attachmentKind(attachment: Attachment): AttachmentKind {
  if (attachment.expired) return "expired";
  if (isPlayableVideo(attachment.contentType)) return "video";
  if (isPlayableAudio(attachment.contentType)) return "audio";
  if (isInlineImage(attachment.contentType)) return "image";
  return "file";
}

// What a preview steps through: the images and videos of a message
// list, oldest first.
export function galleryMedia(messages: Message[]): Attachment[] {
  return messages.flatMap((message) =>
    message.attachments.filter((attachment) => {
      const kind = attachmentKind(attachment);
      return kind === "image" || kind === "video";
    }),
  );
}
