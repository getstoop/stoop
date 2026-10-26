import type { Attachment } from "@stoop/gen/stoop/chat/v1/message_pb";
import { createVideoPlayer, type VideoPlayer } from "expo-video";
import { createContext, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { fileSource } from "../../api/downloads";
import { markUnplayable } from "./unplayable";

// The audio a screen of messages plays: one file at a time, on one
// expo-video player with no view (AVPlayer, ExoPlayer play audio files
// as well as video), made when a file's Play is first tapped and
// released when another starts, the file fails, or the screen goes.
// Starting one stops the other. The screen pauses it whenever it is not
// the one in front (useAudioPlayback): a player with no view isn't
// paused by the system when the app goes to the background, and nothing
// here plays there. A file the phone can't decode joins the unplayable
// ones, and the timeline draws it as the card that shares it.
//
// The player keeps expo-video's audio session: on iOS the playback
// category, so a tapped Play is heard with the silent switch on, as a
// video in the viewer is, and other apps' audio stops while it plays.

// What the file being played is doing; null for every other file.
export type AudioState = { fileId: string; playing: boolean; position: number; duration: number };

// How often the position moves, in seconds.
const TICK = 0.25;

export class AudioPlayback {
  private player: VideoPlayer | null = null;
  private subscriptions: { remove: () => void }[] = [];
  private state: AudioState | null = null;
  // Each file's length once a player has read it, so a file played
  // before shows it at rest.
  private durations = new Map<string, number>();
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  stateOf = (fileId: string) => (this.state?.fileId === fileId ? this.state : null);

  durationOf = (fileId: string) => this.durations.get(fileId) ?? 0;

  // Play or Pause on a file's player.
  toggle(origin: string, token: string, attachment: Attachment) {
    const { player, state } = this;
    if (player && state?.fileId === attachment.fileId) {
      if (state.playing) player.pause();
      else player.play();
      this.update({ playing: !state.playing });
      return;
    }
    this.release();
    this.start(origin, token, attachment.fileId);
  }

  // Moves the playing file to `seconds`, playing or not.
  seek(fileId: string, seconds: number) {
    const { player, state } = this;
    if (!player || state?.fileId !== fileId || state.duration <= 0) return;
    const position = Math.max(0, Math.min(seconds, state.duration));
    player.currentTime = position;
    this.update({ position });
  }

  pause() {
    if (!this.player || !this.state?.playing) return;
    this.player.pause();
    this.update({ playing: false });
  }

  release() {
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions = [];
    this.player?.release();
    this.player = null;
    if (this.state) this.set(null);
  }

  private start(origin: string, token: string, fileId: string) {
    const player = createVideoPlayer(fileSource(origin, token, fileId));
    player.timeUpdateEventInterval = TICK;
    // Playing shows only once sound comes out, and goes while it waits
    // for data; a pause that comes from elsewhere (a call, another app
    // taking the sound) is a pause here once it has started.
    let heard = false;
    this.subscriptions = [
      player.addListener("sourceLoad", ({ duration }) => {
        if (duration > 0) this.durations.set(fileId, duration);
        this.update({ duration });
      }),
      player.addListener("timeUpdate", ({ currentTime }) => this.update({ position: currentTime })),
      player.addListener("playingChange", ({ isPlaying }) => {
        if (isPlaying) heard = true;
        else if (heard && player.status === "readyToPlay") this.update({ playing: false });
      }),
      player.addListener("playToEnd", () => {
        player.pause();
        player.currentTime = 0;
        heard = false;
        this.update({ playing: false, position: 0 });
      }),
      player.addListener("statusChange", ({ status }) => {
        if (status !== "error") return;
        markUnplayable(fileId);
        this.release();
      }),
    ];
    this.player = player;
    this.set({ fileId, playing: true, position: 0, duration: this.durationOf(fileId) });
    player.play();
  }

  private update(change: Partial<AudioState>) {
    if (this.state) this.set({ ...this.state, ...change });
  }

  private set(state: AudioState | null) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

// A screen's playback, for its rows (AudioPlayer, through MessageContexts).
// Without one a file that could play is drawn as its card (index.tsx).
export const AudioContext = createContext<AudioPlayback | null>(null);

// The screen's one playback: paused while `active` is false (the screen
// covered, the app leaving the front, the viewer open) and released with
// the screen.
export function useAudioPlayback(active: boolean) {
  const [playback] = useState(() => new AudioPlayback());
  useEffect(() => () => playback.release(), [playback]);
  useEffect(() => {
    if (!active) playback.pause();
  }, [active, playback]);
  return playback;
}

// One file's part of it: its state while it is the one being played,
// and its length once known.
export function useAudioFile(playback: AudioPlayback, fileId: string) {
  const state = useSyncExternalStore(
    playback.subscribe,
    useCallback(() => playback.stateOf(fileId), [playback, fileId]),
  );
  const duration = useSyncExternalStore(
    playback.subscribe,
    useCallback(() => playback.durationOf(fileId), [playback, fileId]),
  );
  return { state, duration: state?.duration || duration };
}
