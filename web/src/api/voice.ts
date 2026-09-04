import { ConnectError } from "@connectrpc/connect";
import type {
  LocalAudioTrack,
  LocalTrackPublication,
  Participant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  Track,
  TrackPublication,
} from "livekit-client";
import { trackKey, useVoiceStore } from "../stores/voice";
import { voiceClient } from "./clients";
import { stopLocalLevel, syncLocalLevel } from "./voiceLevel";
import { sendClientEvent } from "./ws";

// The LiveKit side of voice. One Room at a time; joining another channel
// leaves the current one first. Remote audio plays through hidden <audio>
// elements appended to a container on <body>; video (cameras, screen
// shares, our own included) goes into the voice store's track registry,
// which the stage renders. Our presence in the channel — mute, deafen,
// camera, sharing — is reported to the gateway (VoiceState) once LiveKit
// is connected, and again on every WebSocket reconnect.

let room: Room | null = null;
const audioElements = new Map<RemoteTrack, HTMLMediaElement>();

// livekit-client is ~300 kB; load it on first use so text-only sessions
// never fetch it.
const livekit = () => import("livekit-client");

// How long a join may take before we give up. livekit-client's own
// peer-connection timeout is 15 s, but on some platforms it keeps
// retrying internally instead of failing, and "Connecting…" forever is
// worse than an honest error.
const JOIN_TIMEOUT_MS = 30_000;

