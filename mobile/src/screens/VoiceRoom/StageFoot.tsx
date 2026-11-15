import { isLiquidGlassAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HangUpIcon, MicIcon, MicOffIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import Surface from "../Channel/Surface";

const JOIN = 52;
const CONTROL = 60;
// The bubble's padding around Join, and its corner, which follows
// Join's own.
const BUBBLE_PAD = 12;

// The foot of the Stage: who is here, in a line, over Join; once in the
// call, Mute and Leave in Join's place. A join that failed says so in
// the line's place. Where iOS has Liquid Glass it is a bubble of it
// floating over the tiles, as the composer floats over a channel;
// elsewhere a solid band across the bottom. `onHeight` says how much of
// the screen's foot it covers, for the tiles to clear.
export default function StageFoot({
  line,
  failure,
  state,
  muted,
  onJoin,
  onToggleMute,
  onLeave,
  onHeight,
}: {
  line: string;
  failure: string;
  // Before the join, while it connects, or in the call (call footState).
  state: "join" | "connecting" | "joined";
  muted: boolean;
  onJoin: () => void;
  onToggleMute: () => void;
  onLeave: () => void;
  onHeight: (height: number) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable();
  const connecting = state === "connecting";

  const inside = (
    <>
      {failure ? (
        <Text style={[styles.here, styles.failure]} numberOfLines={2} accessibilityRole="alert">
          {failure}
        </Text>
      ) : (
        !!line && (
          <Text style={styles.here} numberOfLines={2}>
            {line}
          </Text>
        )
      )}
      {state === "joined" ? (
        <View style={styles.controls}>
          <Control label={muted ? "Unmute" : "Mute"} on={muted} onPress={onToggleMute}>
            {muted ? <MicOffIcon color={theme.surface} size={26} /> : <MicIcon color={theme.text} size={26} />}
          </Control>
          <Control label="Leave" end onPress={onLeave}>
            <HangUpIcon color={theme.onAccent} size={26} />
          </Control>
        </View>
      ) : (
        <Pressable
          disabled={connecting}
          onPress={onJoin}
          accessibilityRole="button"
          accessibilityLabel={connecting ? "Joining" : "Join"}
          accessibilityState={{ disabled: connecting, busy: connecting }}
          style={({ pressed }) => [styles.join, (connecting || pressed) && styles.dim]}
        >
          {connecting ? <ActivityIndicator color={theme.onAccent} /> : <Text style={styles.joinLabel}>Join</Text>}
        </Pressable>
      )}
    </>
  );

  if (glass) {
    const bottom = Math.max(insets.bottom + 4, 8);
    return (
      <View
        style={[styles.floating, { bottom }]}
        onLayout={(event) => onHeight(event.nativeEvent.layout.height + bottom)}
      >
        <Surface glass style={styles.bubble}>
          {inside}
        </Surface>
      </View>
    );
  }
  return (
    <View
      style={[styles.band, { paddingBottom: insets.bottom + 14 }]}
      onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
    >
      {inside}
    </View>
  );
}

// One of the call's controls: a round button over its name. `on` is a
// switch that is on (muted); `end` is the one that ends the call.
function Control({
  label,
  on,
  end,
  onPress,
  children,
}: {
  label: string;
  on?: boolean;
  end?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const styles = makeStyles(useTheme());
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.control, pressed && styles.dim]}
    >
      <View style={[styles.round, on && styles.roundOn, end && styles.roundEnd]}>{children}</View>
      <Text style={styles.controlLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    floating: {
      position: "absolute",
      left: 8,
      right: 8,
    },
    bubble: {
      gap: 12,
      padding: BUBBLE_PAD,
      borderRadius: JOIN / 2 + BUBBLE_PAD,
    },
    band: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      gap: 12,
      paddingTop: 14,
      paddingHorizontal: 20,
      backgroundColor: theme.surface,
    },
    here: {
      textAlign: "center",
      color: theme.textMuted,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
    failure: {
      color: theme.danger,
    },
    join: {
      height: JOIN,
      borderRadius: tokens.radiusPill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accent,
    },
    dim: {
      opacity: tokens.disabled,
    },
    joinLabel: {
      color: theme.onAccent,
      fontSize: 17,
      fontWeight: "700",
    },
    controls: {
      flexDirection: "row",
      justifyContent: "center",
      gap: 28,
    },
    control: {
      width: 72,
      alignItems: "center",
      gap: 6,
    },
    round: {
      width: CONTROL,
      height: CONTROL,
      borderRadius: CONTROL / 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.raised,
    },
    roundOn: {
      backgroundColor: theme.text,
    },
    roundEnd: {
      backgroundColor: theme.danger,
    },
    controlLabel: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
      fontWeight: "600",
    },
  });
}
