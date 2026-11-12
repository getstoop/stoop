import { Code, ConnectError } from "@connectrpc/connect";
import { type Channel, ChannelKind } from "@stoop/gen/stoop/chat/v1/channel_pb";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import {
  loadSpaceChannels,
  memberName,
  type SpaceChannels,
  setChannelMuted,
  touchesSpace,
} from "../../api/channels";
import { errorText } from "../../api/errors";
import { hostOf } from "../../api/probe";
import { sessionToken } from "../../api/servers";
import { channelLink } from "../../api/shareLinks";
import Skeleton from "../../components/Skeleton";
import SkeletonPulse from "../../components/SkeletonPulse";
import TabNotice from "../../components/TabNotice";
import { useSheetNotice } from "../../hooks/useSheetNotice";
import { useServerEvents, useVoiceRoster } from "../../realtime/RealtimeProvider";
import { inRoom } from "../../realtime/voice";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import ChannelMenu from "./ChannelMenu";
import ChannelRow from "./ChannelRow";
import type { ChannelAction } from "./channelMenuRules";
import PaneHeader from "./PaneHeader";
import PaneScroll from "./PaneScroll";
import PaneSkeleton from "./PaneSkeleton";
import { afterLoad } from "./reloads";
import { useQuietReload } from "./useQuietReload";
import VoiceRoom from "./VoiceRoom";

// The Spaces tab's pane: the selected space's name, how many are in it
// and what it is, with the search of it, over its text channels with
// what is waiting in each (each opens the channel) and its voice rooms
// with who is in them. A long press on either opens its menu
// (ChannelMenu): a mute shows once the server has answered and the
// pane has reloaded, and one refused is said. The tab mounts one per space picked, so each
// starts from its skeleton, under the name the rail's list already has.
// Loaded on opening and on a pull, and again, while the tab is in
// sight, on coming back to the app and whenever the realtime socket
// says something in the space changed (out of sight, once on return);
// who is in voice is live from the socket itself. A reload that fails
// keeps the channels already shown: only the first load and Try again
// say the server couldn't be reached.

type State =
  | { state: "loading" }
  | { state: "ready"; token: string; channels: SpaceChannels }
  | { state: "failed" };

// What a load can also answer, which the tab acts on: the session over,
// or the account no longer in the space (left, removed, or the space
// deleted since the rail's list was loaded).
type Answer = State | "ended" | "gone";

