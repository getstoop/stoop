import { type OptionResult, votersShown, votesLabel } from "@stoop/core/polls";
import type { MessageAuthor } from "@stoop/gen/stoop/chat/v1/message_pb";
import { Fragment } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Avatar from "../../components/Avatar";
import { CheckIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";

// One line of the option's text, at the system's default text size: the
// mark is centred on it however large the reader's text is.
const LINE = 22;
const MARK = 22;
const FACE = 20;

// One option of a poll's card (PollRow): its share of the voters as a bar
// behind it, its text and count, and who chose it under them. While the
// poll is open the top line is the vote's control, a radio with one
// choice and a checkbox with several, read out with its count and
// whether it is the reader's vote; pressing it is the card's (onVote).
// Closed, it is a line of the results: the reader's own vote ticked, and
// the winner, or each tied option, badged with its bar in the accent.
// Who chose it is plain text: on mobile the votes sheet lists everyone.
export default function PollOption({
  result,
  open,
  multiple,
  badge,
  pending,
  busy,
  myUserId,
  origin,
  token,
  onVote,
  onLongPress,
}: {
  result: OptionResult;
  open: boolean;
  multiple: boolean;
  // The outcome badge a leading option wears once the poll is closed.
  badge: "winner" | "tied" | null;
  // This option was pressed and the server has yet to answer.
  pending: boolean;
  // Some option was: no other press is taken meanwhile.
  busy: boolean;
  myUserId: string;
  origin: string;
  token: string;
  // Absent on the menu's card, which takes no vote.
  onVote?: (optionId: number) => void;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { fontScale } = useWindowDimensions();
  const count = votesLabel(result.votes);
  const line = { height: LINE * fontScale };

  const top = (
    <>
      {open ? (
        <View style={[styles.markLine, line]}>
          <View
            style={[
              styles.box,
              !multiple && styles.radio,
              result.mine && styles.boxOn,
              pending && styles.boxPending,
            ]}
          >
            {result.mine && <CheckIcon color={theme.onAccent} size={14} />}
          </View>
        </View>
      ) : (
        <View style={[styles.markLine, line]}>{result.mine && <CheckIcon color={theme.accent} size={16} />}</View>
      )}
      <Text style={styles.label}>{result.text}</Text>
      <View style={styles.end}>
        {badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge === "winner" ? "Winner" : "Tied"}</Text>
          </View>
        )}
        <Text style={[styles.count, badge && styles.countWon]}>{count}</Text>
      </View>
    </>
  );

  return (
    <View style={[styles.option, result.mine && styles.mine, pending && styles.pending]}>
      <View style={[styles.bar, badge && styles.barWon, { width: `${result.ratio * 100}%` }]} />
      {open && onVote ? (
        <Pressable
          accessibilityRole={multiple ? "checkbox" : "radio"}
          accessibilityLabel={`${result.text}, ${count}${result.mine ? ", your vote" : ""}`}
          accessibilityState={{ checked: result.mine, disabled: busy, busy: pending }}
          onPress={() => {
            if (!busy) onVote(result.id);
          }}
          onLongPress={onLongPress}
          style={({ pressed }) => [styles.top, pressed && !busy && styles.pressed]}
        >
          {top}
        </Pressable>
      ) : (
        <View
          style={styles.top}
          accessible
          accessibilityLabel={[
            result.text,
            count,
            result.mine && "your vote",
            badge === "winner" ? "winner" : badge === "tied" ? "tied" : "",
          ]
            .filter(Boolean)
            .join(", ")}
        >
          {top}
        </View>
      )}
      {result.votes > 0 && (
        <Voters voters={result.voters} myUserId={myUserId} origin={origin} token={token} styles={styles} />
      )}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

export const voterName = (voter: MessageAuthor): string => voter.displayName || voter.username || "Someone";

// "You, Jun Watanabe and Sam Reyes", or past three "You, Jun Watanabe and
// 12 others" (core/polls votersShown), after the first three faces.
function Voters({
  voters,
  myUserId,
  origin,
  token,
  styles,
}: {
  voters: MessageAuthor[];
  myUserId: string;
  origin: string;
  token: string;
  styles: Styles;
}) {
  const shown = votersShown(voters, myUserId);
  const me = shown.you ? voters.find((voter) => voter.id === myUserId) : undefined;
  const faces = [...(me ? [me] : []), ...shown.named].slice(0, 3);
  const words = [...(me ? [{ key: "you", name: "You", you: true }] : [])].concat(
    shown.named.map((voter) => ({ key: voter.id, name: voterName(voter), you: false })),
  );
  const others = shown.others > 0 ? `${shown.others} ${shown.others === 1 ? "other" : "others"}` : "";
  return (
    <View style={styles.voters}>
      <View style={styles.faces}>
        {faces.map((voter) => (
          <Avatar
            key={voter.id}
            name={voterName(voter)}
            fileId={voter.avatarFileId}
            origin={origin}
            token={token}
            size={FACE}
          />
        ))}
      </View>
      <Text style={styles.names}>
        {words.map((word, index) => (
          <Fragment key={word.key}>
            {index > 0 && (index === words.length - 1 && !others ? " and " : ", ")}
            {word.you ? <Text style={styles.you}>You</Text> : word.name}
          </Fragment>
        ))}
        {others && ` and ${others}`}
      </Text>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    option: {
      overflow: "hidden",
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: tokens.radiusMd,
      backgroundColor: theme.surface,
    },
    mine: {
      borderColor: theme.accent,
    },
    // Pressed, and the server has yet to answer.
    pending: {
      borderStyle: "dashed",
      borderColor: theme.accent,
    },
    bar: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      backgroundColor: theme.raised,
    },
    barWon: {
      backgroundColor: theme.accentSoft,
    },
    top: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "flex-start",
      columnGap: 10,
      rowGap: 2,
      minHeight: 44,
      paddingVertical: 11,
      paddingLeft: 10,
      paddingRight: 12,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    markLine: {
      width: MARK,
      alignItems: "center",
      justifyContent: "center",
    },
    // The control's mark: a box with several choices, a circle with one,
    // filled and ticked when it is the reader's.
    box: {
      width: MARK,
      height: MARK,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: theme.textMuted,
      borderRadius: tokens.radius,
      backgroundColor: theme.panel,
    },
    radio: {
      borderRadius: tokens.radiusPill,
    },
    boxOn: {
      borderColor: theme.accent,
      backgroundColor: theme.accent,
    },
    boxPending: {
      borderStyle: "dashed",
      borderColor: theme.accent,
    },
    label: {
      // The width under which the count wraps below the text.
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 150,
      minWidth: 0,
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
      lineHeight: LINE,
    },
    end: {
      marginLeft: "auto",
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: LINE,
    },
    badge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: tokens.radiusPill,
      backgroundColor: theme.accentSoft,
    },
    badgeText: {
      color: theme.text,
      fontSize: tokens.textXs,
      fontWeight: "600",
      letterSpacing: 0.66,
      textTransform: "uppercase",
    },
    count: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
      lineHeight: LINE,
    },
    countWon: {
      color: theme.text,
      fontWeight: "700",
    },
    // Under the text, clear of the mark.
    voters: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 6,
      paddingLeft: 42,
      paddingRight: 12,
      paddingBottom: 10,
    },
    faces: {
      flexDirection: "row",
      gap: 2,
    },
    names: {
      flex: 1,
      minWidth: 0,
      color: theme.textMuted,
      fontSize: tokens.textUi,
      lineHeight: 20,
    },
    you: {
      color: theme.text,
      fontWeight: "600",
    },
  });
}
