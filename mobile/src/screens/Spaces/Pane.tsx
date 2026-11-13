import { Code, ConnectError } from "@connectrpc/connect";
import { type Channel, ChannelKind } from "@stoop/gen/stoop/chat/v1/channel_pb";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
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
import ChannelAbout from "./ChannelAbout";
import ChannelMenu from "./ChannelMenu";
import ChannelRow from "./ChannelRow";
import { type ChannelAction, channelTopic } from "./channelMenuRules";
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
// pane has reloaded, and one refused is said; About this channel opens
// the channel's topic in a sheet of its own (ChannelAbout) once the
// menu has gone. What is muted with the space is read from the rail's
// list, the only place that says so. The tab mounts one per space
// picked, so each starts from its skeleton, under the name the rail's
// list already has.
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
  onSpaceChanged,
  onEnded,
}: {
  server: SavedServer;
  // The space as the rail's list has it.
  space: Space;
  // Reloads the rail's list: on a pull, with the pane, and when the
  // pane's load says the space is gone, after which the tab moves on to
  // another space.
  onReloadSpaces: () => Promise<void>;
  // Something the pane did changed what the rail shows of the space (a
  // channel muted): the rail's list reloads after a moment's quiet, the
  // reload the socket's event for it asks for too.
  onSpaceChanged: () => void;
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
  const told = useRef({ onReloadSpaces, onSpaceChanged, onEnded });
  told.current = { onReloadSpaces, onSpaceChanged, onEnded };

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

  // The channel whose menu is up, and the id of the one About this
  // channel is up for: one sheet at a time, and a refusal is said once
  // neither is up.
  const [menuFor, setMenuFor] = useState<Channel | null>(null);
  const [aboutFor, setAboutFor] = useState<string | null>(null);
  // The channel About was picked for in the menu, held until the menu's
  // sheet has finished sliding out (closeMenu), when the two change
  // places in one commit.
  const aboutNext = useRef<string | null>(null);
  const { say, opened, closed } = useSheetNotice();
  const openMenu = (channel: Channel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    opened();
    setMenuFor(channel);
  };
  const closeMenu = useCallback(() => {
    setMenuFor(null);
    const next = aboutNext.current;
    aboutNext.current = null;
    if (next) setAboutFor(next);
    else closed();
  }, [closed]);
  const closeAbout = useCallback(() => {
    setAboutFor(null);
    closed();
  }, [closed]);
  // The menu goes with the channels: a pane that stops showing them
  // (a retry, the space gone) must not bring a sheet back later.
  const showing = view.state === "ready";
  useEffect(() => {
    if (showing) return;
    aboutNext.current = null;
    closeMenu();
  }, [showing, closeMenu]);

  // About's channel as the pane now draws it, so a topic changed under
  // the sheet shows. Without the channel or a topic there is nothing to
  // read, and the sheet goes.
  const listed = view.state === "ready" ? [...view.channels.text, ...view.channels.voice] : [];
  const aboutChannel = listed.find((channel) => channel.id === aboutFor && channelTopic(channel));
  const aboutOver = aboutFor !== null && !aboutChannel;
  useEffect(() => {
    if (aboutOver) closeAbout();
  }, [aboutOver, closeAbout]);

  // An action's answer can come after the pane has gone.
  const left = useRef(false);
  useEffect(() => {
    left.current = false;
    return () => {
      left.current = true;
    };
  }, []);

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
  // The space as its own load has it, but for the caller's mute of it,
  // which only the rail's list carries (ListSpaces; GetSpace leaves it
  // unset): `space.muted` is the one to read.
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
        {/* Wrapped as the channels are below, so a pull that reaches the
            server keeps this one list, and its spinner, for them. */}
        <Animated.View entering={FadeIn.duration(tokens.dur)} style={styles.fill}>
          <PaneScroll refreshing={refreshing} onRefresh={pull}>
            <View style={styles.notice}>
              <TabNotice
                flush
                message={`Couldn't reach ${hostOf(server.origin)}.`}
                action={{ label: "Try again", onPress: retry }}
              />
            </View>
          </PaneScroll>
        </Animated.View>
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
    if (action === "about") {
      // From the menu, when its sheet has gone (closeMenu); from a
      // screen reader's action on the row, at once.
      if (menuFor) {
        aboutNext.current = channel.id;
      } else {
        opened();
        setAboutFor(channel.id);
      }
      return;
    }
    if (action === "copyLink") {
      Clipboard.setStringAsync(channelLink(server.origin, spaceId, channel.id)).then(
        () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
        () => say("Couldn't copy the link"),
      );
      return;
    }
    // The reloads, the pane's and the rail's, are the ones the socket's
    // ChannelMuted asks for, asked here too so the row and the space's
    // mark are right with the socket down: the two make one request
    // each (quiet.soon).
    const muted = !channel.muted;
    setChannelMuted(server.origin, ready.token, channel.id, muted).then(
      () => {
        if (left.current) return;
        quiet.soon();
        told.current.onSpaceChanged();
      },
      (err) => {
        if (!left.current) say(muted ? "Couldn't mute the channel" : "Couldn't unmute the channel", errorText(err));
      },
    );
  };

  // The menu's channel as the pane now draws it, so a mute or a reload
  // under it shows; once off the list (deleted), as it was when the
  // menu opened, so the sheet can slide out over it.
  const menuChannel = menuFor && (listed.find((channel) => channel.id === menuFor.id) ?? menuFor);

  return (
    <>
      {header}
      {/* The channels fade in where the skeleton stood (at once under
          Reduce Motion); a reload after that changes them in place. */}
      <Animated.View entering={FadeIn.duration(tokens.dur)} style={styles.fill}>
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
              spaceMuted={space.muted}
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
              spaceMuted={space.muted}
              people={people(channel)}
              origin={server.origin}
              token={ready.token}
              onLongPress={() => openMenu(channel)}
              onAction={(action) => act(channel, action)}
            />
          ))}
          {text.length === 0 && voice.length === 0 && <Text style={styles.empty}>No channels here yet.</Text>}
        </PaneScroll>
      </Animated.View>
      {menuChannel && (
        <ChannelMenu
          channel={menuChannel}
          spaceMuted={space.muted}
          card={
            menuChannel.kind === ChannelKind.VOICE ? (
              <VoiceRoom
                channel={menuChannel}
                spaceMuted={space.muted}
                people={people(menuChannel)}
                origin={server.origin}
                token={ready.token}
              />
            ) : (
              <ChannelRow channel={menuChannel} spaceMuted={space.muted} />
            )
          }
          onAction={(action) => act(menuChannel, action)}
          onClose={closeMenu}
        />
      )}
      {aboutChannel && (
        <ChannelAbout
          channel={aboutChannel}
          topic={channelTopic(aboutChannel)}
          onClose={closeAbout}
        />
      )}
    </>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    fill: {
      flex: 1,
    },
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
