import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { chatClient } from "../../api/clients";
import { dayLabel, fullDateTime, sameDay } from "../../api/dates";
import { usePeople } from "../../api/dms";
import { errorText } from "../../api/errors";
import { isLive, useHistoryStore } from "../../api/history";
import { canDeleteAnyMessage } from "../../api/permissions";
import { useMe, useSpaces } from "../../api/queries";
import { toggleReaction } from "../../api/reactions";
import { removeMessageFromCache } from "../../api/ws";
import { Attachments } from "../../components/Attachments";
import { Avatar } from "../../components/Avatar";
import { EmojiPicker } from "../../components/EmojiPicker";
import { LinkPreviews } from "../../components/LinkPreviews";
import { MessageBody } from "../../components/MessageBody";
import { ReactionBar } from "../../components/ReactionBar";
import { UserCard } from "../../components/UserCard";
import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { confirm, notice } from "../../stores/dialogs";
import { MessageActions } from "./MessageActions";
import { MessageEditor } from "./MessageEditor";

export function MessageList({
  messages,
  spaceId,
  channelId,
  channelName,
  dm = false,
  newAfterId,
  jumpTarget,
  onReply,
}: {
  messages: Message[];
  spaceId: string;
  channelId: string;
  channelName: string;
  // A direct message: channelName is the other person.
  dm?: boolean;
  // Messages with an ID above this were unread when the channel opened;
  // "" means every message was (never opened before), null means the
  // snapshot isn't taken yet.
  newAfterId: string | null;
  // A message to scroll to and flash once it's in the window (deep link).
  jumpTarget?: string;
  onReply: (m: Message) => void;
}) {
  const queryClient = useQueryClient();
  const { data: spacesForPerms } = useSpaces();
  const spaceForPerms = spacesForPerms?.find((s) => s.id === spaceId);
  const [editingId, setEditingId] = useState<string | null>(null);

  const remove = async (m: Message) => {
    const ok = await confirm({
      title: "Delete this message?",
      action: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await chatClient.deleteMessage({ messageId: m.id });
      removeMessageFromCache(queryClient, m.channelId, m.id);
    } catch (err) {
      notice({ title: "Couldn't delete the message", body: errorText(err) });
    }
  };

  // The window's edges (see api/history.ts): a sentinel at each end asks
  // for the next page when it scrolls into view. Before any change to the
  // window we note where one message sits on screen; after React commits
  // we put it back there, so neither prepends nor pruning move the view.
  const listRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const history = useHistoryStore((s) => s.channels[channelId]);
  const live = isLive(history);
  const loadOlder = useHistoryStore((s) => s.loadOlder);
  const loadNewer = useHistoryStore((s) => s.loadNewer);
  const storeJumpTo = useHistoryStore((s) => s.jumpTo);
  const storeJumpToLatest = useHistoryStore((s) => s.jumpToLatest);
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const setAnchor = useCallback((id: string | undefined) => {
    const el = id && document.getElementById(`msg-${id}`);
    anchor.current = el ? { id, top: el.getBoundingClientRect().top } : null;
  }, []);
  const loadOlderAnchored = useCallback(async () => {
    const have = queryClient.getQueryData<Message[]>(["messages", channelId]);
    setAnchor(have?.[0]?.id);
    return loadOlder(queryClient, channelId);
  }, [loadOlder, queryClient, channelId, setAnchor]);
  const loadNewerAnchored = useCallback(async () => {
    const have = queryClient.getQueryData<Message[]>(["messages", channelId]);
    setAnchor(have?.[have.length - 1]?.id);
    return loadNewer(queryClient, channelId);
  }, [loadNewer, queryClient, channelId, setAnchor]);
  const flash = (el: HTMLElement) => {
    el.scrollIntoView({ block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1500);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after every window change
  useLayoutEffect(() => {
    const store = useHistoryStore.getState();
    const land = store.channels[channelId]?.landOn;
    if (land) {
      // A jump replaced the window: land where it asked, once that's rendered.
      const el =
        land === "bottom"
          ? bottomRef.current
          : document.getElementById(`msg-${land.id}`);
      if (!el) return;
      store.landed(channelId);
      anchor.current = null;
      if (land === "bottom") el.scrollIntoView();
      else flash(el);
      return;
    }
    const a = anchor.current;
    const list = listRef.current;
    if (!a || !list) return;
    anchor.current = null;
    const el = document.getElementById(`msg-${a.id}`);
    if (el) list.scrollTop += el.getBoundingClientRect().top - a.top;
  }, [messages]);
  useEffect(() => {
    const list = listRef.current;
    const top = topRef.current;
    const foot = footRef.current;
    if (!list || !top || !foot) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          if (e.target === top) void loadOlderAnchored();
          else void loadNewerAnchored();
        }
      },
      { root: list, rootMargin: "200px 0px 200px 0px" },
    );
    io.observe(top);
    io.observe(foot);
    return () => io.disconnect();
  }, [loadOlderAnchored, loadNewerAnchored]);

  // Jump to a message and flash it. If it isn't in the window, one round
  // trip replaces the window with a page centred on it.
  const jumpTo = async (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      flash(el);
      return true;
    }
    return storeJumpTo(queryClient, channelId, id);
  };
  // A deep link: land on the message as soon as the window holds it (the
  // query opened around it), or fetch that window. The param is then
  // dropped so leaving and returning opens the channel as usual.
  const navigate = useNavigate();
  const [jumped, setJumped] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires once the first window is in
  useEffect(() => {
    if (!jumpTarget || jumped === jumpTarget || messages.length === 0) return;
    setJumped(jumpTarget);
    void jumpTo(jumpTarget).then((ok) => {
      if (!ok) bottomRef.current?.scrollIntoView();
    });
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
  }, [jumpTarget, messages.length > 0]);
  const dividerRef = useRef<HTMLDivElement>(null);
  const { data: meForDivider } = useMe();
  // The first unread message that isn't ours (our own sends are never "new").
  const firstNewId =
    newAfterId === null
      ? undefined
      : messages.find(
          (m) => m.id > newAfterId && m.author?.id !== meForDivider?.id,
        )?.id;
  const [card, setCard] = useState<{ userId: string; anchor: DOMRect } | null>(
    null,
  );
  // The reaction picker, open for one message at a time.
  const [picker, setPicker] = useState<{
    message: Message;
    anchor: DOMRect;
  } | null>(null);
  const { data: me } = useMe();
  const members = usePeople(spaceId, channelId);
  const usernames = new Set(members?.map((m) => m.username.toLowerCase()));

  // Land on the "New messages" line when there is one, else the bottom;
  // subsequent arrivals scroll to the bottom as before.
  const scrolledToDivider = useRef(false);
  const newestId = messages[messages.length - 1]?.id;
  const newestMine = messages[messages.length - 1]?.author?.id === me?.id;
  // Whether the view is at (or within a screen of) the window's end.
  // While it isn't — or the window isn't live — arrivals don't move the
  // view; they count up on the "Jump to latest" pill instead.
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const [unseen, setUnseen] = useState(0);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onScroll = () => {
      const near = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
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
    if (live) bottomRef.current?.scrollIntoView();
    else await storeJumpToLatest(queryClient, channelId);
  };
  const seenNewest = useRef<string | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: react to a message arriving at the end (not to history being prepended)
  useEffect(() => {
    const first = seenNewest.current === undefined;
    // An arrival extends the window by one at its end; a page or a jump
    // that replaces the window is neither an arrival nor a reason to move.
    const arrival =
      !first &&
      seenNewest.current !== newestId &&
      messages[messages.length - 2]?.id === seenNewest.current;
    seenNewest.current = newestId;
    if (!first && !arrival) return;
    if (first && jumpTarget) return; // a deep link is landing instead
    // Land on the "New messages" line when opening (or reading live); a
    // divider appearing while someone is deep in history must not move them.
    if (
      firstNewId &&
      !scrolledToDivider.current &&
      dividerRef.current &&
      (first || atBottomRef.current)
    ) {
      scrolledToDivider.current = true;
      dividerRef.current.scrollIntoView({ block: "center" });
      return;
    }
    if (first || atBottomRef.current || newestMine) {
      bottomRef.current?.scrollIntoView();
    } else {
      setUnseen((n) => n + 1);
    }
  }, [newestId, firstNewId]);

  // A message continues the previous one when it's from the same author
  // within the same minute, isn't a reply, and doesn't sit at the "New
  // messages" line — then we skip its author/time row.
  // A day separator goes above the first message of each calendar day.
  const startsDay = (m: Message, prev: Message | undefined) =>
    !prev?.createdAt ||
    !m.createdAt ||
    !sameDay(timestampDate(prev.createdAt), timestampDate(m.createdAt));
  const continues = (m: Message, prev: Message | undefined) =>
    !!prev &&
    prev.author?.id === m.author?.id &&
    !m.replyTo &&
    m.id !== firstNewId &&
    !!m.createdAt &&
    !!prev.createdAt &&
    sameMinute(timestampDate(prev.createdAt), timestampDate(m.createdAt));

  return (
    <div className="message-list-wrap">
      <div className="message-list" ref={listRef}>
        <div ref={topRef} className="history-sentinel" aria-hidden="true" />
        {/* Always rendered so the row's height is reserved: swapping its
          contents can't shift the view while a page is in flight. */}
        <div
          className={`history-head ${history && !history.hasOlder ? "history-start" : ""}`}
          data-state={
            history && !history.hasOlder
              ? "start"
              : history?.loading
                ? "loading"
                : "idle"
          }
        >
          {history && !history.hasOlder ? (
            <span>
              {dm
                ? `Beginning of your conversation with ${channelName}`
                : `Beginning of #${channelName}`}
            </span>
          ) : history?.loading ? (
            "Loading earlier messages…"
          ) : null}
        </div>
        {messages.map((message, i) => (
          <Fragment key={message.id}>
            {message.createdAt && startsDay(message, messages[i - 1]) && (
              <div className="day-divider">
                <span>{dayLabel(timestampDate(message.createdAt))}</span>
              </div>
            )}
            {message.id === firstNewId && (
              <div ref={dividerRef} className="new-divider">
                <span>New messages</span>
              </div>
            )}
            <div
              id={`msg-${message.id}`}
              // Focusable by tap/click (not Tab) so the toolbar shows on
              // touch screens, where there is no hover.
              tabIndex={-1}
              className={`message ${continues(message, messages[i - 1]) ? "continued" : ""}`}
            >
              {message.replyTo && (
                <button
                  type="button"
                  className="reply-quote"
                  onClick={() => jumpTo(message.replyTo?.messageId ?? "")}
                  title="Jump to the original message"
                >
                  <span className="reply-arrow">↩</span>
                  <strong>
                    {message.replyTo.author?.displayName ||
                      message.replyTo.author?.username ||
                      "deleted"}
                  </strong>
                  <span className="reply-preview">
                    {message.replyTo.preview || "(message deleted)"}
                  </span>
                </button>
              )}
              {!continues(message, messages[i - 1]) && (
                <button
                  type="button"
                  className="message-avatar"
                  aria-label={`${message.author?.displayName || message.author?.username} — profile`}
                  onClick={(e) =>
                    message.author &&
                    setCard({
                      userId: message.author.id,
                      anchor: e.currentTarget.getBoundingClientRect(),
                    })
                  }
                >
                  <Avatar
                    name={
                      message.author?.displayName ||
                      message.author?.username ||
                      "?"
                    }
                    fileId={message.author?.avatarFileId}
                    size="medium"
                  />
                </button>
              )}
              <div className="message-meta">
                <button
                  type="button"
                  className="message-author"
                  onClick={(e) =>
                    message.author &&
                    setCard({
                      userId: message.author.id,
                      anchor: e.currentTarget.getBoundingClientRect(),
                    })
                  }
                >
                  {message.author?.displayName || message.author?.username}
                </button>
                <span
                  className="message-time"
                  title={
                    message.createdAt
                      ? fullDateTime(timestampDate(message.createdAt))
                      : undefined
                  }
                >
                  {message.createdAt
                    ? timestampDate(message.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : ""}
                </span>
              </div>
              <div className="message-toolbar">
                {continues(message, messages[i - 1]) && (
                  <span
                    className="message-time"
                    title={
                      message.createdAt
                        ? fullDateTime(timestampDate(message.createdAt))
                        : undefined
                    }
                  >
                    {message.createdAt
                      ? timestampDate(message.createdAt).toLocaleTimeString(
                          [],
                          {
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )
                      : ""}
                  </span>
                )}
                <MessageActions
                  message={message}
                  mine={me?.id === message.author?.id}
                  canDelete={
                    me?.id === message.author?.id ||
                    (!!spaceForPerms && canDeleteAnyMessage(spaceForPerms))
                  }
                  onReply={() => onReply(message)}
                  onEdit={() => setEditingId(message.id)}
                  onDelete={() => remove(message)}
                  onReact={(anchor) => setPicker({ message, anchor })}
                />
              </div>
              {editingId === message.id ? (
                <MessageEditor
                  message={message}
                  onDone={() => setEditingId(null)}
                />
              ) : null}
              <div
                className="message-content"
                style={
                  editingId === message.id ? { display: "none" } : undefined
                }
              >
                <MessageBody
                  content={message.content}
                  usernames={usernames}
                  mentionsEveryone={message.mentionsEveryone}
                  mentionsHere={message.mentionsHere}
                  myUsername={me?.username}
                />
                <Attachments attachments={message.attachments} />
                <LinkPreviews previews={message.linkPreviews} />
                {message.editedAt && (
                  <span className="edited-marker" title="Edited">
                    (edited)
                  </span>
                )}
              </div>
              <ReactionBar message={message} spaceId={spaceId} />
            </div>
          </Fragment>
        ))}
        {/* The window's newer edge: a sentinel that pages forward while
          the window isn't live. Always in the DOM so the observer is stable. */}
        <div ref={footRef} className="history-foot" data-live={live}>
          {!live && history?.loading ? "Loading newer messages…" : null}
        </div>
        <div ref={bottomRef} />
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
        {card && (
          <UserCard
            spaceId={spaceId}
            userId={card.userId}
            anchor={card.anchor}
            onClose={() => setCard(null)}
          />
        )}
        {picker && (
          <EmojiPicker
            anchor={picker.anchor}
            onPick={(emoji) =>
              me && toggleReaction(queryClient, picker.message, emoji, me.id)
            }
            onClose={() => setPicker(null)}
          />
        )}
      </div>
    </div>
  );
}

function sameMinute(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() &&
    a.getHours() === b.getHours() &&
    a.getMinutes() === b.getMinutes()
  );
}
