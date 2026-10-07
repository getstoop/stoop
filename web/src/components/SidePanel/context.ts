import { createContext, useContext } from "react";
import { useSidePanelStore } from "../../stores/sidePanel";

// How content closes the panel: the container's close, which on a narrow
// screen also pops the history entry the panel added.
export const SidePanelClose = createContext<(() => void) | null>(null);

export function useCloseSidePanel(): () => void {
  const close = useContext(SidePanelClose);
  const storeClose = useSidePanelStore((s) => s.close);
  return close ?? storeClose;
}
