import { NativeTabs } from "expo-router/native-tabs";
import ServerChip from "./ServerChip";

// The server chip in the system tab bar's own slot (iOS 26,
// (tabs)/_layout.ios.tsx). The system keeps two copies of what is in the
// slot, the one over the bar and one inline in a bar shrunk by a scroll;
// ours never shrinks, so the inline copy draws nothing, and there is one
// chip to find and one reader of the badges.
export default function ServerChipSlot() {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  if (placement === "inline") return null;
  return <ServerChip bare />;
}
