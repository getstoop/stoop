import { createContext, useContext } from "react";
import type { Animated } from "react-native";

// The opacity a skeleton's blocks share, so they pulse together
// (SkeletonPulse.tsx sets it going); undefined outside one, where a
// block is drawn still.
export const PulseContext = createContext<Animated.Value | undefined>(undefined);

export function usePulse(): Animated.Value | undefined {
  return useContext(PulseContext);
}
