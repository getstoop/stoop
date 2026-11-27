import { timestampDate } from "@bufbuild/protobuf/wkt";
import { zoneLabel } from "@stoop/core/dates";
import { isPollOpen, isTimePoll, mySelection, outcomeOf, pollOf, pollResults, votersLabel } from "@stoop/core/polls";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { memo } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { authorName } from "../../api/authors";
import Avatar from "../../components/Avatar";
import { CalendarIcon, GlobeIcon, LockIcon, PinIcon, PollIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import { messageTime } from "./messageTime";
import PollOption, { voterName } from "./PollOption";
import { usePendingVote } from "./pendingVotes";

const AVATAR = 36;
const GAP = 10;
// One line of the question, at the system's default text size.
const LINE = 21;
// The screen reader's way to the menu a long press opens (PollMenu), as a
// system row offers its own.
const MENU_ACTION = { name: "longpress", label: "Poll actions" };
// Past this text size View votes goes under the foot's words, as each
// option's count goes under its text (PollOption).
const LARGE_TEXT = 1.3;

// A poll in the channel (docs/architecture/messaging.md → Polls): its
// author's face, name and time as a message's, the question under them
// with a Poll or Closed badge, and the card across the row's whole width
// under that. Each option is a vote's control while the poll is open
// (PollOption): pressing one sends the reader's whole selection
// (pendingVotes, core/polls nextSelection), and the card changes only when
// the server answers, the pressed option showing it is on its way. The
// results and who chose what show before voting. The foot says how many
// voted, or who closed it and when, and View votes opens the votes sheet
// (onViewVotes), which lists everyone. Closed, the card is the final
// results, the reader's own vote ticked and the winner, or each tied
// option, badged. A poll always heads its own group. A long press opens
// its menu (PollMenu); Close poll is there alone, not on the card. A
// screen reader reaches the menu from the question, which is one element
// with a Poll actions action. On
// the menu's card (`card`) it takes no vote, has no View votes, and its
// time carries its day. A row a jump landed on (`flashed`, a closing
// row's View) is ringed for a moment, as a message is. A time poll ("Find
// a time") takes a calendar for its mark, says under the kind line which
// zone its times are in (the reader's own), and words each option as its
// time in that zone (core/polls pollResults label); a time gone by while
// it is open is marked Passed (PollOption), worked out as the card draws,
// with no timer, so the mark comes with the next redraw.
export default memo(function PollRow({
  message,
  myUserId,
  origin,
  token,
  card = false,
  flashed = false,
  onVote,
  onViewVotes,
  onLongPress,
}: {
  message: Message;
  myUserId: string;
  origin: string;
  token: string;
  card?: boolean;
  flashed?: boolean;
  onVote?: (message: Message, optionId: number) => void;
  onViewVotes?: (message: Message) => void;
  onLongPress?: (message: Message) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { fontScale } = useWindowDimensions();
  const pending = usePendingVote(message.id);
  const poll = pollOf(message);
  if (!poll) return null;
  const open = isPollOpen(poll);
  const now = new Date();
  const timed = isTimePoll(poll);
  const results = pollResults(poll, myUserId, now);
  const outcome = outcomeOf(poll, results);
  const voted = mySelection(poll, myUserId).length > 0;
  const author = message.author;
  const name = authorName(author);
  const created = message.createdAt ? timestampDate(message.createdAt) : undefined;
  const closedAt = poll.closedAt ? timestampDate(poll.closedAt) : undefined;
  const hold = onLongPress && (() => onLongPress(message));
  const vote = !card && onVote ? (optionId: number) => onVote(message, optionId) : undefined;
  const foot = open
    ? footOpen(poll.voterCount, voted, poll.multiple)
    : [
        `Closed by ${poll.closedBy ? voterName(poll.closedBy) : "someone"}`,
        closedAt ? messageTime(closedAt, true) : "",
        votersLabel(poll.voterCount),
      ]
        .filter(Boolean)
        .join(" · ");
  const kind = open
    ? poll.multiple
      ? "Choose any number"
      : "Choose one"
    : `Final results · ${poll.multiple ? "any number of choices each" : "one choice each"}`;

  return (
    <Pressable
      onLongPress={hold}
      // Not one element: the question, each option and the foot are read
      // apart, and the options are controls.
      accessible={false}
      accessibilityLabel={flashed ? "Found message" : undefined}
      testID={flashed ? "focus-target" : undefined}
      style={({ pressed }) => [
        card ? styles.card : styles.row,
        flashed && !card && styles.flashed,
        pressed && !!hold && styles.pressed,
      ]}
    >
      {message.pinned && !card && (
        <View style={styles.pinned}>
          <PinIcon color={theme.textMuted} size={12} />
          <Text style={styles.muted}>Pinned</Text>
        </View>
      )}
      <View style={styles.lead}>
        <Avatar name={name} fileId={author?.avatarFileId ?? ""} origin={origin} token={token} size={AVATAR} />
        <View style={styles.main}>
          <View style={styles.byline}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
              {author?.deleted && <Text style={styles.mutedName}> (deleted)</Text>}
            </Text>
            {created && <Text style={styles.time}>{messageTime(created, card)}</Text>}
          </View>
          <View
            style={styles.head}
            // One element to a screen reader: the question and whether it
            // is open, and the way to the poll's menu, whatever state the
            // card is in (a closed poll nobody voted on has no other).
            accessible
            accessibilityRole="header"
            accessibilityLabel={`${open ? "Poll" : "Closed poll"}: ${poll.question}`}
            accessibilityHint={hold ? "Has a Poll actions action" : undefined}
            accessibilityActions={hold ? [MENU_ACTION] : undefined}
            onAccessibilityAction={
              hold
                ? (event) => {
                    if (event.nativeEvent.actionName === MENU_ACTION.name) hold();
                  }
                : undefined
            }
          >
            <View style={[styles.glyph, { height: LINE * fontScale }]}>
              {timed ? (
                <CalendarIcon color={theme.textMuted} size={18} />
              ) : (
                <PollIcon color={theme.textMuted} size={18} />
              )}
            </View>
            <Text style={styles.question}>{poll.question}</Text>
            <View style={styles.state}>
              <Text style={styles.stateText}>{open ? "Poll" : "Closed"}</Text>
            </View>
          </View>
        </View>
      </View>
      <View style={styles.poll}>
        <View style={styles.kind}>
          {open ? (
            <View style={[styles.kindBox, !poll.multiple && styles.kindRadio]} />
          ) : (
            <LockIcon color={theme.textMuted} size={14} />
          )}
          <Text style={styles.kindText}>{kind}</Text>
        </View>
        {timed && (
          <View style={styles.kind}>
            <GlobeIcon color={theme.textMuted} size={14} />
            <Text style={styles.kindText}>Your time zone: {zoneLabel(now)}</Text>
          </View>
        )}
        <View
          style={styles.options}
          accessibilityRole={open && !poll.multiple ? "radiogroup" : undefined}
          accessibilityLabel={open ? poll.question : "Final results"}
        >
          {results.map((result) => (
            <PollOption
              key={result.id}
              result={result}
              open={open}
              multiple={poll.multiple}
              badge={result.leading ? outcome : null}
              pending={pending === result.id}
              busy={pending !== null}
              myUserId={myUserId}
              origin={origin}
              token={token}
              onVote={vote}
              onLongPress={hold}
            />
          ))}
        </View>
        <View style={[styles.foot, fontScale > LARGE_TEXT && styles.footStacked]}>
          <Text style={styles.footText}>{foot}</Text>
          {!card && onViewVotes && poll.voterCount > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View votes"
              onPress={() => onViewVotes(message)}
              onLongPress={hold}
              style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
            >
              <Text style={styles.chipText}>View votes</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Pressable>
  );
});

// "5 people voted", and once the reader has: "· You can change your
// vote", as web's card words it.
function footOpen(voters: number, voted: boolean, multiple: boolean): string {
  if (voters === 0) return "No votes yet";
  const count = votersLabel(voters);
  if (!voted) return count;
  return `${count} · You can change your vote${multiple ? "s" : ""}`;
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    // A message row's insets (MessageRow), so the avatar lines up.
    row: {
      marginHorizontal: 8,
      paddingHorizontal: 8,
      paddingTop: 3,
      paddingBottom: 6,
      borderRadius: tokens.radiusMd,
    },
    // The menu's card: a message card's 12 all round.
    card: {
      paddingHorizontal: 12,
      paddingTop: 4,
      paddingBottom: 12,
    },
    flashed: {
      backgroundColor: theme.panel,
      boxShadow: `inset 0 0 0 1.5px ${theme.accent}`,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    pinned: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingTop: 8,
      paddingLeft: AVATAR + GAP,
    },
    lead: {
      flexDirection: "row",
      gap: GAP,
      paddingTop: 8,
    },
    main: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    byline: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: 8,
    },
    name: {
      flexShrink: 1,
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "700",
    },
    mutedName: {
      color: theme.textMuted,
      fontWeight: "400",
    },
    muted: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    time: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    head: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
    },
    glyph: {
      justifyContent: "center",
    },
    question: {
      flex: 1,
      minWidth: 0,
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
      lineHeight: LINE,
    },
    state: {
      marginTop: 1,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: tokens.radiusPill,
      backgroundColor: theme.raised,
    },
    stateText: {
      color: theme.text,
      fontSize: tokens.textXs,
      fontWeight: "600",
      letterSpacing: 0.66,
      textTransform: "uppercase",
    },
    // The card, across the row's whole width under the byline.
    poll: {
      marginTop: 8,
      padding: 12,
      gap: 10,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: tokens.radiusLg,
      backgroundColor: theme.panel,
    },
    kind: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    kindBox: {
      width: 12,
      height: 12,
      borderWidth: 1,
      borderColor: theme.textMuted,
      borderRadius: 3,
    },
    kindRadio: {
      borderRadius: tokens.radiusPill,
    },
    kindText: {
      flexShrink: 1,
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    options: {
      gap: 6,
    },
    foot: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 20,
    },
    footStacked: {
      flexDirection: "column",
      alignItems: "flex-start",
    },
    footText: {
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
      color: theme.textMuted,
      fontSize: tokens.textSm,
      lineHeight: 18,
    },
    chip: {
      minHeight: 44,
      paddingHorizontal: 16,
      justifyContent: "center",
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: tokens.radiusPill,
      backgroundColor: theme.raised,
    },
    chipPressed: {
      backgroundColor: theme.hover,
    },
    chipText: {
      color: theme.text,
      fontSize: tokens.textUi,
    },
  });
}
