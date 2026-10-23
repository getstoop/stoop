import { useEffect, useSyncExternalStore } from "react";
import { useEventSubscription } from "../../realtime/RealtimeProvider";
import type { SavedServer } from "../../servers";
import { channelEngine } from "./channelEngine";

// The channel's log for a screen showing it (channelEngine), held while
// the screen is mounted, with the thread on rootId's view open for a
// thread screen: one log for the channel and a thread pushed over it,
// gone with the last screen holding it. Another channel in the same
// screen is another log, in the same render.
export function useChannelLog(server: SavedServer, spaceId: string, channelId: string, rootId?: string) {
  const engine = channelEngine(server, spaceId, channelId, useEventSubscription());
  useEffect(() => {
    const release = engine.hold();
    const close = rootId === undefined ? undefined : engine.holdThread(rootId);
    return () => {
      close?.();
      release();
    };
  }, [engine, rootId]);
  const state = useSyncExternalStore(engine.subscribe, engine.current);
  return { state, engine };
}
