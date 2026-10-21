import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLinkableChannels } from "../../../api/channelLinks";
import { usePeople } from "../../../api/dms";
import { useChannelGroups } from "../../../api/groups";
import {
  isLive,
  landed,
  takeAroundThread,
  timelineId,
  useHistoryStore,
} from "../../../api/history";
import { useInstanceStatus, useMe, useSpaces } from "../../../api/queries";
import { toggleReaction } from "../../../api/reactions";
import { historyRetentionNote } from "../../../api/retention";
import { messagePath, shareUrl, threadPath } from "../../../api/shareLinks";
import {
  jumpTo as jumpWindowTo,
  jumpToLatest as jumpWindowToLatest,
  loadNewer,
  loadOlder,
} from "../../../api/timelineLoads";
import { GalleryMedia, galleryMedia } from "../../../components/Attachments";
import { EmojiPicker } from "../../../components/EmojiPicker";
import { GroupCard } from "../../../components/GroupCard";
import { UserCard } from "../../../components/UserCard";
import { firstNewMessageId } from "../../../core/grouping";
import { mentionMembers } from "../../../core/mentions";
import {
  canDeleteAnyMessage,
  canManageChannels,
} from "../../../core/permissions";
import type { Message } from "../../../gen/stoop/chat/v1/message_pb";
import { openSidePanel, useSidePanelStore } from "../../../stores/sidePanel";
import { MessageRow } from "../MessageRow";
import {
  type Anchor,
  anchorMoved,
  type Edges,
  edgesReached,
  newestChange,
} from "./edges";
import {
  estimateSize,
  indexOfMessage,
  indexOfNewLine,
  listItems,
} from "./items";
import { ListHead } from "./ListHead";
import { useRowHandlers } from "./useRowHandlers";

// Rows rendered beyond the visible ones at each end, so a scroll has
// something to show before the next render.
const OVERSCAN = 8;
// Within this many rows of the window's end, the next page is asked for.
const EDGE_LEAD = 4;
// Within this of the bottom counts as at it: arrivals follow, the pill
// hides, and a row growing (an image arriving) keeps the view at the end.
const NEAR_BOTTOM = 120;

