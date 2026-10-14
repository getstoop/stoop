import { ConnectError } from "@connectrpc/connect";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  type DragEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { chatClient } from "../../api/clients";
import { usePeople } from "../../api/dms";
import {
  isInlineImage,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  uploadAttachment,
} from "../../api/files";
import { shortcutFormat } from "../../api/formatting";
import { isLive, timelineId, useHistoryStore } from "../../api/history";
import { filterMembers, mentionQueryAt } from "../../api/mentions";
import { canMentionEntireChannel } from "../../api/permissions";
import { useInstanceStatus, useSpaces } from "../../api/queries";
import {
  replaceShortcodes,
  type Shortcode,
  searchShortcodes,
  shortcodeQueryAt,
} from "../../api/shortcodes";
import { appendMessage, sendClientEvent } from "../../api/ws";
import {
  AttachmentStrip,
  type PendingAttachment,
} from "../../components/AttachmentStrip";
import { messagePreview } from "../../components/Attachments";
import { BotMark } from "../../components/BotMark";
import { DeletedMark } from "../../components/DeletedMark";
import { EmojiSuggest } from "../../components/EmojiSuggest";
import { FormatToolbar } from "../../components/FormatToolbar";
import { SendIcon } from "../../components/Icons";
import { MentionPicker } from "../../components/MentionPicker";
import { RichEditor, type RichField } from "../../components/RichEditor";
import { Tooltip } from "../../components/Tooltip";
import type { Member } from "../../gen/stoop/chat/v1/member_pb";
import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { useTouchKeyboard } from "../../hooks/useTouchKeyboard";

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
  onEditLast,
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
  // Up arrow in an empty box: edit the caller's last message here.
  onEditLast: () => void;
  // Reply into this root's thread instead of the channel.
  threadRootId?: string;
}) {
  const timeline = { channelId, rootId: threadRootId };
  // A thread reply may also show in the channel; reset after each send.
  const [alsoSend, setAlsoSend] = useState(false);
  const [draft, setDraft] = useState("");
  const [mention, setMention] = useState<{
    start: number;
    query: string;
  } | null>(null);
  // The :shortcode being typed, when no @mention is.
  const [shortcode, setShortcode] = useState<{
    start: number;
    query: string;
  } | null>(null);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<RichField>(null);
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
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: drop pending files when switching channels
  useEffect(() => {
    setPending((list) => {
      for (const p of list) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      return [];
    });
    setAttachError(null);
  }, [channelId]);
  const queryClient = useQueryClient();
  const members = usePeople(spaceId, channelId);
  const { data: spaces } = useSpaces();
  const space = spaces?.find((s) => s.id === spaceId);
  const candidates =
    mention && members
      ? filterMembers(
          members,
          mention.query,
          !!space && canMentionEntireChannel(space),
        )
      : [];

  const suggestions = shortcode ? searchShortcodes(shortcode.query) : [];

  const updateMention = (value: string, caret: number) => {
    const q = mentionQueryAt(value, caret);
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

  const pick = (m: Member) => {
    if (!mention) return;
    inputRef.current?.replaceBeforeCaret(
      1 + mention.query.length,
      `@${m.username} `,
    );
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
    if (e.key === "Escape" && !mention && !shortcode && replyTo) {
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
          : 0;
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
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (s + 1) % count);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => (s - 1 + count) % count);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (mention) pick(candidates[selected]);
      else pickEmoji(suggestions[selected]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMention(null);
      setShortcode(null);
    }
  };

  const send = async () => {
    const content = replaceShortcodes(draft).trim();
    const files = pendingRef.current;
    // Wait for uploads in flight; failed ones are dropped, not sent.
    if (files.some((p) => !p.fileId && !p.error)) return;
    const attachmentIds = files.flatMap((p) => (p.fileId ? [p.fileId] : []));
    if (!content && attachmentIds.length === 0) return;
    setDraft("");
    setMention(null);
    setShortcode(null);
    for (const p of files) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    setPending([]);
    setAttachError(null);
    const replyToMessageId = replyTo?.id ?? "";
    onCancelReply();
    setAlsoSend(false);
    try {
      const res = await chatClient.sendMessage({
        channelId,
        content,
        replyToMessageId,
        attachmentIds,
        threadRootId: threadRootId ?? "",
        alsoSendToChannel: !!threadRootId && alsoSend,
      });
      // The WS event usually lands first; appendMessage dedupes by ID either
      // way. Sent from inside history, the window is replaced by the newest
      // page so the message is seen where it landed.
      if (res.message) {
        const h = useHistoryStore.getState();
        if (isLive(h.channels[timelineId(timeline)])) {
          appendMessage(queryClient, res.message);
        } else {
          await h.jumpToLatest(queryClient, timeline);
        }
      }
    } catch (err) {
      setAttachError(
        err instanceof ConnectError ? err.rawMessage : String(err),
      );
    }
  };

  return (
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
      <div className="composer-tools">
        <FormatToolbar onFormat={(f) => inputRef.current?.format(f)} />
        <Tooltip text="Attach files">
          <button
            type="button"
            className="format-button attach-button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach files"
          >
            <PaperclipIcon />
          </button>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
          aria-label="Attach files"
        />
      </div>
      <AttachmentStrip
        items={pending}
        error={attachError}
        onRemove={dropPending}
      />
      <div className="composer-row">
        <div className="composer-input">
          <RichEditor
            fieldRef={inputRef}
            value={draft}
            onPaste={onPaste}
            onChange={(value, textBefore) => {
              setDraft(value);
              updateMention(textBefore, textBefore.length);
              pingTyping(value);
            }}
            onCaret={(textBefore) =>
              updateMention(textBefore, textBefore.length)
            }
            onKeyDown={onKeyDown}
            onBlur={() => {
              setMention(null);
              setShortcode(null);
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
    </form>
  );
}

function PaperclipIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
