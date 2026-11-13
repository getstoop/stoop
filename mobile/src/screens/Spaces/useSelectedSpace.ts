import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useLastSpaceStore } from "../../lastSpace/LastSpaceProvider";
import { pickSpace } from "./railRules";

// Which space the Spaces tab shows: the one last picked on the rail of
// this server, remembered on the phone (src/lastSpace) so the tab opens
// there after a restart or a switch of servers. Nothing is selected
// until both the spaces and the remembered one are known (`settled`),
// so the tab never shows the first space and then jumps. When the
// remembered one is not in the list (left, removed, deleted, another
// account) the first takes its place, and what is remembered follows,
// so the old one coming back does not take the selection with it. A
// server with no spaces keeps what was remembered. Opening a channel
// from elsewhere (search, Activity, a notification) picks nothing here.
// A shared link to a space asks for it (the store's `ask`): it is
// picked if the account is in it, and the selection is left alone if
// not.
export function useSelectedSpace(
  serverId: string,
  spaces: readonly Space[] | undefined,
): {
  settled: boolean;
  selected: string | undefined;
  select: (spaceId: string) => void;
} {
  const store = useLastSpaceStore();
  const remembered = useSyncExternalStore(store.subscribe, store.current);
  const settled = spaces !== undefined && remembered !== undefined;
  const wanted = remembered?.[serverId];
  const selected = settled ? pickSpace(spaces, wanted) : undefined;
  useEffect(() => {
    if (selected !== undefined && selected !== wanted) store.remember(serverId, selected);
  }, [store, serverId, selected, wanted]);
  const asked = useSyncExternalStore(store.subscribe, () => store.asked(serverId));
  useEffect(() => {
    if (asked === undefined || spaces === undefined) return;
    if (spaces.some((space) => space.id === asked)) store.remember(serverId, asked);
    store.answered(serverId);
  }, [store, serverId, spaces, asked]);
  const select = useCallback((spaceId: string) => store.remember(serverId, spaceId), [store, serverId]);
  return { settled, selected, select };
}
