import { isLiquidGlassAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ExternalIcon, HangUpIcon, LoudspeakerIcon, MicIcon, MicOffIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import Surface from "../Channel/Surface";

const JOIN = 52;
const CONTROL = 60;
// The bubble's padding around Join, and its corner, which follows
// Join's own.
const BUBBLE_PAD = 12;

// The foot of the Stage: who is here, in a line, over Join; once in the
// call, Mute, Speaker and Leave in Join's place. Speaker is the
// loudspeaker rather than the earpiece, and has nothing to switch while
// headphones have the sound. A join that failed, or a call that was
// lost, says so in the line's place (`failure`), and so does a call
// whose connection is being tried again or not yet all there (`notice`), with the controls
// kept. A join refused the microphone has a link under its line to
// the app's page in the system's settings (`onOpenSettings`), where the
// microphone is allowed once the system won't ask again: underlined,
// with the mark of a link that leaves the app. Where iOS has Liquid Glass it is a bubble of it
// floating over the tiles, as the composer floats over a channel;
// elsewhere a solid band across the bottom. `onHeight` says how much of
// the screen's foot it covers, for the tiles to clear.
export default function StageFoot({
  line,
  failure,
  notice,
  state,
  muted,
  speaker,
  onJoin,
  onOpenSettings,
  onToggleMute,
  onToggleSpeaker,
  onLeave,
  onHeight,
}: {
  line: string;
  failure: string;
  // What the call says of its connection (call connectionLine), or "".
  notice: string;
  // Given while the failure is the microphone refused.
  onOpenSettings?: () => void;
  // Before the join, while it connects, or in the call (call footState).
  state: "join" | "connecting" | "joined";
  muted: boolean;
  // The loudspeaker on or off, or headphones have the sound (call
  // speakerState).
  speaker: "on" | "off" | "headphones";
  onJoin: () => void;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
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
        <View style={[styles.failed, onOpenSettings && styles.failedWithButton]}>
          <Text style={[styles.here, styles.failure]} numberOfLines={2} accessibilityRole="alert">
            {failure}
          </Text>
          {onOpenSettings && (
            <Pressable
              onPress={onOpenSettings}
              accessibilityRole="link"
              testID="voice-open-settings"
              style={({ pressed }) => [styles.settingsButton, pressed && styles.dim]}
            >
              <Text style={styles.settings}>Open Settings</Text>
              <ExternalIcon color={theme.accent} size={16} />
            </Pressable>
          )}
        </View>
      ) : notice ? (
        <Text style={styles.here} numberOfLines={2} accessibilityRole="alert">
          {notice}
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
          <Control
            label="Speaker"
            toggle
            on={speaker === "on"}
            disabled={speaker === "headphones"}
            hint={speaker === "headphones" ? "Sound is going to headphones" : undefined}
            onPress={onToggleSpeaker}
          >
            <LoudspeakerIcon color={speaker === "on" ? theme.surface : theme.text} size={26} />
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

// One of the call's controls: a round button over its name. `on` fills
// it (muted, the loudspeaker on); `toggle` is one whose name stays and
// whose state is said as on or off; `end` is the one that ends the call.
function Control({
  label,
  on,
  toggle,
  end,
  disabled,
  hint,
  onPress,
  children,
}: {
  label: string;
  on?: boolean;
  toggle?: boolean;
  end?: boolean;
  disabled?: boolean;
  hint?: string;
  onPress: () => void;
  children: ReactNode;
}) {
  const styles = makeStyles(useTheme());
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole={toggle ? "switch" : "button"}
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={toggle ? { checked: !!on, disabled: !!disabled } : undefined}
      style={({ pressed }) => [styles.control, (pressed || disabled) && styles.dim]}
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
    failed: {
      alignItems: "center",
    },
    // The button is as tall as a touch needs, which is more room than
    // its words want over Join: the block gives some of it back.
    failedWithButton: {
      marginBottom: -6,
    },
    settingsButton: {
      minHeight: 44,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },
    settings: {
      color: theme.accent,
      fontSize: tokens.textUi,
      fontWeight: "600",
      textDecorationLine: "underline",
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
