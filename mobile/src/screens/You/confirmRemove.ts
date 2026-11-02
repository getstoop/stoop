import { Alert } from "react-native";
import type { SavedServer } from "../../servers";

// The system's confirm before a server comes off this phone.
export function confirmRemove(server: SavedServer, onRemove: () => void) {
  Alert.alert(
    `Remove ${server.name} from this phone?`,
    "You'll be signed out of it, and need to add it and sign in again to come back.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: onRemove },
    ],
  );
}
