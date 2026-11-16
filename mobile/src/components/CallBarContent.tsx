import { useIsFocused, useNavigation, useRouter } from "expo-router";
import { useRef } from "react";
import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useCallPlace } from "../call/CallPlaceProvider";
import type { Call } from "../call/call";
import { useCall, useCallActions } from "../call/CallProvider";
import {
  CALL_BAR_HEIGHT,
  type CallPlace,
  callBarLabel,
  callBarName,
  callBarShown,
  callBarStatus,
  screensOverRoom,
} from "../call/callBar";
import { askForRoom } from "../call/pendingRoom";
import { usePushOnce } from "../hooks/usePushOnce";
import { useCurrentServer, useServers } from "../servers";
import { type ServerNavigation, swapServer } from "../servers/swapServer";
import { type Theme, tokens, useTheme } from "../theme";
import { HangUpIcon, MicIcon, MicOffIcon } from "./Icons";
import WaveBars from "./WaveBars";

// What the call bar says and does, on whatever surface it is put (the
// row by the tab bar, CallBar.tsx): the call's room and, under it, who
// is speaking (call/callBar.ts), then Mute and Leave. Pressing the
// names opens the room's screen. With another server on screen than the
// call's, the second line names the call's server first, its letter
// stands where the wave was, and pressing swaps to that server and
// opens the room there (call/OpenCallRoom.tsx). With the room already
// in the stack under this screen (a thread opened from the room's
// chat), pressing goes back to it. It reads the call
// itself, and draws nothing with no call; it needs a server's screen
// around it (CurrentServer). `style` is for the surface's own padding.
// The wave moves while the call is connected, and not reconnecting, and
// the screen this is on is the one in front (WaveBars): a bar on a covered screen, or on a
// tab not shown, stays mounted and would otherwise animate unseen for
// the whole call. `held` keeps
// what it last said on show once the call has gone, for a surface that
// fades out after it (CallPill), which must then take no touches.
export default function CallBarContent({ style, held }: { style?: StyleProp<ViewStyle>; held?: boolean }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();
  const navigation = useNavigation<ServerNavigation>();
  const pushOnce = usePushOnce();
  const focused = useIsFocused();
  const current = useCurrentServer();
  const { servers, switchTo } = useServers();
  const now = useCall();
  const placeNow = useCallPlace();
  const { toggleMute, leave } = useCallActions();
  const live = callBarShown(now);
  const last = useRef<{ call: Call; place: CallPlace | undefined }>(undefined);
  if (live) last.current = { call: now, place: placeNow };
  const drawn = live || held ? last.current : undefined;
  if (!drawn) return null;
  const { call, place } = drawn;

  const { room } = call;
  const elsewhere = room.serverId !== current.id;
  const serverName = elsewhere ? (servers.find((saved) => saved.id === room.serverId)?.name ?? "") : "";
  const name = callBarName(place);
  const status = callBarStatus(call, place, serverName);
  const connecting = call.status === "connecting";

  const open = () =>
    pushOnce(() => {
      if (elsewhere) {
        askForRoom(room);
        swapServer(navigation, room.serverId);
        switchTo(room.serverId).catch(() => {});
        return;
      }
      // POP counts from `source`, the screen in front (swapServer.ts).
      const { routes, index, key } = navigation.getState();
      const over = screensOverRoom(routes, index, room);
      if (over) {
        navigation.dispatch({ type: "POP", payload: { count: over }, source: routes[index].key, target: key });
        return;
      }
      router.push({
        pathname: "/s/[id]/space/[spaceId]/voice/[channelId]",
        params: { id: room.serverId, spaceId: room.spaceId, channelId: room.channelId },
      });
    });

  return (
    <View style={[styles.bar, style]} testID="call-bar">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={callBarLabel(name, status)}
        testID="call-bar-open"
        onPress={open}
        style={({ pressed }) => [styles.main, pressed && styles.dim]}
      >
        <View style={[styles.tile, elsewhere && styles.serverTile]}>
          {elsewhere ? (
            <Text style={styles.tileLetter}>{serverName.trim().charAt(0).toUpperCase()}</Text>
          ) : (
            <WaveBars color={theme.ok} moving={live && focused && call.status === "connected" && !call.reconnecting} />
          )}
        </View>
        <View style={styles.lines}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.status} numberOfLines={1}>
            {status}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={call.muted ? "Unmute" : "Mute"}
        accessibilityState={{ disabled: connecting }}
        testID="call-bar-mute"
        disabled={connecting}
        onPress={() => void toggleMute()}
        style={({ pressed }) => [styles.button, pressed && styles.pressed, connecting && styles.dim]}
      >
        {call.muted ? <MicOffIcon color={theme.warn} size={22} /> : <MicIcon color={theme.text} size={22} />}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Leave the call"
        testID="call-bar-leave"
        onPress={() => void leave()}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <HangUpIcon color={theme.danger} size={22} />
      </Pressable>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    bar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      height: CALL_BAR_HEIGHT,
      paddingLeft: 14,
      paddingRight: 6,
    },
    main: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      alignSelf: "stretch",
    },
    tile: {
      width: 32,
      height: 32,
      borderRadius: tokens.radiusMd,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.okSoft,
    },
    serverTile: {
      backgroundColor: theme.accentSoft,
    },
    tileLetter: {
      color: theme.accent,
      fontSize: tokens.textUi,
      fontWeight: "700",
    },
    lines: {
      flex: 1,
      gap: 1,
    },
    name: {
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    status: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    button: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: {
      backgroundColor: theme.raised,
    },
    dim: {
      opacity: 0.5,
    },
  });
}
