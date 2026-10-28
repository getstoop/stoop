import { channelItems } from "@stoop/core/channelLog";
import { type GroupedRow, groupedRows } from "@stoop/core/grouping";
import { canDeleteAnyMessage, canStartThreads } from "@stoop/core/permissions";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { Stack, useIsFocused, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Platform, StyleSheet, Text, View } from "react-native";
import { useServerStatus } from "../../api/instance";
import { markRead } from "../../api/messages";
import { hostOf } from "../../api/probe";
import { messageLink } from "../../api/shareLinks";
import { useAudioPlayback } from "../../components/Attachments/audio";
import { useLinkPreviewActions } from "../../components/LinkPreviews/context";
import MessageContexts from "../../components/MessageContexts";
import Viewer from "../../components/Viewer";
import { itemKey } from "../../components/Viewer/items";
import { useViewer } from "../../components/Viewer/useViewer";
import { useKeyboardHeight } from "../../hooks/useKeyboardHeight";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import ChannelTitle from "./ChannelTitle";
import Composer from "./Composer";
import ComposerDock from "./ComposerDock";
import Divider from "./Divider";
import JumpToLatest from "./JumpToLatest";
import MessageMenu from "./MessageMenu";
import MessageRow from "./MessageRow";
import SearchButton from "./SearchButton";
import Unavailable from "./Unavailable";
import { olderFits } from "./channelEngine";
import { searchItem } from "./searchItem";
import { useChannelLinks } from "./useChannelLinks";
import { useChannelLog } from "./useChannelLog";
import { useMentionNames } from "./useMentionNames";
import { useMessageActions } from "./useMessageActions";

// A channel, pushed over its space: its messages newest at the bottom,
// older pages loading as the reader scrolls up, and the realtime socket
// adding, changing and removing messages as they happen. It opens at the
// "New" line when there is one, and keeps the reader's marker at the
// newest message while it is on screen. The composer floats over the
// bottom of the list and rides up with the keyboard; what it sends
// comes back as a row the same way an event does. A long press on a
// message opens its menu over the channel (MessageMenu); a reaction or a
// delete from it goes through useChannelLog, and one the server refuses
// is said in a line over the composer for a moment, as is a link the
// clipboard refused. Quote in reply makes the message the composer's
// quote: this screen holds it by id while the composer is on this
// channel, rings its row, and once the menu has gone opens the composer
// over it, the row scrolled to the middle of what the keyboard leaves,
// once; the quote goes with a send, Cancel reply, the channel, or the
// message itself (deleted, or left as a placeholder), silently. Edit
// message holds the message the same way, for the composer to edit;
// one at a time between the two, so an edit begun drops a quote and a
// quote picked ends an edit. A root's replies line, or Reply in thread
// once the menu has gone, pushes the thread over the channel
// (screens/Thread), which shares this screen's log, as does the line on
// a reply also sent to the channel, which opens its thread on it. A tap
// on a picture opens the viewer over the channel (components/Viewer),
// stepping through the pictures it has loaded. Search at the header's
// right (searchItem, SearchButton) pushes the space's search screen
// (screens/Search) narrowed to this channel. The
// menu, the quote, the edit and the refusals are useMessageActions',
// shared with the thread; the layout is ComposerDock's. What is held and
// what each answer and event does to it is the channel log's
// (core/channelLog, under core/channelScreen, through useChannelLog);
// this screen marks read and draws.