class JoinTimeoutError extends Error {
  constructor() {
    super("timed out");
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new JoinTimeoutError()), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// Turn a failed join into something a person can act on. Signaling
// reached the server (we have a token and the room answered), so a
// timeout or a peer-connection failure means the *media* path is the
// problem — the classic HTTP-only tunnel / CGNAT case.
const mediaPathHelp =
  "Couldn't establish an audio connection: the server's voice ports aren't reachable from this network. Voice needs a direct path to the server or a TURN relay — see the self-hosting guide.";

function describeJoinError(
  err: unknown,
  lk: Awaited<ReturnType<typeof livekit>>,
): string {
  if (err instanceof ConnectError) return err.rawMessage;
  if (err instanceof JoinTimeoutError) return mediaPathHelp;
  if (err instanceof lk.ConnectionError) {
    switch (err.reason) {
      case lk.ConnectionErrorReason.Timeout:
      case lk.ConnectionErrorReason.InternalError:
        return mediaPathHelp;
      case lk.ConnectionErrorReason.NotAllowed:
        return "The voice server rejected the session token.";
      case lk.ConnectionErrorReason.ServerUnreachable:
      case lk.ConnectionErrorReason.WebSocket:
        return "Couldn't reach the voice server's signaling endpoint.";
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

function signalingUrl(urlOrPath: string): string {
  if (/^wss?:\/\//.test(urlOrPath)) return urlOrPath;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${urlOrPath}`;
}

function audioContainer(): HTMLElement {
  let el = document.getElementById("voice-audio");
  if (!el) {
    el = document.createElement("div");
    el.id = "voice-audio";
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

function attachAudio(track: RemoteTrack) {
  if (track.kind !== "audio") return;
  const el = track.attach();
  el.muted = useVoiceStore.getState().deafened;
  audioElements.set(track, el);
  audioContainer().appendChild(el);
}

function detachAudio(track: RemoteTrack) {
  for (const el of track.detach()) el.remove();
  audioElements.delete(track);
}

function detachAll() {
  for (const el of audioElements.values()) el.remove();
  audioElements.clear();
  useVoiceStore.getState().clearTracks();
}

// Video tracks go to the registry; the stage attaches them to elements.
function videoSource(source: Track.Source): "camera" | "screen" | null {
  switch (source) {
    case "camera":
      return "camera";
    case "screen_share":
      return "screen";
    default:
      return null;
  }
}

function registerVideo(
  track: Track,
  source: Track.Source,
  participantId: string,
  local: boolean,
) {
  const src = videoSource(source);
  if (!src) return;
  useVoiceStore.getState().setTrack({
    key: trackKey(participantId, src),
    participantId,
    source: src,
    track,
    local,
  });
}

function unregisterVideo(source: Track.Source, participantId: string) {
  const src = videoSource(source);
  if (src) useVoiceStore.getState().removeTrack(trackKey(participantId, src));
}

function onTrackSubscribed(
  track: RemoteTrack,
  pub: RemoteTrackPublication,
  participant: Participant,
) {
  if (track.kind === "audio") attachAudio(track);
  else registerVideo(track, pub.source, participant.identity, false);
}

function onTrackUnsubscribed(
  track: RemoteTrack,
  pub: RemoteTrackPublication,
  participant: Participant,
) {
  if (track.kind === "audio") detachAudio(track);
  else unregisterVideo(pub.source, participant.identity);
}

function onLocalPublished(pub: LocalTrackPublication) {
  if (pub.track && pub.kind === "video" && room) {
    registerVideo(pub.track, pub.source, room.localParticipant.identity, true);
  }
}

// A camera turned off is a *muted* track, not an unpublished one (the
// publication stays so it can come back fast): a muted video track
// leaves the stage, an unmuted one returns.
function onTrackMuted(pub: TrackPublication, participant: Participant) {
  if (pub.kind === "video") unregisterVideo(pub.source, participant.identity);
}

function onTrackUnmuted(pub: TrackPublication, participant: Participant) {
  if (pub.kind === "video" && pub.track && room) {
    registerVideo(
      pub.track,
      pub.source,
      participant.identity,
      participant.identity === room.localParticipant.identity,
    );
  }
}

// Also fires when the browser's own "Stop sharing" ends a screen share.
function onLocalUnpublished(pub: LocalTrackPublication) {
  if (pub.kind !== "video" || !room) return;
  unregisterVideo(pub.source, room.localParticipant.identity);
  const store = useVoiceStore.getState();
  if (pub.source === "screen_share") store.setScreenOn(false);
  if (pub.source === "camera") store.setCameraOn(false);
  reportVoiceState();
}

// Tell the gateway where we are (or that we left). Also called from the
// realtime client after a reconnect, since the server forgot us.
export function reportVoiceState() {
  const { connection, muted, deafened, cameraOn, screenOn } =
    useVoiceStore.getState();
  const connected = connection?.status === "connected";
  sendClientEvent({
    payload: {
      case: "voiceState",
      value: {
        channelId: connected ? connection.channelId : "",
        muted,
        deafened,
        camera: connected && cameraOn,
        screenSharing: connected && screenOn,
      },
    },
  });
}

export async function joinVoice(spaceId: string, channelId: string) {
  const store = useVoiceStore.getState();
  // Already here — unless the last attempt failed, in which case this is
  // a retry.
  const here = store.connection?.channelId === channelId;
  if (here && store.connection?.status !== "error") return;
  if (room) await leaveVoice();

  // Every join starts quiet: muted, camera off, nothing shared.
  store.setMuted(true);
  store.clearTracks();
  store.setConnection({ spaceId, channelId, status: "connecting" });
  const lk = await livekit();
  const { Room, RoomEvent } = lk;
  if (useVoiceStore.getState().connection?.channelId !== channelId) return;
  // adaptiveStream: a tile only receives the layer it displays; dynacast:
  // a layer nobody displays isn't sent at all. Cameras capture at 1080p
  // with 360p / 180p simulcast layers for the tile strip; a screen share
  // is 1080p at 15 fps (text, not motion).
  const r = new Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: { resolution: lk.VideoPresets.h1080.resolution },
    publishDefaults: {
      videoSimulcastLayers: [lk.VideoPresets.h360, lk.VideoPresets.h180],
      screenShareEncoding: lk.ScreenSharePresets.h1080fps15.encoding,
    },
  });
  room = r;
  // While the join is in flight, a Disconnected event is part of the
  // failure the join itself reports; only afterwards does it mean we
  // were dropped.
  let joining = true;
  r.on(RoomEvent.TrackSubscribed, onTrackSubscribed)
    .on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
    .on(RoomEvent.LocalTrackPublished, onLocalPublished)
    .on(RoomEvent.LocalTrackUnpublished, onLocalUnpublished)
    .on(RoomEvent.TrackMuted, onTrackMuted)
    .on(RoomEvent.TrackUnmuted, onTrackUnmuted)
    .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) =>
      useVoiceStore.getState().setSpeaking(speakers.map((p) => p.identity)),
    )
    .on(RoomEvent.AudioPlaybackStatusChanged, () =>
      useVoiceStore.getState().setAudioBlocked(!r.canPlaybackAudio),
    )
    .on(RoomEvent.Disconnected, () => {
      // Server-side drop (LiveKit restarted, room closed). A leave we
      // initiated already cleared `room`; a join still in progress
      // reports its own failure.
      if (room !== r || joining) return;
      room = null;
      stopLocalLevel();
      detachAll();
      useVoiceStore.getState().setConnection(null);
      reportVoiceState();
    });

  let mic: LocalAudioTrack | null = null;
  try {
    // Open the microphone first, muted, and publish it as soon as
    // signaling is up. LiveKit doesn't finish the connection until the
    // peer connection has a track to carry: a join that publishes
    // nothing sits at "Connecting…" until the first publish (the server
    // logs "participant active" in the same millisecond as it). Muting
    // before publishing means the publication is announced muted and
    // never carries audio until toggleMute() unmutes it.
    //
    // This comes before the token because a first-time browser asks the
    // person for permission here, and they can take as long as they
    // like. A token minted first would be spending its lifetime waiting
    // on that; see docs/architecture/voice.md.
    try {
      mic = await lk.createLocalAudioTrack();
      await mic.mute();
      const track = mic;
      r.on(RoomEvent.SignalConnected, () => {
        r.localParticipant.publishTrack(track).catch(() => {});
      });
    } catch {
      // No microphone, or permission refused: listen-only.
      mic = null;
    }
    if (room !== r) {
      mic?.stop();
      return; // left while the prompt was up
    }
    const res = await voiceClient.joinVoiceChannel({ channelId });
    // ICE servers from Stoop (a static TURN or Cloudflare credentials
    // minted for this join) replace LiveKit's own list; an empty list
    // keeps LiveKit's defaults.
    const iceServers: RTCIceServer[] = res.iceServers.map((s) => ({
      urls: s.urls,
      username: s.username || undefined,
      credential: s.credential || undefined,
    }));
    await withTimeout(
      r.connect(signalingUrl(res.livekitUrl), res.livekitToken, {
        rtcConfig: iceServers.length ? { iceServers } : undefined,
      }),
      JOIN_TIMEOUT_MS,
    );
    if (room !== r) {
      mic?.stop();
      return; // left while connecting
    }
    joining = false;
    syncLocalLevel(mic, r.localParticipant.identity);
    useVoiceStore.getState().setConnection({
      spaceId,
      channelId,
      status: "connected",
    });
    useVoiceStore.getState().setAudioBlocked(!r.canPlaybackAudio);
    reportVoiceState();
  } catch (err) {
    mic?.stop();
    stopLocalLevel();
    if (room !== r) return;
    room = null;
    joining = false;
    await r.disconnect().catch(() => {});
    useVoiceStore.getState().setConnection({
      spaceId,
      channelId,
      status: "error",
      error: describeJoinError(err, lk),
    });
  }
}

export async function leaveVoice() {
  const r = room;
  room = null;
  stopLocalLevel();
  detachAll();
  useVoiceStore.getState().setConnection(null);
  reportVoiceState();
  await r?.disconnect();
}

export async function toggleMute() {
  const store = useVoiceStore.getState();
  const muted = !store.muted;
  store.setMuted(muted);
  // Unmuting while deafened undeafens too (you can't talk to people you
  // can't hear); deafen implies mute below.
  if (!muted && store.deafened) setDeafenedInternal(false);
  try {
    // The mic was published muted at join, so this unmutes the existing
    // publication; it only opens a device if that publish failed.
    await room?.localParticipant.setMicrophoneEnabled(!muted);
  } catch {
    // No microphone or permission denied: stay in listen-only.
    useVoiceStore.getState().setMuted(true);
  }
  // Unmuting may have opened a device the join never published.
  await syncMicLevel();
  reportVoiceState();
}

export async function toggleDeafen() {
  const store = useVoiceStore.getState();
  const deafened = !store.deafened;
  setDeafenedInternal(deafened);
  if (deafened && !store.muted) {
    store.setMuted(true);
    try {
      await room?.localParticipant.setMicrophoneEnabled(false);
    } catch {
      // Already off, or never opened.
    }
  }
  reportVoiceState();
}

function setDeafenedInternal(deafened: boolean) {
  useVoiceStore.getState().setDeafened(deafened);
  for (const el of audioElements.values()) el.muted = deafened;
}

// After the browser blocked autoplay, resume from a click.
export async function resumeAudio() {
  await room?.startAudio();
  useVoiceStore.getState().setAudioBlocked(!(room?.canPlaybackAudio ?? true));
}

export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  const { Room } = await livekit();
  return Room.getLocalDevices("audioinput");
}

export async function switchMicrophone(deviceId: string) {
  await room?.switchActiveDevice("audioinput", deviceId);
  // The switch swaps the underlying MediaStreamTrack; the meter was
  // reading the old one.
  await syncMicLevel();
}

// Point the local speaking meter at whatever mic we publish now.
async function syncMicLevel() {
  const r = room;
  if (!r) return;
  const { Track } = await livekit();
  const pub = r.localParticipant.getTrackPublication(Track.Source.Microphone);
  if (room !== r) return;
  syncLocalLevel(pub?.audioTrack ?? null, r.localParticipant.identity);
}

// ---- Video ----

// Screen sharing needs getDisplayMedia, which mobile browsers don't have.
export function canShareScreen(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getDisplayMedia
  );
}

function describeVideoError(err: unknown, what: string): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError") return `${what} permission was refused.`;
  if (name === "NotFoundError") return `No ${what.toLowerCase()} was found.`;
  if (name === "NotReadableError")
    return `The ${what.toLowerCase()} is in use by another app.`;
  return err instanceof Error ? err.message : String(err);
}

