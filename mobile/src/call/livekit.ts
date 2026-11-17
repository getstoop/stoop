import {
  AndroidAudioTypePresets,
  type AppleAudioCategoryOption,
  type AudioConfiguration,
  AudioSession,
  setupIOSAudioManagement,
} from "@livekit/react-native";
import { createLocalAudioTrack, DisconnectReason, type LocalAudioTrack, type Participant, Room, RoomEvent } from "livekit-client";
import { Platform } from "react-native";
import { voiceClient } from "../api/clients";
import { sessionToken } from "../api/servers";
import { androidOutput, type CallRoom, type Connection, type ConnectionEvents } from "./call";

// The LiveKit side of a call, as web's (web/src/api/voice.ts): a token
// from JoinVoiceChannel, signalling at the server's own /livekit, the
// ICE servers it names, and the microphone published as signalling comes
// up. A connection that goes down is LiveKit's to bring back, with its
// own retries and none here: the room says when it starts trying (the
// whole connection, or signalling only), when it is back, and, having
// given up, that it is disconnected and why. What the call is and does
// with this is call.ts.

// LiveKit's reasons for a disconnect that are the server taking this
// account out of the room: removed from it, the room deleted, or this
// account joining it on another device. Any other, or none, is the
// connection lost (call.ts onDropped).
const REMOVED = [
  DisconnectReason.PARTICIPANT_REMOVED,
  DisconnectReason.ROOM_DELETED,
  DisconnectReason.DUPLICATE_IDENTITY,
];

// As web's: a join that neither lands nor fails by then has failed.
const JOIN_TIMEOUT_MS = 30_000;

// Where sound goes as a call starts (mobile/README.md → Voice).
// Android: LiveKit picks the first of these that is there, so the
// loudspeaker unless a headset is, in call mode. iOS: the loudspeaker
// rather than the earpiece when nothing else is connected.
const AUDIO: AudioConfiguration = {
  android: {
    preferredOutputList: ["bluetooth", "headset", "speaker", "earpiece"],
    audioTypeOptions: AndroidAudioTypePresets.communication,
  },
  ios: { defaultOutput: "speaker" },
};

// iOS: the loudspeaker or the earpiece as the session's default, which
// headphones override either way. LiveKit sets the session again from
// its policy whenever the audio engine changes, so the policy is told
// too; the session is set here for the change to be heard now. The
// options and modes are LiveKit's own for the two.
const IOS_OPTIONS: AppleAudioCategoryOption[] = ["mixWithOthers", "allowBluetooth", "allowBluetoothA2DP", "allowAirPlay"];

async function setIosSpeaker(speaker: boolean) {
  setupIOSAudioManagement(speaker);
  try {
    await AudioSession.setAppleAudioConfiguration({
      audioCategory: "playAndRecord",
      audioCategoryOptions: speaker ? [...IOS_OPTIONS, "defaultToSpeaker"] : IOS_OPTIONS,
      audioMode: speaker ? "videoChat" : "voiceChat",
    });
  } catch (err) {
    // The session didn't follow, so the policy goes back with it.
    setupIOSAudioManagement(!speaker);
    throw err;
  }
}

// Android has no event for a headset coming or going, so the outputs
// are read this often while in a call. Until the next reading after a
// headset goes, the sound is where LiveKit's own order puts it: the
// loudspeaker.
const OUTPUTS_EVERY_MS = 1000;

