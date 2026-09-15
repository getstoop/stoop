import type { QueryClient } from "@tanstack/react-query";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import { useVoiceStore } from "../stores/voice";
import { captureState, voiceReport } from "./capture";
import {
  onShellVoiceAction,
  reportVoice,
  shellDrawsVoice,
  type VoiceAction,
} from "./platform";
import { channelsQuery } from "./queries";
import {
  leaveVoice,
  toggleCamera,
  toggleMute,
  toggleScreenShare,
} from "./voice";

// Keeps the desktop shell's strip, popover and tray in step with this
// page's voice state, and carries out what they ask. A no-op wherever the
// shell does not draw the indicator. `show` opens a channel. Returns the
// stop.
export function startVoiceBridge(
  queryClient: QueryClient,
  show: (spaceId: string, channelId: string) => void,
): () => void {
  if (!shellDrawsVoice()) return () => {};

  let last = "";
  const report = () => {
    const voice = useVoiceStore.getState();
    const spaceId = voice.connection?.spaceId ?? "";
    const space = queryClient
      .getQueryData<Space[]>(["spaces"])
      ?.find((s) => s.id === spaceId);
    const channel = queryClient
      .getQueryData<Channel[]>(channelsQuery(spaceId).queryKey)
      ?.find((c) => c.id === voice.connection?.channelId);
    const next = voiceReport(captureState(voice), channel?.name, space?.name);
    // Moving channels is not leaving voice: keep the strip as it is until
    // the new call reports, so it neither exits nor arrives again.
    if (next === null && voice.switching) return;
    const key = JSON.stringify(next);
    if (key === last) return;
    last = key;
    reportVoice(next);
  };

  report();
  const unwatchVoice = useVoiceStore.subscribe(report);
  const unwatchCache = queryClient.getQueryCache().subscribe((event) => {
    const head = event.query.queryKey[0];
    if (head === "spaces" || head === "channels") report();
  });
  const unlisten = onShellVoiceAction((action) => act(action, show));
  return () => {
    unwatchVoice();
    unwatchCache();
    unlisten();
    reportVoice(null);
  };
}

// Each action is a request for a state, not a toggle: a click that arrives
// after the page already changed must not flip it back.
function act(
  action: VoiceAction,
  show: (spaceId: string, channelId: string) => void,
) {
  const voice = useVoiceStore.getState();
  switch (action) {
    case "show":
      if (voice.connection)
        show(voice.connection.spaceId, voice.connection.channelId);
      break;
    case "mute":
      if (!voice.muted) void toggleMute();
      break;
    case "unmute":
      if (voice.muted) void toggleMute();
      break;
    case "camera-on":
      if (!voice.cameraOn) void toggleCamera();
      break;
    case "camera-off":
      if (voice.cameraOn) void toggleCamera();
      break;
    case "stop-screen":
      if (voice.screenOn) void toggleScreenShare();
      break;
    // Voice started on another server the shell holds: one call at a time.
    case "leave":
      if (voice.connection) void leaveVoice();
      break;
  }
}
