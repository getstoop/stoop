import { useLocalSearchParams } from "expo-router";
import Channel from "../../../../../../screens/Channel";
import { useCurrentServer } from "../../../../../../servers";

export default function ChannelRoute() {
  const { spaceId, channelId } = useLocalSearchParams<{ spaceId: string; channelId: string }>();
  return <Channel server={useCurrentServer()} spaceId={spaceId} channelId={channelId} />;
}
