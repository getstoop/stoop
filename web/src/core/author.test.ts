import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { IdentityKind } from "../gen/stoop/access/v1/access_pb";
import { type Member, MemberSchema } from "../gen/stoop/chat/v1/member_pb";
import {
  type MessageAuthor,
  MessageAuthorSchema,
} from "../gen/stoop/chat/v1/message_pb";
import { authorShown } from "./author";

const author = (
  init: MessageInitShape<typeof MessageAuthorSchema> = {},
): MessageAuthor =>
  create(MessageAuthorSchema, {
    id: "ada",
    username: "ada",
    displayName: "Ada",
    avatarFileId: "",
    kind: IdentityKind.BOT,
    ...init,
  });

const member = (init: MessageInitShape<typeof MemberSchema> = {}): Member =>
  create(MemberSchema, {
    userId: "ada",
    username: "ada",
    displayName: "Ada",
    avatarFileId: "",
    ...init,
  });

const listing = (...members: Member[]) =>
  new Map(members.map((one) => [one.userId, one]));

describe("authorShown", () => {
  it("takes the member's current name and avatar", () => {
    const shown = authorShown(
      author(),
      listing(member({ displayName: "Ada L.", avatarFileId: "f1" })),
    );
    expect(shown).toMatchObject({
      displayName: "Ada L.",
      avatarFileId: "f1",
      username: "ada",
    });
  });

  it("keeps the kind and the deleted mark as embedded", () => {
    const shown = authorShown(
      author({ deleted: true }),
      listing(member({ displayName: "Ada L." })),
    );
    expect(shown?.kind).toBe(IdentityKind.BOT);
    expect(shown?.deleted).toBe(true);
  });

  it("shows someone no longer a member as embedded", () => {
    const embedded = author();
    expect(authorShown(embedded, listing())).toBe(embedded);
  });

  it("hands the same author back when nothing differs", () => {
    const embedded = author();
    expect(authorShown(embedded, listing(member()))).toBe(embedded);
    expect(authorShown(undefined, listing(member()))).toBeUndefined();
  });
});
