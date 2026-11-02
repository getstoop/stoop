import { Alert } from "react-native";

// The system's ask before unsaved edits go. Android's back, or a tap outside,
// keeps editing, as Keep editing does.
export function confirmDiscard(onDiscard: () => void) {
  Alert.alert(
    "Discard your changes?",
    undefined,
    [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onDiscard },
    ],
    { cancelable: true },
  );
}
