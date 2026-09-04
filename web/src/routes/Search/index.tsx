import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { chatClient } from "../../api/clients";
import { useChannels, useMembers, useSpaces } from "../../api/queries";
import {
  highlightPattern,
  highlightTerms,
  inChannel,
  searchErrorText,
  toggleInChannel,
} from "../../api/search";
import { SearchIcon } from "../../components/Icons";
import { MenuButton } from "../../components/MenuButton";
import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { ResultRow } from "./ResultRow";

// Search results for one space, in the channel view's shape: a header
// with the query field, then rows newest first. ?q= is the search and
// ?c= the channel it started from, so the page is linkable and Close
// goes back where the person was. The first page is a query keyed on
// the words, so Back restores it; older pages are appended on demand.
export function SearchPage() {
  const { spaceId } = useParams({ strict: false }) as { spaceId: string };
  const { q = "", c } = useSearch({ strict: false }) as {
    q?: string;
    c?: string;
  };
  const navigate = useNavigate();
  const { data: spaces } = useSpaces();
  const { data: channels } = useChannels(spaceId);
  const { data: members } = useMembers(spaceId);
  const space = spaces?.find((s) => s.id === spaceId);
  const from = channels?.find((ch) => ch.id === c);
  const usernames = new Set(members?.map((m) => m.username.toLowerCase()));
  const [draft, setDraft] = useState(q);
  const input = useRef<HTMLInputElement>(null);
  // Arriving with nothing to search puts the cursor in the field.
  useEffect(() => {
    if (!q) input.current?.focus();
  }, [q]);
  // The field follows the URL (Back, a chip) but not the other way round
  // until Enter.
  useEffect(() => setDraft(q), [q]);

  const {
    data: first,
    error,
    isFetching,
  } = useQuery({
    queryKey: ["search", spaceId, q],
    queryFn: () =>
      chatClient.searchMessages({
        scope: { case: "spaceId", value: spaceId },
        query: q,
      }),
    enabled: q !== "",
    retry: false,
    staleTime: 60_000,
  });
  const [older, setOlder] = useState<Message[]>([]);
  const [olderExhausted, setOlderExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new search drops the older pages
  useEffect(() => {
    setOlder([]);
    setOlderExhausted(false);
  }, [q]);

  const all = [...(first?.messages ?? []), ...older];
  const hasOlder = !olderExhausted && (older.length > 0 || !!first?.hasOlder);
  const loadMore = async () => {
    const last = all[all.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const res = await chatClient.searchMessages({
        scope: { case: "spaceId", value: spaceId },
        query: q,
        beforeId: last.id,
      });
      setOlder((o) => [...o, ...res.messages]);
      if (!res.hasOlder) setOlderExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const setQuery = (next: string) =>
    navigate({
      to: "/s/$spaceId/search",
      params: { spaceId },
      search: { q: next.trim() || undefined, c },
      replace: true,
    });
  const close = () =>
    from
      ? navigate({
          to: "/s/$spaceId/c/$channelId",
          params: { spaceId, channelId: from.id },
        })
      : navigate({ to: "/s/$spaceId", params: { spaceId } });

  const highlight = highlightPattern(highlightTerms(q));
  const count =
    first && q
      ? `${all.length}${hasOlder ? "+" : ""} ${all.length === 1 && !hasOlder ? "message" : "messages"}`
      : "";

  return (
    <div className="search-page">
      <header className="channel-header search-header">
        <MenuButton />
        <span className="search-title">Search in {space?.name ?? "…"}</span>
        <form
          className="search-form"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(draft);
          }}
        >
          <label className="members-search search-field">
            <SearchIcon />
            <input
              ref={input}
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                if (draft) setDraft("");
                else close();
              }}
              placeholder="Words, “a phrase”, from:@name, in:#channel"
              aria-label="Search messages"
            />
          </label>
        </form>
        <span className="muted search-count">{count}</span>
        <button type="button" className="chip" onClick={close}>
          Close
        </button>
      </header>

      {from && (
        <div className="search-scope">
          <button
            type="button"
            className={`chip ${inChannel(q, from.name) ? "" : "active"}`}
            onClick={() =>
              inChannel(q, from.name) && setQuery(toggleInChannel(q, from.name))
            }
          >
            All channels
          </button>
          <button
            type="button"
            className={`chip ${inChannel(q, from.name) ? "active" : ""}`}
            onClick={() =>
              !inChannel(q, from.name) &&
              setQuery(toggleInChannel(q, from.name))
            }
          >
            This channel
          </button>
        </div>
      )}

      <div className="search-scroll">
        {error && (
          <p className="error search-error">{searchErrorText(error)}</p>
        )}
        {!q && (
          <p className="muted empty-state">
            Type a word and press Enter. Quote “a phrase”, put - before a word
            to leave it out, or narrow with from:@name, in:#channel,
            before:2026-01-31 and after:2026-01-01.
          </p>
        )}
        {q && first && all.length === 0 && (
          <p className="muted empty-state">
            No messages match <strong>{q}</strong>.
          </p>
        )}
        {q && !first && !error && isFetching && (
          <p className="muted empty-state">Searching…</p>
        )}
        <ul className="search-list">
          {all.map((m) => (
            <li key={m.id}>
              <ResultRow
                message={m}
                spaceId={spaceId}
                usernames={usernames}
                highlight={highlight}
              />
            </li>
          ))}
        </ul>
        {hasOlder && (
          <button
            type="button"
            className="chip search-more"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load older"}
          </button>
        )}
      </div>
    </div>
  );
}
