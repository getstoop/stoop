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

export function PeopleIcon({ color, size = 18 }: IconProps) {
  return (
    <Stroke color={color} size={size}>
      <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <Circle cx={9} cy={7} r={4} />
      <Path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <Path d="M16 3.13a4 4 0 0 1 0 7.75" />
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

// The composer's: the send arrow, and the formatting row's link and
// lists, drawn as the composing mockups draw them.
export function SendIcon({ color, size = 20 }: IconProps) {
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
      <Path d="M12 19V5M5 12l7-7 7 7" />
    </Svg>
  );
}

function Format({ color, size, children }: { color: ColorValue; size: number; children: ReactNode }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

export function LinkIcon({ color, size = 20 }: IconProps) {
  return (
    <Format color={color} size={size}>
      <Path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <Path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </Format>
  );
}

export function BulletListIcon({ color, size = 20 }: IconProps) {
  return (
    <Format color={color} size={size}>
      <Path d="M9 6h11M9 12h11M9 18h11" />
      <Circle cx={4.5} cy={6} r={1.2} fill={color} stroke="none" />
      <Circle cx={4.5} cy={12} r={1.2} fill={color} stroke="none" />
      <Circle cx={4.5} cy={18} r={1.2} fill={color} stroke="none" />
    </Format>
  );
}

// A list item a level deeper, or a level up: the format row's indent and
// outdent, shown while the caret is in a list.
export function IndentIcon({ color, size = 20 }: IconProps) {
  return (
    <Format color={color} size={size}>
      <Path d="M21 6H11M21 12H11M21 18H11M4 9l3 3-3 3" />
    </Format>
  );
}

export function OutdentIcon({ color, size = 20 }: IconProps) {
  return (
    <Format color={color} size={size}>
      <Path d="M21 6H11M21 12H11M21 18H11M7 9l-3 3 3 3" />
    </Format>
  );
}

export function NumberedListIcon({ color, size = 20 }: IconProps) {
  return (
    <Format color={color} size={size}>
      <Path d="M10 6h10M10 12h10M10 18h10" />
      <Path d="M4 5h1.5v4M4 9h3M4 14.5h2.5l-2.5 2.5h3" />
    </Format>
  );
}

// The message menu's, at the tab bar's 1.8 stroke as the menu mockup draws
// them: a smiley for more reactions, a bubble with lines for the thread,
// the reply arrow for a quote, the copy sheets, a pencil and a bin.
export function SmileyIcon({ color, size = 22 }: IconProps) {
  return (
    <Stroke color={color} size={size}>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
    </Stroke>
  );
}

export function ThreadIcon({ color, size = 22 }: IconProps) {
  return (
    <Stroke color={color} size={size}>
      <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <Path d="M8 9h8M8 13h5" />
    </Stroke>
  );
}

export function QuoteReplyIcon({ color, size = 22 }: IconProps) {
  return (
    <Stroke color={color} size={size}>
      <Path d="M9 14L4 9l5-5" />
      <Path d="M4 9h10a6 6 0 0 1 6 6v5" />
    </Stroke>
  );
}

// A cross, at the composer's reply strip's heavier stroke.
export function CloseIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round">
      <Path d="M18 6L6 18M6 6l12 12" />
    </Svg>
  );
}

export function CopyIcon({ color, size = 22 }: IconProps) {
  return (
    <Stroke color={color} size={size}>
      <Rect x={9} y={9} width={12} height={12} rx={2} />
      <Path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </Stroke>
  );
}

export function PencilIcon({ color, size = 22 }: IconProps) {
  return (
    <Stroke color={color} size={size}>
      <Path d="M12 20h9" />
      <Path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </Stroke>
  );
}

export function TrashIcon({ color, size = 22 }: IconProps) {
  return (
    <Stroke color={color} size={size}>
      <Path d="M3 6h18" />
      <Path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <Path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <Path d="M10 11v6M14 11v6" />
    </Stroke>
  );
}

// Attachments, as the attaching mockups draw them: the sheet's photo
// library, camera and files, the play mark on a video's thumbnail, and
// the pill's paperclip.
export function PhotoIcon({ color, size = 22 }: IconProps) {
  return (
    <Stroke color={color} size={size}>
      <Rect x={3} y={3} width={18} height={18} rx={2} />
      <Circle cx={8.5} cy={8.5} r={1.5} />
      <Path d="M21 15l-5-5L5 21" />
    </Stroke>
  );
}

export function CameraIcon({ color, size = 22 }: IconProps) {
  return (
    <Stroke color={color} size={size}>
      <Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <Circle cx={12} cy={13} r={4} />
    </Stroke>
  );
}

export function FileIcon({ color, size = 22 }: IconProps) {
  return (
    <Stroke color={color} size={size}>
      <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <Path d="M14 2v6h6" />
    </Stroke>
  );
}

export function PlayIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M8 5v14l11-7z" />
    </Svg>
  );
}

export function PauseIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Rect x={6} y={5} width={4} height={14} rx={1} />
      <Rect x={14} y={5} width={4} height={14} rx={1} />
    </Svg>
  );
}

export function PaperclipIcon({ color, size = 14 }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M21.4 11.6l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
    </Svg>
  );
}

// The viewer's: Android's back arrow, which closes it there, and each
// platform's own share glyph (a box with an arrow up out of it on iOS,
// three joined nodes on Android).
export function BackIcon({ color, size = 24 }: IconProps) {
  return (
    <Stroke color={color} size={size}>
      <Path d="M19 12H5" />
      <Path d="M12 19l-7-7 7-7" />
    </Stroke>
  );
}

export function ShareIcon({ color, size = 24, android = false }: IconProps & { android?: boolean }) {
  return android ? (
    <Stroke color={color} size={size}>
      <Circle cx={18} cy={5} r={3} />
      <Circle cx={6} cy={12} r={3} />
      <Circle cx={18} cy={19} r={3} />
      <Path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </Stroke>
  ) : (
    <Stroke color={color} size={size}>
      <Path d="M12 3v12" />
      <Path d="M8 7l4-4 4 4" />
      <Path d="M8 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2" />
    </Stroke>
  );
}
