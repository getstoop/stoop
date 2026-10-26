import type { Attachment } from "@stoop/gen/stoop/chat/v1/message_pb";
import { createVideoPlayer, type VideoPlayer } from "expo-video";
import { createContext, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { fileSource } from "../../api/files";
import { whyFailed } from "./unplayable";

// The audio a screen of messages plays: one file at a time, on one
// expo-video player with no view (AVPlayer, ExoPlayer play audio files
// as well as video), made when a file's Play is first tapped and
// released when another starts, the file fails, its last row goes or
// the screen does. Starting one stops the other. The screen pauses it
// whenever it is not the one in front (useAudioPlayback): a player with
// no view isn't paused by the system when the app goes to the
// background, and nothing here plays there.
//
// A file the phone can't decode (unplayable.ts → whyFailed) joins the
// unplayable ones, and the timeline draws it as the card that shares it.
// One that couldn't load leaves the player, whose row says "Couldn't
// play · tap to retry" until Play is tapped again.
//
// The player keeps expo-video's audio session: on iOS the playback
// category, so a tapped Play is heard with the silent switch on, as a
// video in the viewer is, and other apps' audio stops while it plays.

// What the file being played is doing; null for every other file.
export type AudioState = { fileId: string; playing: boolean; position: number; duration: number };

// How often the position moves, in seconds.
const TICK = 0.25;
// How long a loaded file may sit without sound before Play shows again
// (a call in progress, the sound refused to the app).
const START_GRACE_MS = 2000;
// A seek stops this far short of the end, which would end the file.
const END_MARGIN = 0.1;

export class AudioPlayback {
  private player: VideoPlayer | null = null;
  private subscriptions: { remove: () => void }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private state: AudioState | null = null;
  // Each file's length once a player has read it, so a file played
  // before shows it at rest.
  private durations = new Map<string, number>();
  // Files whose last try failed in a way a retry may mend.
  private failed: ReadonlySet<string> = new Set();
  private listeners = new Set<() => void>();
  // How many rows show each file: a row moved in the list unmounts and
  // mounts again, and the player stays for it.
  private mounted = new Map<string, number>();
  // Each try at a file, so a late answer about an earlier one is dropped.
  private attempt = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  stateOf = (fileId: string) => (this.state?.fileId === fileId ? this.state : null);

  durationOf = (fileId: string) => this.durations.get(fileId) ?? 0;

  failedOf = (fileId: string) => this.failed.has(fileId);

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
    const position = Math.max(0, Math.min(seconds, state.duration - END_MARGIN));
    player.currentTime = position;
    this.update({ position });
  }

  // Always told to the player: what the row shows may lag what it does.
  pause() {
    if (!this.player) return;
    this.player.pause();
    this.update({ playing: false });
  }

  release() {
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions = [];
    this.clearTimer();
    this.player?.release();
    this.player = null;
    if (this.state) this.set(null);
  }

  // A row showing the file; what it returns is called as the row goes.
  // The player goes with the file's last row, a moment later, so a row
  // that only moved (a message above it deleted, a reply landing after
  // it) keeps it.
  mount(fileId: string) {
    this.mounted.set(fileId, (this.mounted.get(fileId) ?? 0) + 1);
    return () => {
      const left = (this.mounted.get(fileId) ?? 1) - 1;
      if (left > 0) this.mounted.set(fileId, left);
      else this.mounted.delete(fileId);
      setTimeout(() => {
        if (!this.mounted.has(fileId) && this.state?.fileId === fileId) this.release();
      }, 0);
    };
  }

  private start(origin: string, token: string, fileId: string) {
    const player = createVideoPlayer(fileSource(origin, token, fileId));
    const attempt = ++this.attempt;
    player.timeUpdateEventInterval = TICK;
    if (this.failed.has(fileId)) this.failed = new Set([...this.failed].filter((id) => id !== fileId));
    // Playing goes only once sound has come out and the player is not
    // waiting for data, so a stall reads as playing; a pause that comes
    // from elsewhere (a call, another app taking the sound) is a pause
    // here. After the end rewinds it, a late position is the end's.
    let heard = false;
    let loaded = false;
    let ended = false;
    this.subscriptions = [
      player.addListener("sourceLoad", ({ duration }) => {
        loaded = true;
        if (duration > 0) this.durations.set(fileId, duration);
        this.update({ duration });
        this.clearTimer();
        this.timer = setTimeout(() => {
          if (this.player === player && !player.playing) this.update({ playing: false });
        }, START_GRACE_MS);
      }),
      player.addListener("timeUpdate", ({ currentTime }) => {
        if (!ended) this.update({ position: currentTime });
      }),
      player.addListener("playingChange", ({ isPlaying }) => {
        if (isPlaying) {
          heard = true;
          ended = false;
          this.update({ playing: true });
        } else if (heard && player.status === "readyToPlay") {
          this.update({ playing: false });
        }
      }),
      player.addListener("playToEnd", () => {
        ended = true;
        heard = false;
        player.pause();
        player.currentTime = 0;
        this.update({ playing: false, position: 0 });
      }),
      player.addListener("statusChange", ({ status }) => {
        if (status !== "error") return;
        this.release();
        whyFailed(origin, token, fileId, loaded).then((why) => {
          if (this.attempt === attempt && why === "unloaded") this.markFailed(fileId);
        });
      }),
    ];
    this.player = player;
    this.set({ fileId, playing: true, position: 0, duration: this.durationOf(fileId) });
    player.play();
  }

  private markFailed(fileId: string) {
    this.failed = new Set([...this.failed, fileId]);
    for (const listener of this.listeners) listener();
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
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
// its length once known, and whether its last try failed. The player
// goes with the file's last row.
export function useAudioFile(playback: AudioPlayback, fileId: string) {
  const state = useSyncExternalStore(
    playback.subscribe,
    useCallback(() => playback.stateOf(fileId), [playback, fileId]),
  );
  const failed = useSyncExternalStore(
    playback.subscribe,
    useCallback(() => playback.failedOf(fileId), [playback, fileId]),
  );
  const duration = useSyncExternalStore(
    playback.subscribe,
    useCallback(() => playback.durationOf(fileId), [playback, fileId]),
  );
  useEffect(() => playback.mount(fileId), [playback, fileId]);
  return { state, duration: state?.duration || duration, failed };
}
