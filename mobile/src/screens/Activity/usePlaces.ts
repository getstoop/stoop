import type { ActivityItem } from "@stoop/gen/stoop/chat/v1/activity_pb";
import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadChannelList, loadSpaceList } from "../../api/activity";

export type Places = {
  // A row's channel's name, or undefined while it isn't known.
  channelName: (item: ActivityItem) => string | undefined;
  // A row's space's name, only when the account is in more than one.
  spaceName: (item: ActivityItem) => string | undefined;
};

// Where the rows point: an item carries only IDs, so the spaces are
// listed once and each space's channels once it shows in the feed, kept
// for as long as the tab is mounted. A row naming a channel or a space
// the lists didn't have (made since) asks for its list once more; a
// failed ask goes again when the feed next changes.
export function usePlaces(origin: string, token: string | null, items: ActivityItem[]): Places {
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [channels, setChannels] = useState<Record<string, Channel[]>>({});
  // What each list was asked for, by space ("" for the spaces), so an ID
  // still missing after its ask isn't asked for again.
  const asked = useRef(new Map<string, Set<string>>());
  const inFlight = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const ask = useCallback(
    (key: string, wanted: string[]) => {
      if (!token || inFlight.current.has(key)) return;
      const before = asked.current.get(key);
      if (before && wanted.every((id) => before.has(id))) return;
      inFlight.current.add(key);
      asked.current.set(key, new Set([...(before ?? []), ...wanted]));
      const done = () => inFlight.current.delete(key);
      const failed = () => {
        done();
        asked.current.set(key, before ?? new Set());
      };
      if (key === "") {
        loadSpaceList(origin, token)
          .then((list) => alive.current && setSpaces(list))
          .then(done, failed);
      } else {
        loadChannelList(origin, token, key)
          .then((list) => alive.current && setChannels((all) => ({ ...all, [key]: list })))
          .then(done, failed);
      }
    },
    [origin, token],
  );

  useEffect(() => {
    const placed = items.filter((item) => item.spaceId);
    const missingSpaces = placed
      .map((item) => item.spaceId)
      .filter((id) => !spaces?.some((space) => space.id === id));
    if (!spaces || missingSpaces.length > 0) ask("", missingSpaces);
    const bySpace = new Map<string, string[]>();
    for (const item of placed) {
      if (channels[item.spaceId]?.some((channel) => channel.id === item.channelId)) continue;
      bySpace.set(item.spaceId, [...(bySpace.get(item.spaceId) ?? []), item.channelId]);
    }
    for (const [spaceId, wanted] of bySpace) ask(spaceId, wanted);
  }, [items, spaces, channels, ask]);

  const channelName = useCallback(
    (item: ActivityItem) => channels[item.spaceId]?.find((channel) => channel.id === item.channelId)?.name,
    [channels],
  );
  const spaceName = useCallback(
    (item: ActivityItem) =>
      spaces && spaces.length > 1 ? spaces.find((space) => space.id === item.spaceId)?.name : undefined,
    [spaces],
  );
  return { channelName, spaceName };
}
