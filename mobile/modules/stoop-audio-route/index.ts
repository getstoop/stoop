import { requireOptionalNativeModule } from "expo";

// One place the phone's sound comes out. iOS names them all: the phone's
// own loudspeaker and earpiece, headphones on a wire (the jack, USB, line
// out), anything over Bluetooth, and the rest (AirPlay, a car, HDMI).
// `name` is the system's own for it.
export type AudioOutput = {
  kind: "speaker" | "earpiece" | "headphones" | "bluetooth" | "other";
  name: string;
};

type Native = {
  addListener(event: "onRouteChange", listener: () => void): { remove(): void };
  // iOS only (StoopAudioRouteModule.swift).
  currentOutputs?: () => AudioOutput[];
  // iOS only: whether the system's picker was presented.
  showPicker?: () => Promise<boolean>;
};

// The module is built for iOS and Android (expo-module.config.json);
// anywhere else, and in a build made before it was added, this is null.
const native = requireOptionalNativeModule<Native>("StoopAudioRoute");

export const audioRoute = native
  ? {
      // Where the sound goes now. iOS only: Android's module is the event
      // alone, and LiveKit's AudioSession.getAudioOutputs() is its list,
      // so this is empty there.
      outputs: (): AudioOutput[] => native.currentOutputs?.() ?? [],
      // Presents the system's picker of outputs over the app, and says
      // whether it was presented. iOS only, and false elsewhere: Android
      // has no such picker, and the app lists its outputs itself. What
      // is picked there is the system's to apply, and comes back through
      // onChange.
      showPicker: (): Promise<boolean> => native.showPicker?.().catch(() => false) ?? Promise.resolve(false),
      // Calls back whenever the phone's outputs or its choice among them
      // change: the route on iOS (AVAudioSession's route change, for
      // every reason it gives), an output added or removed on Android
      // (AudioDeviceCallback, which also calls once as listening starts).
      // The phone is watched only while something listens; the function
      // returned stops this listener.
      onChange: (listener: () => void): (() => void) => {
        const subscription = native.addListener("onRouteChange", listener);
        return () => subscription.remove();
      },
    }
  : null;
