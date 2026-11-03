import { type ComponentRef, type ReactElement, type ReactNode, useRef, useState } from "react";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { ScrollViewMarker } from "react-native-screens/experimental";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type Theme, tokens, useTheme } from "../../theme";
import { GAP, PILL } from "./Composer";
import { ComposerAbove, ComposerOverlay } from "./composerAbove";
import EdgeBlur from "./EdgeBlur";
import EdgeFade from "./EdgeFade";
import type { Notice } from "./useMessageActions";

// A list of messages with the composer floating over its foot, riding
// up with the keyboard, and a refusal's line over the composer, or what
// the composer shows over itself (ComposerAbove): the channel's layout,
// and a thread's. The list is drawn by the screen, given how far its
// newest row must stay clear of the composer. The header floats over
// the list's head the same way (the server's layout); on iOS 26 the
// system would fade a list under a bar, which on this upside-down list
// dims it whole, so the list is marked to have no such fade, and gets
// its own at both ends: under the status bar, and under the home
// indicator up past the composer. Where iOS has Liquid Glass the ends
// blur (EdgeBlur), as the system's own bars do; elsewhere they fade
// (EdgeFade).
export default function ComposerDock({
  keyboard,
  list,
  composer,
  notice,
  corner,
}: {
  keyboard: number;
  list: (clearance: number) => ReactElement;
  composer: ReactNode;
  notice: Notice | null;
  // What sits over the composer's right end (the channel's jump to the
  // latest message); a notice or what the composer shows over itself
  // draws over it.
  corner?: ReactNode;
}) {
  const styles = makeStyles(useTheme());
  const insets = useSafeAreaInsets();
  const Edge = Platform.OS === "ios" && isLiquidGlassAvailable() ? EdgeBlur : EdgeFade;
  // The composer's height as drawn, for the list to clear.
  const [composerHeight, setComposerHeight] = useState(PILL);
  const [above, setAbove] = useState<ReactNode>(null);
  const [overlay, setOverlay] = useState<ReactNode>(null);
  // Where the dock starts in the window (under the stack's header): the
  // avoiding view measures itself against its parent and needs that
  // offset to know how much of it the keyboard covers.
  const [top, setTop] = useState(0);
  const dock = useRef<ComponentRef<typeof View>>(null);
  // The composer sits FOOT above the home indicator (GAP above the edge
  // of a screen without one), or GAP above the keyboard while that is up
  // (the avoiding view's padding ends at its top edge).
  const composerBottom = keyboard > 0 ? GAP : Math.max(insets.bottom + FOOT, GAP);
  // The foot's edge keeps one height whether the keyboard is up or not:
  // the glass does not survive being resized, and the few extra points
  // over the keyboard are under the composer anyway.
  const footEdge = Math.max(insets.bottom + FOOT, GAP) + PILL + FADE_IN;

  return (
    <View
      ref={dock}
      style={styles.fill}
      onLayout={() => dock.current?.measureInWindow((_windowX, windowY) => setTop(windowY))}
    >
      <KeyboardAvoidingView style={styles.fill} behavior="padding" keyboardVerticalOffset={top}>
        {/* The avoiding view pads its bottom for the keyboard; the composer
            is placed from this view's bottom, which that padding moves. */}
        {/* Under an overlay (the link dialog on Android, which is no window
            of its own) the rest is out of a screen reader's reach, as under
            a modal. */}
        <View style={styles.fill} importantForAccessibility={overlay ? "no-hide-descendants" : "auto"}>
          {Platform.OS === "ios" ? (
            <ScrollViewMarker style={styles.fill} scrollEdgeEffects={noFade}>
              {list(composerHeight + composerBottom)}
            </ScrollViewMarker>
          ) : (
            list(composerHeight + composerBottom)
          )}
          <Edge edge="top" height={insets.top + FADE_IN} />
          <Edge edge="bottom" height={footEdge} />
          <View
            style={[styles.composer, { bottom: composerBottom }]}
            onLayout={(event) => setComposerHeight(event.nativeEvent.layout.height)}
          >
            <ComposerAbove.Provider value={setAbove}>
              <ComposerOverlay.Provider value={setOverlay}>{composer}</ComposerOverlay.Provider>
            </ComposerAbove.Provider>
          </View>
          {corner && (
            <View style={[styles.corner, { bottom: composerBottom + composerHeight + GAP }]}>{corner}</View>
          )}
          {notice && (
            <View
              style={[styles.toast, { bottom: composerBottom + composerHeight + GAP }]}
              accessibilityRole="alert"
              testID="channel-notice"
              pointerEvents="none"
            >
              <Text style={styles.toastTitle}>{notice.title}</Text>
              {notice.body && (
                <Text style={styles.toastBody} numberOfLines={2}>
                  {notice.body}
                </Text>
              )}
            </View>
          )}
          {above && (
            <View style={[styles.above, { bottom: composerBottom + composerHeight + GAP }]}>{above}</View>
          )}
        </View>
        {overlay && <View style={StyleSheet.absoluteFill}>{overlay}</View>}
      </KeyboardAvoidingView>
    </View>
  );
}

const noFade = { top: "hidden", bottom: "hidden", left: "hidden", right: "hidden" } as const;

// The composer's clearance over the home indicator: less than GAP, since
// the indicator already keeps its distance from the screen's edge.
const FOOT = 4;

// How far past the status bar, and past the composer's head, a fade
// reaches before it is gone. The bottom one runs the composer's whole
// height and on, so the rows behind the pill dim by degrees instead of
// meeting a line across it.
const FADE_IN = 20;

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    fill: {
      flex: 1,
    },
    composer: {
      position: "absolute",
      left: 0,
      right: 0,
    },
    corner: {
      position: "absolute",
      right: 12,
    },
    // Over the composer's card, as wide.
    above: {
      position: "absolute",
      left: 8,
      right: 8,
    },
    toast: {
      position: "absolute",
      left: 16,
      right: 16,
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 2,
      borderRadius: tokens.radiusMd,
      backgroundColor: theme.panel,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      boxShadow: theme.scheme === "dark" ? "0 6px 20px rgba(0, 0, 0, 0.35)" : "0 6px 20px rgba(30, 25, 20, 0.16)",
    },
    toastTitle: {
      color: theme.danger,
      fontSize: tokens.textUi,
      fontWeight: "600",
    },
    toastBody: {
      color: theme.text,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
  });
}
