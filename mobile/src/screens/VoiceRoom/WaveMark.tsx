import Svg, { Path } from "react-native-svg";

// A sound wave, five bars: the mark of a call this phone is in.
// Decorative: what it means is said in the label beside it.
export default function WaveMark({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round">
      <Path d="M5 10v4M9 6v12M13 9v6M17 4v16M21 10v4" />
    </Svg>
  );
}
