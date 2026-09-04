import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { SearchIcon } from "./Icons";

// The way into message search from a channel header: a compact field on
// a desktop, an icon on a phone (mobile.css swaps them). Either opens
// the space's results page; the field takes its words along.
export function SearchLauncher({
  spaceId,
  channelId,
}: {
  spaceId: string;
  channelId: string;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const open = (q: string) =>
    navigate({
      to: "/s/$spaceId/search",
      params: { spaceId },
      search: { q: q.trim() || undefined, c: channelId },
    });
  return (
    <>
      <form
        className="search-launch"
        onSubmit={(e) => {
          e.preventDefault();
          open(query);
          setQuery("");
        }}
      >
        <label className="members-search search-field">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search"
            aria-label="Search messages"
          />
        </label>
      </form>
      <button
        type="button"
        className="icon-button search-launch-button"
        onClick={() => open("")}
        aria-label="Search messages"
      >
        <SearchIcon />
      </button>
    </>
  );
}
