import type { ActivityItem } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { describe, expect, it } from "vitest";
import cut from "../../../internal/push/testdata/payload-cut.json";
import dm from "../../../internal/push/testdata/payload-dm.json";
import mention from "../../../internal/push/testdata/payload-mention.json";
import threadReply from "../../../internal/push/testdata/payload-thread-reply.json";
import shared from "../../extensions/notification-service/cases/content.json";
import { notificationContent } from "./content";

// The cases the notification service extension's Swift runs too
// (extensions/notification-service, `swift test`), so a push says what
// the app's own notification would. Each starts from one of the
// server's payload fixtures (docs/architecture/push-payload.md).

type Payload = typeof mention;

const fixtures: Record<string, Payload> = {
  "payload-cut.json": cut,
  "payload-dm.json": dm,
  "payload-mention.json": mention,
  "payload-thread-reply.json": threadReply,
};

type Case = {
  name: string;
  fixture: string;
  change?: Partial<Payload>;
  settings: { showText: boolean; serverName: string; manyServers: boolean; manySpaces: boolean };
  expect: { title: string; subtitle: string; body: string };
};

// The payload as the activity item and the names the app would hold
// for it: a space is named only when the account is in several
// (places.ts namesIn), and a direct message has no names.
function content({ fixture, change, settings }: Case) {
  const base = fixtures[fixture];
  if (!base) throw new Error(`No fixture ${fixture}`);
  const payload = { ...base, ...change };
  const item = {
    id: payload.itemId,
    kind: payload.kind,
    spaceId: payload.spaceId,
    channelId: payload.channelId,
    threadRootId: payload.threadRootId,
    messageId: payload.messageId,
    actor: payload.actorName ? { displayName: payload.actorName, username: "" } : undefined,
    preview: payload.preview,
  } as ActivityItem;
  const names = {
    channel: payload.channelName || undefined,
    space: settings.manySpaces ? payload.spaceName || undefined : undefined,
  };
  const server = { id: payload.serverId, name: settings.serverName };
  return {
    payload,
    content: notificationContent(item, server, names, { manyServers: settings.manyServers, showText: settings.showText }),
  };
}

describe("the cases shared with the notification service extension", () => {
  for (const entry of shared.cases as Case[]) {
    it(entry.name, () => {
      const { payload, content: said } = content(entry);
      expect({ title: said.title, subtitle: said.subtitle ?? "", body: said.body }).toEqual(entry.expect);
      // Where a tap goes is the payload's own fields, whatever is said.
      const { serverId, itemId, kind, spaceId, channelId, threadRootId, messageId } = payload;
      expect(said.data).toEqual({ serverId, itemId, kind, spaceId, channelId, threadRootId, messageId });
    });
  }
});