// The response's address is a path on the server's origin; ws follows
// http and wss follows https.
function signalingUrl(origin: string, urlOrPath: string): string {
  if (/^wss?:\/\//.test(urlOrPath)) return urlOrPath;
  return `${origin.replace(/^http/, "ws")}${urlOrPath}`;
}

function withTimeout<Value>(work: Promise<Value>, ms: number): Promise<Value> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function openConnection(origin: string, room: CallRoom, events: ConnectionEvents): Connection {
  const lk = new Room();
  let closed = false;
  // Whether the join has landed: only then is a disconnect a drop.
  let live = false;
  let audioStarted = false;
  let mic: LocalAudioTrack | undefined;
  let speaker = true;
  // Android: whether Speaker has been pressed, and the output chosen
  // last since. LiveKit moves the sound to a headset by itself only
  // until an output is chosen by hand: a chosen one stays whatever
  // connects later. So from the first press on, a headset is chosen
  // here when one appears, and the phone's own output when it goes.
  let chosen = false;
  let output = "";
  let watching: ReturnType<typeof setInterval> | undefined;

  // Puts Android's sound where it belongs, and says whether that is a
  // headset.
  const routeAndroid = async (): Promise<boolean> => {
    const outputs = await AudioSession.getAudioOutputs();
    if (closed) return false;
    const wanted = androidOutput(outputs, speaker);
    const headset = wanted !== "speaker" && wanted !== "earpiece";
    events.onHeadphones(headset);
    if (!chosen || wanted === output) return headset;
    output = wanted;
    await AudioSession.selectAudioOutput(wanted);
    return headset;
  };

  lk.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) =>
    events.onSpeaking(speakers.map((speaker) => speaker.identity)),
  )
    .on(RoomEvent.Reconnecting, () => {
      if (live && !closed) events.onReconnecting();
    })
    .on(RoomEvent.SignalReconnecting, () => {
      if (live && !closed) events.onReconnecting();
    })
    // LiveKit says who is speaking again before it says it is back,
    // which the call doesn't hear while reconnecting: so it is said
    // once more here, for whoever kept talking to wear their ring.
    .on(RoomEvent.Reconnected, () => {
      if (!live || closed) return;
      events.onReconnected();
      events.onSpeaking(lk.activeSpeakers.map((speaker) => speaker.identity));
    })
    .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      if (live && !closed) events.onDropped(reason !== undefined && REMOVED.includes(reason) ? "removed" : "lost");
    });

  const stopIfClosed = () => {
    if (closed) throw new Error("closed");
  };

  const connect = async () => {
    const session = await sessionToken(room.serverId);
    if (!session) throw new Error("signed out");
    stopIfClosed();
    const joined = await voiceClient(origin, session).joinVoiceChannel({ channelId: room.channelId });
    stopIfClosed();
    await AudioSession.configureAudio(AUDIO);
    // The last call may have left the earpiece as iOS's default.
    if (Platform.OS === "ios") setupIOSAudioManagement(true);
    stopIfClosed();
    audioStarted = true;
    await AudioSession.startAudioSession();
    stopIfClosed();
    // A call starts muted (call.ts), so the microphone's track is muted
    // before it is published, as web's is: it is announced muted and
    // carries no sound until it is unmuted. The connection isn't up
    // until it has a track to carry, so it is published as soon as
    // signalling is.
    const track = await createLocalAudioTrack();
    mic = track;
    // Closed meanwhile: close() had no track to stop yet.
    if (closed) track.stop();
    stopIfClosed();
    await track.mute();
    let published: Promise<unknown> = Promise.resolve();
    lk.once(RoomEvent.SignalConnected, () => {
      published = lk.localParticipant.publishTrack(track);
      published.catch(() => {});
    });
    // The server's list replaces LiveKit's own; an empty one keeps it.
    const iceServers = joined.iceServers.map((server) => ({
      urls: server.urls,
      username: server.username || undefined,
      credential: server.credential || undefined,
    }));
    await lk.connect(signalingUrl(origin, joined.livekitUrl), joined.livekitToken, {
      rtcConfig: iceServers.length ? { iceServers } : undefined,
    });
    await published;
    stopIfClosed();
    live = true;
    if (Platform.OS === "android") {
      watching = setInterval(() => void routeAndroid().catch(() => {}), OUTPUTS_EVERY_MS);
      void routeAndroid().catch(() => {});
    }
  };

  return {
    ready: withTimeout(connect(), JOIN_TIMEOUT_MS),
    // The token names the participant by user ID (voice.md → Tokens).
    userId: () => lk.localParticipant.identity,
    setMuted: async (muted) => {
      await lk.localParticipant.setMicrophoneEnabled(!muted);
    },
    // Rejects, with the choice as it was, when the sound didn't move:
    // also when a headset turned out to have it (Android), which the
    // last reading hadn't seen yet.
    setSpeaker: async (on) => {
      const was = speaker;
      speaker = on;
      try {
        if (Platform.OS === "ios") await setIosSpeaker(on);
        else {
          chosen = true;
          if (await routeAndroid()) throw new Error("headphones have the sound");
        }
      } catch (err) {
        speaker = was;
        throw err;
      }
    },
    close: async () => {
      if (closed) return;
      closed = true;
      clearInterval(watching);
      await lk.disconnect().catch(() => {});
      // Disconnecting stops a published track; one not yet published is
      // stopped here, or the microphone would stay open.
      mic?.stop();
      if (audioStarted) await AudioSession.stopAudioSession().catch(() => {});
    },
  };
}
