import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { Permission } from "../gen/stoop/access/v1/access_pb";
import { DeliverySchema } from "../gen/stoop/integrations/v1/webhook_pb";
import {
  absoluteHookUrl,
  deliveryState,
  deliveryText,
  eventLabel,
  hookCanText,
  hostOf,
} from "./integrations";

describe("integrations helpers", () => {
  it("describes what a hook may do", () => {
    expect(hookCanText({ permissions: [Permission.MESSAGES_POST] })).toBe(
      "Post",
    );
    expect(
      hookCanText({
        permissions: [
          Permission.MESSAGES_POST,
          Permission.MESSAGES_NOTIFY_EVERYONE,
        ],
      }),
    ).toBe("Post, and notify everyone");
  });

  it("shows a member the host only", () => {
    expect(hostOf("https://discord.com/api/webhooks/1/secret?x=1")).toBe(
      "https://discord.com",
    );
    expect(hostOf("http://10.0.0.5:9911/hook")).toBe("http://10.0.0.5:9911");
    expect(hostOf("not a url")).toBe("not a url");
  });

  it("labels events, unknown ones by key", () => {
    expect(eventLabel("message.created")).toBe("A message is posted");
    expect(eventLabel("webhook.test")).toBe("webhook.test");
  });

  it("summarises a delivery", () => {
    const done = create(DeliverySchema, {
      attempts: 3,
      statusCode: 200,
      finishedAt: timestampFromDate(new Date()),
    });
    expect(deliveryState(done)).toBe("delivered");
    expect(deliveryText(done)).toBe("Delivered (HTTP 200) · 3 attempts");
    const dead = create(DeliverySchema, {
      attempts: 4,
      error: "dial tcp: connection refused",
      finishedAt: timestampFromDate(new Date()),
    });
    expect(deliveryState(dead)).toBe("failed");
    expect(deliveryText(dead)).toBe(
      "Failed (dial tcp: connection refused) · 4 attempts",
    );
    const waiting = create(DeliverySchema, { attempts: 1 });
    expect(deliveryState(waiting)).toBe("pending");
    expect(deliveryText(waiting)).toBe("Waiting to send · 1 attempt");
  });

  it("completes a bare hook path with the origin", () => {
    expect(absoluteHookUrl("/hooks/abc", "https://stoop.example.com/")).toBe(
      "https://stoop.example.com/hooks/abc",
    );
    expect(absoluteHookUrl("https://x.example/hooks/abc", "https://y")).toBe(
      "https://x.example/hooks/abc",
    );
  });
});
