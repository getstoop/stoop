import { ConnectError } from "@connectrpc/connect";
import { useQueryClient } from "@tanstack/react-query";
import {
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
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
import { isLive, useHistoryStore } from "../../api/history";
import { filterMembers, mentionQueryAt } from "../../api/mentions";
import { canMentionEveryone } from "../../api/permissions";
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
import { ComposerOverlay } from "../../components/ComposerOverlay";
import { EmojiSuggest } from "../../components/EmojiSuggest";
import { FormatToolbar } from "../../components/FormatToolbar";
import { MentionPicker } from "../../components/MentionPicker";
import type { Member } from "../../gen/stoop/chat/v1/member_pb";
import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { useAutoGrow } from "../../hooks/useAutoGrow";
import { useFormatting } from "../../hooks/useFormatting";

export function Composer({
  channelId,
  channelName,
  dm = false,
  spaceId,
  replyTo,
  onCancelReply,
}: {
  channelId: string;
  channelName?: string;
  dm?: boolean;
  spaceId: string;
  replyTo: Message | null;
  onCancelReply: () => void;
}) {
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(inputRef, draft);
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
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
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
  const { apply: format, onShortcut } = useFormatting(inputRef, setDraft);
  const queryClient = useQueryClient();
  const members = usePeople(spaceId, channelId);
  const { data: spaces } = useSpaces();
  const space = spaces?.find((s) => s.id === spaceId);
  const candidates =
    mention && members
      ? filterMembers(
          members,
          mention.query,
          !!space && canMentionEveryone(space),
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
    if (!value.trim()) return;
    const now = Date.now();
    if (now - lastTypingRef.current < 2500) return;
    lastTypingRef.current = now;
    sendClientEvent({
      payload: { case: "typing", value: { spaceId, channelId } },
    });
  };

  const pick = (m: Member) => {
    if (!mention) return;
    const caret = inputRef.current?.selectionStart ?? draft.length;
    const next = `${draft.slice(0, mention.start)}@${m.username} ${draft.slice(caret)}`;
    setDraft(next);
    setMention(null);
    const pos = mention.start + m.username.length + 2;
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(pos, pos));
  };

  const pickEmoji = (sc: Shortcode) => {
    if (!shortcode) return;
    const caret = inputRef.current?.selectionStart ?? draft.length;
    const next = `${draft.slice(0, shortcode.start)}${sc.emoji} ${draft.slice(caret)}`;
    setDraft(next);
    setShortcode(null);
    const pos = shortcode.start + sc.emoji.length + 1;
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(pos, pos));
  };

  // Focus the box when a reply is started.
  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (onShortcut(e)) return;
    if (e.key === "Escape" && !mention && !shortcode && replyTo) {
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
    // its form on its own).
    if (e.key === "Enter" && !e.shiftKey && count === 0) {
      e.preventDefault();
      send();
      return;
    }
    if (count === 0) return;
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
    try {
      const res = await chatClient.sendMessage({
        channelId,
        content,
        replyToMessageId,
        attachmentIds,
      });
      // The WS event usually lands first; appendMessage dedupes by ID either
      // way. Sent from inside history, the window is replaced by the newest
      // page so the message is seen where it landed.
      if (res.message) {
        const h = useHistoryStore.getState();
        if (isLive(h.channels[channelId])) {
          appendMessage(queryClient, res.message);
        } else {
          await h.jumpToLatest(queryClient, channelId);
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
        <FormatToolbar onFormat={format} />
        <button
          type="button"
          className="format-button attach-button"
          onClick={() => fileInputRef.current?.click()}
          title="Attach files"
          aria-label="Attach files"
        >
          <PaperclipIcon />
        </button>
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
      <div className="composer-input">
        <ComposerOverlay value={draft} textareaRef={inputRef} />
        <textarea
          ref={inputRef}
          value={draft}
          rows={1}
          onPaste={onPaste}
          onChange={(e) => {
            setDraft(e.target.value);
            updateMention(
              e.target.value,
              e.target.selectionStart ?? e.target.value.length,
            );
            pingTyping(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setMention(null);
            setShortcode(null);
          }}
          placeholder={
            channelName
              ? dm
                ? `Message @${channelName}`
                : `Message #${channelName}`
              : "Message"
          }
          maxLength={4000}
          autoComplete="off"
        />
      </div>
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
