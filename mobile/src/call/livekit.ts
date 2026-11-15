import { AndroidAudioTypePresets, type AudioConfiguration, AudioSession } from "@livekit/react-native";
import { type Participant, Room, RoomEvent } from "livekit-client";
import { voiceClient } from "../api/clients";
import { sessionToken } from "../api/servers";
import type { CallRoom, Connection, ConnectionEvents } from "./call";

// The LiveKit side of a call, as web's (web/src/api/voice.ts): a token
// from JoinVoiceChannel, signalling at the server's own /livekit, the
// ICE servers it names, and the microphone published as signalling comes
// up. What the call is and does with this is call.ts.

// As web's: a join that neither lands nor fails by then has failed.
const JOIN_TIMEOUT_MS = 30_000;

// Where sound goes (mobile/README.md → Voice). Android: LiveKit picks
// the first of these that is there, so the loudspeaker unless a headset
// is, in call mode. iOS: the loudspeaker rather than the earpiece when
// nothing else is connected.
const AUDIO: AudioConfiguration = {
  android: {
    preferredOutputList: ["bluetooth", "headset", "speaker", "earpiece"],
    audioTypeOptions: AndroidAudioTypePresets.communication,
  },
  ios: { defaultOutput: "speaker" },
};

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

  lk.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) =>
    events.onSpeaking(speakers.map((speaker) => speaker.identity)),
  ).on(RoomEvent.Disconnected, () => {
    if (live && !closed) events.onDropped();
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
    stopIfClosed();
    audioStarted = true;
    await AudioSession.startAudioSession();
    stopIfClosed();
    // The connection isn't up until it has a track to carry, so the
    // microphone is published as soon as signalling is (web's join).
    let published: Promise<unknown> = Promise.resolve();
    lk.once(RoomEvent.SignalConnected, () => {
      published = lk.localParticipant.setMicrophoneEnabled(true);
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
  };

  return {
    ready: withTimeout(connect(), JOIN_TIMEOUT_MS),
    setMuted: async (muted) => {
      await lk.localParticipant.setMicrophoneEnabled(!muted);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await lk.disconnect().catch(() => {});
      if (audioStarted) await AudioSession.stopAudioSession().catch(() => {});
    },
  };
}
