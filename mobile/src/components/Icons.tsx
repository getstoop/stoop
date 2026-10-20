import type { ReactNode } from "react";
import type { ColorValue } from "react-native";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";

// Stroke icons, drawn from the same paths as web/src/components/Icons.tsx
// so the two apps share one icon language. Decorative: whatever an icon
// means is said in text or an accessibility label beside it.

export function CheckIcon({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="m4 12 5.5 5.5L20 7" />
    </Svg>
  );
}

// The tab bar's four, the muted bell and the channel marks. Drawn at the
// tab bar's 1.8 stroke, as in the mockups.
function Stroke({ color, size, children }: { color: ColorValue; size: number; children: ReactNode }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

type IconProps = { color: ColorValue; size?: number };

export function SpacesIcon({ color, size = 24 }: IconProps) {
  return (
    <Stroke color={color} size={size}>
      <Rect x={3.5} y={3.5} width={7} height={7} rx={2} />
      <Rect x={13.5} y={3.5} width={7} height={7} rx={2} />
      <Rect x={3.5} y={13.5} width={7} height={7} rx={2} />
      <Rect x={13.5} y={13.5} width={7} height={7} rx={2} />
    </Stroke>
  );
}

export function BellIcon({ color, size = 24 }: IconProps) {
  return (
    <Stroke color={color} size={size}>
      <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <Path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </Stroke>
  );
}

export function MessagesIcon({ color, size = 24 }: IconProps) {
  return (
    <Stroke color={color} size={size}>
      <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Stroke>
  );
}

export function PersonIcon({ color, size = 24 }: IconProps) {
  return (
    <Stroke color={color} size={size}>
      <Circle cx={12} cy={8} r={4} />
      <Path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </Stroke>
  );
}

export function MutedIcon({ color, size = 18 }: IconProps) {
  return (
    <Stroke color={color} size={size}>
      <Path d="M13.7 21a2 2 0 0 1-3.4 0M18.6 13A17 17 0 0 1 18 8M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14M18 8a6 6 0 0 0-9.3-5M2 2l20 20" />
    </Stroke>
  );
}

// A channel's mark where # would be, as web's ChannelGlyph draws them: a
// lock for a private channel, a megaphone for an announcement channel
// (tilted so it can't be read as the speaker), a speaker for voice.
export function LockIcon({ color, size = 18 }: IconProps) {
  return (
    <Stroke color={color} size={size}>
      <Rect x={5} y={11} width={14} height={10} rx={2} />
      <Path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Stroke>
  );
}

export function MegaphoneIcon({ color, size = 18 }: IconProps) {
  return (
    <Stroke color={color} size={size}>
      <G transform="translate(11.06 13.16) rotate(-28) translate(-12 -12.5)">
        <Path d="m3 11 18-5v12L3 14v-3z" />
        <Path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
      </G>
    </Stroke>
  );
}

export function SpeakerIcon({ color, size = 18 }: IconProps) {
  return (
    <Stroke color={color} size={size}>
      <Path d="M4 9v6h4l5 4V5L8 9H4z" />
      <Path d="M16 9a4 4 0 0 1 0 6" />
    </Stroke>
  );
}

export function ChevronRightIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M9 18l6-6-6-6" />
    </Svg>
  );
}

export function ChevronDownIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

export function PlusIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
    >
      <Path d="M12 5v14M5 12h14" />
    </Svg>
  );
}
