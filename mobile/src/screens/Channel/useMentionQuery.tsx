import { atReplace, pickReplace, type Replace } from "@stoop/core/mentionPicks";
import {
  channelCandidates,
  channelQueryAt,
  type MentionCandidate,
  mentionCandidates,
  mentionQueryAt,
} from "@stoop/core/mentions";
import { useContext, useEffect, useMemo, useRef } from "react";
import { AccessibilityInfo } from "react-native";
import { ComposerAbove } from "./composerAbove";
import MentionList from "./MentionList";
import type { ComposerMentions } from "./useMentionNames";

// The composer field's mention list: the @handle or #name being typed at
// the caret (core/mentions mentionQueryAt, channelQueryAt; a #name only
// where channels can be linked), its candidates by web's rules, the list
// shown over the card while there are any (ComposerAbove), and a pick
// putting the token in place of the query. The @ button types an "@" at
// the caret, which opens the list the same way. The field reports its
// caret's line up to the caret (`before`, null over a selection) and
// does the replacing itself (RichField replaceBeforeCaret).
export function useMentionQuery({
  before,
  writing,
  names,
  origin,
  token,
  replace,
}: {
  before: string | null;
  writing: boolean;
  names: ComposerMentions;
  origin: string;
  token: string;
  replace: (edit: Replace) => void;
}) {
  const showAbove = useContext(ComposerAbove);
  const text = writing ? before : null;
  const mention = text !== null ? mentionQueryAt(text, text.length) : null;
  const channel =
    text !== null && !mention && names.channels.size > 0 ? channelQueryAt(text, text.length) : null;
  const query = mention ?? channel;
  const candidates = useMemo(
    () =>
      mention
        ? mentionCandidates([...names.members.values()], [...names.groups.values()], mention.query, {
            channelAndHere: names.channelAndHere,
          })
        : channel
          ? channelCandidates(names.channels, channel.query)
          : [],
    [mention?.query, channel?.query, names],
  );

  const pick = (candidate: MentionCandidate) => {
    if (query && text !== null) replace(pickReplace(text, query.start, candidate));
  };
  // The list keeps one callback, which reads the latest pick.
  const latestPick = useRef(pick);
  latestPick.current = pick;
  const onPick = useRef((candidate: MentionCandidate) => latestPick.current(candidate)).current;

  const list = useMemo(
    () =>
      candidates.length > 0 ? (
        <MentionList candidates={candidates} onPick={onPick} origin={origin} token={token} />
      ) : null,
    [candidates, onPick, origin, token],
  );
  useEffect(() => showAbove(list), [list, showAbove]);
  useEffect(() => () => showAbove(null), [showAbove]);

  // A screen reader hears that the list opened, and how long it is.
  const shown = candidates.length;
  const wasShown = useRef(0);
  useEffect(() => {
    if (shown > 0 && wasShown.current === 0) {
      AccessibilityInfo.announceForAccessibility(shown === 1 ? "1 suggestion" : `${shown} suggestions`);
    }
    wasShown.current = shown;
  }, [shown]);

  return {
    // The @ button: at the caret (at a selection's start).
    typeAt: () => replace(atReplace(before ?? "")),
  };
}
