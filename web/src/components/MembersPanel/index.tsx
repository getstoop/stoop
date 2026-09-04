import { useRef, useState } from "react";
import { useMembers } from "../../api/queries";
import { useConnectionStore } from "../../stores/connection";
import { SearchIcon } from "../Icons";
import { UserCard } from "../UserCard";
import { COLLAPSE_OFFLINE_ABOVE, headingText, splitMembers } from "./groups";
import { MemberGroup } from "./MemberGroup";
import { MemberRow } from "./MemberRow";

// Members of the current space in online and offline groups, narrowed by
// the search field. Clicking a member opens the same profile card as
// clicking their name in chat.
export function MembersPanel({ spaceId }: { spaceId: string }) {
  const { data: members } = useMembers(spaceId);
  const online = useConnectionStore((s) => s.online);
  const presence = useConnectionStore((s) => s.presence);
  const [query, setQuery] = useState("");
  // The panel keeps the height it had when the search began, so the
  // field does not move as the results narrow.
  const panel = useRef<HTMLElement>(null);
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);
  const search = (next: string) => {
    if (next === "") setLockedHeight(null);
    else if (query === "") setLockedHeight(panel.current?.offsetHeight ?? null);
    setQuery(next);
  };
  const [onlineOpen, setOnlineOpen] = useState(true);
  const [offlineOpen, setOfflineOpen] = useState<boolean | null>(null);
  const [card, setCard] = useState<{ userId: string; anchor: DOMRect } | null>(
    null,
  );

  const all = members ?? [];
  const searching = query.trim() !== "";
  const groups = splitMembers(all, online, query);
  const onlineCount = all.filter((m) => online.has(m.userId)).length;
  const shownCount = groups.online.length + groups.offline.length;
  // A search looks through folded groups too.
  const showOffline =
    searching || (offlineOpen ?? all.length <= COLLAPSE_OFFLINE_ABOVE);

  const row = (m: (typeof all)[number]) => (
    <MemberRow
      key={m.userId}
      member={m}
      online={online.has(m.userId)}
      presence={presence[m.userId]}
      onOpen={(anchor) => setCard({ userId: m.userId, anchor })}
    />
  );

  return (
    <section
      className="members-panel"
      ref={panel}
      style={lockedHeight === null ? undefined : { height: lockedHeight }}
    >
      <h4 className="members-heading">
        Members
        {members &&
          ` · ${headingText(all.length, onlineCount, shownCount, searching)}`}
      </h4>
      <label className="members-search">
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(e) => search(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") search("");
          }}
          placeholder="Find a member"
          aria-label="Find a member"
        />
      </label>
      <ul className="members-list">
        <MemberGroup
          label="Online"
          count={groups.online.length}
          open={searching || onlineOpen}
          onToggle={() => setOnlineOpen((v) => !v)}
        >
          {groups.online.map(row)}
        </MemberGroup>
        <MemberGroup
          label="Offline"
          count={groups.offline.length}
          open={showOffline}
          onToggle={() => setOfflineOpen(!showOffline)}
        >
          {groups.offline.map(row)}
        </MemberGroup>
        {searching && shownCount === 0 && (
          <li className="members-empty muted small">
            No one matches “{query.trim()}”.
          </li>
        )}
      </ul>
      {card && (
        <UserCard
          spaceId={spaceId}
          userId={card.userId}
          anchor={card.anchor}
          onClose={() => setCard(null)}
        />
      )}
    </section>
  );
}
