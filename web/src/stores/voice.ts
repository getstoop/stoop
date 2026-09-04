import type { Track } from "livekit-client";
import { create } from "zustand";
import type { VoiceParticipant } from "../gen/stoop/realtime/v1/realtime_pb";

// Voice state: who is in which voice channel (from the gateway's Ready
// snapshot + VoiceStateChanged), and our own connection. The LiveKit Room
// itself lives in src/api/voice.ts; this store is what the UI renders.

export type VoiceStatus = "connecting" | "connected" | "error";

export type VideoSource = "camera" | "screen";

// A video track on the stage: someone's camera or screen (ours included,
// for the self-view). The Track object is livekit-client's; tiles attach
// it to a <video>. `order` is arrival order, so the newest share wins
// the spotlight.
export interface VideoTrackRef {
  key: string;
  participantId: string;
  source: VideoSource;
  track: Track;
  local: boolean;
  order: number;
}

export function trackKey(participantId: string, source: VideoSource) {
  return `${participantId}:${source}`;
}

export interface VoiceConnection {
  spaceId: string;
  channelId: string;
  status: VoiceStatus;
  error?: string;
}

interface VoiceState {
  // userId → participant. A user is in at most one voice channel.
  participants: Record<string, VoiceParticipant>;
  connection: VoiceConnection | null;
  muted: boolean;
  deafened: boolean;
  // Users LiveKit currently reports as speaking (identity = user id).
  speaking: Set<string>;
  // Our own user id while our mic is loud, else null. Measured locally
  // (api/voiceLevel.ts) and held apart from `speaking`, which every
  // server update replaces wholesale.
  localSpeaking: string | null;
  // The browser refused to autoplay audio; a user gesture is needed.
  audioBlocked: boolean;
  // Video on the stage, keyed by trackKey().
  tracks: Record<string, VideoTrackRef>;
  cameraOn: boolean;
  screenOn: boolean;
  // Why the last camera / share attempt failed, for the VoiceBar.
  videoError: string | null;
  setParticipants: (list: VoiceParticipant[]) => void;
  applyChange: (p: VoiceParticipant, joined: boolean) => void;
  dropChannel: (channelId: string) => void;
  setConnection: (c: VoiceConnection | null) => void;
  setMuted: (muted: boolean) => void;
  setDeafened: (deafened: boolean) => void;
  setSpeaking: (ids: string[]) => void;
  setLocalSpeaking: (userId: string | null) => void;
  setAudioBlocked: (blocked: boolean) => void;
  setTrack: (ref: Omit<VideoTrackRef, "order">) => void;
  removeTrack: (key: string) => void;
  clearTracks: () => void;
  setCameraOn: (on: boolean) => void;
  setScreenOn: (on: boolean) => void;
  setVideoError: (err: string | null) => void;
}

let trackOrder = 0;

export const useVoiceStore = create<VoiceState>((set) => ({
  participants: {},
  connection: null,
  muted: false,
  deafened: false,
  speaking: new Set(),
  localSpeaking: null,
  audioBlocked: false,
  tracks: {},
  cameraOn: false,
  screenOn: false,
  videoError: null,
  setParticipants: (list) =>
    set({
      participants: Object.fromEntries(list.map((p) => [p.userId, p])),
    }),
  applyChange: (p, joined) =>
    set((s) => {
      const participants = { ...s.participants };
      if (joined) participants[p.userId] = p;
      else if (participants[p.userId]?.channelId === p.channelId)
        delete participants[p.userId];
      return { participants };
    }),
  dropChannel: (channelId) =>
    set((s) => ({
      participants: Object.fromEntries(
        Object.entries(s.participants).filter(
          ([, p]) => p.channelId !== channelId,
        ),
      ),
    })),
  setConnection: (connection) =>
    set(
      connection
        ? { connection }
        : { connection, speaking: new Set(), localSpeaking: null },
    ),
  setMuted: (muted) => set({ muted }),
  setDeafened: (deafened) => set({ deafened }),
  setSpeaking: (ids) => set({ speaking: new Set(ids) }),
  setLocalSpeaking: (localSpeaking) => set({ localSpeaking }),
  setAudioBlocked: (audioBlocked) => set({ audioBlocked }),
  setTrack: (ref) =>
    set((s) => ({
      tracks: {
        ...s.tracks,
        [ref.key]: { ...ref, order: s.tracks[ref.key]?.order ?? ++trackOrder },
      },
    })),
  removeTrack: (key) =>
    set((s) => {
      if (!(key in s.tracks)) return {};
      const tracks = { ...s.tracks };
      delete tracks[key];
      return { tracks };
    }),
  clearTracks: () =>
    set({ tracks: {}, cameraOn: false, screenOn: false, videoError: null }),
  setCameraOn: (cameraOn) => set({ cameraOn }),
  setScreenOn: (screenOn) => set({ screenOn }),
  setVideoError: (videoError) => set({ videoError }),
}));

// Everyone in one voice channel.
export function participantsIn(
  participants: Record<string, VoiceParticipant>,
  channelId: string,
): VoiceParticipant[] {
  return Object.values(participants).filter((p) => p.channelId === channelId);
}
