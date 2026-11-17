import {
  AndroidAudioTypePresets,
  type AppleAudioCategoryOption,
  type AudioConfiguration,
  AudioSession,
  setupIOSAudioManagement,
} from "@livekit/react-native";
import { DisconnectReason, type Participant, Room, RoomEvent } from "livekit-client";
import { Platform } from "react-native";
import { voiceClient } from "../api/clients";
import { sessionToken } from "../api/servers";
import { audioRoute } from "../../modules/stoop-audio-route";
import type { CallRoom, Connection, ConnectionEvents } from "./call";
import { androidName, androidOutput, androidOutputs, iosOwnChange, type OutputKind, ownOutput } from "./output";

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
// Android: the first of these that is there, so the loudspeaker unless
// a headset is, in call mode; the app then chooses by the same order
// itself (routeAndroid). iOS: the loudspeaker rather than the earpiece
// when nothing else is connected.
const AUDIO: AudioConfiguration = {
  android: {
    preferredOutputList: ["bluetooth", "headset", "speaker", "earpiece"],
    audioTypeOptions: AndroidAudioTypePresets.communication,
  },
  ios: { defaultOutput: "speaker" },
};

// iOS: the loudspeaker or the earpiece as the phone's own output: the
// session's default, which headphones override either way. LiveKit sets
// the session again from its policy whenever the audio engine changes,
// so the policy is told first, and holds the choice even if the session
// refuses; the session is set as well for the change to be heard now.
// The options and modes are LiveKit's own for the two.
const IOS_OPTIONS: AppleAudioCategoryOption[] = ["mixWithOthers", "allowBluetooth", "allowBluetoothA2DP", "allowAirPlay"];

async function setIosSpeaker(speaker: boolean) {
  setupIOSAudioManagement(speaker);
  await AudioSession.setAppleAudioConfiguration({
    audioCategory: "playAndRecord",
    audioCategoryOptions: speaker ? [...IOS_OPTIONS, "defaultToSpeaker"] : IOS_OPTIONS,
    audioMode: speaker ? "videoChat" : "voiceChat",
  });
}

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

// How long after the phone says its outputs changed they are read a
// second time (routeChanged).
const READ_AGAIN_MS = 500;

