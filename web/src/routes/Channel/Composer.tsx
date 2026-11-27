import type { ReactNode } from "react";
import {
  type DragEvent,
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLinkableChannels } from "../../api/channelLinks";
import { holdRow, isLive, jumpToLatest } from "../../api/channelLog";
import { chatClient } from "../../api/clients";
import { useComposerFormattingStore } from "../../api/composerFormatting";
import { usePeople } from "../../api/dms";
import { errorText } from "../../api/errors";
import {
  isInlineImage,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  uploadAttachment,
} from "../../api/files";
import { type Format, shortcutFormat } from "../../api/formatting";
import { useChannelGroups } from "../../api/groups";
import { useInstanceStatus, useMe, useSpaces } from "../../api/queries";
import type { SetReminder } from "../../api/reminders";
import {
  replaceShortcodes,
  type Shortcode,
  searchShortcodes,
  shortcodeQueryAt,
} from "../../api/shortcodes";
import { sendClientEvent } from "../../api/ws";
import {
  AttachmentStrip,
  type PendingAttachment,
} from "../../components/AttachmentStrip";
import { BotMark } from "../../components/BotMark";
import { CommandList } from "../../components/CommandList";
import { DeletedMark } from "../../components/DeletedMark";
import { EmojiSuggest } from "../../components/EmojiSuggest";
import { FormatToolbar } from "../../components/FormatToolbar";
import { SendIcon } from "../../components/Icons";
import { MentionPicker } from "../../components/MentionPicker";
import { RichEditor, type RichField } from "../../components/RichEditor";
import { restoreFiles } from "../../core/attachments";
import {
  type Command,
  type CommandName,
  type CommandPlace,
  type CommandQuery,
  commandQueryAt,
  commandsOffered,
  matchingCommands,
  type ParsedCommand,
  parseCommand,
  pickedText,
} from "../../core/commands";
import { draftKey, SEND_STALL_MS } from "../../core/drafts";
import { isBlankMessage } from "../../core/markdown";
import {
  candidateMention,
  channelCandidates,
  channelQueryAt,
  type MentionCandidate,
  mentionCandidates,
  mentionMembers,
  mentionQueryAt,
} from "../../core/mentions";
import { messagePreview } from "../../core/messagePreview";
import { canMentionEntireChannel } from "../../core/permissions";
import { reminderPlace, reminderSetText } from "../../core/reminderForm";
import { restoreDraft } from "../../core/unsent";
import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { useTouchKeyboard } from "../../hooks/useTouchKeyboard";
import { notice } from "../../stores/dialogs";
import { ComposerActions } from "./ComposerActions";
import { PollForm } from "./PollForm";
import { TimePollForm } from "./PollForm/TimePollForm";
import { ReminderForm } from "./ReminderForm";
import {
  ReminderNotice,
  type ShownReminder,
} from "./ReminderForm/ReminderNotice";
import { useSavedDraft } from "./useSavedDraft";

