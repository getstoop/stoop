import { isShown, threadItems } from "@stoop/core/channelLog";
import { firstUnreadReplyId, type GroupedRow, threadRows } from "@stoop/core/grouping";
import { canDeleteAnyMessage } from "@stoop/core/permissions";
import { threadRepliesClosed } from "@stoop/core/threadReplies";
import { Stack, useIsFocused, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Platform, StyleSheet, Text, View } from "react-native";
import { hostOf } from "../../api/probe";
import { errorText } from "../../api/errors";
import { useServerStatus } from "../../api/instance";
import { threadMessageLink } from "../../api/shareLinks";
import { useAudioPlayback } from "../../components/Attachments/audio";
import { useLinkPreviewActions } from "../../components/LinkPreviews/context";
import MessageContexts from "../../components/MessageContexts";
import Viewer from "../../components/Viewer";
import { itemKey } from "../../components/Viewer/items";
import { useViewer } from "../../components/Viewer/useViewer";
import { useKeyboardHeight } from "../../hooks/useKeyboardHeight";
import { usePushOnce } from "../../hooks/usePushOnce";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import { olderFits } from "../Channel/channelEngine";
import Composer from "../Channel/Composer";
import ComposerDock from "../Channel/ComposerDock";
import Divider from "../Channel/Divider";
import MessageMenu from "../Channel/MessageMenu";
import MessageRow from "../Channel/MessageRow";
import SearchButton from "../Channel/SearchButton";
import { searchItem } from "../Channel/searchItem";
import { useChannelLinks } from "../Channel/useChannelLinks";
import Unavailable from "../Channel/Unavailable";
import { useChannelLog } from "../Channel/useChannelLog";
import { useFlash } from "../Channel/useFlash";
import { useMentionNames } from "../Channel/useMentionNames";
import { useMessageActions } from "../Channel/useMessageActions";
import MuteButton from "./MuteButton";
import { muteItem } from "./muteItem";
import ThreadHead from "./ThreadHead";
import ThreadTitle from "./ThreadTitle";

// A thread, pushed over its channel: the root at the top, ruled off, how
// many replies it has, and the replies under it, newest at the bottom,
// older ones loading as the reader scrolls up, the root shown once
// nothing older is left. It shares the channel's log (useChannelLog with
// the root's id), so a reply, an edit or a deletion of a reply or of the
// root lands here as it does in the channel; a root deleted while
// replies live stays as the channel's placeholder. It opens at the "New"
// line above the replies the reader hadn't read (the root's unread
// count, as the server gave it when the thread opened) and marks the
// thread read while it is on screen with the app open, again for each
// new reply; opened on a reply (`focusId`: one also sent to the channel,
// or one the channel was opened at), it lands on that reply instead,
// ringed for a moment (useFlash), when it is among the replies loaded.
// The composer replies in the thread, and to the channel as well when
// asked (Composer `inThread`); a deleted root or an announcement channel
// takes no replies, and a line says so in its place, as on web (with no
// Quote in reply or Edit message in its menu, and a quote or an edit
// begun dropped as it closes; web edits inline there, this screen not yet). A long
// press on the root or a reply opens the channel's menu, with no Reply
// in thread since everything here is in it already; Quote in reply and
// Edit message act on this composer (useMessageActions, as the
// channel's). A tap on a picture opens the viewer over the thread,
// stepping through its pictures. The header's bell mutes the thread, or unmutes it, as
// web's thread panel does: once it has replies, and only where its
// channel isn't muted, which silences it already. Before the bell, Search
// pushes the space's search screen narrowed to the thread's channel, as
// the channel's header does.

// How long after a failed read it is asked for again.
const READ_RETRY_MS = 5000;

