import { Code, ConnectError } from "@connectrpc/connect";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { useCallback, useEffect, useRef, useState } from "react";
import { searchErrorText, searchMessages } from "../../api/search";

// The search screen's matches: the query last run, its first page and
// the older pages appended as the reader reaches the end of the list,
// newest first, as web's search page holds them. A new query drops the
// older pages; an answer to a query no longer wanted (a newer one run,
// the screen left) is dropped too. The server saying the sign-in has
// ended, or the space is no longer the person's, is not a refusal to
// word: it goes to `onEnded` or `onGone`, for the screen to say so in
// the channel's way.

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

export function useSearch(
  origin: string,
  token: string | null,
  spaceId: string,
  onEnded: () => void,
  onGone: () => void,
) {
  const [state, setState] = useState<SearchState>(IDLE);
  // Whether the failure is the sign-in over (Unauthenticated) or the
  // space lost (PermissionDenied, membership gone since the scope
  // loaded): the state goes back to idle and the screen is told. NotFound
  // stays an error to word, since a filter can produce it.
  const over = useCallback(
    (err: unknown): boolean => {
      if (!(err instanceof ConnectError)) return false;
      const tell = err.code === Code.Unauthenticated ? onEnded : err.code === Code.PermissionDenied ? onGone : null;
      if (!tell) return false;
      setState(IDLE);
      tell();
      return true;
    },
    [onEnded, onGone],
  );
  // Which request's answer is still wanted: each search starts a new
  // generation, and an older page's answer is kept only in its own.
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  // An older page out right now, known at once: `loadingMore` changes
  // only after a render, and the list can say it reached the end twice
  // before one, which asked for the same page twice and showed it twice.
  const paging = useRef(false);

  const run = useCallback(
    (text: string) => {
      const query = text.trim();
      const mine = ++generation.current;
      paging.current = false;
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
          if (mine !== generation.current || over(err)) return;
          setState({ query, searching: false, results: null, loadingMore: false, error: searchErrorText(err) });
        },
      );
    },
    [origin, token, spaceId, over],
  );

  // The older page before the last match. Not while the last one's
  // failure is still shown: the footer's swap to it changes the list's
  // height, which the list reports as the end reached again, and that
  // would ask, fail and swap until the person scrolled. The failure
  // line is itself the way to ask again (retryMore).
  const older = useCallback(() => {
    const { query, results } = state;
    const last = results?.messages.at(-1);
    if (!results?.hasOlder || paging.current || !last || !token) return;
    const mine = generation.current;
    paging.current = true;
    setState((before) => ({ ...before, loadingMore: true, error: null }));
    searchMessages(origin, token, spaceId, query, last.id).then(
      ({ messages, hasOlder }) => {
        if (mine !== generation.current) return;
        paging.current = false;
        setState((before) => ({
          ...before,
          loadingMore: false,
          results: { messages: [...(before.results?.messages ?? []), ...messages], hasOlder },
        }));
      },
      (err: unknown) => {
        if (mine !== generation.current) return;
        paging.current = false;
        if (over(err)) return;
        setState((before) => ({ ...before, loadingMore: false, error: searchErrorText(err) }));
      },
    );
  }, [origin, token, spaceId, state, over]);
  const more = useCallback(() => {
    if (!state.error) older();
  }, [state.error, older]);

  return { state, run, more, retryMore: older };
}
