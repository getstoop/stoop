import { useNavigation, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { PlusIcon } from "../../components/Icons";
import { usePushOnce } from "../../hooks/usePushOnce";
import { type SavedServer, useServers } from "../../servers";
import { type ServerNavigation, swapServer } from "../../servers/swapServer";
import { useLeaveServer } from "../../servers/useLeaveServer";
import type { Waiting } from "../../servers/useWaiting";
import { type Theme, tokens, useTheme } from "../../theme";
import { confirmRemove } from "./confirmRemove";
import Section from "./Section";
import ServerEntry from "./ServerEntry";
import ServerMenu from "./ServerMenu";
import SwipeToRemove from "./SwipeToRemove";

// Every server on this phone. A tap opens one on its Spaces tab, or its
// sign-in if that has ended; a swipe left or a long press offers Remove,
// on the current server too, where it is the same as signing out.
export default function ServersSection({
  current,
  waiting,
}: {
  current: SavedServer;
  waiting: Record<string, Waiting>;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();
  const navigation = useNavigation<ServerNavigation>();
  const pushOnce = usePushOnce();
  const { servers, switchTo } = useServers();
  const leave = useLeaveServer();
  const [menuFor, setMenuFor] = useState<SavedServer | null>(null);

  // The row resting open on Remove, closed as another is swiped.
  const openRow = useRef<SwipeableMethods | null>(null);
  const swiped = useCallback((row: SwipeableMethods) => {
    if (openRow.current !== row) openRow.current?.close();
    openRow.current = row;
  }, []);

  const open = (server: SavedServer) => {
    openRow.current?.close();
    openRow.current = null;
    pushOnce(() => {
      if (server.id === current.id) {
        navigation.navigate("(spaces)" as never);
      } else if (waiting[server.id]?.state === "ended") {
        router.push({ pathname: "/sign-in", params: { server: server.origin } });
      } else {
        swapServer(navigation, server.id);
        switchTo(server.id);
      }
    });
  };

  // A refusal is said once the sheet has gone: on iOS an alert over a
  // modal goes with it (as the Messages tab holds its own).
  const menuOpen = useRef(false);
  const unsaid = useRef<string | null>(null);
  const remove = (server: SavedServer) => {
    leave(server).catch(() => {
      const title = `Couldn't remove ${server.name}`;
      if (menuOpen.current) unsaid.current = title;
      else Alert.alert(title);
    });
  };

  const openMenu = (server: SavedServer) => {
    openRow.current?.close();
    openRow.current = null;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    menuOpen.current = true;
    setMenuFor(server);
  };
  const closeMenu = () => {
    menuOpen.current = false;
    setMenuFor(null);
    const held = unsaid.current;
    unsaid.current = null;
    if (held) Alert.alert(held);
  };

  return (
    <Section title="Servers">
      {servers.map((server, index) => (
        <SwipeToRemove
          key={server.id}
          name={server.name}
          onRemove={() => confirmRemove(server, () => remove(server))}
          onSwipe={swiped}
        >
          <ServerEntry
            server={server}
            current={server.id === current.id}
            waiting={waiting[server.id]}
            divided={index > 0}
            onPress={() => open(server)}
            onLongPress={() => openMenu(server)}
            onRemove={() => confirmRemove(server, () => remove(server))}
          />
        </SwipeToRemove>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={() => pushOnce(() => router.push("/add-server"))}
        style={({ pressed }) => [styles.add, pressed && styles.pressed]}
      >
        <PlusIcon color={theme.accent} />
        <Text style={styles.addLabel}>Add a server</Text>
      </Pressable>
      {menuFor && (
        <ServerMenu
          server={menuFor}
          current={menuFor.id === current.id}
          waiting={waiting[menuFor.id]}
          onRemove={() => remove(menuFor)}
          onClose={closeMenu}
        />
      )}
    </Section>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    add: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 52,
      paddingHorizontal: 18,
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    addLabel: {
      color: theme.accent,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
  });
}
