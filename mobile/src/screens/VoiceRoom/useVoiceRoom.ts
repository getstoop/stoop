import { Code, ConnectError } from "@connectrpc/connect";
import type { Outcome } from "@stoop/core/channelScreen";
import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import type { Member } from "@stoop/gen/stoop/chat/v1/member_pb";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { loadSpaceChannels, touchesSpace } from "../../api/channels";
import { sessionToken } from "../../api/servers";
import { useServerEvents } from "../../realtime/RealtimeProvider";
import type { SavedServer } from "../../servers";
import { afterLoad } from "../Spaces/reloads";
import { useQuietReload } from "../Spaces/useQuietReload";

export type RoomView =
  | { state: "loading" }
  | {
      state: "ready";
      token: string;
      channel: Channel;
      space: Space;
      // By user ID, to name who is in the room.
      members: Record<string, Member>;
    }
  | { state: Outcome };

// What a voice room's screen shows besides who is in it (the roster's,
// live from the socket): the room, its space and the space's members,
// loaded as the Spaces tab's pane loads them, and again, after a
// moment's quiet, when the socket says something in the space changed
// or the app comes back. A reload that fails keeps what is shown; a
// room no longer among the space's voice channels is gone.
export function useVoiceRoom(
  server: SavedServer,
  spaceId: string,
  channelId: string,
): { view: RoomView; reload: () => Promise<void>; retry: () => void } {
  const [view, setView] = useState<RoomView>({ state: "loading" });

  const load = useCallback(async (): Promise<RoomView> => {
    const token = await sessionToken(server.id).catch(() => null);
    if (!token) return { state: "ended" };
    try {
      const { space, voice, members } = await loadSpaceChannels(server.origin, token, spaceId);
      const channel = voice.find((room) => room.id === channelId);
      return channel ? { state: "ready", token, channel, space, members } : { state: "gone" };
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.Unauthenticated) return { state: "ended" };
      if (err instanceof ConnectError && (err.code === Code.NotFound || err.code === Code.PermissionDenied)) {
        return { state: "gone" };
      }
      return { state: "failed" };
    }
  }, [server, spaceId, channelId]);

  // Loads can overlap: only the latest started is shown, and leaving
  // the screen makes none the latest.
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++latest.current;
    const loaded = await load();
    if (mine === latest.current) setView((shown) => afterLoad(shown, loaded));
  }, [load]);

  const quiet = useQuietReload(reload);
  useEffect(() => {
    setView({ state: "loading" });
    reload();
    const sub = AppState.addEventListener("change", (state) => state === "active" && quiet.now());
    return () => {
      latest.current++;
      sub.remove();
    };
  }, [reload, quiet]);
  useServerEvents(server.id, (event) => {
    if (event.payload.case === "credentialRevoked") {
      latest.current++;
      setView({ state: "ended" });
    } else if (touchesSpace(event, spaceId)) quiet.soon();
  });

  const retry = useCallback(() => {
    setView({ state: "loading" });
    reload();
  }, [reload]);

  return { view, reload, retry };
}
