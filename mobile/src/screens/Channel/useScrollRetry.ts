import { type RefObject, useCallback, useRef } from "react";
import type { FlatList } from "react-native";

// A list's onScrollToIndexFailed, for a scroll to a row not measured yet:
// get near, then try again once drawn, for the same row, since a page or an
// arrival may have moved it meanwhile (a row gone meanwhile is nothing to
// land on).
export function useScrollRetry<Row extends { key: string }>(list: RefObject<FlatList<Row> | null>, rows: Row[]) {
  // The latest rows, for the try after they may have shifted.
  const latest = useRef(rows);
  latest.current = rows;
  return useCallback(
    ({ index }: { index: number }) => {
      const key = latest.current[index]?.key;
      list.current?.scrollToOffset({ offset: index * 60, animated: false });
      setTimeout(() => {
        const again = latest.current.findIndex((row) => row.key === key);
        if (again >= 0) list.current?.scrollToIndex({ index: again, viewPosition: 0.5, animated: false });
      }, 100);
    },
    [list],
  );
}
