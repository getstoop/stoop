import { useRef } from "react";
import { groupCount } from "../api/groups";
import { isBot } from "../core/identity";
import { isChannelOrHere, type MentionCandidate } from "../core/mentions";
import { presenceClass, presenceLabel } from "../core/presence";
import { useScrollToSelected } from "../hooks/useScrollToSelected";
import { useConnectionStore } from "../stores/connection";
import { Avatar } from "./Avatar";
import { BotMark } from "./BotMark";
import { PeopleIcon } from "./Icons";

// Autocomplete list shown above the composer while typing @handle:
// @channel and @here, then groups, then people. While typing #name, the
// space's public channels.
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
  const mobile = useConnectionStore((s) => s.mobile);
  const listRef = useRef<HTMLUListElement>(null);
  useScrollToSelected(listRef, selected);
  if (candidates.length === 0) return null;
  const channels = candidates[0].kind === "channel";
  return (
    <ul
      ref={listRef}
      className="mention-picker popover"
      aria-label={channels ? "Link a channel" : "Mention a member"}
    >
      {candidates.map((candidate, i) => (
        <li key={candidateKey(candidate)}>
          <button
            type="button"
            className={`option mention-option ${i === selected ? "selected" : ""}`}
            aria-pressed={i === selected}
            onMouseDown={(e) => {
              e.preventDefault(); // keep the input focused
              onPick(candidate);
            }}
          >
            {candidate.kind === "channel" ? (
              <>
                <span className="channel-mark" aria-hidden="true">
                  #
                </span>
                <span className="member-name">{candidate.channel.name}</span>
                <span className="muted small mention-option-topic">
                  {candidate.channel.topic}
                </span>
              </>
            ) : candidate.kind === "group" ? (
              <>
                <span className="group-mark" aria-hidden="true">
                  <PeopleIcon />
                </span>
                <span className="member-name">
                  {candidate.group.name}{" "}
                  <span className="muted">{groupCount(candidate.group)}</span>
                </span>
                <span className="muted small">@{candidate.group.handle}</span>
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
                        className={`online-dot ${presenceClass(online.has(candidate.member.userId), dnd[candidate.member.userId], mobile[candidate.member.userId])}`}
                        role="img"
                        aria-label={presenceLabel(
                          online.has(candidate.member.userId),
                          dnd[candidate.member.userId],
                          mobile[candidate.member.userId],
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

function candidateKey(candidate: MentionCandidate): string {
  if (candidate.kind === "channel") return `channel:${candidate.channel.id}`;
  if (candidate.kind === "group") return `group:${candidate.group.id}`;
  return candidate.member.userId;
}
