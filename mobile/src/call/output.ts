// Where a call's sound comes out: the kinds of output there are, what
// the Output control calls each, and the rule for where Android's sound
// belongs as outputs come and go. Plain rules, with unit tests beside
// them; the call holds the output (call.ts) and livekit.ts applies them
// to the phone.

// A place a call's sound can come out: the phone's own loudspeaker and
// earpiece, headphones on a wire (the jack, USB), anything over
// Bluetooth, and whatever else a phone names (AirPlay, a car).
export type OutputKind = "speaker" | "earpiece" | "headphones" | "bluetooth" | "other";

// One output: its kind and, where the phone gives one without asking a
// permission (iOS), the system's own name for it; "" where it doesn't
// (Android, where only kinds are read).
export type Output = { kind: OutputKind; name: string };

// Where every call starts.
export const LOUDSPEAKER: Output = { kind: "speaker", name: "" };

// What the Output control says of an output. The phone's own two and
// headphones on a wire go by their kind in a word, the earpiece as
// "Phone": the phone held to the ear. Anything else goes by the system's
// own name for it where the phone gave one, else by its kind.
export function outputName(output: Output): string {
  if (output.kind === "speaker") return "Speaker";
  if (output.kind === "earpiece") return "Phone";
  if (output.kind === "headphones") return "Headphones";
  if (output.name) return output.name;
  return output.kind === "bluetooth" ? "Bluetooth" : "Other";
}

// The headsets, in the order one is preferred over the other when both
// are there (LiveKit's own, livekit.ts AUDIO).
const HEADSETS: OutputKind[] = ["bluetooth", "headphones"];

// Whether an output is one of the phone's own two: what the sound
// returns to when a headset goes.
export const ownOutput = (kind: OutputKind): kind is "speaker" | "earpiece" =>
  kind === "speaker" || kind === "earpiece";

// Android: LiveKit's names for its four outputs and the kinds they are,
// in the order the list shows them.
const ANDROID: [string, OutputKind][] = [
  ["speaker", "speaker"],
  ["earpiece", "earpiece"],
  ["headset", "headphones"],
  ["bluetooth", "bluetooth"],
];

// Android: LiveKit's names for the outputs there are now, as kinds. A
// name not known is left out.
export const androidOutputs = (names: string[]): OutputKind[] =>
  ANDROID.filter(([name]) => names.includes(name)).map(([, kind]) => kind);

// Android: LiveKit's name for a kind, to choose it by; none for a kind
// it has no output of.
export const androidName = (kind: OutputKind): string | undefined => ANDROID.find(([, known]) => known === kind)?.[0];

// Android: where the sound belongs once the outputs have been read
// again. A headset that has just appeared takes it, also from an output
// chosen by hand. Otherwise it stays where it was while that is still
// there. When that has gone, a headset still there has it, and failing
// one the phone's own output chosen last (`own`).
export function androidOutput(
  outputs: OutputKind[],
  was: { outputs: OutputKind[]; output: OutputKind; own: OutputKind },
): OutputKind {
  const headsets = HEADSETS.filter((kind) => outputs.includes(kind));
  const arrived = headsets.find((kind) => !was.outputs.includes(kind));
  if (arrived) return arrived;
  if (outputs.includes(was.output)) return was.output;
  return headsets[0] ?? was.own;
}

export const sameOutput = (one: Output, other: Output) => one.kind === other.kind && one.name === other.name;
export const sameList = (one: OutputKind[], other: OutputKind[]) =>
  one.length === other.length && one.every((kind, at) => kind === other[at]);
