import { useMemo } from "react";
import { useVoiceStore } from "../stores/voice";

// Who gets a ring: everyone LiveKit reports as active, plus ourselves as
// soon as our own mic goes loud (api/voiceLevel.ts).
export function useSpeaking(): ReadonlySet<string> {
  const speaking = useVoiceStore((s) => s.speaking);
  const local = useVoiceStore((s) => s.localSpeaking);
  return useMemo(
    () =>
      local && !speaking.has(local) ? new Set(speaking).add(local) : speaking,
    [speaking, local],
  );
}
