import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { ChannelHeader } from "@stoop/core/channelHeader";
import { channelItems } from "@stoop/core/channelLog";
import { CHANNEL, ids, page, rows } from "@stoop/core/channelLog/testing";
import { NO_CHANNELS } from "@stoop/core/mentions";
import { ChannelSchema } from "@stoop/gen/stoop/chat/v1/channel_pb";
import { SpaceSchema } from "@stoop/gen/stoop/chat/v1/space_pb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadChannel, sendMessage } from "../../api/messages";
import type { SavedServer } from "../../servers";
import { channelEngine, holdEngine } from "./channelEngine";

vi.mock("react-native", () => ({ AppState: { currentState: "active" } }));
vi.mock("../../api/files", () => ({ uploadAttachment: vi.fn() }));
vi.mock("../../api/servers", () => ({ sessionToken: async () => "t1" }));
vi.mock("../../api/messages", () => ({
  ChannelGone: class extends Error {},
  PAGE: 50,
  loadChannel: vi.fn(),
  sendMessage: vi.fn(),
}));

const SERVER = { id: "server", origin: "https://stoop.example" } as SavedServer;

const header: ChannelHeader = {
  space: create(SpaceSchema, { id: "s1", name: "The Porch" }),
  channel: create(ChannelSchema, { id: CHANNEL, name: "general" }),
  memberCount: 2,
  members: [],
  groups: [],
  myUserId: "me",
  channels: NO_CHANNELS,
};

// An engine holding an open channel of ten rows, and the rows it shows.
async function openEngine() {
  vi.mocked(loadChannel).mockResolvedValue({ header, page: page(rows(0, 10), { channelSeq: 10 }), found: false });
  const { engine, release } = holdEngine(channelEngine(SERVER, "s1", CHANNEL, () => () => {}));
  await vi.waitFor(() => expect(engine.current().header).not.toBeNull());
  return { engine, release, shown: ids(channelItems(engine.current().log)) };
}

const refuse = (message: string, code: Code) => vi.mocked(sendMessage).mockRejectedValue(new ConnectError(message, code));

describe("a refused send", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["in the channel", {}],
    ["with a quote", { replyToMessageId: "quoted" }],
    ["in a thread", { threadRootId: "root", alsoSendToChannel: true }],
  ])("leaves the screen as it is when permission is denied, %s", async (_where, to) => {
    const { engine, release, shown } = await openEngine();
    refuse("you can't message this person", Code.PermissionDenied);
    await expect(engine.send("hello", to)).rejects.toThrow("you can't message this person");
    expect(engine.current().outcome).toBeNull();
    expect(ids(channelItems(engine.current().log))).toEqual(shown);
    release();
  });

  it("ends the session when the sign-in has ended", async () => {
    const { engine, release } = await openEngine();
    refuse("expired", Code.Unauthenticated);
    await expect(engine.send("hello")).rejects.toThrow("expired");
    expect(engine.current().outcome).toBe("ended");
    release();
  });

  it("calls the channel gone when it isn't found, with no root or quote named", async () => {
    const { engine, release } = await openEngine();
    refuse("channel not found", Code.NotFound);
    await expect(engine.send("hello")).rejects.toThrow("channel not found");
    expect(engine.current().outcome).toBe("gone");
    release();
  });
});
