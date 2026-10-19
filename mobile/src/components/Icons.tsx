import Svg, { Path } from "react-native-svg";

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
