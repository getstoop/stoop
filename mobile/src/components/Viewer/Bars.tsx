import { formatBytes } from "@stoop/core/attachments";
import { useRef } from "react";
import { ActivityIndicator, type LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "../../theme";
import { BackIcon, CloseIcon, ShareIcon } from "../Icons";
import { positionText, senderName, sentAt, type ViewerItem } from "./items";

export type Sharing = "idle" | "going" | "failed";

export type BarHeights = { top: number; bottom: number };

// The viewer's bars over the picture, as "8d · Viewer, photo" draws
// them: at the top Close (iOS ×, Android's ← as its back), who sent the
// picture and when (they change as the reader pages into another
// message's), and Share; at the foot its name and size and "2 of 4".
// While Share fetches the original a spinner takes its place, and a
// failure says "Couldn't download" in the size's place until the next.
// `passThrough` (over a playing video) lets every touch but Close's and
// Share's through to the pager under the bars, so a swipe on them pages.
// onHeights reports how tall the two are, for the video's box between.
export default function Bars({
  item,
  index,
  count,
  sharing,
  passThrough = false,
  onClose,
  onShare,
  onHeights,
}: {
  item: ViewerItem;
  index: number;
  count: number;
  sharing: Sharing;
  passThrough?: boolean;
  onClose: () => void;
  onShare: () => void;
  onHeights?: (heights: BarHeights) => void;
}) {
  const heights = useRef<BarHeights>({ top: 0, bottom: 0 });
  const measured = (edge: keyof BarHeights) => (event: LayoutChangeEvent) => {
    const height = Math.ceil(event.nativeEvent.layout.height);
    if (heights.current[edge] === height) return;
    heights.current = { ...heights.current, [edge]: height };
    if (heights.current.top > 0 && heights.current.bottom > 0) onHeights?.(heights.current);
  };
  const through = passThrough ? "box-none" : "auto";
  const words = passThrough ? "none" : "auto";
  const insets = useSafeAreaInsets();
  const android = Platform.OS === "android";
  const size = sharing === "failed" ? "Couldn't download" : formatBytes(item.attachment.size);
  return (
    <>
      <View
        style={[styles.bar, styles.top, { paddingTop: insets.top + 4 }]}
        pointerEvents={through}
        onLayout={measured("top")}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          hitSlop={8}
          style={styles.button}
          testID="viewer-close"
        >
          {android ? <BackIcon color={WHITE} /> : <CloseIcon color={WHITE} size={22} />}
        </Pressable>
        <View style={styles.who} pointerEvents={words}>
          <Text style={styles.sender} numberOfLines={1}>
            {senderName(item)}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {sentAt(item)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sharing === "going" ? "Share, downloading" : "Share"}
          accessibilityState={{ busy: sharing === "going" }}
          onPress={onShare}
          hitSlop={8}
          style={styles.button}
          testID="viewer-share"
        >
          {sharing === "going" ? <ActivityIndicator color={WHITE} /> : <ShareIcon color={WHITE} android={android} />}
        </Pressable>
      </View>
      <View
        style={[styles.bar, styles.bottom, { paddingBottom: insets.bottom + 8 }]}
        pointerEvents={through}
        onLayout={measured("bottom")}
      >
        <View style={styles.file} pointerEvents={words}>
          <Text style={styles.name} numberOfLines={1}>
            {item.attachment.name}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {size}
          </Text>
        </View>
        <View pointerEvents={words}>
          <Text style={styles.muted}>{positionText(index, count)}</Text>
        </View>
      </View>
    </>
  );
}

// On the viewer's black, whatever the theme: white words over a dark
// veil, so they read over a bright photo too.
const WHITE = "#ffffff";
const MUTED = "rgba(255, 255, 255, 0.7)";
const VEIL = "rgba(0, 0, 0, 0.55)";

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    backgroundColor: VEIL,
  },
  top: {
    top: 0,
    paddingBottom: 8,
  },
  bottom: {
    bottom: 0,
    paddingTop: 10,
    paddingHorizontal: 16,
  },
  button: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  who: {
    flex: 1,
    alignItems: "center",
  },
  file: {
    flex: 1,
  },
  sender: {
    color: WHITE,
    fontSize: tokens.textUi,
    fontWeight: "600",
  },
  name: {
    color: WHITE,
    fontSize: tokens.textUi,
  },
  muted: {
    color: MUTED,
    fontSize: tokens.textSm,
  },
});
