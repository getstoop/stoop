import { optionLabel, pollOf, votesLabel } from "@stoop/core/polls";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Avatar from "../../components/Avatar";
import Sheet from "../../components/Sheet";
import { type Theme, tokens, useTheme } from "../../theme";
import { voterName } from "./PollOption";

// The most of the screen's height the list takes before it scrolls.
const LIST_HEIGHT = 0.6;
const FACE = 24;

// Everyone who voted on a poll, from its card's View votes: a sheet
// (Sheet) with the question, then every option with its count and the
// people who chose it, in the order they voted, the reader marked
// "(you)", each option worded as the card words it (a time poll's in the
// reader's zone). The names on the card are not a control on mobile; this is
// where the whole list is. It follows the poll as votes arrive; the
// screen closes it when the poll goes. A list too long for the sheet
// scrolls in it.
export default function PollVotes({
  message,
  myUserId,
  origin,
  token,
  onClose,
}: {
  message: Message;
  myUserId: string;
  origin: string;
  token: string;
  onClose: () => void;
}) {
  const styles = makeStyles(useTheme());
  const most = useWindowDimensions().height * LIST_HEIGHT;
  // As ChannelAbout's topic: a list that fits leaves a swipe down to the
  // sheet; one that scrolls keeps it while away from its top.
  const [height, setHeight] = useState(0);
  const top = useRef(0);
  const poll = pollOf(message);
  if (!poll) return null;

  return (
    <Sheet label="Votes" closeTestID="poll-votes-close" onClose={onClose}>
      {({ hold }) => (
        <>
          <Text style={styles.title} accessibilityRole="header">
            Votes
          </Text>
          <Text style={styles.question}>{poll.question}</Text>
          <ScrollView
            style={{ maxHeight: most }}
            contentContainerStyle={styles.body}
            scrollEnabled={height > most}
            onContentSizeChange={(_width, drawn) => setHeight(drawn)}
            onLayout={(event) => {
              top.current = event.nativeEvent.layout.y;
            }}
            onScroll={(event) => hold(event.nativeEvent.contentOffset.y > 0 ? top.current : null)}
            scrollEventThrottle={16}
          >
            {poll.options.map((option) => (
              <View key={option.id}>
                <View style={styles.option} accessible accessibilityRole="header">
                  <Text style={styles.optionText}>{optionLabel(option)}</Text>
                  <Text style={styles.count}>{votesLabel(option.voters.length)}</Text>
                </View>
                {option.voters.map((voter) => (
                  <View key={voter.id} style={styles.voter} accessible>
                    <Avatar
                      name={voterName(voter)}
                      fileId={voter.avatarFileId}
                      origin={origin}
                      token={token}
                      size={FACE}
                    />
                    <Text style={styles.name}>
                      {voterName(voter)}
                      {voter.deleted && <Text style={styles.muted}> (deleted)</Text>}
                      {voter.id === myUserId && <Text style={styles.muted}> (you)</Text>}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </>
      )}
    </Sheet>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    title: {
      marginHorizontal: 12,
      color: theme.text,
      fontSize: 17,
      fontWeight: "700",
    },
    question: {
      marginHorizontal: 12,
      marginTop: 2,
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
    body: {
      paddingBottom: 8,
    },
    option: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: 8,
      paddingTop: 12,
      paddingBottom: 4,
      paddingHorizontal: 12,
    },
    optionText: {
      flex: 1,
      minWidth: 0,
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "700",
    },
    count: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
    voter: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 40,
      paddingHorizontal: 12,
      paddingVertical: 4,
    },
    name: {
      flex: 1,
      minWidth: 0,
      color: theme.text,
      fontSize: 16,
    },
    muted: {
      color: theme.textMuted,
    },
  });
}
