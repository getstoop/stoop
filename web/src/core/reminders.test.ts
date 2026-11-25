import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  MessageAuthorSchema,
  MessageSchema,
  SystemEventSchema,
} from "../gen/stoop/chat/v1/message_pb";
import { isReminderRow, mayDeleteReminder, reminderPreview } from "./reminders";

const maya = create(MessageAuthorSchema, { id: "maya", username: "maya" });

const reminder = (extra: { deleted?: boolean } = {}) => {
  const made = create(MessageSchema, {
    id: "m1",
    author: maya,
    content: "Order the *pizza* for @sam",
    ...extra,
  });
  made.event = create(SystemEventSchema, {
    kind: { case: "reminder", value: {} },
  });
  return made;
};

const message = create(MessageSchema, {
  id: "m2",
  author: maya,
  content: "hello",
});

describe("reminderPreview", () => {
  it("is the text exactly as typed", () => {
    expect(reminderPreview(reminder())).toBe(
      "Reminder: Order the *pizza* for @sam",
    );
  });

  it("is nothing for a message", () => {
    expect(isReminderRow(message)).toBe(false);
    expect(reminderPreview(message)).toBeNull();
  });
});

describe("mayDeleteReminder", () => {
  const ask = (
    myUserId: string,
    inSpace: boolean,
    canModerate: boolean,
    row = reminder(),
  ) => mayDeleteReminder({ message: row, myUserId, inSpace, canModerate });

  it("lets the person who set it delete it, anywhere", () => {
    expect(ask("maya", true, false)).toBe(true);
    expect(ask("maya", false, false)).toBe(true);
  });

  it("lets a moderator delete it in a space, never in a conversation", () => {
    expect(ask("sam", true, true)).toBe(true);
    expect(ask("sam", false, true)).toBe(false);
  });

  it("lets nobody else, and nobody delete one already gone", () => {
    expect(ask("sam", true, false)).toBe(false);
    expect(ask("maya", true, true, reminder({ deleted: true }))).toBe(false);
    expect(
      mayDeleteReminder({
        message,
        myUserId: "maya",
        inSpace: true,
        canModerate: true,
      }),
    ).toBe(false);
  });
});
