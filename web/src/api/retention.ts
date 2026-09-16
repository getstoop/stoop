import type { PreviewRetentionResponse } from "../gen/stoop/instance/v1/instance_pb";

// The retention settings' words, kept out of the components so they can be
// tested. 0 days keeps forever. See docs/proposals/retention.md.

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

// The history head's addition: "" when messages are kept forever.
export function historyRetentionNote(messageDays: number): string {
  return messageDays > 0
    ? `messages older than ${days(messageDays)} are deleted`
    : "";
}

// Whether a change deletes sooner than before, which is when saving asks.
export function shortens(before: number, after: number): boolean {
  return after > 0 && (before === 0 || after < before);
}

// Attachments can't outlive the messages carrying them.
export function attachmentRetentionMoot(
  messageDays: number,
  attachmentDays: number,
): boolean {
  return messageDays > 0 && attachmentDays >= messageDays;
}

// The confirm's body: what the server would delete now. size is the
// preview's attachment bytes, already formatted.
export function retentionConfirmBody(
  preview: Pick<PreviewRetentionResponse, "messages" | "attachments">,
  messageDays: number,
  attachmentDays: number,
  size: string,
): string {
  const parts: string[] = [];
  if (messageDays > 0) {
    parts.push(
      `${preview.messages.toLocaleString("en")} message${preview.messages === 1n ? "" : "s"} older than ${days(messageDays)}`,
    );
  }
  if (attachmentDays > 0) {
    parts.push(
      `${preview.attachments.toLocaleString("en")} attachment${preview.attachments === 1n ? "" : "s"} older than ${days(attachmentDays)} (${size})`,
    );
  }
  const what =
    parts.length > 0
      ? `Within the hour, the server will permanently delete ${parts.join(" and ")}.`
      : "";
  return `${what} Pinned messages and their files are kept. This can't be undone.`.trim();
}