export async function toggleCamera() {
  const store = useVoiceStore.getState();
  if (!room) return;
  const on = !store.cameraOn;
  store.setVideoError(null);
  try {
    await room.localParticipant.setCameraEnabled(on);
    useVoiceStore.getState().setCameraOn(on);
  } catch (err) {
    useVoiceStore.getState().setCameraOn(false);
    useVoiceStore.getState().setVideoError(describeVideoError(err, "Camera"));
  }
  reportVoiceState();
}

export async function toggleScreenShare() {
  const store = useVoiceStore.getState();
  if (!room) return;
  const on = !store.screenOn;
  store.setVideoError(null);
  try {
    const lk = await livekit();
    await room.localParticipant.setScreenShareEnabled(on, {
      audio: true,
      contentHint: "detail",
      resolution: lk.ScreenSharePresets.h1080fps15.resolution,
    });
    useVoiceStore.getState().setScreenOn(on);
  } catch (err) {
    // Dismissing the picker is a NotAllowedError: not an error to show.
    useVoiceStore.getState().setScreenOn(false);
    if (!(err instanceof Error && err.name === "NotAllowedError")) {
      useVoiceStore
        .getState()
        .setVideoError(describeVideoError(err, "Screen share"));
    }
  }
  reportVoiceState();
}

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  const { Room } = await livekit();
  return Room.getLocalDevices("videoinput");
}

export async function switchCamera(deviceId: string) {
  await room?.switchActiveDevice("videoinput", deviceId);
}
