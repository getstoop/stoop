import type { Outcome } from "@stoop/core/channelScreen";
import { useRouter } from "expo-router";
import { hostOf } from "../../api/probe";
import type { SavedServer } from "../../servers";
import Unavailable from "./Unavailable";

// What a channel or a thread says when its channel can't be shown: the
// sign-in ended, the channel gone, or the server out of reach, with the
// screen's own way to try again (a thread also opens itself again).
export default function ChannelOutcome({
  outcome,
  server,
  spaceId,
  onRetry,
}: {
  outcome: Outcome;
  server: SavedServer;
  spaceId: string;
  onRetry: () => void;
}) {
  const router = useRouter();
  if (outcome === "ended") {
    return (
      <Unavailable
        message={`Your sign-in to ${server.name} has ended. Sign in again to carry on.`}
        action={{
          label: "Sign in again",
          onPress: () => router.replace({ pathname: "/sign-in", params: { server: server.origin } }),
        }}
      />
    );
  }
  if (outcome === "gone") {
    return <Unavailable message={`This ${spaceId ? "channel" : "conversation"} isn't available any more.`} />;
  }
  return (
    <Unavailable message={`Couldn't reach ${hostOf(server.origin)}.`} action={{ label: "Try again", onPress: onRetry }} />
  );
}
