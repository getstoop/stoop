import { Platform } from "react-native";
import BackButton from "./BackButton";
import { backItem } from "./backItem";

// The screen's own back button in place of the stack's, which pops natively
// with nothing able to ask first. A native block (usePreventRemove) crashed
// Android, so what asks is this button's press. With no native back button,
// iOS has no long-press back menu either.
export function backOptions(onPress: () => void, tint: string) {
  return Platform.OS === "ios"
    ? { headerBackVisible: false, unstable_headerLeftItems: () => [backItem(onPress, tint)] }
    : { headerBackVisible: false, headerLeft: () => <BackButton onPress={onPress} /> };
}
