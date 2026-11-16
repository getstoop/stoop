import type { ColorValue } from "react-native";
import type { OutputKind } from "../../call/output";
import { BluetoothIcon, HeadphonesIcon, LoudspeakerIcon, PhoneIcon, SpeakerIcon } from "../../components/Icons";

// The mark of one of a call's outputs, on the Output control and in its
// list: the loudspeaker sounding out loud, the phone for its earpiece,
// headphones for any on a wire, the Bluetooth rune, and a plain speaker
// for anything else the phone names (AirPlay, a car).
export default function OutputIcon({ kind, color, size }: { kind: OutputKind; color: ColorValue; size: number }) {
  if (kind === "speaker") return <LoudspeakerIcon color={color} size={size} />;
  if (kind === "earpiece") return <PhoneIcon color={color} size={size} />;
  if (kind === "headphones") return <HeadphonesIcon color={color} size={size} />;
  if (kind === "bluetooth") return <BluetoothIcon color={color} size={size} />;
  return <SpeakerIcon color={color} size={size} />;
}
