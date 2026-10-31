import { useLocalSearchParams } from "expo-router";
import Channel from "../../../../../screens/Channel";
import { useCurrentServer } from "../../../../../servers";

// A direct message: the channel screen with no space.
export default function ConversationRoute() {
  const { channelId, focus } = useLocalSearchParams<{ channelId: string; focus?: string }>();
  return <Channel server={useCurrentServer()} spaceId="" channelId={channelId} focusId={focus} />;
}
