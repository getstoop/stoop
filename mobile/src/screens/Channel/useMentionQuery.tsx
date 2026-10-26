import { type Edited, withAt, withPick } from "@stoop/core/mentionPicks";
import {
  channelCandidates,
  channelQueryAt,
  type MentionCandidate,
  mentionCandidates,
  mentionQueryAt,
} from "@stoop/core/mentions";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, type TextInputSelectionChangeEvent } from "react-native";
import { ComposerAbove } from "./composerAbove";
import MentionList from "./MentionList";
import type { ComposerMentions } from "./useMentionNames";

type Selection = { start: number; end: number };

// The composer field's mention list: the @handle or #name being typed at
// the caret (core/mentions mentionQueryAt, channelQueryAt; a #name only
// where channels can be linked), its candidates by web's rules, the list
// shown over the card while there are any (ComposerAbove), and a pick
// putting the token in place of the query. The @ button types an "@" at
// the caret, which opens the list the same way. The field's text and the
// caret arrive in either order, so the query is read from both as they
// stand; a pick or the @ button sets the caret once, then leaves it to
// the field.
export function useMentionQuery({
  draft,
  setDraft,
  writing,
  replaced,
  names,
  origin,
  token,
}: {
  draft: string;
  setDraft: (text: string) => void;
  writing: boolean;
  // Changes when the draft is put in from outside the field (an edit
  // begun or ended), which leaves the caret at its end.
  replaced: string | null;
  names: ComposerMentions;
  origin: string;
  token: string;
}) {
  const showAbove = useContext(ComposerAbove);
  // The field's selection as it last said, unknown until it does (a card
  // just opened, or a draft put in, has its caret at the end), and one set
  // by a pick, which iOS doesn't report back. Both are dropped with the
  // card or the draft they were for, so a new field is never handed an
  // old caret.
  const [selection, setSelection] = useState<Selection | null>(null);
  const [placed, setPlaced] = useState<Selection | undefined>(undefined);
  // Run as the card or the draft changes; neither is read.
  useEffect(() => {
    setSelection(null);
    setPlaced(undefined);
  }, [writing, replaced]);
  const caret = !selection
    ? draft.length
    : selection.start === selection.end
      ? Math.min(selection.end, draft.length)
      : -1;

  const mention = writing && caret >= 0 ? mentionQueryAt(draft, caret) : null;
  const channel =
    writing && caret >= 0 && !mention && names.channels.size > 0 ? channelQueryAt(draft, caret) : null;
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

  const place = (edited: Edited) => {
    const at = { start: edited.caret, end: edited.caret };
    setDraft(edited.text);
    setSelection(at);
    setPlaced(at);
  };
  const pick = (candidate: MentionCandidate) => {
    if (query) place(withPick(draft, query.start, caret, candidate));
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
    // For the field: the caret a pick set, until the field moves it.
    selection: placed,
    onSelectionChange: (event: TextInputSelectionChangeEvent) => {
      setSelection(event.nativeEvent.selection);
      setPlaced(undefined);
    },
    // The @ button: at the caret, or after a selection.
    typeAt: () => {
      place(withAt(draft, caret >= 0 ? caret : Math.min(selection?.end ?? draft.length, draft.length)));
    },
  };
}