export default function Channel({
  server,
  spaceId,
  channelId,
}: {
  server: SavedServer;
  spaceId: string;
  channelId: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  // The header floats over the list (the server's layout), so the list
  // and what stands in for it clear it by this much.
  const headerHeight = useHeaderHeight();
  const router = useRouter();
  const focused = useIsFocused();
  const keyboard = useKeyboardHeight();
  const status = useServerStatus(server.origin);
  const { state, engine } = useChannelLog(server, spaceId, channelId);
  const { older, retry, send, edit } = engine;
  const { log, header, outcome, token, newAfter, loadingOlder } = state;
  const [active, setActive] = useState(AppState.currentState === "active");
  // The thread Reply in thread opens once the menu has gone, by its root.
  const threadAfterMenu = useRef<string | null>(null);
  const list = useRef<FlatList<GroupedRow>>(null);
  // Whether the reader has scrolled up from the newest message, for the
  // jump back to it.
  const [away, setAway] = useState(false);
  // What this screen remembers about the channel shown: the marker it
  // moved and whether it has landed. Another channel starts afresh.
  const marked = useRef("");
  const landed = useRef(false);
  const shownChannel = useRef(channelId);
  if (shownChannel.current !== channelId) {
    shownChannel.current = channelId;
    marked.current = "";
    landed.current = false;
    threadAfterMenu.current = null;
  }

  useEffect(() => {
    const sub = AppState.addEventListener("change", (appState) => setActive(appState === "active"));
    return () => sub.remove();
  }, []);

  // The channel's shown rows, oldest first; the same array while nothing
  // shown changed.
  const messages = channelItems(log);

  // A screen pushed over the channel (a thread, the search), one at a
  // time: a second tap before the first has covered the channel pushes
  // nothing; coming back to the channel lets the next go, as does a
  // second gone by, should the push have gone nowhere.
  const pushed = useRef(false);
  useEffect(() => {
    if (focused) pushed.current = false;
  }, [focused]);
  const pushOnce = useCallback((go: () => void) => {
    if (pushed.current) return;
    pushed.current = true;
    setTimeout(() => {
      pushed.current = false;
    }, 1000);
    go();
  }, []);
  // The thread pushed over the channel, by its root's id.
  const pushThread = useCallback(
    (rootId: string, focusId?: string) =>
      pushOnce(() =>
        router.push({
          pathname: "/s/[id]/space/[spaceId]/channel/[channelId]/thread/[rootId]",
          params: { id: server.id, spaceId, channelId, rootId, ...(focusId ? { focus: focusId } : {}) },
        }),
      ),
    [pushOnce, router, server.id, spaceId, channelId],
  );
  // The space's search, starting in this channel.
  const openSearch = useCallback(
    () =>
      pushOnce(() =>
        router.push({ pathname: "/s/[id]/space/[spaceId]/search", params: { id: server.id, spaceId, c: channelId } }),
      ),
    [pushOnce, router, server.id, spaceId, channelId],
  );
  const openThread = useCallback((message: Message) => pushThread(message.id), [pushThread]);
  // A reply also sent here opens its thread on it.
  const openOrigin = useCallback(
    (message: Message) => pushThread(message.threadRootId, message.id),
    [pushThread],
  );
  // The reader's marker follows the newest message while the channel is
  // on screen with the app open, as on web.
  const newestId = messages.at(-1)?.id ?? "";
  useEffect(() => {
    if (!newestId || !token || !focused || !active || !header) return;
    const readTo = header.channel.lastReadMessageId;
    if (newestId <= readTo || newestId <= marked.current) return;
    marked.current = newestId;
    markRead(server.origin, token, channelId, newestId).catch(() => {
      if (marked.current === newestId) marked.current = "";
    });
  }, [newestId, token, focused, active, server.origin, channelId, header]);

  // Newest first, for a list drawn from the bottom up.
  const items = useMemo(
    () => (header ? groupedRows(messages, newAfter, header.myUserId).reverse() : []),
    [messages, newAfter, header],
  );
  const actions = useMessageActions({
    scope: channelId,
    shown: messages,
    log,
    gone: !!outcome,
    engine,
    keyboard,
    focused,
    list,
    items,
  });
  const { menuFor, menuMessage } = actions;
  const links = useChannelLinks(server, spaceId, channelId, header);
  const mentionNames = useMentionNames(header);
  const viewer = useViewer(messages);
  // Audio stops when the screen is covered or left, the app leaves the
  // front, or the viewer opens.
  const audio = useAudioPlayback(focused && active && !viewer.viewing);
  // Nor does it go on when the screen shows another channel in place.
  useEffect(() => () => audio.release(), [audio, channelId]);
  const previews = useLinkPreviewActions(status.origins, header?.space, actions.dismissPreview);
  // And Reply in thread pushes the thread then.
  useEffect(() => {
    const rootId = threadAfterMenu.current;
    if (menuFor || !rootId) return;
    threadAfterMenu.current = null;
    pushThread(rootId);
  }, [menuFor, pushThread]);
  const sendHere = useCallback(
    (content: string, replyToMessageId: string, _alsoSend: boolean, attachmentIds: string[]) =>
      send(content, { replyToMessageId, attachmentIds }),
    [send],
  );

  // Opening lands on the "New" line, once.
  const newIndex = items.findIndex((item) => item.kind === "new");
  useEffect(() => {
    if (landed.current || items.length === 0) return;
    landed.current = true;
    if (newIndex > 0) list.current?.scrollToIndex({ index: newIndex, viewPosition: 0.5, animated: false });
  }, [items.length, newIndex]);

  if (outcome === "ended") {
    return (
      <Unavailable
        message={`Your sign-in to ${server.name} has ended. Sign in again to carry on.`}
        action={{
          label: "Sign in again",
          onPress: () => router.replace({ pathname: "/sign-in", params: { server: server.origin } }),
        }}
      />
    );
  }
  if (outcome === "gone") return <Unavailable message="This channel isn't available any more." />;
  if (outcome === "failed") {
    return (
      <Unavailable message={`Couldn't reach ${hostOf(server.origin)}.`} action={{ label: "Try again", onPress: retry }} />
    );
  }
  if (!header) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator style={[styles.center, { marginTop: 24 + headerHeight }]} color={theme.textMuted} />
      </View>
    );
  }

  const { space, channel, memberCount, myUserId } = header;
  const { hasOlder } = log.channel;
  const search = { spaceName: space.name, onPress: openSearch };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerTitle: () => <ChannelTitle channel={channel} spaceName={space.name} memberCount={memberCount} />,
          ...(Platform.OS === "ios"
            ? { unstable_headerRightItems: () => [searchItem(search)] }
            : { headerRight: () => <SearchButton {...search} /> }),
        }}
      />
      <ComposerDock
        keyboard={keyboard}
        notice={actions.notice}
        list={(clearance) => (
          <MessageContexts links={links} previews={previews} view={viewer.open} audio={audio}>
            <FlatList
              ref={list}
              inverted
              data={items}
              keyExtractor={(item) => item.key}
              renderItem={({ item }) =>
                item.kind === "message" ? (
                  <MessageRow
                    message={item.message}
                    continued={item.continued}
                    myUserId={myUserId}
                    origin={server.origin}
                    token={token}
                    onLongPress={actions.openMenu}
                    onOpenThread={openThread}
                    onOpenOrigin={openOrigin}
                    onReact={actions.reactTo}
                    target={actions.targetOf(item.message)}
                  />
                ) : (
                  <Divider label={item.label} fresh={item.kind === "new"} />
                )
              }
              onEndReached={older}
              onEndReachedThreshold={0.5}
              onScrollToIndexFailed={({ index }) => {
                // Rows not measured yet: get near, then try again once drawn.
                list.current?.scrollToOffset({ offset: index * 60, animated: false });
                setTimeout(() => list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false }), 100);
              }}
              // Away from the newest message once scrolled further from the
              // bottom edge than the list follows new rows from.
              onScroll={(event) => setAway(event.nativeEvent.contentOffset.y > AT_LATEST)}
              scrollEventThrottle={50}
              // Scrolling leaves the keyboard, and so the composer's card, in
              // place. On iOS a drag down into the keyboard puts it away; the
              // card follows the keyboard's hide event, which iOS posts only
              // at the end of that drag, so it floats over an empty strip
              // while the keyboard follows the finger. Following it needs
              // react-native-keyboard-controller, a follow-up. Android has no
              // such drag: the back gesture puts the keyboard away.
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "none"}
              // Drawn upside down, so the top padding is the bottom edge: the
              // list scrolls under the composer, and its newest message clears
              // it; the bottom padding is the top edge, under the header.
              contentContainerStyle={{ paddingTop: 12 + clearance, paddingBottom: 12 + headerHeight }}
              // Rows in view stay put when that padding changes (the composer
              // growing a line) and when a row arrives, unless the reader is at
              // the newest edge, where the list follows it.
              maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: AT_LATEST }}
              ListFooterComponent={
                loadingOlder ? (
                  <ActivityIndicator style={styles.edge} color={theme.textMuted} />
                ) : !hasOlder ? (
                  <Text style={styles.beginning}>
                    {messages.length === 0 ? "No messages yet. " : ""}This is the beginning of #{channel.name}.
                  </Text>
                ) : !olderFits(log) ? (
                  <Text style={styles.beginning}>Showing the latest {messages.length.toLocaleString()} messages.</Text>
                ) : undefined
              }
            />
          </MessageContexts>
        )}
        corner={
          <JumpToLatest
            shown={away}
            onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
          />
        }
        composer={
          <Composer
            ref={actions.composer}
            key={channelId}
            channelName={channel.name}
            mentionNames={mentionNames}
            origin={server.origin}
            token={token}
            send={sendHere}
            upload={engine.upload}
            maxUploadBytes={status.maxUploadBytes}
            edit={edit}
            replyTo={actions.replyTo}
            onCancelReply={actions.cancelReply}
            onReply={actions.reply}
            editing={actions.editing}
            onEditDone={actions.endEdit}
          />
        }
      />
      <MessageContexts links={links} previews={previews}>
        {menuMessage && (
          <MessageMenu
            message={menuMessage}
            myUserId={myUserId}
            canModerate={canDeleteAnyMessage(space)}
            origin={server.origin}
            token={token}
            link={messageLink(server.origin, spaceId, menuMessage)}
            onReact={(emoji) => actions.reactTo(menuMessage, emoji)}
            onCopyFailed={actions.linkNotCopied}
            onThread={
              // As web's: where the reader may start one, and not on a reply
              // also sent here, which is in a thread already.
              canStartThreads(space, channel) && !menuMessage.threadRootId
                ? () => {
                    threadAfterMenu.current = menuMessage.id;
                  }
                : undefined
            }
            onQuote={() => actions.quote(menuMessage)}
            onEdit={() => actions.startEdit(menuMessage)}
            onDelete={() => actions.deleteMessage(menuMessage)}
            onClose={actions.closeMenu}
          />
        )}
      </MessageContexts>
      {viewer.viewing && (
        <Viewer
          key={itemKey(viewer.viewing.items[viewer.viewing.index])}
          items={viewer.viewing.items}
          start={viewer.viewing.index}
          origin={server.origin}
          token={token}
          onClose={viewer.close}
        />
      )}
    </View>
  );
}

// How far from the bottom edge the reader still counts as at the newest
// message: the list follows a new row from this near, and the jump back
// shows from further.
const AT_LATEST = 80;

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.surface,
    },
    center: {
      marginTop: 24,
    },
    edge: {
      marginVertical: 16,
    },
    beginning: {
      marginHorizontal: 16,
      marginVertical: 16,
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
  });
}
