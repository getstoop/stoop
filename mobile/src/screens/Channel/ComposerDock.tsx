import { type ComponentRef, type ReactNode, useRef, useState } from "react";
import { KeyboardAvoidingView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type Theme, tokens, useTheme } from "../../theme";
import { GAP, PILL } from "./Composer";
import { ComposerAbove } from "./composerAbove";
import type { Notice } from "./useMessageActions";

// A list of messages with the composer floating over its foot, riding
// up with the keyboard, and a refusal's line over the composer, or what
// the composer shows over itself (ComposerAbove): the channel's layout,
// and a thread's. The list is drawn by the screen, given how far its
// newest row must stay clear of the composer.
export default function ComposerDock({
  keyboard,
  list,
  composer,
  notice,
}: {
  keyboard: number;
  list: (clearance: number) => ReactNode;
  composer: ReactNode;
  notice: Notice | null;
}) {
  const styles = makeStyles(useTheme());
  const insets = useSafeAreaInsets();
  // The composer's height as drawn, for the list to clear.
  const [composerHeight, setComposerHeight] = useState(PILL);
  const [above, setAbove] = useState<ReactNode>(null);
  // Where the dock starts in the window (under the stack's header): the
  // avoiding view measures itself against its parent and needs that
  // offset to know how much of it the keyboard covers.
  const [top, setTop] = useState(0);
  const dock = useRef<ComponentRef<typeof View>>(null);
  // The composer sits GAP above the home indicator, or above the keyboard
  // while that is up (the avoiding view's padding ends at its top edge).
  const composerBottom = keyboard > 0 ? GAP : insets.bottom + GAP;

  return (
    <View
      ref={dock}
      style={styles.fill}
      onLayout={() => dock.current?.measureInWindow((_windowX, windowY) => setTop(windowY))}
    >
      <KeyboardAvoidingView style={styles.fill} behavior="padding" keyboardVerticalOffset={top}>
        {/* The avoiding view pads its bottom for the keyboard; the composer
            is placed from this view's bottom, which that padding moves. */}
        <View style={styles.fill}>
          {list(composerHeight + composerBottom)}
          <View
            style={[styles.composer, { bottom: composerBottom }]}
            onLayout={(event) => setComposerHeight(event.nativeEvent.layout.height)}
          >
            <ComposerAbove.Provider value={setAbove}>{composer}</ComposerAbove.Provider>
          </View>
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
      </KeyboardAvoidingView>
    </View>
  );
}

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
