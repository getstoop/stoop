import { useEffect, useState, useSyncExternalStore } from "react";
import { useEventSubscription } from "../../realtime/RealtimeProvider";
import type { SavedServer } from "../../servers";
import { channelEngine, engineKey, holdEngine } from "./channelEngine";

// The channel's log for a screen showing it (channelEngine), held while
// the screen is mounted, with the thread on rootId's view open for a
// thread screen: one log for the channel and a thread pushed over it,
// gone with the last screen holding it. Until the screen has held it the
// screen draws an engine nothing else knows of, which holding replaces
// with the one already held for the channel, if any. Another channel in
// the same screen is another log, in the same render.
export function useChannelLog(server: SavedServer, spaceId: string, channelId: string, rootId?: string) {
  const subscribe = useEventSubscription();
  const [engine, setEngine] = useState(() => channelEngine(server, spaceId, channelId, subscribe));
  const key = engineKey(server, channelId);
  const shown = engine.key === key ? engine : channelEngine(server, spaceId, channelId, subscribe);
  if (shown !== engine) setEngine(shown);
  useEffect(() => {
    const held = holdEngine(shown, rootId);
    if (held.engine !== shown) setEngine(held.engine);
    return held.release;
  }, [shown, rootId]);
  const state = useSyncExternalStore(shown.subscribe, shown.current);
  return { state, engine: shown };
}