export function openConnection(origin: string, room: CallRoom, events: ConnectionEvents): Connection {
  const lk = new Room();
  let closed = false;
  // Whether the join has landed: only then is a disconnect a drop.
  let live = false;
  let audioStarted = false;
  // The phone's own output chosen last, which has the sound again when a
  // headset goes: the loudspeaker until the earpiece is picked.
  let own: OutputKind = "speaker";
  // Android: the outputs as last read and the one the sound is on.
  // LiveKit says neither and keeps the sound on whatever was chosen
  // last, whatever connects later, so the app chooses every time: at the
  // first reading, when a headset appears or goes (androidOutput), and
  // at a pick from the list. `told` is what LiveKit was told last.
  let outputs: OutputKind[] = [];
  let output: OutputKind = "speaker";
  let told: OutputKind | undefined;
  // iOS: where the sound was at the last reading, and whether the
  // system's picker has been shown since the last pick taken from it.
  let last: OutputKind | undefined;
  let armed = false;
  // LiveKit says nothing of where the sound goes or of a headset coming
  // or going, on either phone, so our own module does
  // (modules/stoop-audio-route): listened to from the join landing until
  // the connection closes.
  let stopListening: (() => void) | undefined;

  // Android: reads the outputs, says them and where the sound belongs
  // among them, and puts it there.
  const routeAndroid = async () => {
    const now = androidOutputs(await AudioSession.getAudioOutputs());
    if (closed) return;
    output = androidOutput(now, { outputs, output, own });
    outputs = now;
    events.onOutput({ kind: output, name: "" }, outputs);
    const name = androidName(output);
    if (told === output || !name) return;
    const target = output;
    told = target;
    try {
      await AudioSession.selectAudioOutput(name);
    } catch (err) {
      // LiveKit didn't take it: the next reading tells it again, unless
      // it has been told something else since.
      if (told === target) told = undefined;
      throw err;
    }
  };

  // iOS moves the sound itself, to headphones and back and wherever the
  // system's picker says; this says where it is now. The picker also
  // offers the phone's own two, so the sound moving from one of them to
  // the other after the picker was shown is taken as picked there
  // (iosOwnChange): it becomes the phone's own choice, in LiveKit's
  // policy and on the session, so both agree and the sound returns to
  // it when headphones go. The session still has its old default until
  // then, which is where iOS puts the sound when headphones go; landing
  // on the one not chosen that way, it is put back. Setting the session
  // answers with a route change of its own, which reads as nothing: the
  // sound is by then where it was or where it was chosen.
  const routeIos = () => {
    const [now] = audioRoute?.outputs() ?? [];
    if (!now) return;
    events.onOutput(now, []);
    const change = iosOwnChange(now.kind, last, own, armed);
    last = now.kind;
    if (change === "none") return;
    if (change === "pick") {
      own = now.kind;
      armed = false;
    }
    void setIosSpeaker(own === "speaker").catch(() => {});
  };

  // The outputs are read as the call goes live and again each time the
  // phone says they changed. On Android, until that reading after the
  // output the sound was on goes, the sound is where LiveKit's own order
  // puts it: a headset still there, else the loudspeaker.
  const readRoute = () => {
    if (closed) return;
    if (Platform.OS === "android") void routeAndroid().catch(() => {});
    else if (Platform.OS === "ios") routeIos();
  };

  // A change is read at once and once more a moment later: on Android
  // the list read is LiveKit's own, kept from the same news, and nothing
  // promises it has heard by the first reading.
  let again: ReturnType<typeof setTimeout> | undefined;
  const routeChanged = () => {
    readRoute();
    clearTimeout(again);
    again = setTimeout(readRoute, READ_AGAIN_MS);
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
    stopListening = audioRoute?.onChange(routeChanged);
    readRoute();
  };

  return {
    ready: withTimeout(connect(), JOIN_TIMEOUT_MS),
    // The token names the participant by user ID (voice.md → Tokens).
    userId: () => lk.localParticipant.identity,
    setMuted: async (muted) => {
      await lk.localParticipant.setMicrophoneEnabled(!muted);
    },
    // Android only: iOS has no output the app can choose, and rejects.
    // Rejects too for an output that has gone since the list was read.
    // What is chosen is written down before LiveKit is told, so a
    // reading of the outputs that runs meanwhile (routeAndroid) starts
    // from it: a headset it finds arriving is chosen after this, and
    // LiveKit ends where the app says the sound is.
    chooseOutput: async (kind) => {
      const name = androidName(kind);
      if (Platform.OS !== "android" || !name || !outputs.includes(kind)) throw new Error("no such output");
      const was = { output, own };
      output = kind;
      told = kind;
      if (ownOutput(kind)) own = kind;
      events.onOutput({ kind, name: "" }, outputs);
      try {
        await AudioSession.selectAudioOutput(name);
      } catch (err) {
        // LiveKit didn't take it. Unless the sound has been put elsewhere
        // since, it is where it was, and LiveKit is told at the next
        // reading.
        if (!closed && output === kind) {
          ({ output, own } = was);
          told = undefined;
          events.onOutput({ kind: output, name: "" }, outputs);
        }
        throw err;
      }
    },
    // iOS only: our own module presents the system's picker
    // (modules/stoop-audio-route showPicker says why not LiveKit's).
    // What is picked there comes back as a route change, and counts as
    // a pick only once the picker has really been shown.
    showOutputPicker: () => {
      if (Platform.OS !== "ios" || !audioRoute) return;
      void audioRoute.showPicker().then((shown) => {
        if (shown && !closed) armed = true;
      });
    },
    close: async () => {
      if (closed) return;
      closed = true;
      stopListening?.();
      clearTimeout(again);
      await lk.disconnect().catch(() => {});
      if (audioStarted) await AudioSession.stopAudioSession().catch(() => {});
    },
  };
}
