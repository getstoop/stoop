import { useLocalSearchParams } from "expo-router";
import Thread from "../../../../../../screens/Thread";
import { useCurrentServer } from "../../../../../../servers";

// A thread in a direct message: the thread screen with no space.
export default function ConversationThreadRoute() {
  const { channelId, rootId, focus } = useLocalSearchParams<{ channelId: string; rootId: string; focus?: string }>();
  return <Thread server={useCurrentServer()} spaceId="" channelId={channelId} rootId={rootId} focusId={focus} />;
}
