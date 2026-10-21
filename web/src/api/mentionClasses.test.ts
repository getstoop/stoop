import { describe, expect, it } from "vitest";
import type { Group } from "../gen/stoop/chat/v1/group_pb";
import { groupMentionClass } from "./mentionClasses";

const group = (handle: string, name: string, userIds: string[] = []): Group =>
  ({ id: handle, handle, name, userIds }) as unknown as Group;

describe("groupMentionClass", () => {
  it("fills the pill for someone in the group", () => {
    const crew = group("gardeners", "Garden crew", ["me-id"]);
    expect(groupMentionClass(crew, "me-id")).toBe("mention group me");
    expect(groupMentionClass(crew, "other")).toBe("mention group");
    expect(groupMentionClass(undefined, "me-id")).toBe("mention group");
  });
});
