import { create, type MessageInitShape, toBinary } from "@bufbuild/protobuf";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerEventSchema } from "../gen/stoop/realtime/v1/realtime_pb";
import { openChannel } from "./channelLog";
import {
  CHANNEL,
  id,
  logOf,
  postOnServer,
  resetServer,
  server,
} from "./channelLogTestServer";
import { linkedMessageKey } from "./queries";
import { startRealtime } from "./ws";

// The RPC clients and the page's origin are not there in node; these
// tests never reach them beyond the channel log's pages.
const { listMessages, listChanges } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  listChanges: vi.fn(),
}));
vi.mock("./clients", () => ({
  chatClient: { listMessages, listChanges },
  authClient: {},
  voiceClient: {},
}));
vi.mock("./origin", () => ({
  serverOrigin: () => "http://test",
  socketUrl: (path: string) => `ws://test${path}`,
}));

class FakeSocket {
  static last: FakeSocket | undefined;
  binaryType = "";
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    FakeSocket.last = this;
  }
  close() {}
  send() {}
}

// A frame off the socket, as the gateway sends it.
function receive(
  queryClient: QueryClient,
  payload: MessageInitShape<typeof ServerEventSchema>["payload"],
) {
  vi.stubGlobal("WebSocket", FakeSocket);
  const stop = startRealtime(queryClient);
  const frame = toBinary(
    ServerEventSchema,
    create(ServerEventSchema, { payload }),
  );
  FakeSocket.last?.onmessage?.({ data: frame.slice().buffer });
  stop();
}

beforeEach(async () => {
  resetServer(listMessages, listChanges);
  await openChannel(CHANNEL);
});
afterEach(() => vi.unstubAllGlobals());

describe("events about a message", () => {
  it("reach the channel log by seq", () => {
    const queryClient = new QueryClient();
    const held = logOf().rows.get(id(390));
    if (!held) throw new Error("no row");
    server.seq += 1;
    receive(queryClient, {
      case: "messageUpdated",
      value: { ...held, content: "reworded", seq: BigInt(server.seq) },
    });
    expect(logOf().rows.get(id(390))?.content).toBe("reworded");
    expect(logOf().seq).toBe(server.seq);
  });

  it("ask again for the one-message copy fetched on its own", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(linkedMessageKey(CHANNEL, id(390)), []);
    queryClient.setQueryData(linkedMessageKey(CHANNEL, id(391)), []);
    server.seq += 1;
    receive(queryClient, {
      case: "reactionsChanged",
      value: {
        channelId: CHANNEL,
        messageId: id(390),
        reactions: [],
        seq: BigInt(server.seq),
      },
    });
    const state = (messageId: string) =>
      queryClient.getQueryState(linkedMessageKey(CHANNEL, messageId));
    expect(state(id(390))?.isInvalidated).toBe(true);
    expect(state(id(391))?.isInvalidated).toBe(false);
  });

  it("drop a deleted channel's log", () => {
    const queryClient = new QueryClient();
    receive(queryClient, {
      case: "channelDeleted",
      value: { channelId: CHANNEL, spaceId: "s1" },
    });
    expect(logOf()).toBeUndefined();
  });
});

describe("member_updated", () => {
  it("refetches the DM list, whose participants a conversation's rows read", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["dms"], []);
    queryClient.setQueryData(["channels", "s1"], []);
    receive(queryClient, {
      case: "memberUpdated",
      value: { spaceId: "s1", userId: "ada" },
    });
    expect(queryClient.getQueryState(["dms"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["channels", "s1"])?.isInvalidated).toBe(
      false,
    );
  });
});

describe("member_removed", () => {
  it("asks for the profile their rows now read the author from", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["user-profile", "bea"], null);
    queryClient.setQueryData(["user-profile", "ada"], null);
    receive(queryClient, {
      case: "memberRemoved",
      value: { spaceId: "s1", userId: "bea" },
    });
    expect(
      queryClient.getQueryState(["user-profile", "bea"])?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["user-profile", "ada"])?.isInvalidated,
    ).toBe(false);
  });
});

describe("Ready", () => {
  it("asks every held log for the changes since its seq", async () => {
    const queryClient = new QueryClient();
    // Posted while the socket was down: no event reached the log.
    const held = logOf().seq;
    postOnServer("late", {}, false);
    receive(queryClient, {
      case: "ready",
      value: { userId: "me", presences: [], voiceParticipants: [] },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listChanges).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: CHANNEL, sinceSeq: BigInt(held) }),
    );
    expect(logOf().rows.has("late")).toBe(true);
    expect(logOf().seq).toBe(held + 1);
    expect(logOf().needsCatchUp).toBe(false);
  });
});
