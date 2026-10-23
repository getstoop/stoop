import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import type { ChannelLog } from "./types";

// The reader's own change to a held row (a reaction, a delete), written
// before or as the server answers, at the row's own seq: the server's
// whole row then replaces it, the event that follows at a higher seq or
// the answer at the same one (FROM_ANSWER wins a tie). Nothing when the
// row isn't held or the change left it as it was. The caller reverts a
// refusal with another patch.
export function withPatch(
  log: ChannelLog,
  id: string,
  change: (held: Message) => Message,
): ChannelLog {
  const held = log.rows.get(id);
  if (!held) return log;
  const next = change(held);
  if (next === held) return log;
  const rows = new Map(log.rows);
  rows.set(id, { ...next, seq: held.seq });
  return { ...log, rows };
}
