import { useLocalSearchParams } from "expo-router";
import VoiceRoom from "../../../../../../screens/VoiceRoom";
import { useCurrentServer } from "../../../../../../servers";

export default function VoiceRoomRoute() {
  const { spaceId, channelId } = useLocalSearchParams<{ spaceId: string; channelId: string }>();
  return <VoiceRoom server={useCurrentServer()} spaceId={spaceId} channelId={channelId} />;
}