export default function Pane({
  server,
  space,
  onReloadSpaces,
  onEnded,
}: {
  server: SavedServer;
  // The space as the rail's list has it.
  space: Space;
  // Reloads the rail's list: on a pull, with the pane, and when the
  // pane's load says the space is gone, after which the tab moves on to
  // another space.
  onReloadSpaces: () => Promise<void>;
  // The server said the session is over: the whole tab says so.
  onEnded: () => void;
}) {
  const styles = makeStyles(useTheme());
  const router = useRouter();
  const roster = useVoiceRoster(server.id);
  const spaceId = space.id;
  const [view, setView] = useState<State>({ state: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (): Promise<Answer> => {
    const token = await sessionToken(server.id).catch(() => null);
    if (!token) return "ended";
    try {
      return { state: "ready", token, channels: await loadSpaceChannels(server.origin, token, spaceId) };
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.Unauthenticated) return "ended";
      if (err instanceof ConnectError && (err.code === Code.NotFound || err.code === Code.PermissionDenied)) {
        return "gone";
      }
      return { state: "failed" };
    }
  }, [server, spaceId]);

  // What the load's answer is passed to, as they are on the latest draw.
  const told = useRef({ onReloadSpaces, onEnded });
  told.current = { onReloadSpaces, onEnded };

  // Loads can overlap (opening, a pull, coming back, an event), and an
  // older one finishing last must not undo a newer one: only the latest
  // started is shown, and leaving the pane makes none the latest.
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++latest.current;
    const answer = await load();
    if (mine !== latest.current) return;
    if (answer === "ended") {
      told.current.onEnded();
      return;
    }
    if (answer !== "gone") {
      setView((shown) => afterLoad(shown, answer));
      return;
    }
    // The rail's list is asked again, and without the space the tab
    // takes this pane away. Still here after that, the list and the
    // space disagree: say so, with a way to ask again, rather than
    // leave what was shown.
    await told.current.onReloadSpaces();
    if (mine === latest.current) setView({ state: "failed" });
  }, [load]);

  const quiet = useQuietReload(refresh);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener("change", (state) => state === "active" && quiet.now());
    return () => {
      latest.current++;
      sub.remove();
    };
  }, [refresh, quiet]);
  useServerEvents(server.id, (event) => {
    if (touchesSpace(event, spaceId)) quiet.soon();
  });

  // The channel whose menu is up; a refusal is said once its sheet has
  // gone.
  const [menuFor, setMenuFor] = useState<Channel | null>(null);
  const { say, opened, closed } = useSheetNotice();
  const openMenu = (channel: Channel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    opened();
    setMenuFor(channel);
  };
  const closeMenu = () => {
    setMenuFor(null);
    closed();
  };

  const pull = async () => {
    setRefreshing(true);
    await Promise.all([refresh(), onReloadSpaces()]);
    setRefreshing(false);
  };

  const retry = async () => {
    setView({ state: "loading" });
    await refresh();
  };

  const ready = view.state === "ready" ? view : undefined;
  const shown = ready?.channels.space ?? space;
  const about =
    ready &&
    [ready.channels.memberCount === 1 ? "1 member" : `${ready.channels.memberCount} members`, shown.description]
      .filter(Boolean)
      .join(" · ");

  const header = (
    <PaneHeader
      name={shown.name}
      about={about}
      pending={view.state === "loading"}
      onSearch={() =>
        router.push({ pathname: "/s/[id]/space/[spaceId]/search", params: { id: server.id, spaceId } })
      }
    />
  );

  if (view.state === "loading") {
    // One pulse for the header's placeholder and the rows'.
    return (
      <SkeletonPulse>
        {header}
        <Skeleton>
          <PaneSkeleton />
        </Skeleton>
      </SkeletonPulse>
    );
  }
  if (!ready) {
    return (
      <>
        {header}
        <PaneScroll refreshing={refreshing} onRefresh={pull}>
          <View style={styles.notice}>
            <TabNotice
              flush
              message={`Couldn't reach ${hostOf(server.origin)}.`}
              action={{ label: "Try again", onPress: retry }}
            />
          </View>
        </PaneScroll>
      </>
    );
  }

  const { text, voice, members } = ready.channels;

  const people = (channel: Channel) =>
    roster &&
    inRoom(roster, channel.id).map((participant) => {
      const member = members[participant.userId];
      // Someone the member list doesn't have yet: joined since it loaded.
      return member
        ? { userId: participant.userId, name: memberName(member), avatarFileId: member.avatarFileId }
        : { userId: participant.userId, name: "Someone", avatarFileId: "" };
    });

  const act = (channel: Channel, action: ChannelAction) => {
    if (action === "copyLink") {
      Clipboard.setStringAsync(channelLink(server.origin, spaceId, channel.id)).then(
        () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
        () => say("Couldn't copy the link"),
      );
      return;
    }
    // The socket's ChannelMuted reloads the pane too; asked here as
    // well, the row is right with the socket down.
    const muted = !channel.muted;
    setChannelMuted(server.origin, ready.token, channel.id, muted)
      .catch((err) => say(muted ? "Couldn't mute the channel" : "Couldn't unmute the channel", errorText(err)))
      .finally(refresh);
  };

  // The menu's channel as the pane now draws it, so a mute or a reload
  // under it shows; once off the list (deleted), as it was when the
  // menu opened, so the sheet can slide out over it.
  const menuChannel =
    menuFor && ([...text, ...voice].find((channel) => channel.id === menuFor.id) ?? menuFor);

  return (
    <>
      {header}
      <PaneScroll refreshing={refreshing} onRefresh={pull}>
        {text.length > 0 && (
          <Text style={styles.section} accessibilityRole="header">
            Text channels
          </Text>
        )}
        {text.map((channel) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            spaceMuted={shown.muted}
            onPress={() => router.push(`/s/${server.id}/space/${spaceId}/channel/${channel.id}`)}
            onLongPress={() => openMenu(channel)}
            onAction={(action) => act(channel, action)}
          />
        ))}
        {voice.length > 0 && (
          <Text style={[styles.section, styles.later]} accessibilityRole="header">
            Voice
          </Text>
        )}
        {voice.map((channel) => (
          <VoiceRoom
            key={channel.id}
            channel={channel}
            spaceMuted={shown.muted}
            people={people(channel)}
            origin={server.origin}
            token={ready.token}
            onLongPress={() => openMenu(channel)}
            onAction={(action) => act(channel, action)}
          />
        ))}
        {text.length === 0 && voice.length === 0 && <Text style={styles.empty}>No channels here yet.</Text>}
      </PaneScroll>
      {menuChannel && (
        <ChannelMenu
          channel={menuChannel}
          spaceMuted={shown.muted}
          card={
            menuChannel.kind === ChannelKind.VOICE ? (
              <VoiceRoom
                channel={menuChannel}
                spaceMuted={shown.muted}
                people={people(menuChannel)}
                origin={server.origin}
                token={ready.token}
              />
            ) : (
              <ChannelRow channel={menuChannel} spaceMuted={shown.muted} />
            )
          }
          onAction={(action) => act(menuChannel, action)}
          onClose={closeMenu}
        />
      )}
    </>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    // With the scroll's own 8, the pane's 20 at the sides.
    notice: {
      marginTop: 4,
      paddingHorizontal: 12,
    },
    section: {
      marginTop: 8,
      marginBottom: 4,
      marginHorizontal: 12,
      color: theme.textMuted,
      fontSize: tokens.textXs,
      fontWeight: "600",
      letterSpacing: 0.66,
      textTransform: "uppercase",
    },
    later: {
      marginTop: 20,
    },
    empty: {
      paddingHorizontal: 12,
      color: theme.textMuted,
      fontSize: tokens.textBody,
      lineHeight: tokens.textBody * tokens.leadingBody,
    },
  });
}
