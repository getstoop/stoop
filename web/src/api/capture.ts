import type { VoiceConnection } from "../stores/voice";
import type { VoiceReport } from "./platform";

// What Stoop is capturing right now, as one state every surface draws:
// the rail and header pills, the tab and the desktop strip.

export type CaptureKind =
  | "none"
  | "joining"
  | "error"
  | "muted"
  | "mic"
  | "camera"
  | "screen";

export interface Capture {
  kind: CaptureKind;
  mic: boolean;
  camera: boolean;
  screen: boolean;
}

export interface CaptureInput {
  connection: VoiceConnection | null;
  muted: boolean;
  cameraOn: boolean;
  screenOn: boolean;
}

const NOTHING = { mic: false, camera: false, screen: false };

// The loudest live thing decides the kind: screen, then camera, then mic.
export function captureState({
  connection,
  muted,
  cameraOn,
  screenOn,
}: CaptureInput): Capture {
  if (!connection) return { kind: "none", ...NOTHING };
  if (connection.status === "error") return { kind: "error", ...NOTHING };
  if (connection.status === "connecting")
    return { kind: "joining", ...NOTHING };
  const capture = { mic: !muted, camera: cameraOn, screen: screenOn };
  const kind = screenOn
    ? "screen"
    : cameraOn
      ? "camera"
      : capture.mic
        ? "mic"
        : "muted";
  return { kind, ...capture };
}

export function isCapturing(c: Capture): boolean {
  return c.mic || c.camera || c.screen;
}

export function captureLabel(c: Capture): string {
  switch (c.kind) {
    case "joining":
      return "Joining voice…";
    case "error":
      return "Couldn't join voice";
    case "muted":
      return "In voice, muted";
    case "mic":
      return "Microphone live";
    case "camera":
      return "Camera on";
    case "screen":
      return "Sharing your screen";
    default:
      return "";
  }
}

// What the desktop shell is told: null outside voice, and names it cannot
// look up for itself. A name still loading is an ellipsis, not empty.
export function voiceReport(
  c: Capture,
  channel: string | undefined,
  space: string | undefined,
  deafened: boolean,
): VoiceReport | null {
  if (c.kind === "none") return null;
  return {
    kind: c.kind,
    mic: c.mic,
    camera: c.camera,
    screen: c.screen,
    deafened,
    channel: channel || "…",
    space: space || "…",
  };
}

// The tab is all a background tab has: a dot ahead of the title.
export function tabTitle(title: string, c: Capture): string {
  return isCapturing(c) ? `● ${title}` : title;
}
