import { type Command, type CommandPlace, commandQueryAt, matchingCommands } from "@stoop/core/commands";
import { useEffect, useMemo, useRef } from "react";
import { AccessibilityInfo } from "react-native";
import CommandList from "./CommandList";

// The composer field's command list: while the whole draft is "/" and
// letters (core/commands commandQueryAt, read on the Markdown, so code, a
// quote or a list item never counts), the commands offered here whose
// names start with them, and after a space the one so named. The list is
// for the composer to show over the card (useComposerAbove); it is shut
// while the card is down, while a @handle or #name is being typed, and
// where `open` says so (an edit, a composer that opens no forms). A tap
// picks; the composer reads the draft as a send would and opens the form.
export function useCommandQuery({
  draft,
  open,
  place,
  onPick,
}: {
  // The whole draft, as Markdown.
  draft: string;
  open: boolean;
  place: CommandPlace;
  onPick: (command: Command) => void;
}) {
  const query = open ? commandQueryAt(draft) : null;
  const { thread, canPost } = place;
  const commands = useMemo(
    () => (query ? matchingCommands(query, { thread, canPost }) : []),
    [query?.query, query?.spaced, thread, canPost],
  );

  // The list keeps one callback, which reads the latest pick.
  const latestPick = useRef(onPick);
  latestPick.current = onPick;
  const pick = useRef((command: Command) => latestPick.current(command)).current;

  const list = useMemo(
    () => (commands.length > 0 ? <CommandList commands={commands} onPick={pick} /> : null),
    [commands, pick],
  );

  // A screen reader hears that the list opened, and how long it is.
  const shown = commands.length;
  const wasShown = useRef(0);
  useEffect(() => {
    if (shown > 0 && wasShown.current === 0) {
      AccessibilityInfo.announceForAccessibility(shown === 1 ? "1 command" : `${shown} commands`);
    }
    wasShown.current = shown;
  }, [shown]);

  return list;
}
