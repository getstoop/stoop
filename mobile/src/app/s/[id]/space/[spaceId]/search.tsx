import { useLocalSearchParams } from "expo-router";
import Search from "../../../../../screens/Search";
import { useCurrentServer } from "../../../../../servers";

// ?c= is the channel the search started from and ?q= a query to run
// on opening, as web's search page takes them.
export default function SearchRoute() {
  const { spaceId, c, q } = useLocalSearchParams<{ spaceId: string; c?: string; q?: string }>();
  return <Search server={useCurrentServer()} spaceId={spaceId} channelId={c} query={q} />;
}
