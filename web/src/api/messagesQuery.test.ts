import { create } from "@bufbuild/protobuf";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ListMessagesResponseSchema } from "../gen/stoop/chat/v1/chat_pb";
import { type Message, MessageSchema } from "../gen/stoop/chat/v1/message_pb";
import { useHistoryStore } from "./history";
import { messagesQuery } from "./queries";
import { loadOlder } from "./timelineLoads";

const { listMessages } = vi.hoisted(() => ({ listMessages: vi.fn() }));
vi.mock("./clients", () => ({ chatClient: { listMessages } }));
vi.mock("./origin", () => ({ serverOrigin: () => "http://test" }));

const CHANNEL = "general";
const TOTAL = 400;

// A channel of TOTAL messages, ids m0000 (oldest) to m0399, paged as the
// server pages them.
const channel: Message[] = Array.from({ length: TOTAL }, (_, i) =>
  create(MessageSchema, {
    id: `m${String(i).padStart(4, "0")}`,
    channelId: CHANNEL,
    content: `message ${i}`,
  }),
);

function serve(req: { beforeId?: string; limit?: number }) {
  const limit = req.limit || 50;
  const end = req.beforeId
    ? channel.findIndex((m) => m.id === req.beforeId)
    : channel.length;
  const start = Math.max(0, end - limit);
  return Promise.resolve(
    create(ListMessagesResponseSchema, {
      messages: channel.slice(start, end),
      hasOlder: start > 0,
      hasNewer: false,
    }),
  );
}

describe("messagesQuery", () => {
  beforeEach(() => {
    listMessages.mockReset();
    listMessages.mockImplementation(serve);
    useHistoryStore.setState({ channels: {}, windows: {} });
  });

  it("keeps the history paged in when a live window is refetched", async () => {
    const queryClient = new QueryClient();
    const timeline = { channelId: CHANNEL };
    const query = messagesQuery(timeline);
    await queryClient.fetchQuery(query);
    await loadOlder(queryClient, timeline);
    await loadOlder(queryClient, timeline);
    const paged = queryClient.getQueryData<Message[]>(query.queryKey);
    expect(paged).toHaveLength(150);

    await queryClient.refetchQueries({ queryKey: query.queryKey });

    const after = queryClient.getQueryData<Message[]>(query.queryKey);
    expect(after?.map((m) => m.id)).toEqual(paged?.map((m) => m.id));
    expect(useHistoryStore.getState().channels[CHANNEL]).toMatchObject({
      hasOlder: true,
      hasNewer: false,
    });
  });

  it("redraws the paged rows from the server", async () => {
    const queryClient = new QueryClient();
    const timeline = { channelId: CHANNEL };
    const query = messagesQuery(timeline);
    await queryClient.fetchQuery(query);
    await loadOlder(queryClient, timeline);
    const oldest = channel[TOTAL - 100];
    channel[TOTAL - 100] = { ...oldest, content: "renamed" };

    await queryClient.refetchQueries({ queryKey: query.queryKey });

    const after = queryClient.getQueryData<Message[]>(query.queryKey);
    expect(after?.[0]?.content).toBe("renamed");
    channel[TOTAL - 100] = oldest;
  });
});
