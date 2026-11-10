import type { ActivityItem } from "@stoop/gen/stoop/chat/v1/activity_pb";
import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";

// The names a notification's subtitle is made of. An item carries only
// IDs, so one session's spaces, and each space's channels, are listed
// the first time an item needs them and kept for as long as the session
// is. The Activity tab keeps lists of its own (usePlaces), for the
// items it shows on the server on screen; these serve every saved
// server.

export type PlaceNames = {
  channel?: string;
  // Only when the account is in more than one space.
  space?: string;
};

export type Lists = {
  spaces: Space[] | null;
  // By space ID.
  channels: Map<string, Channel[]>;
};

type Where = Pick<ActivityItem, "spaceId" | "channelId">;

// A direct message has no space, and so no names.
export function namesIn(lists: Lists, item: Where): PlaceNames {
  if (!item.spaceId) return {};
  const { spaces } = lists;
  return {
    channel: lists.channels.get(item.spaceId)?.find((channel) => channel.id === item.channelId)?.name,
    space: spaces && spaces.length > 1 ? spaces.find((space) => space.id === item.spaceId)?.name : undefined,
  };
}

export type Loaders = {
  spaces: () => Promise<Space[]>;
  channels: (spaceId: string) => Promise<Channel[]>;
};

// How long a notification waits for its names before going out without.
export const NAMES_WAIT_MS = 2000;

export type Places = { names: (item: Where) => Promise<PlaceNames> };

// Resolves with what is known once the lists the item needs have
// landed, or after waitMs. A list is asked for when it isn't held, and
// once more for an ID it lacks (a channel made since); a failed ask
// goes again with the next item.
export function placesCache(load: Loaders, waitMs = NAMES_WAIT_MS): Places {
  const lists: Lists = { spaces: null, channels: new Map() };
  // What each list was asked for, by space ("" for the spaces).
  const asked = new Map<string, Set<string>>();
  const inFlight = new Map<string, Promise<void>>();

  const ask = (key: string, wanted: string, held: boolean): Promise<void> | undefined => {
    const going = inFlight.get(key);
    if (going) return going;
    const before = asked.get(key);
    if (held || before?.has(wanted)) return undefined;
    asked.set(key, new Set([...(before ?? []), wanted]));
    const loading =
      key === ""
        ? load.spaces().then((spaces) => {
            lists.spaces = spaces;
          })
        : load.channels(key).then((channels) => {
            lists.channels.set(key, channels);
          });
    const settled = loading
      .catch(() => {
        asked.get(key)?.delete(wanted);
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, settled);
    return settled;
  };

  const names = async (item: Where): Promise<PlaceNames> => {
    if (!item.spaceId) return {};
    const asks = [
      ask("", item.spaceId, lists.spaces?.some((space) => space.id === item.spaceId) ?? false),
      ask(
        item.spaceId,
        item.channelId,
        lists.channels.get(item.spaceId)?.some((channel) => channel.id === item.channelId) ?? false,
      ),
    ].filter((going) => going !== undefined);
    if (asks.length > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waited = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, waitMs);
      });
      await Promise.race([Promise.all(asks), waited]);
      clearTimeout(timer);
    }
    return namesIn(lists, item);
  };

  return { names };
}
