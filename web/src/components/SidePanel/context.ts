import { createContext, useContext } from "react";
import { useSidePanelStore } from "../../stores/sidePanel";

// What the container hands the frame: how to close (on a narrow screen
// that also pops the history entry the panel added), and whether the
// panel is on its way out, animating, with left() to call when it is gone.
interface PanelControls {
  close: () => void;
  leaving: boolean;
  left: () => void;
  // It came from closed, so it slides in; replaced content doesn't.
  entering: boolean;
}

export const SidePanelControls = createContext<PanelControls | null>(null);

export function useCloseSidePanel(): () => void {
  const controls = useContext(SidePanelControls);
  const storeClose = useSidePanelStore((s) => s.close);
  return controls?.close ?? storeClose;
}

export function usePanelMotion(): {
  entering: boolean;
  leaving: boolean;
  left: () => void;
} {
  const controls = useContext(SidePanelControls);
  return {
    entering: controls?.entering ?? true,
    leaving: controls?.leaving ?? false,
    left: controls?.left ?? (() => {}),
  };
}
