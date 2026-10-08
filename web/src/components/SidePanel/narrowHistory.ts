import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import { useNarrowScreen } from "../../hooks/useNarrowScreen";
import { type OpenPanel, useSidePanelStore } from "../../stores/sidePanel";

const ENTRY = "stoopSidePanel";

// Whether a history entry is the one the panel added.
const isPanelEntry = (state: object) => Reflect.get(state, ENTRY) === true;

// On a narrow screen the panel is a full screen of its own, so it behaves
// like one: opening it adds a history entry and the device's Back closes
// it, and going to another page closes it. On a wide screen it is a column
// beside the page and history is left alone. Returns the close to use.
export function useNarrowHistory(open: OpenPanel | null): () => void {
  const router = useRouter();
  const narrow = useNarrowScreen();
  const close = useSidePanelStore((s) => s.close);
  // The page the entry was added on; null while there is no entry.
  const entryPath = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      entryPath.current = null;
      return;
    }
    if (!narrow) {
      // Wide again with the panel open (a resize, a rotation): it is a
      // column now, so its entry goes and the panel stays.
      if (entryPath.current) {
        entryPath.current = null;
        if (isPanelEntry(router.history.location.state)) router.history.back();
      }
      return;
    }
    if (entryPath.current) return;
    const location = router.history.location;
    entryPath.current = location.pathname;
    router.history.push(location.href, { ...location.state, [ENTRY]: true });
  }, [open, narrow, router]);

  useEffect(
    () =>
      router.history.subscribe(({ location, action }) => {
        if (!entryPath.current) return;
        const ours = isPanelEntry(location.state);
        const leftPage =
          (action.type === "PUSH" || action.type === "REPLACE") &&
          location.pathname !== entryPath.current;
        const backedOut =
          (action.type === "BACK" || action.type === "GO") && !ours;
        if (leftPage || backedOut) {
          entryPath.current = null;
          close();
        }
      }),
    [router, close],
  );

  return useCallback(() => {
    if (entryPath.current && isPanelEntry(router.history.location.state))
      router.history.back();
    else close();
  }, [router, close]);
}
