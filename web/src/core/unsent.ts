// A refused send puts its text back in the composer, ahead of anything
// typed while the request was in flight. Web's and the phone's composers
// both restore a draft this way.
export function restoreDraft(sent: string, typedSince: string): string {
  return typedSince.trim() ? `${sent}\n${typedSince}` : sent;
}
