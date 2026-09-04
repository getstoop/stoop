import { type RefObject, useLayoutEffect } from "react";

// Sizes a textarea to its content on every value change: one line when
// empty, growing as the text wraps. The CSS max-height caps it, after
// which the textarea scrolls internally.
export function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight is padding-box (content + padding). The textarea is
    // box-sizing: border-box, so the height must also include the border or
    // the content area ends up 2px short and the always-visible-scrollbar
    // setting shows a bar on a single empty line.
    const cs = getComputedStyle(el);
    const border =
      Number.parseFloat(cs.borderTopWidth) +
      Number.parseFloat(cs.borderBottomWidth);
    el.style.height = `${el.scrollHeight + border}px`;
  }, [ref, value]);
}
