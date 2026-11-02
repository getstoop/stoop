import { type RefObject, useCallback, useEffect, useState } from "react";
import type { FlatList } from "react-native";

// Back to the newest edge of an upside-down list once the reader has sent
// something, from however far up they had scrolled (the list only follows a
// row by itself when already near that edge). In an effect, so the row is in
// the list first. Not animated: on Android, an animated scroll from far up
// stopped short of the edge, leaving the row out of sight.
export function useFollowSend<T>(list: RefObject<FlatList<T> | null>) {
  const [sends, setSends] = useState(0);
  useEffect(() => {
    if (sends > 0) list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [sends, list]);
  return useCallback(() => setSends((count) => count + 1), []);
}
