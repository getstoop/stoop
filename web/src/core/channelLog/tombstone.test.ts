import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { MessageSchema } from "../../gen/stoop/chat/v1/message_pb";
import { withOwnDelete } from "./tombstone";
import type { ChannelLog } from "./types";

describe("withOwnDelete", () => {
  it("takes a deleted poll's closing row and pin row with it", () => {
    const poll = create(MessageSchema, {
      id: "p1",
      seq: 5n,
      event: { kind: { case: "poll", value: { question: "Friday?" } } },
    });
    const about = (id: string, kind: "pin" | "pollClosed") =>
      create(MessageSchema, {
        id,
        seq: 6n,
        event: { kind: { case: kind, value: {} } },
        reference: { messageId: "p1", author: { id: "them" } },
      });
    const other = create(MessageSchema, { id: "m1", seq: 7n, content: "hi" });
    const log = {
      rows: new Map(
        [poll, about("c1", "pollClosed"), about("n1", "pin"), other].map(
          (row) => [row.id, row],
        ),
      ),
    } as unknown as ChannelLog;
    const next = withOwnDelete(log, "p1");
    expect(next.rows.get("p1")?.deleted).toBe(true);
    expect(next.rows.get("c1")).toMatchObject({ deleted: true, seq: 6n });
    expect(next.rows.get("n1")).toMatchObject({ deleted: true, seq: 6n });
    expect(next.rows.get("m1")?.deleted).toBe(false);
  });
});
