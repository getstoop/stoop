import { useRef } from "react";
import { groupCount } from "../api/groups";
import { isBot } from "../api/identity";
import { isChannelOrHere, type MentionCandidate } from "../api/mentions";
import { presenceClass, presenceLabel } from "../api/presence";
import { useScrollToSelected } from "../hooks/useScrollToSelected";
import { useConnectionStore } from "../stores/connection";
import { Avatar } from "./Avatar";
import { BotMark } from "./BotMark";
import { PeopleIcon } from "./Icons";

// Autocomplete list shown above the composer while typing @handle or
// @@handle: @channel and @here, then groups, then people.
export function MentionPicker({
  candidates,
  selected,
  onPick,
}: {
  candidates: MentionCandidate[];
  selected: number;
  onPick: (candidate: MentionCandidate) => void;
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
      {candidates.map((candidate, i) => (
        <li
          key={
            candidate.kind === "group"
              ? `group:${candidate.group.id}`
              : candidate.member.userId
          }
        >
          <button
            type="button"
            className={`option mention-option ${i === selected ? "selected" : ""}`}
            aria-pressed={i === selected}
            onMouseDown={(e) => {
              e.preventDefault(); // keep the input focused
              onPick(candidate);
            }}
          >
            {candidate.kind === "group" ? (
              <>
                <span className="group-mark" aria-hidden="true">
                  <PeopleIcon />
                </span>
                <span className="member-name">
                  {candidate.group.name}{" "}
                  <span className="muted">{groupCount(candidate.group)}</span>
                </span>
                <span className="muted small">@@{candidate.group.handle}</span>
              </>
            ) : (
              <>
                {/* @channel and @here are not anyone. */}
                {!isChannelOrHere(candidate.member.userId) && (
                  <Avatar
                    name={
                      candidate.member.displayName || candidate.member.username
                    }
                    fileId={candidate.member.avatarFileId}
                    kind={candidate.member.kind}
                    size="small"
                  >
                    {!isBot(candidate.member.kind) && (
                      <span
                        className={`online-dot ${presenceClass(online.has(candidate.member.userId), dnd[candidate.member.userId])}`}
                        role="img"
                        aria-label={presenceLabel(
                          online.has(candidate.member.userId),
                          dnd[candidate.member.userId],
                        )}
                      />
                    )}
                  </Avatar>
                )}
                <span className="member-name">
                  {candidate.member.displayName || candidate.member.username}
                  <BotMark kind={candidate.member.kind} />
                </span>
                <span className="muted small">
                  @{candidate.member.username}
                </span>
              </>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
