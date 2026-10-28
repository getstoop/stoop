import { useLocalSearchParams } from "expo-router";
import Channel from "../../../../../../../screens/Channel";
import { useCurrentServer } from "../../../../../../../servers";

export default function ChannelRoute() {
  const { spaceId, channelId, focus } = useLocalSearchParams<{ spaceId: string; channelId: string; focus?: string }>();
  return <Channel server={useCurrentServer()} spaceId={spaceId} channelId={channelId} focusId={focus} />;
}