export default function Thread({
  server,
  spaceId,
  channelId,
  rootId,
  focusId,
}: {
  server: SavedServer;
  spaceId: string;
  channelId: string;
  rootId: string;
  focusId?: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  // The header floats over the list (the server's layout), so the list
  // and the spinner in its place clear it by this much.
  const headerHeight = useHeaderHeight();
  const router = useRouter();
  const focused = useIsFocused();
  const keyboard = useKeyboardHeight();
  const status = useServerStatus(server.origin);
  const { state, engine } = useChannelLog(server, spaceId, channelId, rootId);
  const { log, header, outcome, token, threads } = state;
  const thread = threads[rootId];
  const view = log.threads[rootId];
  const [active, setActive] = useState(AppState.currentState === "active");
  const list = useRef<FlatList<GroupedRow>>(null);
  const landed = useRef(false);
  const { flashId, flash } = useFlash();

  useEffect(() => {
    const sub = AppState.addEventListener("change", (appState) => setActive(appState === "active"));
    return () => sub.remove();
  }, []);

  const held = log.rows.get(rootId);
  const root = held && isShown(held) ? held : undefined;
  const items = threadItems(log, rootId);
  const replies = useMemo(() => (root ? items.slice(1) : items), [root, items]);
  const opened = !!view && view.generation > 0;

  // Where the "New" line goes, decided once, when the replies first show:
  // the read that follows clears the count it is worked out from.
  const [firstNew, setFirstNew] = useState<string | undefined | null>(null);
  const decided = firstNew !== null;
  if (!decided && opened && root && header) {
    setFirstNew(firstUnreadReplyId(replies, root.thread?.unreadCount ?? 0, header.myUserId));
  }

  // Read while on screen, again for each new reply, and again whenever
  // the count comes back above nothing (a page read on the server before
  // the read landed after it), so the read wins. A read that fails is
  // asked for again after a moment, or on the next change.
  const replyCount = root?.thread?.replyCount ?? 0;
  const unread = root?.thread?.unreadCount ?? 0;
  const readAt = useRef(-1);
  const [retries, setRetries] = useState(0);
  useEffect(() => {
    if (!decided || replyCount === 0 || !focused || !active) return;
    if (readAt.current === replyCount && unread === 0) return;
    readAt.current = replyCount;
    let left = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    engine.readThread(rootId).catch(() => {
      readAt.current = -1;
      if (!left) timer = setTimeout(() => setRetries((count) => count + 1), READ_RETRY_MS);
    });
    return () => {
      left = true;
      clearTimeout(timer);
    };
  }, [decided, replyCount, unread, focused, active, engine, rootId, retries]);

  // Newest first, for a list drawn from the bottom up.
  const rows = useMemo(
    () => (decided ? threadRows(replies, firstNew ?? undefined).reverse() : []),
    [decided, replies, firstNew],
  );
  // The latest rows, for a scroll retried after they may have shifted.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Opening lands on the reply it was opened on, ringed for a moment, or
  // else the "New" line, once.
  const focusIndex = focusId ? rows.findIndex((row) => row.kind === "message" && row.message.id === focusId) : -1;
  const landIndex = focusIndex >= 0 ? focusIndex : rows.findIndex((row) => row.kind === "new");
  useEffect(() => {
    if (landed.current || rows.length === 0) return;
    landed.current = true;
    if (landIndex > 0) list.current?.scrollToIndex({ index: landIndex, viewPosition: 0.5, animated: false });
    if (focusId && focusIndex >= 0) flash(focusId);
  }, [rows.length, landIndex, focusId, focusIndex, flash]);

  const shown = useMemo(() => (root ? [root, ...replies] : replies), [root, replies]);
  // Why the thread takes no replies, if it doesn't: then there is no
  // composer, and nothing to quote or edit into.
  const closed = header ? threadRepliesClosed(header.channel, root) : null;
  const actions = useMessageActions({
    scope: rootId,
    shown,
    log,
    gone: !!outcome,
    engine,
    keyboard,
    focused,
    composing: !closed,
    list,
    items: rows,
  });
  const { send, edit, muteThread } = engine;
  const links = useChannelLinks(server, spaceId, channelId, header, true);
  const mentionNames = useMentionNames(header);
  const viewer = useViewer(shown);
  // Audio stops when the screen is covered or left, the app leaves the
  // front, or the viewer opens.
  const audio = useAudioPlayback(focused && active && !viewer.viewing);
  // Nor does it go on when the screen shows another thread in place.
  useEffect(() => () => audio.release(), [audio, rootId]);
  const previews = useLinkPreviewActions(status.origins, header?.space, actions.dismissPreview);
  // A mute asked for: the bell waits for the server's answer, as web's,
  // and a second tap meanwhile does nothing. Each tap turns over what
  // the log holds as it lands, not what the header was drawn with.
  const [muting, setMuting] = useState(false);
  const mutingNow = useRef(false);
  const { notify } = actions;
  const toggleMute = useCallback(() => {
    if (mutingNow.current) return;
    const muted = !engine.current().log.rows.get(rootId)?.thread?.muted;
    mutingNow.current = true;
    setMuting(true);
    muteThread(rootId, muted)
      .catch((err) => notify(muted ? "Couldn't mute the thread" : "Couldn't unmute the thread", errorText(err)))
      .finally(() => {
        mutingNow.current = false;
        setMuting(false);
      });
  }, [engine, muteThread, rootId, notify]);
  const sendHere = useCallback(
    (content: string, replyToMessageId: string, alsoSend: boolean, attachmentIds: string[]) =>
      send(content, { replyToMessageId, threadRootId: rootId, alsoSendToChannel: alsoSend, attachmentIds }),
    [send, rootId],
  );

  // The header in every state, the channel once it is known, Search once
  // the space is, and the bell once the thread is on screen (with the
  // dock, where a refusal is said) with a summary to mute.
  const summary = !outcome && !thread?.outcome && decided ? root?.thread : undefined;
  const mute =
    header && summary
      ? { muted: summary.muted, channelMuted: header.channel.muted, pending: muting, onPress: toggleMute }
      : undefined;
  const pushOnce = usePushOnce();
  const openSearch = useCallback(
    () =>
      pushOnce(() =>
        router.push({ pathname: "/s/[id]/space/[spaceId]/search", params: { id: server.id, spaceId, c: channelId } }),
      ),
    [pushOnce, router, server.id, spaceId, channelId],
  );
  const search = header ? { spaceName: header.space.name, onPress: openSearch } : undefined;
  const title = (
    <Stack.Screen
      options={{
        headerTitle: () => <ThreadTitle channel={header?.channel} spaceName={header?.space.name ?? ""} />,
        ...(Platform.OS === "ios"
          ? {
              unstable_headerRightItems: () => [
                ...(search ? [searchItem(search)] : []),
                ...(mute ? [muteItem(mute)] : []),
              ],
            }
          : {
              headerRight: () => (
                <View style={styles.headerItems}>
                  {search && <SearchButton {...search} />}
                  {mute && <MuteButton {...mute} />}
                </View>
              ),
            }),
      }}
    />
  );
  if (outcome === "ended") {
    return (
      <Screen title={title}>
        <Unavailable
          message={`Your sign-in to ${server.name} has ended. Sign in again to carry on.`}
          action={{
            label: "Sign in again",
            onPress: () => router.replace({ pathname: "/sign-in", params: { server: server.origin } }),
          }}
        />
      </Screen>
    );
  }
  if (outcome === "gone") {
    return (
      <Screen title={title}>
        <Unavailable message="This channel isn't available any more." />
      </Screen>
    );
  }
  if (thread?.outcome === "gone" || (held && !root)) {
    return (
      <Screen title={title}>
        <Unavailable message="This thread isn't available any more." />
      </Screen>
    );
  }
  const failed = outcome === "failed" || thread?.outcome === "failed";
  if (failed) {
    return (
      <Screen title={title}>
        <Unavailable
          message={`Couldn't reach ${hostOf(server.origin)}.`}
          action={{
            label: "Try again",
            onPress: () => {
              if (outcome === "failed") engine.retry();
              engine.retryThread(rootId);
            },
          }}
        />
      </Screen>
    );
  }
  if (!header || !decided || !root) {
    return (
      <Screen title={title}>
        <ActivityIndicator style={[styles.center, { marginTop: 24 + headerHeight }]} color={theme.textMuted} />
      </Screen>
    );
  }

  const { space, channel, myUserId } = header;
  // The root heads the list once nothing older is left to load, or none
  // fits.
  const atTop = !view?.hasOlder || !olderFits(log, rootId);
  const { menuMessage } = actions;

  return (
    <Screen title={title}>
      <ComposerDock
        keyboard={keyboard}
        notice={actions.notice}
        list={(clearance) => (
          <MessageContexts links={links} previews={previews} view={viewer.open} audio={audio}>
            <FlatList
              ref={list}
              inverted
              data={rows}
              keyExtractor={(row) => row.key}
              renderItem={({ item }) =>
                item.kind === "message" ? (
                  <MessageRow
                    message={item.message}
                    continued={item.continued}
                    myUserId={myUserId}
                    origin={server.origin}
                    token={token}
                    onLongPress={actions.openMenu}
                    onReact={actions.reactTo}
                    target={actions.targetOf(item.message) ?? (item.message.id === flashId ? "focus" : undefined)}
                    alsoSentTo={item.message.inChannel ? `#${channel.name}` : undefined}
                    withDay
                  />
                ) : (
                  <Divider label={item.label} fresh={item.kind === "new"} />
                )
              }
              onEndReached={() => engine.olderReplies(rootId)}
              onEndReachedThreshold={0.5}
              onScrollToIndexFailed={({ index }) => {
                // Rows not measured yet: get near, then try again once drawn,
                // for the same row, since a reply arriving may have moved it
                // meanwhile (as the channel's does).
                const key = rowsRef.current[index]?.key;
                list.current?.scrollToOffset({ offset: index * 60, animated: false });
                setTimeout(() => {
                  const again = rowsRef.current.findIndex((row) => row.key === key);
                  if (again >= 0) list.current?.scrollToIndex({ index: again, viewPosition: 0.5, animated: false });
                }, 100);
              }}
              // As the channel's: scrolling leaves the keyboard in place.
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "none"}
              // Drawn upside down, so the top padding is the bottom edge, and
              // the bottom padding the top, under the floating header.
              contentContainerStyle={{ paddingTop: 12 + clearance, paddingBottom: 12 + headerHeight }}
              maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
              ListFooterComponent={
                thread?.loadingOlder ? (
                  <ActivityIndicator style={styles.edge} color={theme.textMuted} />
                ) : atTop ? (
                  <ThreadHead
                    root={root}
                    myUserId={myUserId}
                    origin={server.origin}
                    token={token}
                    onLongPress={actions.openMenu}
                    onReact={actions.reactTo}
                    target={actions.targetOf(root)}
                  />
                ) : undefined
              }
            />
          </MessageContexts>
        )}
        composer={
          closed ? (
            <Text style={styles.closed}>{closed}</Text>
          ) : (
            <Composer
              ref={actions.composer}
              key={rootId}
              channelName={channel.name}
              mentionNames={mentionNames}
              origin={server.origin}
              token={token}
              inThread
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
          )
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
            link={threadMessageLink(server.origin, spaceId, menuMessage)}
            onReact={(emoji) => actions.reactTo(menuMessage, emoji)}
            onCopyFailed={actions.linkNotCopied}
            onQuote={closed ? undefined : () => actions.quote(menuMessage)}
            onEdit={closed ? undefined : () => actions.startEdit(menuMessage)}
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
    </Screen>
  );
}

// The screen's surface under its header.
function Screen({ title, children }: { title: ReactNode; children: ReactNode }) {
  const styles = makeStyles(useTheme());
  return (
    <View style={styles.screen}>
      {title}
      {children}
    </View>
  );
}

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
    headerItems: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    closed: {
      marginHorizontal: 16,
      paddingVertical: 8,
      color: theme.textMuted,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
  });
}
