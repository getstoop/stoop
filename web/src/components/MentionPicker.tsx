import { useRef } from "react";
import { isBot } from "../api/identity";
import { isChannelOrHere } from "../api/mentions";
import { presenceClass, presenceLabel } from "../api/presence";
import type { Member } from "../gen/stoop/chat/v1/member_pb";
import { useScrollToSelected } from "../hooks/useScrollToSelected";
import { useConnectionStore } from "../stores/connection";
import { Avatar } from "./Avatar";
import { BotMark } from "./BotMark";

// Autocomplete list shown above the composer while typing @handle.
export function MentionPicker({
  candidates,
  selected,
  onPick,
}: {
  candidates: Member[];
  selected: number;
  onPick: (m: Member) => void;
}) {
  const online = useConnectionStore((s) => s.online);
  const dnd = useConnectionStore((s) => s.dnd);
  const listRef = useRef<HTMLUListElement>(null);
  useScrollToSelected(listRef, selected);
  if (candidates.length === 0) return null;
  return (
    <ul
      ref={listRef}
      className="mention-picker popover"
      aria-label="Mention a member"
    >
      {candidates.map((m, i) => (
        <li key={m.userId}>
          <button
            type="button"
            className={`option mention-option ${i === selected ? "selected" : ""}`}
            aria-pressed={i === selected}
            onMouseDown={(e) => {
              e.preventDefault(); // keep the input focused
              onPick(m);
            }}
          >
            {/* @channel and @here are not anyone. */}
            {!isChannelOrHere(m.userId) && (
              <Avatar
                name={m.displayName || m.username}
                fileId={m.avatarFileId}
                kind={m.kind}
                size="small"
              >
                {!isBot(m.kind) && (
                  <span
                    className={`online-dot ${presenceClass(online.has(m.userId), dnd[m.userId])}`}
                    role="img"
                    aria-label={presenceLabel(
                      online.has(m.userId),
                      dnd[m.userId],
                    )}
                  />
                )}
              </Avatar>
            )}
            <span className="member-name">
              {m.displayName || m.username}
              <BotMark kind={m.kind} />
            </span>
            <span className="muted small">@{m.username}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
