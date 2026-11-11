import type { ActivityItem } from "@stoop/gen/stoop/chat/v1/activity_pb";
import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";

// The names a notification's subtitle is made of. An item carries only
// IDs, so one session's spaces, and each space's channels, are listed
// the first time an item needs them and kept for as long as the session
// is. The naming rules are the Activity tab's (usePlaces), which keeps
// lists of its own for the items it shows on the server on screen;
// these serve every saved server.

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
// landed, or after waitMs.
export function placesCache(load: Loaders, waitMs = NAMES_WAIT_MS): Places {
  const lists: Lists = { spaces: null, channels: new Map() };
  // The loads under way: the spaces', and each space's channels'.
  let spacesLoad: Promise<void> | undefined;
  const channelLoads = new Map<string, Promise<void>>();
  // The IDs a held list lacked and was loaded again for (a channel made
  // since), so each is asked for once.
  const askedAgain = new Set<string>();

  // Whether a list should be loaded for an ID: it isn't held, or it
  // lacks the ID and hasn't been loaded again for it.
  const needs = (held: { id: string }[] | null | undefined, id: string) => {
    if (!held) return true;
    if (held.some((entry) => entry.id === id) || askedAgain.has(id)) return false;
    askedAgain.add(id);
    return true;
  };

  // Each resolves when its list has landed or failed, and is undefined
  // when there is nothing to wait for. A failed load keeps what was
  // held and may be asked for again.
  const spacesFor = (spaceId: string) => {
    if (spacesLoad || !needs(lists.spaces, spaceId)) return spacesLoad;
    spacesLoad = load
      .spaces()
      .then(
        (spaces) => {
          lists.spaces = spaces;
        },
        () => {
          askedAgain.delete(spaceId);
        },
      )
      .finally(() => {
        spacesLoad = undefined;
      });
    return spacesLoad;
  };

  const channelsFor = (spaceId: string, channelId: string) => {
    const going = channelLoads.get(spaceId);
    if (going || !needs(lists.channels.get(spaceId), channelId)) return going;
    const loading = load
      .channels(spaceId)
      .then(
        (channels) => {
          lists.channels.set(spaceId, channels);
        },
        () => {
          askedAgain.delete(channelId);
        },
      )
      .finally(() => {
        channelLoads.delete(spaceId);
      });
    channelLoads.set(spaceId, loading);
    return loading;
  };

  const names = async (item: Where): Promise<PlaceNames> => {
    if (!item.spaceId) return {};
    const loads = [spacesFor(item.spaceId), channelsFor(item.spaceId, item.channelId)].filter(
      (loading) => loading !== undefined,
    );
    if (loads.length > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waited = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, waitMs);
      });
      await Promise.race([Promise.all(loads), waited]);
      clearTimeout(timer);
    }
    return namesIn(lists, item);
  };

  return { names };
}
