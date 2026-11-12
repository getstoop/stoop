import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { useEffect, useState } from "react";
import { pickSpace } from "./railRules";

// Which space the Spaces tab shows: the one last picked on the rail,
// held only while the tab is mounted, so a server opens on its first
// space. When the picked one is no longer in the list (left, removed,
// deleted) the first takes its place, and what is held follows, so the
// old one coming back does not take the selection with it. Opening a
// channel from elsewhere (search, Activity, a notification) picks
// nothing here.
export function useSelectedSpace(spaces: readonly Space[] | undefined): {
  selected: string | undefined;
  select: (spaceId: string) => void;
} {
  const [wanted, setWanted] = useState<string | undefined>(undefined);
  const selected = spaces ? pickSpace(spaces, wanted) : undefined;
  useEffect(() => {
    if (spaces && selected !== wanted) setWanted(selected);
  }, [spaces, selected, wanted]);
  return { selected, select: setWanted };
}
