import { create } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";
import { ActivityItemSchema, ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { ActivityItemCreatedSchema, ServerEventSchema } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { describe, expect, it } from "vitest";
import { itemInThread } from "./itemInThread";

const arrived = (fields: { threadRootId: string; kind?: ActivityKind; read?: boolean }) =>
  create(ServerEventSchema, {
    payload: {
      case: "activityItemCreated",
      value: create(ActivityItemCreatedSchema, {
        item: create(ActivityItemSchema, {
          id: "item",
          threadRootId: fields.threadRootId,
          kind: fields.kind,
          readAt: fields.read ? timestampNow() : undefined,
        }),
      }),
    },
  });

describe("itemInThread", () => {
  it.each([
    ["a thread reply", ActivityKind.THREAD_REPLY],
    ["a mention", ActivityKind.MENTION],
    ["a quote-reply", ActivityKind.REPLY],
    ["a direct message", ActivityKind.DM],
  ])("takes %s about a reply in this thread", (_name, kind) => {
    expect(itemInThread(arrived({ threadRootId: "root", kind }), "root")).toBe(true);
  });

  it("leaves another thread's item, and one not in a thread", () => {
    expect(itemInThread(arrived({ threadRootId: "other" }), "root")).toBe(false);
    expect(itemInThread(arrived({ threadRootId: "" }), "root")).toBe(false);
  });

  it("leaves an item already read", () => {
    expect(itemInThread(arrived({ threadRootId: "root", read: true }), "root")).toBe(false);
  });

  it("leaves any other event", () => {
    expect(itemInThread(create(ServerEventSchema, {}), "root")).toBe(false);
  });
});
