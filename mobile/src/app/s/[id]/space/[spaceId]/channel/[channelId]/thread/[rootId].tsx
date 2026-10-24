import { useLocalSearchParams } from "expo-router";
import Thread from "../../../../../../../../screens/Thread";
import { useCurrentServer } from "../../../../../../../../servers";

export default function ThreadRoute() {
  const { spaceId, channelId, rootId, focus } = useLocalSearchParams<{
    spaceId: string;
    channelId: string;
    rootId: string;
    focus?: string;
  }>();
  return <Thread server={useCurrentServer()} spaceId={spaceId} channelId={channelId} rootId={rootId} focusId={focus} />;
}
