import type { PendingAttachment } from "../../components/AttachmentStrip";

// A refused send puts its text and files back in the composer, ahead of
// anything added while the request was in flight. The text's rule is
// core's (the phone's composer shares it); the files are web's alone.

export { restoreDraft } from "../../core/unsent";

export function restoreFiles(
  sent: PendingAttachment[],
  addedSince: PendingAttachment[],
): PendingAttachment[] {
  const restored = new Set(sent.map((file) => file.key));
  return [...sent, ...addedSince.filter((file) => !restored.has(file.key))];
}
