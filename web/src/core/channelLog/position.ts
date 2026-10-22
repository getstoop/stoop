import type { ChannelLog } from "./types";

// The log at a position a load set: the first page's channel seq, or a
// catch-up's last page. The server reads the seq before the rows, so an
// event seen above it (seenSeq, events.ts) landed after that read and the
// load did not cover it: the catch-up is still owed.
export function positioned(log: ChannelLog, seq: number): ChannelLog {
  const needsCatchUp = log.seenSeq > seq;
  if (seq === log.seq && needsCatchUp === log.needsCatchUp) return log;
  return { ...log, seq, needsCatchUp };
}
