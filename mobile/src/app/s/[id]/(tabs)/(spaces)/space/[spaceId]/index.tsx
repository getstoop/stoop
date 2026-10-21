import { useLocalSearchParams } from "expo-router";
import Space from "../../../../../../../screens/Space";
import { useCurrentServer } from "../../../../../../../servers";

export default function SpaceRoute() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  return <Space server={useCurrentServer()} spaceId={spaceId} />;
}
