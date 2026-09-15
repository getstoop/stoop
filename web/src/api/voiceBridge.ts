import type { QueryClient } from "@tanstack/react-query";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import { useLayoutStore } from "../stores/layout";
import { useVoiceStore } from "../stores/voice";
import { captureState, voiceReport } from "./capture";
import {
  onShellVoiceAction,
  reportVoice,
  shellDrawsVoice,
  type VoiceAction,
} from "./platform";
import { channelsQuery } from "./queries";
import { toggleCamera, toggleMute, toggleScreenShare } from "./voice";

// Keeps the desktop shell's strip and tray in step with this page's voice
// state, and carries out what they ask. A no-op wherever the shell does
// not draw the indicator. Returns the stop.
export function startVoiceBridge(queryClient: QueryClient): () => void {
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
  const unlisten = onShellVoiceAction(act);
  return () => {
    unwatchVoice();
    unwatchCache();
    unlisten();
    reportVoice(null);
  };
}

// Each action is a request for a state, not a toggle: a tray click that
// arrives after the page already changed must not flip it back.
function act(action: VoiceAction) {
  const voice = useVoiceStore.getState();
  switch (action) {
    case "open": {
      const layout = useLayoutStore.getState();
      layout.setShellLiveOpen(!layout.shellLiveOpen);
      break;
    }
    case "mute":
      if (!voice.muted) void toggleMute();
      break;
    case "camera-off":
      if (voice.cameraOn) void toggleCamera();
      break;
    case "stop-screen":
      if (voice.screenOn) void toggleScreenShare();
      break;
  }
}
