import { isLiquidGlassAvailable } from "expo-glass-effect";
import { useIsFocused, useRouter } from "expo-router";
import { type ReactNode, useEffect, useRef } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePushOnce } from "../../hooks/usePushOnce";
import { BackIcon, BellIcon, MutedIcon, SearchIcon } from "../../components/Icons";
import { tokens, useTheme } from "../../theme";
import { type HeaderMute, type HeaderSearch, searchLabel } from "./headerActions";
import Surface from "./Surface";

// A channel's header, a conversation's and a thread's, floating over
// the head of the list under the status bar as the composer floats over
// its foot, the same on both platforms: a round back button, the title
// in a pill that takes the room between (the screen's title component,
// in a TitlePill), and one capsule holding Search and the bell, when
// the screen has either. All three are the composer's surface (Liquid
// Glass where iOS has it, else the panel under its shadow). The screens
// have no navigation bar of their own (the server's layout): the bar
// gave a title only the room it chose, differently on each platform,
// and cut off what was drawn outside it.
//
// It is drawn in every state of the screen, the title once there is
// one, so there is always a way back. Only its three surfaces take
// touches: the list scrolls under the rest of the row. The list, and
// what stands in for it, clear it by useHeaderClearance.

// The surfaces' height, and the room over and under them.
const BAR = 44;
const OVER = 6;
const UNDER = 8;

// How long after its screen comes to the front a header's Back does
// nothing: about the stack's own transition.
const SETTLE_MS = 400;

// How far down the screen the header reaches.
export function useHeaderClearance(): number {
  return useSafeAreaInsets().top + OVER + BAR + UNDER;
}

export default function ScreenHeader({
  title,
  search,
  mute,
}: {
  // The screen's title, in its TitlePill; none until it is known.
  title?: ReactNode;
  search?: HeaderSearch;
  mute?: HeaderMute;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // One screen back for a tap, however many land before it has gone.
  // A second tap in the same place can also land on the screen
  // underneath as it comes back (the channel's, under a thread), and
  // would take that with it: a header takes no Back until its screen
  // has been in front for a moment.
  const once = usePushOnce();
  const focused = useIsFocused();
  const inFront = useRef(0);
  useEffect(() => {
    if (focused) inFront.current = Date.now();
  }, [focused]);
  const back = () => {
    if (Date.now() - inFront.current < SETTLE_MS) return;
    once(() => router.back());
  };
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable();
  return (
    <View style={[styles.header, { paddingTop: insets.top + OVER }]} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={back}
        style={({ pressed }) => pressed && styles.down}
      >
        <Surface glass={glass} style={styles.round}>
          <BackIcon color={theme.text} size={24} />
        </Surface>
      </Pressable>
      {/* Holds the title's place while there is none, so the capsule
          keeps to the right. */}
      <View style={styles.title} pointerEvents="box-none">
        {title}
      </View>
      {(search || mute) && (
        <Surface glass={glass} style={styles.capsule}>
          {search && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={searchLabel(search.spaceName)}
              onPress={search.onPress}
              style={({ pressed }) => [styles.action, pressed && styles.down]}
            >
              <SearchIcon color={theme.text} size={22} />
            </Pressable>
          )}
          {mute && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={mute.label}
              accessibilityState={{
                selected: mute.muted,
                disabled: mute.pending || mute.held,
                busy: mute.pending,
              }}
              disabled={mute.pending || mute.held}
              onPress={mute.onPress}
              style={({ pressed }) => [
                styles.action,
                pressed && styles.down,
                (mute.pending || mute.held) && styles.dim,
              ]}
            >
              {mute.muted ? <MutedIcon color={theme.text} size={22} /> : <BellIcon color={theme.text} size={22} />}
            </Pressable>
          )}
        </Surface>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    // Over the list and its edges, which are drawn after it: it comes
    // first for a screen reader.
    zIndex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: UNDER,
  },
  round: {
    width: BAR,
    height: BAR,
    borderRadius: tokens.radiusPill,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    minHeight: BAR,
  },
  // As wide as what it holds: a circle around one, a capsule around
  // two.
  capsule: {
    flexDirection: "row",
    alignItems: "center",
    height: BAR,
    borderRadius: tokens.radiusPill,
  },
  action: {
    width: BAR,
    height: BAR,
    alignItems: "center",
    justifyContent: "center",
  },
  down: {
    opacity: 0.6,
  },
  dim: {
    opacity: tokens.disabled,
  },
});
