import type { PendingAttachment } from "../../components/AttachmentStrip";

// A refused send puts its text and files back in the composer, ahead of
// anything added while the request was in flight.

export function restoreDraft(sent: string, typedSince: string): string {
  return typedSince.trim() ? `${sent}\n${typedSince}` : sent;
}

export function restoreFiles(
  sent: PendingAttachment[],
  addedSince: PendingAttachment[],
): PendingAttachment[] {
  const restored = new Set(sent.map((file) => file.key));
  return [...sent, ...addedSince.filter((file) => !restored.has(file.key))];
}
