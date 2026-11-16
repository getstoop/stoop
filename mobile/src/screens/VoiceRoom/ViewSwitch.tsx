import { isLiquidGlassAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { MicIcon, MicOffIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import Surface from "../Channel/Surface";
import { TITLE_SCALE } from "../Channel/TitlePill";
import { type Side, sideLabel } from "./switchRules";
import WaveMark from "./WaveMark";

// The row's height, and the room under it.
const BAR = 44;
const UNDER = 8;

// How far below the header's clearance the row reaches.
export const SWITCH_CLEARANCE = BAR + UNDER;

// A voice room's second floating row, under its header (ScreenHeader)
// and on the header's surface: the Call | Chat switch, a pill of two
// sides with the one shown filled. Call wears a green wave while this
// phone is in the room's call, and Chat a dot while its chat has
// messages waiting. `mic`, where given (on Chat, in the call), is the
// call's microphone as a round button beside the pill. Only the pill
// and the button take touches: the list scrolls under the rest.
export default function ViewSwitch({
  top,
  side,
  inCall,
  waiting,
  onSide,
  mic,
}: {
  // Where the row starts: the header's clearance.
  top: number;
  side: Side;
  inCall: boolean;
  waiting: boolean;
  onSide: (side: Side) => void;
  mic?: { muted: boolean; onToggle: () => void };
}) {
  const theme = useTheme();
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable();
  const styles = makeStyles(theme, glass);
  const marks = { inCall, waiting };
  return (
    <View style={[styles.row, { top }]} pointerEvents="box-none">
      <Surface glass={glass} style={styles.pill}>
        <View style={styles.sides} accessibilityRole="tablist">
          <SideButton label="Call" says={sideLabel("call", marks)} on={side === "call"} onPress={() => onSide("call")}>
            {inCall && <WaveMark color={theme.ok} />}
          </SideButton>
          <SideButton
            label="Chat"
            says={sideLabel("chat", marks)}
            on={side === "chat"}
            onPress={() => onSide("chat")}
            after={waiting && <View style={styles.dot} />}
          />
        </View>
      </Surface>
      {mic && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={mic.muted ? "Unmute your microphone" : "Mute your microphone"}
          onPress={mic.onToggle}
          style={({ pressed }) => pressed && styles.down}
        >
          {mic.muted ? (
            <View style={[styles.round, styles.muted]}>
              <MicOffIcon color={theme.surface} size={22} />
            </View>
          ) : (
            <Surface glass={glass} style={styles.round}>
              <MicIcon color={theme.text} size={22} />
            </Surface>
          )}
        </Pressable>
      )}
    </View>
  );
}

// One side of the switch: its name, with a mark before or after it.
function SideButton({
  label,
  says,
  on,
  onPress,
  children,
  after,
}: {
  label: string;
  // What a screen reader is told.
  says: string;
  on: boolean;
  onPress: () => void;
  children?: ReactNode;
  after?: ReactNode;
}) {
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable();
  const styles = makeStyles(useTheme(), glass);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={says}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => [styles.side, on && styles.sideOn, pressed && styles.down]}
    >
      {children}
      <Text style={[styles.label, on && styles.labelOn]} maxFontSizeMultiplier={TITLE_SCALE} numberOfLines={1}>
        {label}
      </Text>
      {after}
    </Pressable>
  );
}

function makeStyles(theme: Theme, glass: boolean) {
  // The side shown: lifted off the panel, or a wash over the glass.
  const shown = !glass ? theme.raised : theme.scheme === "dark" ? "rgba(255, 255, 255, 0.16)" : "rgba(0, 0, 0, 0.08)";
  return StyleSheet.create({
    row: {
      position: "absolute",
      left: 0,
      right: 0,
      // Over the list and its edges, as the header is.
      zIndex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
    },
    pill: {
      flex: 1,
      height: BAR,
      padding: 4,
      borderRadius: tokens.radiusPill,
    },
    sides: {
      flex: 1,
      flexDirection: "row",
      gap: 4,
    },
    side: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      borderRadius: tokens.radiusPill,
    },
    sideOn: {
      backgroundColor: shown,
    },
    label: {
      color: theme.textMuted,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    labelOn: {
      color: theme.text,
    },
    dot: {
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: theme.accent,
    },
    round: {
      width: BAR,
      height: BAR,
      borderRadius: tokens.radiusPill,
      alignItems: "center",
      justifyContent: "center",
    },
    muted: {
      backgroundColor: theme.text,
    },
    down: {
      opacity: 0.6,
    },
  });
}
