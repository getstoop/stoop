import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { describe, expect, it, vi } from "vitest";
import { type Lists, namesIn, placesCache } from "./places";

const space = (id: string, name: string) => ({ id, name }) as Space;
const channel = (id: string, name: string) => ({ id, name }) as Channel;
const mention = { spaceId: "s1", channelId: "c1" };

describe("namesIn", () => {
  const lists: Lists = {
    spaces: [space("s1", "Neighbours"), space("s2", "Garden")],
    channels: new Map([["s1", [channel("c1", "general")]]]),
  };

  it("names the channel, and the space among several", () => {
    expect(namesIn(lists, mention)).toEqual({ channel: "general", space: "Neighbours" });
  });

  it("leaves out the only space's name", () => {
    expect(namesIn({ ...lists, spaces: [space("s1", "Neighbours")] }, mention).space).toBeUndefined();
  });

  it("has no names for a direct message, or for what the lists lack", () => {
    expect(namesIn(lists, { spaceId: "", channelId: "d1" })).toEqual({});
    expect(namesIn(lists, { spaceId: "s1", channelId: "c9" }).channel).toBeUndefined();
    expect(namesIn({ spaces: null, channels: new Map() }, mention)).toEqual({});
  });
});

describe("placesCache", () => {
  const loaders = () => ({
    spaces: vi.fn(async () => [space("s1", "Neighbours"), space("s2", "Garden")]),
    channels: vi.fn(async () => [channel("c1", "general")]),
  });

  it("loads the lists an item needs, once", async () => {
    const load = loaders();
    const places = placesCache(load);
    expect(await places.names(mention)).toEqual({ channel: "general", space: "Neighbours" });
    expect(await places.names(mention)).toEqual({ channel: "general", space: "Neighbours" });
    expect(load.spaces).toHaveBeenCalledTimes(1);
    expect(load.channels).toHaveBeenCalledTimes(1);
    expect(load.channels).toHaveBeenCalledWith("s1");
  });

  it("asks for nothing for a direct message", async () => {
    const load = loaders();
    expect(await placesCache(load).names({ spaceId: "", channelId: "d1" })).toEqual({});
    expect(load.spaces).not.toHaveBeenCalled();
  });

  it("asks once more for a channel its list lacks", async () => {
    const load = loaders();
    const places = placesCache(load);
    await places.names(mention);
    load.channels.mockResolvedValueOnce([channel("c1", "general"), channel("c2", "new")]);
    expect((await places.names({ spaceId: "s1", channelId: "c2" })).channel).toBe("new");
    await places.names({ spaceId: "s1", channelId: "c3" });
    await places.names({ spaceId: "s1", channelId: "c3" });
    expect(load.channels).toHaveBeenCalledTimes(3);
  });

  it("answers without the names of a list that fails, and asks again next time", async () => {
    const load = loaders();
    load.channels.mockRejectedValueOnce(new Error("offline"));
    const places = placesCache(load);
    expect(await places.names(mention)).toEqual({ space: "Neighbours" });
    expect((await places.names(mention)).channel).toBe("general");
  });

  it("answers with what it has when the lists are slow", async () => {
    vi.useFakeTimers();
    const load = loaders();
    load.channels.mockReturnValueOnce(new Promise(() => {}));
    const names = placesCache(load, 2000).names(mention);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await names).toEqual({ space: "Neighbours" });
    vi.useRealTimers();
  });
});