export function Composer({
  channelId,
  channelName,
  channelLabel,
  dm = false,
  group = false,
  announcement = false,
  spaceId,
  replyTo,
  onCancelReply,
  onReply,
  onEditLast,
  onRestoreQuote,
  threadRootId,
}: {
  channelId: string;
  channelName?: string;
  channelLabel?: ReactNode;
  dm?: boolean;
  // A group conversation: its title is a list of names, not a handle.
  group?: boolean;
  // An announcement channel the caller may post in: say so.
  announcement?: boolean;
  spaceId: string;
  replyTo: Message | null;
  onCancelReply: () => void;
  // Puts back the reply target of a send the server refused.
  onReply: (message: Message) => void;
  // Up arrow in an empty box: edit the caller's last message here.
  onEditLast: () => void;
  // A shown draft's quote, or none: the screen sets the reply if the
  // message is in the log, and clears it for none.
  onRestoreQuote: (messageId: string | undefined) => void;
  // Reply into this root's thread instead of the channel.
  threadRootId?: string;
}) {
  const view = { channelId, rootId: threadRootId };
  // A thread reply may also show in the channel; reset after each send.
  const [alsoSend, setAlsoSend] = useState(false);
  // The words, kept on the device under the account and conversation
  // (useSavedDraft): back on return, never shown anywhere else.
  const { data: me } = useMe();
  const {
    text: draft,
    setText: setDraft,
    startSend,
  } = useSavedDraft({
    key: me
      ? draftKey({ accountId: me.id, channelId, threadRootId })
      : undefined,
    quotedMessageId: replyTo?.id,
    onRestoreQuote,
  });
  const [formats, setFormats] = useState<Format[]>([]);
  // The @handle or #channel being typed.
  const [mention, setMention] = useState<{
    start: number;
    query: string;
    channel?: boolean;
  } | null>(null);
  // The :shortcode being typed, when no @mention is.
  const [shortcode, setShortcode] = useState<{
    start: number;
    query: string;
  } | null>(null);
  // The /command being typed, when no other list is open.
  const [commandQuery, setCommandQuery] = useState<CommandQuery | null>(null);
  // Escape shuts the command list until the draft stops being a command,
  // so it stays shut while a question is typed after the name.
  const commandDismissed = useRef(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<RichField>(null);
  // The formatting row inside the box: shown or not is the device's
  // choice, the same for every composer.
  const formatting = useComposerFormattingStore((s) => s.shown);
  const setFormatting = useComposerFormattingStore((s) => s.setShown);
  const formatId = useId();
  const touchKeyboard = useTouchKeyboard();
  // Files picked, dropped, or pasted, uploading as they arrive; sent by id.
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  // The operator's per-file cap
  const { data: instanceStatus } = useInstanceStatus();
  const maxAttachmentBytes = instanceStatus
    ? Number(instanceStatus.maxUploadBytes)
    : MAX_ATTACHMENT_BYTES;
  const [dragging, setDragging] = useState(false);
  // The command form open (from the plus's menu or the typed command),
  // the channel it was opened in and the words it starts with. Not
  // offered in a thread, which takes no poll.
  // The composer outlives a channel change, and the form does not: it is
  // drawn only in the channel it was opened in, and closed on leaving it.
  // id tells one opening from the next, so a late answer closes only the
  // form that sent it; where names the channel or conversation, for a
  // notice shown away from it.
  const [formIn, setFormIn] = useState<{
    command: CommandName;
    channelId: string;
    text: string;
    id: number;
    where: string;
  } | null>(null);
  const formCount = useRef(0);
  const pollIn =
    formIn?.command === "poll" && formIn.channelId === channelId
      ? formIn
      : null;
  const whenIn =
    formIn?.command === "when" && formIn.channelId === channelId
      ? formIn
      : null;
  const remindIn =
    formIn?.command === "remind" && formIn.channelId === channelId
      ? formIn
      : null;
  // The reminder just set, for its notice and Undo. The notice belongs to
  // the channel it was set in and goes when the composer moves to
  // another. A reminder whose answer comes after that move is still
  // shown, naming where it posts, so its Undo is not lost; one that
  // comes when no composer is left on screen is a notice dialog
  // (reminderSetElsewhere).
  const [reminderSet, setReminderSet] = useState<ShownReminder | null>(null);
  const shownChannel = useRef(channelId);
  shownChannel.current = channelId;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Where focus goes when the form closes. Opened by a command (a pick
  // from the list, a send), it goes back to the words; opened from the
  // plus's menu, a cancel leaves it to the dialog, which returns it to
  // the plus. A posted poll sends it to the words either way. Not when the
  // form closes because the composer moved to another channel.
  const formOpen = formIn !== null;
  const focusAfterForm = useRef(false);
  const openForm = (command: CommandName, text: string, typed: boolean) => {
    focusAfterForm.current = typed;
    formCount.current += 1;
    setFormIn({
      command,
      channelId,
      text,
      id: formCount.current,
      where: reminderPlace({ conversation: dm, name: channelName ?? "" }),
    });
  };
  useEffect(() => {
    if (formOpen || !focusAfterForm.current) return;
    focusAfterForm.current = false;
    inputRef.current?.focus();
  }, [formOpen]);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  // Object URLs for thumbnails are released when the item goes away.
  const dropPending = (key: string) => {
    setPending((list) => {
      const gone = list.find((p) => p.key === key);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return list.filter((p) => p.key !== key);
    });
  };
  const patchPending = (key: string, patch: Partial<PendingAttachment>) =>
    setPending((list) =>
      list.map((p) => (p.key === key ? { ...p, ...patch } : p)),
    );
  const addFiles = (files: Iterable<File>) => {
    setAttachError(null);
    const room = MAX_ATTACHMENTS - pendingRef.current.length;
    const picked = [...files];
    if (picked.length > room) {
      setAttachError(`At most ${MAX_ATTACHMENTS} files per message`);
      picked.length = Math.max(0, room);
    }
    for (const file of picked) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const item: PendingAttachment = {
        key,
        name: file.name,
        size: file.size,
        contentType: file.type,
        previewUrl: isInlineImage(file.type)
          ? URL.createObjectURL(file)
          : undefined,
      };
      if (file.size > maxAttachmentBytes) {
        item.error = `Too big — files must be ${maxAttachmentBytes >> 20} MB or smaller`;
        setPending((list) => [...list, item]);
        continue;
      }
      setPending((list) => [...list, item]);
      uploadAttachment(channelId, file, maxAttachmentBytes).then(
        (up) =>
          patchPending(key, {
            fileId: up.id,
            name: up.name,
            contentType: up.contentType,
            size: up.size,
          }),
        (err) =>
          patchPending(key, {
            error: err instanceof Error ? err.message : String(err),
          }),
      );
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };
  const onPaste = (e: ClipboardEvent) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  };
  // Switching channels drops the pickers and the files; the words are
  // saved and restored by useSavedDraft.
  // biome-ignore lint/correctness/useExhaustiveDependencies: start without pickers or files when switching channels
  useEffect(() => {
    setMention(null);
    setShortcode(null);
    setPending((list) => {
      for (const p of list) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      return [];
    });
    setAttachError(null);
    setCommandQuery(null);
    commandDismissed.current = false;
    focusAfterForm.current = false;
    setFormIn(null);
    setReminderSet(null);
  }, [channelId]);
  const members = usePeople(spaceId, channelId);
  const { data: spaces } = useSpaces();
  const space = spaces?.find((s) => s.id === spaceId);
  const channelAndHere = !!space && canMentionEntireChannel(space);
  const groups = useChannelGroups(spaceId, channelId);
  const linkable = useLinkableChannels(spaceId, channelId);
  const mentionContext = useMemo(
    () => ({
      members: mentionMembers(members),
      channelAndHere,
      groups,
      channels: linkable,
    }),
    [members, channelAndHere, groups, linkable],
  );
  const candidates = mention?.channel
    ? channelCandidates(linkable, mention.query)
    : mention && members
      ? mentionCandidates(members, [...groups.values()], mention.query, {
          channelAndHere,
        })
      : [];

  const suggestions = shortcode ? searchShortcodes(shortcode.query) : [];

  // Where this composer is, for the commands it offers.
  const place: CommandPlace = {
    thread: !!threadRootId,
    canPost: true,
    opens: WEB_FORMS,
  };
  const commands =
    commandQuery && !mention && !shortcode
      ? matchingCommands(commandQuery, place)
      : [];

  // value and caret are the block's text up to the caret; whole is the
  // draft, which a /command is judged on.
  const updateMention = (value: string, caret: number, whole: string) => {
    // No picker in code or a link's words: a mention there is sent as text.
    const off = inputRef.current?.mentionsOffAtCaret();
    const command = commandQueryAt(whole);
    if (!command) commandDismissed.current = false;
    setCommandQuery(off || commandDismissed.current ? null : command);
    const channelQuery = linkable.size > 0 && channelQueryAt(value, caret);
    const q = off
      ? null
      : (mentionQueryAt(value, caret) ??
        (channelQuery ? { ...channelQuery, channel: true } : null));
    setMention(q);
    setShortcode(q ? null : shortcodeQueryAt(value, caret));
    setSelected(0);
  };

  // Typing hint: at most one ping every few seconds while there's text.
  const lastTypingRef = useRef(0);
  const pingTyping = (value: string) => {
    // Typing hints are per channel: one from a thread would read as typing
    // in the channel.
    if (threadRootId || !value.trim()) return;
    const now = Date.now();
    if (now - lastTypingRef.current < 2500) return;
    lastTypingRef.current = now;
    sendClientEvent({
      payload: { case: "typing", value: { spaceId, channelId } },
    });
  };

  const pick = (candidate: MentionCandidate) => {
    if (!mention) return;
    const typed = 1 + mention.query.length;
    const ref = candidateMention(candidate);
    if (ref) inputRef.current?.mentionBeforeCaret(typed, ref);
    else if (candidate.kind === "member") {
      inputRef.current?.replaceBeforeCaret(
        typed,
        `@${candidate.member.username} `,
      );
    }
    setMention(null);
  };

  const pickEmoji = (sc: Shortcode) => {
    if (!shortcode) return;
    inputRef.current?.replaceBeforeCaret(
      1 + shortcode.query.length,
      `${sc.emoji} `,
    );
    setShortcode(null);
  };

  // A command opens its form and posts nothing. Only its own words go:
  // files and a reply stay for the next message, and closing the form
  // does not bring the words back.
  const openCommand = ({ command, text }: ParsedCommand) => {
    setDraft("");
    setMention(null);
    setShortcode(null);
    setCommandQuery(null);
    commandDismissed.current = false;
    openForm(command.name, text, true);
  };

  // What Enter would send, read the same way for a send and for a pick
  // from the command list: mentions settled, shortcodes turned to emoji.
  const outgoing = () => {
    const typed = inputRef.current?.sendable() ?? draft;
    const written = replaceShortcodes(typed);
    return { typed, content: isBlankMessage(written) ? "" : written.trim() };
  };

  const pickCommand = (command: Command) =>
    openCommand({ command, text: pickedText(outgoing().content, command) });

  // Focus the box when a reply is started.
  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  const onKeyDown = (e: KeyboardEvent) => {
    const shortcut = shortcutFormat(e);
    if (shortcut) {
      e.preventDefault();
      inputRef.current?.format(shortcut);
      return;
    }
    // Escape handled here is spent: it doesn't also close the side panel.
    if (
      e.key === "Escape" &&
      !mention &&
      !shortcode &&
      commands.length === 0 &&
      replyTo
    ) {
      e.preventDefault();
      onCancelReply();
      return;
    }
    // Whichever list is open owns the arrow keys and Enter/Tab.
    const count =
      mention && candidates.length > 0
        ? candidates.length
        : shortcode
          ? suggestions.length
          : commands.length;
    // Enter sends; Shift+Enter breaks the line (a textarea never submits
    // its form on its own). An on-screen keyboard's Return breaks the line
    // and the send button sends.
    if (e.key === "Enter" && !e.shiftKey && count === 0) {
      if (touchKeyboard) return;
      e.preventDefault();
      send();
      return;
    }
    if (count === 0) {
      if (e.key === "ArrowUp" && draft === "") {
        e.preventDefault();
        onEditLast();
      }
      return;
    }
    // A list of one has nowhere to move: the arrows stay the caret's,
    // which a question typed after "/poll " needs.
    const commandList = !mention && !shortcode;
    const arrows = !commandList || count > 1;
    if (e.key === "ArrowDown" && arrows) {
      e.preventDefault();
      setSelected((s) => (s + 1) % count);
    } else if (e.key === "ArrowUp" && arrows) {
      e.preventDefault();
      setSelected((s) => (s - 1 + count) % count);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (mention) pick(candidates[selected]);
      else if (shortcode) pickEmoji(suggestions[selected]);
      else pickCommand(commands[selected]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (commandList) commandDismissed.current = true;
      setMention(null);
      setShortcode(null);
      setCommandQuery(null);
    }
  };

  // Enter pressed again before the server answers must not send twice.
  const sendingRef = useRef(false);
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;
  const where = `${channelId}/${threadRootId ?? ""}`;
  const whereRef = useRef(where);
  whereRef.current = where;
  const send = async () => {
    if (sendingRef.current) return;
    const { typed, content } = outgoing();
    // A command offered here opens its form instead of sending; in a
    // thread, or unknown, it is sent as typed.
    const command = parseCommand(content, place);
    if (command) {
      openCommand(command);
      return;
    }
    const files = pendingRef.current;
    // Wait for uploads in flight; failed ones are dropped, not sent.
    if (files.some((p) => !p.fileId && !p.error)) return;
    const attachmentIds = files.flatMap((p) => (p.fileId ? [p.fileId] : []));
    if (!content && attachmentIds.length === 0) return;
    setDraft("");
    setMention(null);
    setShortcode(null);
    setCommandQuery(null);
    commandDismissed.current = false;
    setPending([]);
    setAttachError(null);
    onCancelReply();
    setAlsoSend(false);
    const releasePreviews = () => {
      for (const p of files)
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    };
    sendingRef.current = true;
    // Held apart from the draft while the send is out; a send that stalls
    // past the timeout has failed, here and for any other tab.
    const ticket = startSend({ text: typed, quotedMessageId: replyTo?.id });
    let res: Awaited<ReturnType<typeof chatClient.sendMessage>>;
    try {
      res = await chatClient.sendMessage(
        {
          channelId,
          content,
          replyToMessageId: replyTo?.id ?? "",
          attachmentIds,
          threadRootId: threadRootId ?? "",
          alsoSendToChannel: !!threadRootId && alsoSend,
        },
        { timeoutMs: SEND_STALL_MS },
      );
    } catch (err) {
      // Refused: put it all back with the reason, unless the person has
      // moved to another channel or thread meanwhile.
      ticket.fail();
      if (whereRef.current !== where) {
        releasePreviews();
        return;
      }
      setDraft((typedSince) => restoreDraft(typed, typedSince));
      setPending((addedSince) => restoreFiles(files, addedSince));
      // The reply target comes back unless another was picked meanwhile.
      const replyNow = replyToRef.current;
      if (replyTo && (!replyNow || replyNow === replyTo)) onReply(replyTo);
      setAlsoSend(alsoSend);
      setAttachError(errorText(err));
      return;
    } finally {
      sendingRef.current = false;
    }
    ticket.finish();
    releasePreviews();
    try {
      // The WS event usually lands first; the log merges by seq either
      // way. Sent from inside history, the view is replaced by the newest
      // page so the message is seen where it landed.
      if (res.message) {
        if (isLive(view)) holdRow(channelId, res.message);
        else await jumpToLatest(view);
      }
    } catch (err) {
      setAttachError(errorText(err));
    }
  };

  return (
    <>
      <form
        className={`composer ${dragging ? "dragging" : ""}`}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          send();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <MentionPicker
          candidates={candidates}
          selected={selected}
          onPick={pick}
        />
        {!mention && (
          <EmojiSuggest
            candidates={suggestions}
            selected={selected}
            onPick={pickEmoji}
          />
        )}
        <CommandList
          commands={commands}
          selected={selected}
          onPick={pickCommand}
        />
        {replyTo && (
          <div className="reply-bar">
            <span>
              Replying to{" "}
              <strong>
                {replyTo.author?.displayName || replyTo.author?.username}
                <BotMark kind={replyTo.author?.kind} />
                <DeletedMark deleted={replyTo.author?.deleted} />
              </strong>
              <span className="muted">
                {" "}
                — {messagePreview(replyTo).slice(0, 80)}
              </span>
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={onCancelReply}
              aria-label="Cancel reply"
              title="Cancel reply (Esc)"
            >
              ✕
            </button>
          </div>
        )}
        <AttachmentStrip
          items={pending}
          error={attachError}
          onRemove={dropPending}
        />
        <div className="composer-row">
          {/* A press on the box's own ground, between or beside its
            buttons, goes to the words and keeps the caret. */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: the editor inside is the control; this only widens its target for a mouse */}
          <div
            className="composer-input"
            onMouseDown={(e) => {
              const on = e.target as HTMLElement;
              if (on.closest("button, input, .rich-editor")) return;
              e.preventDefault();
              inputRef.current?.focus();
            }}
          >
            {/* The formatting row, opened and shut by the Aa below. Shut,
              it is out of the Tab order and a screen reader's way. */}
            <div
              id={formatId}
              className={`composer-format ${formatting ? "open" : ""}`}
              inert={!formatting}
            >
              <div className="composer-format-clip">
                <FormatToolbar
                  active={formats}
                  onFormat={(f) => inputRef.current?.format(f)}
                />
              </div>
            </div>
            <RichEditor
              fieldRef={inputRef}
              onFormats={setFormats}
              mentions={mentionContext}
              value={draft}
              onPaste={onPaste}
              onChange={(value, textBefore) => {
                setDraft(value);
                updateMention(textBefore, textBefore.length, value);
                pingTyping(value);
              }}
              onCaret={(textBefore) =>
                updateMention(textBefore, textBefore.length, draft)
              }
              onKeyDown={onKeyDown}
              onBlur={() => {
                setMention(null);
                setShortcode(null);
                setCommandQuery(null);
              }}
              placeholder={
                threadRootId
                  ? "Reply in thread"
                  : channelName
                    ? dm
                      ? group
                        ? `Message ${channelName}`
                        : `Message @${channelName}`
                      : announcement
                        ? `Announce in ${channelName}`
                        : `Message ${channelName}`
                    : "Message"
              }
            />
            {/* Keyed by the channel, so an open menu does not follow the
              composer to another one. */}
            <ComposerActions
              key={channelId}
              commands={commandsOffered(place)}
              onCommand={(name) => openForm(name, "", false)}
              onFiles={addFiles}
              formatting={formatting}
              formattingId={formatId}
              onFormatting={setFormatting}
              onMention={() => inputRef.current?.typeAt()}
            />
          </div>
          {touchKeyboard && (
            <button
              type="submit"
              className="primary composer-send"
              aria-label="Send"
              onMouseDown={(e) => e.preventDefault()}
            >
              <SendIcon />
            </button>
          )}
        </div>
        {threadRootId && (
          <label className="toggle-row composer-also-send">
            <input
              type="checkbox"
              checked={alsoSend}
              onChange={(e) => setAlsoSend(e.target.checked)}
            />
            <span>
              Also send to{" "}
              {dm && !group ? `@${channelName}` : (channelLabel ?? channelName)}
            </span>
          </label>
        )}
        {announcement && (
          <p className="composer-hint">
            Announcement channel: members read and react, only admins post.
          </p>
        )}
        {/* Last in the form, so Tab reaches it from the words. */}
        <ReminderNotice
          set={reminderSet}
          onDone={() => setReminderSet(null)}
          returnFocus={() => inputRef.current?.focus()}
        />
      </form>
      {/* Beside the composer's form, not in it: a form in a form would
        send the message on the poll's submit. */}
      {pollIn && (
        <PollForm
          key={pollIn.channelId}
          channelId={pollIn.channelId}
          question={pollIn.text}
          onClose={() => setFormIn(null)}
          onPosted={() => {
            focusAfterForm.current = true;
            setFormIn(null);
          }}
        />
      )}
      {whenIn && (
        <TimePollForm
          key={whenIn.channelId}
          channelId={whenIn.channelId}
          question={whenIn.text}
          onClose={() => setFormIn(null)}
          onPosted={() => {
            focusAfterForm.current = true;
            setFormIn(null);
          }}
        />
      )}
      {remindIn && (
        <ReminderForm
          key={remindIn.channelId}
          channelId={remindIn.channelId}
          where={dm ? null : (channelLabel ?? channelName)}
          text={remindIn.text}
          onClose={() => setFormIn(null)}
          onSet={(set) => {
            const { id, channelId: setIn, where } = remindIn;
            if (!mounted.current) {
              reminderSetElsewhere(set, where);
              return;
            }
            setReminderSet({
              ...set,
              where: shownChannel.current === setIn ? undefined : where,
            });
            // Closes the form that sent it, if that one is still open.
            setFormIn((open) => {
              if (open?.id !== id) return open;
              focusAfterForm.current = true;
              return null;
            });
          }}
        />
      )}
    </>
  );
}

// A reminder whose answer came when its composer was gone (the person
// moved to a view with none): said in a notice dialog, naming where it
// posts, so it is never set without a word. There is no Undo there.
function reminderSetElsewhere(set: SetReminder, where: string) {
  notice({
    title: "Reminder set",
    body: `${reminderSetText(set.remindAt, new Date(), where)}.`,
  });
}

// The commands this composer has a form for: all of them.
const WEB_FORMS: readonly CommandName[] = ["poll", "when", "remind"];
