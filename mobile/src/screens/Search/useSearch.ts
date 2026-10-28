import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { useCallback, useEffect, useRef, useState } from "react";
import { searchErrorText, searchMessages } from "../../api/search";

// The search screen's matches: the query last run, its first page and
// the older pages appended as the reader reaches the end of the list,
// newest first, as web's search page holds them. A new query drops the
// older pages; an answer to a query no longer wanted (a newer one run,
// the screen left) is dropped too.

export type SearchState = {
  // The query as run, trimmed; "" before the first search and after one
  // cleared back to nothing.
  query: string;
  // The first page is out.
  searching: boolean;
  // What the query found, once its first page is in.
  results: { messages: Message[]; hasOlder: boolean } | null;
  // A page is out beyond the first.
  loadingMore: boolean;
  // Why the last request failed, in the person's words (api/search).
  error: string | null;
};

const IDLE: SearchState = { query: "", searching: false, results: null, loadingMore: false, error: null };

export function useSearch(origin: string, token: string | null, spaceId: string) {
  const [state, setState] = useState<SearchState>(IDLE);
  // Which request's answer is still wanted: each search starts a new
  // generation, and an older page's answer is kept only in its own.
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  const run = useCallback(
    (text: string) => {
      const query = text.trim();
      const mine = ++generation.current;
      if (!query || !token) {
        setState(IDLE);
        return;
      }
      setState({ query, searching: true, results: null, loadingMore: false, error: null });
      searchMessages(origin, token, spaceId, query).then(
        ({ messages, hasOlder }) => {
          if (mine !== generation.current) return;
          setState({ query, searching: false, results: { messages, hasOlder }, loadingMore: false, error: null });
        },
        (err: unknown) => {
          if (mine !== generation.current) return;
          setState({ query, searching: false, results: null, loadingMore: false, error: searchErrorText(err) });
        },
      );
    },
    [origin, token, spaceId],
  );

  const more = useCallback(() => {
    const { query, results, loadingMore } = state;
    const last = results?.messages.at(-1);
    if (!results?.hasOlder || loadingMore || !last || !token) return;
    const mine = generation.current;
    setState((before) => ({ ...before, loadingMore: true, error: null }));
    searchMessages(origin, token, spaceId, query, last.id).then(
      ({ messages, hasOlder }) => {
        if (mine !== generation.current) return;
        setState((before) => ({
          ...before,
          loadingMore: false,
          results: { messages: [...(before.results?.messages ?? []), ...messages], hasOlder },
        }));
      },
      (err: unknown) => {
        if (mine !== generation.current) return;
        setState((before) => ({ ...before, loadingMore: false, error: searchErrorText(err) }));
      },
    );
  }, [origin, token, spaceId, state]);

  return { state, run, more };
}