// A timeline's rows, virtualised: only the rows near the viewport are in
// the DOM, positioned by the virtualiser from measured heights, inside a
// body the height of the whole window. The window itself (api/history.ts)
// is what the rows are drawn from. docs/architecture/web.md → The message
// list.
export function MessageList({
  messages,
  spaceId,
  channelId,
  channelName,
  channelLabel,
  dm = false,
  group = false,
  newAfterId,
  jumpTarget,
  jumpVisit = 0,
  editingId,
  onEdit,
  onReply,
  threadRoot,
  threadsAllowed = false,
}: {
  messages: Message[];
  spaceId: string;
  channelId: string;
  // As it reads in a sentence: "#general", a private channel's bare name,
  // or for a direct message the other person.
  channelName: string;
  // The same for where an icon fits; channelName when absent.
  channelLabel?: ReactNode;
  dm?: boolean;
  // A group conversation: named after its people, who change.
  group?: boolean;
  // Messages with an ID above this were unread when the channel opened;
  // "" means every message was (never opened before), null means the
  // snapshot isn't taken yet.
  newAfterId: string | null;
  // A message to scroll to and flash once it's in the window (deep link).
  jumpTarget?: string;
  // Which following of a link this is: the same target lands again when
  // it changes.
  jumpVisit?: number;
  // The message open in the inline editor, if any.
  editingId: string | null;
  onEdit: (id: string | null) => void;
  onReply: (m: Message) => void;
  // Show this root's thread instead of the channel; the root sits above
  // the oldest reply once there is nothing older.
  threadRoot?: Message;
  // Messages here may start a thread (never in an announcement channel).
  threadsAllowed?: boolean;
}) {
  const queryClient = useQueryClient();
  const threadRootId = threadRoot?.id;
  const timeline = useMemo(
    () => ({ channelId, rootId: threadRootId }),
    [channelId, threadRootId],
  );
  const rowIdPrefix = threadRootId ? "thread-msg-" : "msg-";
  const openPanel = useSidePanelStore((state) => state.open);
  const openThread =
    openPanel?.kind === "thread" && openPanel.params.channelId === channelId
      ? openPanel.params.rootId
      : undefined;
  const { data: spacesForPerms } = useSpaces();
  const spaceForPerms = spacesForPerms?.find((space) => space.id === spaceId);
  // The permalink each message offers to copy. An ordinary https:// link,
  // on the server's public address when it has one (api/shareLinks.ts).
  const { data: instanceStatus } = useInstanceStatus();
  const retentionNote = historyRetentionNote(
    instanceStatus?.messageRetentionDays ?? 0,
  );
  const linkOrigin = instanceStatus?.publicUrl;
  const rows = useRowHandlers(spaceId, channelId);
  const { data: me } = useMe();
  const members = usePeople(spaceId, channelId);
  const membersById = useMemo(() => mentionMembers(members), [members]);
  const groups = useChannelGroups(spaceId, channelId);
  const linkable = useLinkableChannels(spaceId, channelId);

  const history = useHistoryStore(
    (state) => state.channels[timelineId(timeline)],
  );
  const live = isLive(history);
  const rootShown = !!threadRoot && !!history && !history.hasOlder;
  // The first unread message that isn't ours (our own sends are never "new").
  const firstNewId = firstNewMessageId(messages, newAfterId, me?.id);
  const items = useMemo(
    () =>
      listItems({
        messages,
        firstNewId,
        inThread: !!threadRootId,
        rootShownId: rootShown ? threadRootId : undefined,
      }),
    [messages, firstNewId, threadRootId, rootShown],
  );
  // For the handlers rows keep across renders.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // The virtualiser. Rows are keyed by message, so a page prepended keeps
  // every measured height. Edge loading asks for the next page when the
  // rows on screen come within EDGE_LEAD of the window's end; it waits for
  // the first landing, or opening a channel (rendered at its top before it
  // lands at the bottom) would page straight back. Before a page is asked
  // for we note where the edge's message sits on screen; once the window
  // has changed we put it back there, so neither prepends nor pruning move
  // the view. Whether the view is at the bottom is tracked below.
  const listRef = useRef<HTMLDivElement>(null);
  const landedOnce = useRef(false);
  const edges = useRef<Edges>({ older: false, newer: false });
  const anchor = useRef<Anchor | null>(null);
  const atBottomRef = useRef(true);
  const liveRef = useRef(live);
  liveRef.current = live;
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => listRef.current,
    estimateSize: useCallback(
      (index: number) => estimateSize(items[index]),
      [items],
    ),
    getItemKey: useCallback((index: number) => items[index].key, [items]),
    overscan: OVERSCAN,
    onChange: (instance) => {
      const list = listRef.current;
      if (!landedOnce.current || !list) return;
      // Not while a replaced window has yet to land: a row measured as it
      // mounts reports before the landing scroll, from wherever the view was.
      if (useHistoryStore.getState().channels[timelineId(timeline)]?.landOn)
        return;
      // From the element's own scroll position, which a scroll command sets
      // at once; the virtualiser's range may still describe where the view
      // was before a landing when a measurement reports.
      const first = instance.getVirtualItemForOffset(list.scrollTop);
      const last = instance.getVirtualItemForOffset(
        list.scrollTop + list.clientHeight,
      );
      const reached = edgesReached(
        first && last
          ? { startIndex: first.index, endIndex: last.index }
          : null,
        instance.options.count,
        EDGE_LEAD,
      );
      const before = edges.current;
      edges.current = reached;
      // The anchor is noted only for a page that will be asked for, and
      // dropped if it brings nothing: one left over would put the view
      // back at a stale position on the next change (an arrival).
      const state = useHistoryStore.getState().channels[timelineId(timeline)];
      if (!state || state.loading) return;
      const page = (
        edge: Anchor["edge"],
        id: string | undefined,
        load: typeof loadOlder,
      ) => {
        const element = id && document.getElementById(`${rowIdPrefix}${id}`);
        anchor.current = element
          ? { edge, id, top: element.getBoundingClientRect().top }
          : null;
        void load(queryClient, timeline).then((brought) => {
          if (brought === 0) anchor.current = null;
        });
      };
      if (reached.older && !before.older && state.hasOlder) {
        page("older", messages[0]?.id, loadOlder);
      } else if (reached.newer && !before.newer && state.hasNewer) {
        page("newer", messages[messages.length - 1]?.id, loadNewer);
      }
    },
  });
  // A row measured again, taller or shorter than it was (an image arriving,
  // a preview): the view keeps its place when the row is above it, and
  // stays at the bottom when it is there. A row's first measurement keeps
  // the virtualiser's rule — the rows a landing is still settling over
  // must not each move the view. Not while scrolling up, where rows
  // settling above would cascade — except for the head, which grows when
  // the beginning is reached, which is where an upward scroll ends.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (
    item,
    _delta,
    instance,
  ) => {
    const offset = instance.scrollOffset ?? 0;
    if (!instance.itemSizeCache.has(item.key)) return item.start < offset;
    if (liveRef.current && atBottomRef.current) return true;
    return (
      item.end <= offset &&
      (item.index === 0 || instance.scrollDirection !== "backward")
    );
  };
  const scrollToBottom = useCallback(() => {
    virtualizer.scrollToEnd();
    landedOnce.current = true;
  }, [virtualizer]);
  const scrollToItem = useCallback(
    (index: number) => {
      virtualizer.scrollToIndex(index, { align: "center" });
      landedOnce.current = true;
    },
    [virtualizer],
  );

  // The row a jump landed on flashes once it is rendered: at once when it
  // already is (a jump may not render anything), else after the render
  // that brings it in.
  const pendingFlash = useRef<string | null>(null);
  const flashPending = useCallback(() => {
    const id = pendingFlash.current;
    if (!id) return;
    const element = document.getElementById(`${rowIdPrefix}${id}`);
    if (!element) return;
    pendingFlash.current = null;
    flash(element);
  }, [rowIdPrefix]);
  useEffect(flashPending);

  // After every window change, before it is painted. The edges start over:
  // the rows on screen keep their indexes when a page is appended, so no
  // range change would say the end is further off now. Then either land
  // where a jump asked, once that's rendered, or put the anchored row back
  // where it was on screen, from its measured offset in the new window.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after every window change
  useLayoutEffect(() => {
    edges.current = { older: false, newer: false };
    const land =
      useHistoryStore.getState().channels[timelineId(timeline)]?.landOn;
    if (land) {
      anchor.current = null;
      if (land === "bottom") {
        landed(timeline);
        scrollToBottom();
        return;
      }
      const index = indexOfMessage(items, land.id);
      if (index < 0) return;
      landed(timeline);
      scrollToItem(index);
      pendingFlash.current = land.id;
      return;
    }
    const pinned = anchor.current;
    const list = listRef.current;
    if (!pinned || !list) return;
    // A change elsewhere while the page is still out (an arrival, an edit)
    // keeps the anchor for the page; its top follows any scroll since.
    if (!anchorMoved(pinned, messages)) {
      const row = document.getElementById(`${rowIdPrefix}${pinned.id}`);
      if (row) pinned.top = row.getBoundingClientRect().top;
      return;
    }
    anchor.current = null;
    const index = indexOfMessage(items, pinned.id);
    // getTotalSize brings the measurements up to date with the rows
    // measured as this window mounted, before their offsets are read.
    virtualizer.getTotalSize();
    const start = virtualizer.measurementsCache[index]?.start;
    if (index < 0 || start === undefined) return;
    // The body sits at the top of the scrolled content, so a row's top on
    // screen is the list's top plus its offset less the scroll. The scroll
    // event this raises is the virtualiser's cue to render the rows there
    // before the frame is painted.
    list.scrollTop = list.getBoundingClientRect().top + start - pinned.top;
  }, [items]);

  // Jump to a message and flash it. If it isn't in the window, one round
  // trip replaces the window with a page centred on it.
  const jumpTo = useCallback(
    async (id: string) => {
      const index = indexOfMessage(itemsRef.current, id);
      if (index >= 0) {
        scrollToItem(index);
        pendingFlash.current = id;
        flashPending();
        return true;
      }
      const { found, threadRootId: thread } = await jumpWindowTo(
        queryClient,
        timeline,
        id,
      );
      // A reply in a thread: the channel lands on its root, and the thread
      // opens at the reply.
      if (thread) {
        openSidePanel("thread", {
          spaceId,
          channelId,
          rootId: thread,
          focusId: id,
        });
      }
      return found;
    },
    [scrollToItem, flashPending, queryClient, timeline, spaceId, channelId],
  );

  // A deep link: land on the message as soon as the window holds it (the
  // query opened around it), or fetch that window. The param is then
  // dropped so leaving and returning opens the channel as usual.
  const navigate = useNavigate();
  const [jumped, setJumped] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires once the first window is in
  useEffect(() => {
    const visit = `${jumpVisit}:${jumpTarget}`;
    if (!jumpTarget || jumped === visit || messages.length === 0) return;
    setJumped(visit);
    // The first window already came centred on a reply's root: land there
    // and open the thread at the reply, without asking the server again.
    const thread = takeAroundThread(timeline);
    if (thread && thread !== jumpTarget) {
      void jumpTo(thread);
      openSidePanel("thread", {
        spaceId,
        channelId,
        rootId: thread,
        focusId: jumpTarget,
      });
    } else {
      void jumpTo(jumpTarget).then((ok) => {
        if (!ok) scrollToBottom();
      });
    }
    // A thread's link was read by the side panel; only a channel's sits
    // in the address.
    if (threadRootId) return;
    if (spaceId) {
      navigate({
        to: "/s/$spaceId/c/$channelId",
        params: { spaceId, channelId },
        search: {},
        replace: true,
      });
    } else {
      navigate({
        to: "/dm/$channelId",
        params: { channelId },
        search: {},
        replace: true,
      });
    }
  }, [jumpTarget, jumpVisit, messages.length > 0]);

  // Whether the view is at (or within a screen of) the window's end.
  // While it isn't — or the window isn't live — arrivals don't move the
  // view; they count up on the "Jump to latest" pill instead.
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onScroll = () => {
      const near =
        list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM;
      atBottomRef.current = near;
      setAtBottom(near);
      if (near) setUnseen(0);
    };
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => list.removeEventListener("scroll", onScroll);
  }, []);
  const pendingNewer = history?.pendingNewer ?? 0;
  const newCount = unseen + pendingNewer;
  const jumpToLatest = async () => {
    setUnseen(0);
    if (live) scrollToBottom();
    else await jumpWindowToLatest(queryClient, timeline);
  };

  // Land on the "New messages" line when there is one, else the bottom;
  // subsequent arrivals scroll to the bottom as before. A page or a jump
  // that replaces the window is neither an arrival nor a reason to move.
  const scrolledToDivider = useRef(false);
  const seenNewest = useRef<string | undefined>(undefined);
  const newestId = messages[messages.length - 1]?.id;
  const newestMine = messages[messages.length - 1]?.author?.id === me?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: react to a message arriving at the end (not to history being prepended)
  useLayoutEffect(() => {
    // Nothing to land on yet: the first window is still the first.
    if (messages.length === 0) return;
    const change = newestChange(seenNewest.current, messages);
    seenNewest.current = newestId;
    if (change !== "first" && change !== "arrival") return;
    const first = change === "first";
    if (first && jumpTarget) return; // a deep link is landing instead
    // Land on the "New messages" line when opening (or reading live); a
    // divider appearing while someone is deep in history must not move them.
    const newLine = indexOfNewLine(items);
    if (
      newLine >= 0 &&
      !scrolledToDivider.current &&
      (first || atBottomRef.current)
    ) {
      scrolledToDivider.current = true;
      scrollToItem(newLine);
      return;
    }
    if (first || atBottomRef.current || newestMine) {
      scrollToBottom();
    } else {
      setUnseen((count) => count + 1);
    }
  }, [newestId, firstNewId]);

  // One message's row: in the timeline (positioned by the virtualiser),
  // and a thread's root on the head.
  const row = (
    message: Message,
    continued: boolean,
    position?: { index: number; top: number },
  ) => (
    <MessageRow
      key={message.id}
      message={message}
      continued={continued}
      index={position?.index}
      top={position?.top}
      measure={position ? virtualizer.measureElement : undefined}
      spaceId={spaceId}
      link={shareUrl(
        threadRootId && message.id !== threadRootId
          ? threadPath(spaceId, channelId, threadRootId, message.id)
          : messagePath(spaceId, channelId, message.id),
        linkOrigin,
      )}
      mine={me?.id === message.author?.id}
      canDelete={
        me?.id === message.author?.id ||
        (!!spaceForPerms && canDeleteAnyMessage(spaceForPerms))
      }
      canPin={
        !threadRootId &&
        !message.threadRootId &&
        !!spaceForPerms &&
        canManageChannels(spaceForPerms)
      }
      editing={editingId === message.id}
      members={membersById}
      groups={groups}
      channels={linkable}
      myUserId={me?.id}
      threadOpen={!threadRootId && openThread === message.id}
      canStartThread={threadsAllowed && !message.threadRootId}
      withDay={!!threadRootId}
      rowIdPrefix={rowIdPrefix}
      onJumpTo={jumpTo}
      onCard={rows.showCard}
      onGroup={rows.showGroup}
      onReact={rows.showPicker}
      onReply={onReply}
      onEdit={onEdit}
      onDelete={rows.remove}
      onDismissPreview={rows.dismissPreview}
      onTogglePin={rows.togglePin}
      onThread={threadRootId ? undefined : rows.openThreadOf}
      onOpenOrigin={
        threadRootId || !message.threadRootId ? undefined : rows.openOrigin
      }
      alsoSentTo={
        threadRootId && message.inChannel && message.id !== threadRootId
          ? dm
            ? "the conversation"
            : (channelLabel ?? channelName)
          : undefined
      }
    />
  );

  const media = useMemo(
    () =>
      galleryMedia(
        rootShown && threadRoot ? [threadRoot, ...messages] : messages,
      ),
    [messages, threadRoot, rootShown],
  );

  return (
    <GalleryMedia.Provider value={media}>
      <div className="message-list-wrap">
        {/* data-rows and data-oldest say what the window holds; the DOM
        holds only the rows near the viewport. */}
        <div
          className="message-list"
          ref={listRef}
          data-rows={messages.length}
          data-oldest={messages[0]?.id}
        >
          <div
            className="message-list-body"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index];
              const position = {
                index: virtualRow.index,
                top: virtualRow.start,
              };
              switch (item.kind) {
                case "head":
                  return (
                    <ListHead
                      key={item.key}
                      {...position}
                      measure={virtualizer.measureElement}
                      history={history}
                      threadRoot={threadRoot}
                      rootRow={threadRoot && row(threadRoot, false)}
                      replyCount={
                        threadRoot?.thread?.replyCount ?? messages.length
                      }
                      channelId={channelId}
                      channelName={channelName}
                      channelLabel={channelLabel}
                      dm={dm}
                      group={group}
                      retentionNote={retentionNote}
                    />
                  );
                case "foot":
                  // The window's newer edge: pages forward while the window
                  // isn't live, and closes the list with its padding.
                  return (
                    <div
                      key={item.key}
                      className="message-list-foot history-foot"
                      data-index={position.index}
                      data-live={live}
                      ref={virtualizer.measureElement}
                      style={{ top: position.top }}
                    >
                      {!live && history?.loading
                        ? "Loading newer messages…"
                        : null}
                    </div>
                  );
                case "day":
                  return (
                    <div
                      key={item.key}
                      className="day-divider eyebrow"
                      data-index={position.index}
                      ref={virtualizer.measureElement}
                      style={{ top: position.top }}
                    >
                      <span>{item.label}</span>
                    </div>
                  );
                case "new":
                  return (
                    <div
                      key={item.key}
                      className={`new-divider eyebrow${item.startsDay ? " starts-day" : ""}`}
                      data-index={position.index}
                      ref={virtualizer.measureElement}
                      style={{ top: position.top }}
                    >
                      <span>{item.label}</span>
                    </div>
                  );
                case "message":
                  return row(item.message, item.continued, position);
                default:
                  return null;
              }
            })}
          </div>
          {(!atBottom || !live) && (
            <button
              type="button"
              className={`jump-latest ${newCount > 0 ? "unseen" : ""}`}
              onClick={jumpToLatest}
            >
              {newCount > 0
                ? `${newCount} new message${newCount === 1 ? "" : "s"} ↓`
                : "Jump to latest ↓"}
            </button>
          )}
          {rows.card && (
            <UserCard
              spaceId={spaceId}
              userId={rows.card.userId}
              anchor={rows.card.anchor}
              onClose={() => rows.setCard(null)}
            />
          )}
          {rows.groupCard && (
            <GroupCard
              spaceId={spaceId}
              group={rows.groupCard.group}
              anchor={rows.groupCard.anchor}
              onClose={() => rows.setGroupCard(null)}
            />
          )}
          {rows.picker && (
            <EmojiPicker
              anchor={rows.picker.anchor}
              onPick={(emoji) =>
                me &&
                rows.picker &&
                toggleReaction(queryClient, rows.picker.message, emoji, me.id)
              }
              onClose={() => rows.setPicker(null)}
            />
          )}
        </div>
      </div>
    </GalleryMedia.Provider>
  );
}

// Flash a row the view has been brought to.
function flash(element: HTMLElement) {
  // An open thread's root is highlighted already.
  if (element.classList.contains("thread-open")) return;
  element.classList.add("flash");
  setTimeout(() => element.classList.remove("flash"), 1500);
}
