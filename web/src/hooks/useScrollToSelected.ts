import { type RefObject, useLayoutEffect } from "react";

// Keeps an arrow-key list's selected row in view, scrolling the list alone
// so the page under it stays put.
export function useScrollToSelected(
  listRef: RefObject<HTMLElement | null>,
  selected: number,
) {
  useLayoutEffect(() => {
    const list = listRef.current;
    const row = list?.children[selected] as HTMLElement | undefined;
    if (!list || !row) return;
    // The first row takes the list's top padding with it.
    const top = selected === 0 ? 0 : row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }, [listRef, selected]);
}
