import { useLocalSearchParams } from "expo-router";
import VoiceRoom from "../../../../../../screens/VoiceRoom";
import { useCurrentServer } from "../../../../../../servers";

// ?focus= is the message to open the room's chat at.
export default function VoiceRoomRoute() {
  const { spaceId, channelId, focus } = useLocalSearchParams<{ spaceId: string; channelId: string; focus?: string }>();
  return <VoiceRoom server={useCurrentServer()} spaceId={spaceId} channelId={channelId} focusId={focus} />;
}
